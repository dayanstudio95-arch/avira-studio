// The films Worker. Two audiences:
//  - Studio admins, from the StudioOS hub (another origin): /api/admin/*, signed in
//    with their Supabase session (Authorization: Bearer). Data lives in Supabase.
//  - Couples and visitors: /api/watch/*, /api/studio/*, /api/cover/* — public pages
//    and video streaming. Every stream re-checks the gallery's expiry.
import { randomId, randomToken, sign, verify } from './auth';
import { checkFilmLinks, LINK_CHECK_CRON, nightly, type LinkCheckReport, type NightlyReport } from './cleanup';
import { dashboard } from './dashboard';
import { addFacesChunk, FACE_CONSENT, FACE_SEARCHES_PER_HOUR, FACE_TOKEN_SECONDS, faceToken, faceTokenValid, guestChunk, removeFacePhotos, removePerson, type PersonFace } from './faces';
import { DESIGN_BANK_LIMITS, DESIGNER_ROLES, designerGalleries, designerPhotos, pixelSize } from './albumDesigner';
import { albumOrderToken, albumSummary, orderingOf, orderLink, orderNeeded, orderStateOrNull, revOf, saveAlbumDraft, sha256Hex, submitAlbum, unlockAlbum } from './albums';
import { cleanCustom, MAX_ALBUM_BYTES, usedPhotos, type Album } from '../shared/album';
import { accessOf, ensureGuestId, isStudioPreview, NO_ACCESS_VERSION, previewToken, requireView, rotateGuestId, studioCookieFor, thumbsToken, unlockCookie, viewerGallery, type Role } from './access';
import { cleanDesign, effectiveDesign } from '../shared/design';
import { coverPath, forgetCover, getCover, putCover } from './covers';
import { manifestFor, pageWithMeta } from './pages';
import {
  ALBUM_BLOCK_WORDS,
  albumGuard,
  applyFilmsAndFolder,
  buildGallery,
  closeGallery,
  coupleView,
  createGallery,
  daysLeft,
  purgeGallery,
  restoreGallery,
  trashGallery,
  filmsWithoutCode,
  getOwnedGallery,
  isExpired,
  kindOf,
  updateGallery,
  validDays,
  type AlbumBlock,
} from './galleries';
import { applyPhotoEdits, cachedPreview, cachedSize, chosenLost, cleanWho, coverOf, downloadFailedPage, editPhotos, favoritesFrom, fetchOriginalStart, heartsFor, listPhotos, mergePhotoData, nextGen, photoDoc, photoResponse, publicPhotos, readsThroughDropbox, sharedLinkReplaced, withoutPreviewWarning } from './photos';
import { askedVersion, photoBase, photoPath, printPhotoBase } from '../shared/photoUrl';
import { exifTakenAt, normalizeLabel, pictureKind, xmpLabel } from '../shared/exif';
import { datesBatchSize } from '../shared/photosets';
import { resolveFile, resolveFolder } from './providers';
import { accountName, dropboxError, exchangeCode, forgetAccessToken, oauthAuthorizeUrl, revokeConnection } from './providers/dropbox';
import { filmIssues } from './linkCheck';
import { CONNECTION_PROVIDERS } from '../shared/providers';
import { streamFilm, streamFolderZip } from './providers/stream';
import { adminView, getSettings, musicUrl, normalizeSocial, studioNameOf } from './settings';
import { MIT4MIT_DECLARATION, fetchMit4mitReviews, isMit4mitUrl, mit4mitBizId } from './mit4mit';
import { ADMIN_UPLOADS_PER_HOUR, checkTurnstile, cleanReviews, clientIp, getStudioPage, leadLimits, mergeImport, publicStudio, rateLimit, saveStudioPage, validateLead } from './studio';
import { DROPBOX_SECRET, MAX_LISTS, storeFor, studioChanges, type FilmsStudio, type Store, type StudioUser, type TenantInfo } from './store';
import { READ_ONLY_REDUCE_WORDS, requireKind, requireStudioAdmin } from './supabaseAuth';
import { PRINT_BLOCK_WORDS, PRINT_EXPIRED_WORDS, printBlock, printLinkExpiresAt, printLinkExpired } from './printLink';
import { sealSecret } from './secretBox';
import type { Env, Gallery, PhotoData } from './types';
import { HttpError } from './types';

/** `waitUntil`: work that may finish after the answer was sent (the edge-cache writes, P66). */
type Ctx = { request: Request; env: Env; params: Record<string, string>; url: URL; store: Store; waitUntil?: (p: Promise<unknown>) => void };
type Handler = (ctx: Ctx) => Promise<Response>;

const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => {
      keys.push(k);
      return '([^/]+)';
    }) + '/?$',
  );
  routes.push({ method, pattern, keys, handler });
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers ?? {}) } });

async function body<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'בקשה לא תקינה');
  }
}

/** Gallery passwords and download codes: seen and changed by the studio's owner and admins only (D12). */
const SECRET_ROLES = ['owner', 'admin'];
const seesSecrets = (me: StudioUser) => SECRET_ROLES.includes(me.role);

/** A gallery for the hub; others (the studio manager) learn only whether it has a password or code. */
function adminGallery(g: Gallery, me: StudioUser) {
  const out = { ...g, daysLeft: daysLeft(g), expired: isExpired(g), hasPassword: Boolean(g.password), hasDownloadPin: Boolean(g.downloadPin) };
  if (!seesSecrets(me)) {
    delete out.password;
    delete out.downloadPin;
  }
  return out;
}

/**
 * A gallery in the studio's list (fix plan P70): read without its secrets (listView), so it says nothing about
 * a password or a download code — the gallery's own page does (adminGallery).
 */
function listRow(g: Gallery) {
  return { ...g, daysLeft: daysLeft(g), expired: isExpired(g) };
}

/** The gallery form of someone who may not see the secrets leaves them as they are. */
function withoutSecrets(me: StudioUser, input: Record<string, unknown>): Record<string, unknown> {
  if (seesSecrets(me)) return input;
  const { password: _p, downloadPin: _d, ...rest } = input;
  return rest;
}

/** First 12 bytes of SHA-256, hex: enough to tell texts apart, never reversible to an IP. */
async function shortHash(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri(url: URL): string {
  return `${url.origin}/api/admin/dropbox/callback`;
}

function stateSecret(env: Env): string {
  if (env.FILMS_STATE_SECRET) return env.FILMS_STATE_SECRET;
  if (env.CLOUD_MOCK) return 'mock-state-secret';
  throw new HttpError(500, 'FILMS_STATE_SECRET is not configured');
}

function hubUrl(env: Env, url: URL): string {
  return (env.HUB_URL || url.origin).replace(/\/$/, '');
}

/** The studio's access version (P73): every cookie and token is checked against it. */
const versionOf = (t: TenantInfo | null | undefined) => t?.accessVersion ?? NO_ACCESS_VERSION;

/**
 * The preview token of a gallery for this signed-in member (P73: the studio, the member, 12 hours, the access
 * version). The studio was already read by requireStudioAdmin (kept for this request).
 */
async function studioPass(env: Env, store: Store, me: StudioUser, galleryId: string): Promise<string> {
  const version = versionOf(await store.getTenant(me.tenantId));
  return previewToken(stateSecret(env), { galleryId, tenantId: me.tenantId, userId: me.userId, version });
}

route('GET', '/api/health', async () => json({ ok: true }));
// The free UptimeRobot plan checks with HEAD only (GET is a paid option).
route('HEAD', '/api/health', async () => new Response(null, { status: 200 }));

// ---------- films settings (studio admin) ----------
route('GET', '/api/admin/settings', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store);
  const [s, films, tenant] = await Promise.all([getSettings(env, store, me.tenantId), store.getFilmsStudio(me.tenantId), store.getTenant(me.tenantId)]);
  return json({ ...adminView(s, films), slug: tenant?.slug ?? '', redirectUri: redirectUri(url) });
});

route('PUT', '/api/admin/settings', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const f = await store.getFilmsStudio(me.tenantId);
  const before = structuredClone(f);
  const input = await body<Record<string, unknown>>(request);
  if (input.defaultDays !== undefined) {
    const d = Math.floor(Number(input.defaultDays));
    if (!Number.isFinite(d) || d < 1 || d > 3650) throw new HttpError(400, 'מספר ימי ברירת המחדל לא תקין');
    f.defaultDays = d;
  }
  // Empty terms = back to the built-in default text.
  if (typeof input.termsText === 'string') f.termsText = input.termsText.trim() ? input.termsText : null;
  if (typeof input.contactLine === 'string') f.contactLine = input.contactLine.trim().slice(0, 200);
  const socials: ['vimeo' | 'youtube', string[], string][] = [
    ['vimeo', ['vimeo.com'], 'Vimeo'],
    ['youtube', ['youtube.com', 'youtu.be'], 'יוטיוב'],
  ];
  for (const [key, hosts, label] of socials) {
    if (typeof input[key] !== 'string') continue;
    const v = normalizeSocial(input[key], hosts);
    if (String(input[key]).trim() && !v) throw new HttpError(400, `הקישור ל${label} לא נראה תקין`);
    f[key] = v;
  }
  if (typeof input.musicDefault === 'string') f.musicDefault = f.music?.some((t) => t.id === input.musicDefault) ? input.musicDefault : '';
  if (input.designDefault !== undefined) f.designDefault = cleanDesign(input.designDefault);
  if (typeof input.labelSetsOn === 'boolean') f.labelSetsOn = input.labelSetsOn;
  if (input.labelMap && typeof input.labelMap === 'object') {
    const map: Record<string, string> = {};
    for (const c of ['yellow', 'red', 'blue', 'purple', 'green']) {
      const v = (input.labelMap as Record<string, unknown>)[c];
      if (typeof v === 'string') map[c] = v.trim().slice(0, 40);
    }
    f.labelMap = map;
  }
  if (typeof input.headline === 'string') f.headline = input.headline.trim().slice(0, 120);
  if (typeof input.about === 'string') f.about = input.about.trim().slice(0, 1500);
  if (typeof input.slug === 'string' && input.slug.trim()) await store.setSlug(me.tenantId, input.slug.trim().toLowerCase());
  // Only what this form changed: a song uploaded meanwhile (or a Dropbox connection) stays.
  await store.patchFilmsStudio(me.tenantId, studioChanges(before, f));
  const [s, tenant] = await Promise.all([getSettings(env, store, me.tenantId), store.getTenant(me.tenantId)]);
  return json({ ...adminView(s, f), slug: tenant?.slug ?? '', redirectUri: redirectUri(url) });
});

// ---------- Dropbox connection (per studio) ----------
/**
 * "Disconnect every access" (P73): the studio's access version goes up, so every preview token, thumbs token,
 * studio cookie and gallery password / download-code cookie made before stops working at once (couples type
 * the password again; the hub's open screens load again). The owner and admins only, like the passwords
 * (D12); allowed also when the subscription is not active (it only takes access away).
 */
route('POST', '/api/admin/access/revoke', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store);
  if (!seesSecrets(me)) throw new HttpError(403, 'רק הבעלים או מנהל מערכת יכולים לנתק את כל הגישות');
  return json({ accessVersion: await store.bumpAccessVersion(me.tenantId) });
});

route('GET', '/api/admin/dropbox/connect', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  if (!env.DROPBOX_APP_KEY || !env.DROPBOX_APP_SECRET) throw new HttpError(400, 'חיבור דרופבוקס עדיין לא הוגדר במערכת. פנו לתמיכה.');
  const state = await sign(stateSecret(env), `dbx:${me.tenantId}:${me.userId}:${Date.now()}`);
  // JSON, not a redirect: the hub calls this with fetch (Bearer token) and then navigates.
  return json({ url: oauthAuthorizeUrl(env.DROPBOX_APP_KEY, redirectUri(url), state) });
});

// Dropbox sends the browser here, with no session. The connection is NOT finished
// here: the code goes back to the hub, where the signed-in admin finishes it
// (/finish below). That binds the Dropbox account to the person who is actually
// signed in to that studio, so a connect link started by someone else can't
// attach a victim's Dropbox to the attacker's studio (OAuth login CSRF).
route('GET', '/api/admin/dropbox/callback', async ({ env, url }) => {
  const back = new URL(`${hubUrl(env, url)}/films/settings`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (!code || !(await verify(stateSecret(env), state))) {
    back.searchParams.set('dropbox', 'error');
    return Response.redirect(back.toString(), 302);
  }
  back.searchParams.set('dropbox_code', code);
  back.searchParams.set('dropbox_state', state);
  return Response.redirect(back.toString(), 302);
});

route('POST', '/api/admin/dropbox/finish', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const { code, state } = await body<{ code: string; state: string }>(request);
  const payload = await verify(stateSecret(env), String(state ?? ''));
  const m = payload ? /^dbx:([^:]+):([^:]+):(\d+)$/.exec(payload) : null;
  if (!code || !m || Date.now() - Number(m[3]) > 15 * 60_000) throw new HttpError(400, 'חיבור הדרופבוקס פג תוקף. נסו שוב.');
  // Same studio AND the same person who started the connection.
  if (m[1] !== me.tenantId || m[2] !== me.userId) throw new HttpError(403, 'החיבור הזה התחיל ממשתמש אחר. התחילו אותו מחדש מהחשבון שלכם.');
  const s = await getSettings(env, store, me.tenantId);
  const { refreshToken } = await exchangeCode(s, String(code), redirectUri(url));
  // A reconnect over an earlier connection ends that one at Dropbox first (P65): its token stops working everywhere,
  // not only here. One try; a failure does not stop the new connection.
  if (s.dropbox.refreshToken && s.dropbox.refreshToken !== refreshToken) await revokeConnection(s, env);
  // Sealed for this studio (fix plan P16, worker/secretBox.ts); getSettings opens it.
  await store.setSecret(me.tenantId, DROPBOX_SECRET, await sealSecret(env, me.tenantId, DROPBOX_SECRET, refreshToken));
  // The previous connection's token must not answer for the new one (also not for the account name below).
  await forgetAccessToken(env, s);
  const f = await store.getFilmsStudio(me.tenantId);
  try {
    f.dropboxAccountName = await accountName({ ...s, dropbox: { ...s.dropbox, refreshToken } }, env);
  } catch {
    f.dropboxAccountName = '';
  }
  await store.patchFilmsStudio(me.tenantId, { dropboxAccountName: f.dropboxAccountName });
  const [fresh, tenant] = await Promise.all([getSettings(env, store, me.tenantId), store.getTenant(me.tenantId)]);
  return json({ ...adminView(fresh, f), slug: tenant?.slug ?? '', redirectUri: redirectUri(url) });
});

/**
 * What stops when the studio disconnects Dropbox (P65), for the hub's question before it does: open photo galleries
 * read through the connection, and films streamed with it — in open film galleries and on the studio page.
 */
route('GET', '/api/admin/dropbox/impact', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store);
  const [impact, films] = await Promise.all([store.dropboxImpact(me.tenantId), store.getFilmsStudio(me.tenantId)]);
  const studioFilms = (films.showcase?.films ?? []).filter((f) => CONNECTION_PROVIDERS.includes(f.provider)).length;
  return json({ ...impact, studioFilms });
});

route('POST', '/api/admin/dropbox/disconnect', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  // Ended at Dropbox itself first (P65; the sealed token is opened by getSettings), then removed here. One try: a
  // failure there does not keep the studio connected.
  await revokeConnection(await getSettings(env, store, me.tenantId), env);
  await store.setSecret(me.tenantId, DROPBOX_SECRET, null);
  const f = await store.getFilmsStudio(me.tenantId);
  f.dropboxAccountName = undefined;
  await store.patchFilmsStudio(me.tenantId, { dropboxAccountName: undefined });
  const [s, tenant] = await Promise.all([getSettings(env, store, me.tenantId), store.getTenant(me.tenantId)]);
  await forgetAccessToken(env, s);
  return json({ ...adminView(s, f), slug: tenant?.slug ?? '', redirectUri: redirectUri(url) });
});

// ---------- cloud lookups (Dropbox, Google Drive, MyAirBridge) ----------
// Reading a folder or checking a link uses the studio's cloud connection on its behalf: an edit, not a look (P65).
route('POST', '/api/admin/resolve-folder', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const { url } = await body<{ url: string }>(request);
  return json(await resolveFolder({ env, settings: await getSettings(env, store, me.tenantId), origin: new URL(request.url).origin }, String(url ?? '')));
});

route('POST', '/api/admin/check-link', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const { url } = await body<{ url: string }>(request);
  return json(await resolveFile({ env, settings: await getSettings(env, store, me.tenantId), origin: new URL(request.url).origin }, String(url ?? '')));
});

// ---------- galleries (each studio sees only its own) ----------
/**
 * The studio's galleries, newest first, with the list's fields only (P70: no password, download code, print
 * token or guests' id). Without `limit`/`offset` every gallery, as before (read page by page); with them one
 * page and the total: `{ items, total }` (the hub reads pages of 500).
 */
route('GET', '/api/admin/galleries', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store);
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');
  const version = versionOf(await store.getTenant(me.tenantId));
  if (limit === null && offset === null) return json(await withThumbs(env, (await store.listGalleries(me.tenantId)).map(listRow), version));
  const n = Number(limit ?? GALLERIES_PAGE);
  const from = Number(offset ?? 0);
  if (!Number.isInteger(n) || n < 1 || n > 1000 || !Number.isInteger(from) || from < 0) throw new HttpError(400, 'בקשה לא תקינה');
  const { galleries, total } = await store.pageGalleries(me.tenantId, n, from);
  return json({ items: await withThumbs(env, galleries.map(listRow), version), total });
});

/** Galleries per page of the hub's list (and without `limit`). */
const GALLERIES_PAGE = 500;

/** The gallery link picker (films ↔ photos): every gallery of the studio in a few fields (P70). */
route('GET', '/api/admin/galleries/options', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store);
  return json(await store.galleryOptions(me.tenantId));
});

/**
 * A small picture per gallery for the studio's list (addresses on the films site; the hub adds its
 * origin): the cover photo of a photo gallery, a film gallery's cover or the frame taken from a film.
 * Film galleries without a picture get a token, so the hub can take a frame (thumbFilmUrl). The token is a
 * thumbs token (P73): it opens these pictures and that film, never the gallery, a large photo or a download.
 * A photo gallery's cover is the key saved with it (cover_key, written with every save of its list and
 * filled for older galleries by 0130): the list reads no photo lists (P62).
 */
async function withThumbs<T extends Gallery>(env: Env, list: T[], version: number): Promise<(T & { thumb: string; previewToken?: string })[]> {
  const secret = stateSecret(env);
  return Promise.all(
    list.map(async (g) => {
      // A gallery in the trash opens nothing: no picture, no token.
      if (g.deletedAt) return { ...g, thumb: '' };
      const pt = await thumbsToken(secret, { galleryId: g.id, tenantId: g.tenantId, version });
      if (kindOf(g) === 'photos') {
        const key = g.coverKey ?? '';
        return { ...g, thumb: key ? photoPath(g.id, g.photosGen, key, 'm', `pt=${encodeURIComponent(pt)}`) : '' };
      }
      if (g.hasCover) return { ...g, thumb: coverPath(g.id, g, `pt=${encodeURIComponent(pt)}`) };
      if (g.hasThumb) return { ...g, thumb: `/api/admin/galleries/${g.id}/thumb?pt=${encodeURIComponent(pt)}` };
      return { ...g, thumb: '', previewToken: pt };
    }),
  );
}

route('POST', '/api/admin/galleries', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const input = withoutSecrets(me, await body<Record<string, unknown>>(request));
  requireKind(me, input.kind === 'photos' ? 'photos' : 'films');
  const s = await getSettings(env, store, me.tenantId);
  return json(adminGallery(await createGallery(store, env, s, input as never, me.tenantId), me));
});

// Many galleries at once, from a pasted list ("couple date venue" per line, parsed in the browser).
route('POST', '/api/admin/galleries/bulk', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const s = await getSettings(env, store, me.tenantId);
  const { items, kind: k } = await body<{ items: { coupleName?: string; date?: string; venue?: string }[]; kind?: string }>(request);
  const kind = k === 'photos' ? 'photos' : 'films';
  requireKind(me, kind);
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'הרשימה ריקה');
  if (items.length > 100) throw new HttpError(400, 'עד 100 אירועים בכל ייבוא');
  items.forEach((it, i) => {
    if (!String(it.coupleName ?? '').trim()) throw new HttpError(400, `בשורה ${i + 1} חסרים שמות הזוג`);
  });
  // Every line is checked and built first, then all are saved in one write (P70): all of them, or none.
  const created = items.map((it, i) => {
    try {
      return buildGallery(env, s, { kind, coupleName: it.coupleName, date: it.date ?? '', venue: it.venue ?? '' }, me.tenantId);
    } catch (e) {
      if (e instanceof HttpError) throw new HttpError(e.status, `בשורה ${i + 1}: ${e.message}`);
      throw e;
    }
  });
  await store.putGalleries(created);
  return json(created.map((g) => adminGallery(g, me)));
});

route('GET', '/api/admin/galleries/:id', async ({ request, env, store, params }) => {
  const me = await requireStudioAdmin(request, store);
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  requireKind(me, kindOf(g));
  // Photo galleries get their guests' address the first time the studio opens them.
  if (kindOf(g) === 'photos' && !g.guestId && (await store.getTenant(me.tenantId))?.access === 'ok') await ensureGuestId(store, g);
  // What the nightly link check found (P65): "הקישור נשבר" next to a film it could not open.
  const issues = kindOf(g) === 'films' ? await filmIssues(env, g.id, g.films) : [];
  const out = adminGallery(g, me);
  const films = out.films.map((f, i) => (issues[i] ? { ...f, linkIssue: { at: issues[i]!.at, reason: issues[i]!.reason } } : f));
  return json({ ...out, films, terms: await store.termsAccepts(g.id), previewToken: await studioPass(env, store, me, g.id) });
});

/**
 * A new guests' link for a photo gallery (P73, D15(3)): the old one answers 404 from now on (the couple's link
 * stays). Written only while the guests' id is the one read, so two clicks make one new link.
 */
route('POST', '/api/admin/galleries/:id/rotate-guest', async ({ request, store, params }) => {
  const { me, g } = await ownedPhotoGallery(request, store, params.id, true);
  const saved = await rotateGuestId(store, g);
  if (!saved) throw new HttpError(409, 'הגלריה השתנתה בינתיים. טענו את הדף מחדש ונסו שוב.');
  return json({ guestId: saved.guestId ?? '', gallery: adminGallery(saved, me) });
});

route('PUT', '/api/admin/galleries/:id', async ({ request, env, store, params }) => {
  // A read-only studio may still set a new password or code, or close it earlier (P55).
  const me = await requireStudioAdmin(request, store, { write: true, allowReadOnly: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  requireKind(me, kindOf(g));
  const s = await getSettings(env, store, me.tenantId);
  const input = withoutSecrets(me, await body<Record<string, unknown>>(request));
  delete input.kind; // a gallery keeps its kind
  if (typeof input.music === 'string' && input.music && input.music !== 'none') {
    const f = await store.getFilmsStudio(me.tenantId);
    if (!f.music?.some((t) => t.id === input.music)) throw new HttpError(400, 'השיר לא נמצא');
  }
  return json(adminGallery(await updateGallery(store, env, s, g, input, { onlyLower: me.readOnly }), me));
});

route('DELETE', '/api/admin/galleries/:id', async ({ request, env, store, params, url }) => {
  // The trash and removal lower exposure: also for a read-only studio (P55).
  const me = await requireStudioAdmin(request, store, { write: true, allowReadOnly: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  // To the trash (30 days, restorable); "?forever=1" on a gallery already in the trash removes it now.
  const forever = url.searchParams.get('forever') === '1' && Boolean(g.deletedAt);
  // A designed album (photo galleries only) may keep it (P71): 409 with the reason as its code; a sent album
  // goes to the trash only with "?force=1" (the studio said yes).
  if (kindOf(g) === 'photos' && (forever || !g.deletedAt)) {
    const block = albumGuard((await store.albumGuards(me.tenantId, [g.id]))[g.id], forever ? 'purge' : 'trash', url.searchParams.get('force') === '1');
    if (block) throw new HttpError(409, ALBUM_BLOCK_WORDS[block], block);
  }
  if (forever) await purgeGallery(store, env, g);
  else await trashGallery(store, g);
  // Its cover leaves this data centre's cache now (P66; the link already stops at the gallery check everywhere).
  await forgetCover(g.id, g.coverVersion);
  return json({ ok: true });
});

// ?kind=photos|films: the summary of one menu's galleries ("גלריות" / "סרטים" in the hub); without it, both.
route('GET', '/api/admin/dashboard', async ({ request, store, url }) => {
  const me = await requireStudioAdmin(request, store);
  const only = url.searchParams.get('kind');
  const kinds = { films: Boolean(me.films) && only !== 'photos', photos: Boolean(me.photos) && only !== 'films' };
  return json(await dashboard(store, me.tenantId, kinds), { headers: { 'Cache-Control': 'no-store' } });
});

route('POST', '/api/admin/galleries/:id/restore', async ({ request, store, params }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  requireKind(me, kindOf(g));
  // Face search was switched off when its data was deleted: the hub tells the studio to switch it on and scan (P68).
  return json({ ...adminGallery(await restoreGallery(store, g), me), ...(g.facesOffAt ? { faceSearchOff: true } : {}) });
});

/**
 * Why a gallery of a batch was left as it was (the hub says it in words). P71: 'album_submitted' (sent again with
 * `force` after the studio's yes), 'album_order' and 'album_paid' (albumGuard).
 */
type Skipped = { id: string; reason: 'not_found' | 'module' | 'in_trash' | 'not_in_trash' | 'changed' | 'faces_failed' | AlbumBlock };

/**
 * Photo galleries whose face data one batch request deletes: about 3 requests each (list, delete, record), so
 * a batch stays under the 50 a call may send (P70). The rest come back in `remaining`, and the hub sends them.
 */
const FACES_PER_BATCH = 6;

const BATCH_ACTIONS = ['extend', 'close', 'trash', 'restore', 'purge'];
/** What a read-only studio may still do to many galleries (P55): what lowers exposure. */
const REDUCING_BATCH_ACTIONS = ['close', 'trash', 'purge'];

/** A closing time the screen showed (an ISO time), else the one read now. */
const seenOf = (seen: unknown, g: Gallery) => (typeof seen === 'string' && Number.isFinite(Date.parse(seen)) ? seen : g.expiresAt);

/**
 * Several galleries at once (up to 50): extend, close now, trash, restore, remove for good (from the trash).
 * A fixed number of requests, whatever the count (P70): one read of the galleries, one of which have face data,
 * face data of at most FACES_PER_BATCH galleries, then one write — extending through films_galleries_extend, each
 * gallery only while its closing time is still the one the screen showed (`seen`: id → expiresAt), so a second
 * click extends nothing. Answers `done` (how many), `doneIds`, `skipped` ({ id, reason }) and `remaining` (photo
 * galleries whose face data waits for the next request; the hub sends them again).
 */
route('POST', '/api/admin/galleries/batch', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true, allowReadOnly: true });
  const { ids, action, days, seen, force } = await body<{ ids: string[]; action: string; days?: number; seen?: Record<string, unknown>; force?: boolean }>(request);
  // A read-only studio closes, trashes and removes (lower exposure), never extends or restores (P55).
  if (me.readOnly && !REDUCING_BATCH_ACTIONS.includes(action)) throw new HttpError(402, READ_ONLY_REDUCE_WORDS);
  if (!Array.isArray(ids) || ids.length === 0) throw new HttpError(400, 'לא נבחרו גלריות');
  if (ids.length > 50) throw new HttpError(400, 'עד 50 גלריות בכל פעם');
  if (!BATCH_ACTIONS.includes(action)) throw new HttpError(400, 'פעולה לא מוכרת');
  const n = action === 'extend' ? validDays(days ?? (await store.getFilmsStudio(me.tenantId)).defaultDays) : 0;
  const asked = [...new Set(ids.map(String))];
  const found = new Map((await store.getGalleries(me.tenantId, asked)).map((g) => [g.id, g]));
  const skipped: Skipped[] = [];
  let ready: Gallery[] = [];
  const fromTrash = action === 'restore' || action === 'purge';
  for (const id of asked) {
    const g = found.get(id);
    if (!g) skipped.push({ id, reason: 'not_found' });
    // Only galleries of a module the studio has.
    else if (!(kindOf(g) === 'photos' ? me.photos : me.films)) skipped.push({ id, reason: 'module' });
    else if (Boolean(g.deletedAt) !== fromTrash) skipped.push({ id, reason: fromTrash ? 'not_in_trash' : 'in_trash' });
    else ready.push(g);
  }
  // A designed album keeps its photo gallery out of the trash, or from removal for good (P71, albumGuard): one read
  // for the photo galleries, before anything is touched. A sent album goes with `force` (the studio's yes).
  if (action === 'trash' || action === 'purge') {
    const photoIds = ready.filter((g) => kindOf(g) === 'photos').map((g) => g.id);
    const guards = photoIds.length ? await store.albumGuards(me.tenantId, photoIds) : {};
    ready = ready.filter((g) => {
      const block = albumGuard(guards[g.id], action, force === true);
      if (block) skipped.push({ id: g.id, reason: block });
      return !block;
    });
  }
  // Closed, in the trash or removed: a photo gallery's face data goes first (privacy), and a failure leaves that
  // gallery as it was (said in `skipped`, never hidden).
  const remaining: string[] = [];
  if (action === 'close' || action === 'trash' || action === 'purge') {
    const photoIds = ready.filter((g) => kindOf(g) === 'photos').map((g) => g.id);
    const withFaces = new Set(photoIds.length ? await store.faceGalleriesAmong(photoIds) : []);
    const go: Gallery[] = [];
    let faced = 0;
    for (const g of ready) {
      if (!withFaces.has(g.id)) go.push(g);
      else if (faced >= FACES_PER_BATCH) remaining.push(g.id);
      else {
        faced++;
        try {
          await store.deleteFaces(g.id, { searchOff: action !== 'purge' });
          go.push(g);
        } catch (e) {
          console.error(`[films] batch ${action}: face data of ${g.id} not deleted:`, (e as Error).message);
          skipped.push({ id: g.id, reason: 'faces_failed' });
        }
      }
    }
    ready = go;
  }
  const readyIds = ready.map((g) => g.id);
  let done: string[] = [];
  if (!readyIds.length) done = [];
  else if (action === 'extend') {
    const items = ready.map((g) => ({ id: g.id, seen: seenOf(seen?.[g.id], g) }));
    done = (await store.extendGalleries(me.tenantId, items, n)).map((r) => r.id);
  } else if (action === 'close') done = await closeGallery(store, me.tenantId, ready);
  else if (action === 'trash') done = await store.patchGalleries(me.tenantId, readyIds, { deletedAt: new Date().toISOString() }, { deletedAt: null });
  else if (action === 'restore') done = await store.patchGalleries(me.tenantId, readyIds, { deletedAt: undefined });
  else {
    // One request; a linked gallery forgets the link by itself (films_galleries.linked_id … on delete set null).
    done = await store.deleteGalleries(me.tenantId, readyIds);
    const gone = new Set(done);
    await Promise.all(ready.filter((g) => gone.has(g.id)).flatMap((g) => [env.KV.delete(`cover:${g.id}`), ...(g.hasThumb ? [env.KV.delete(`thumb:${g.id}`)] : [])]));
  }
  // Their covers leave this data centre's cache now (P66).
  if (action === 'trash' || action === 'purge') {
    const gone = new Set(done);
    await Promise.all(ready.filter((g) => gone.has(g.id) && g.hasCover).map((g) => forgetCover(g.id, g.coverVersion)));
  }
  const doneSet = new Set(done);
  // Changed meanwhile (another tab, the clean-up, a closing time moved since the screen read it).
  for (const id of readyIds) if (!doneSet.has(id)) skipped.push({ id, reason: 'changed' });
  // Extended or restored galleries whose face search was switched off when its data was deleted (P68): the hub says so.
  const reopened = action === 'extend' || action === 'restore';
  const faceSearchOff = reopened ? ready.filter((g) => doneSet.has(g.id) && g.facesOffAt).map((g) => g.id) : [];
  return json({ ok: true, done: done.length, doneIds: done, skipped, remaining, ...(reopened ? { faceSearchOff } : {}) });
});

route('POST', '/api/admin/galleries/:id/extend', async ({ request, store, params }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  requireKind(me, kindOf(g));
  const { days, expiresAt } = await body<{ days?: number; expiresAt?: string }>(request);
  const n = validDays(days ?? (await store.getFilmsStudio(me.tenantId)).defaultDays);
  if (g.deletedAt) throw new HttpError(400, 'הגלריה בסל המחזור. שחזרו אותה קודם.');
  // Only while its closing time is still the one the screen showed (P70): a second click extends nothing.
  const [r] = await store.extendGalleries(me.tenantId, [{ id: g.id, seen: seenOf(expiresAt, g) }], n);
  if (!r) throw new HttpError(409, 'תאריך הסגירה של הגלריה השתנה בינתיים. רעננו את הדף ונסו שוב.');
  return json({ ...adminGallery({ ...g, expiresAt: r.expiresAt, days: r.days }, me), ...(g.facesOffAt ? { faceSearchOff: true } : {}) });
});

route('POST', '/api/admin/galleries/:id/cover', async ({ request, env, store, params }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  requireKind(me, kindOf(g));
  await adminUploadLimit(store, me.tenantId);
  // A new version every time (a time stamp: two uploads never share one), so the address changes too.
  const coverVersion = Math.max(Date.now(), (g.coverVersion ?? 0) + 1);
  await putCover(env, g.id, request, coverVersion);
  const saved = await store.patchGallery(g.tenantId, g.id, { hasCover: true, coverVersion });
  if (!saved) throw new HttpError(404, 'הגלריה לא נמצאה');
  // The old cover's copy at the edge goes (the new one has its own version, and so its own key).
  await forgetCover(g.id, g.coverVersion);
  return json({ ok: true, coverUrl: coverPath(g.id, saved) });
});

// ---------- photo galleries (admin) ----------
async function ownedPhotoGallery(request: Request, store: Store, id: string, write = false, allowReadOnly = false) {
  const me = await requireStudioAdmin(request, store, { write, module: 'photos', allowReadOnly });
  const g = await getOwnedGallery(store, me.tenantId, id);
  if (kindOf(g) !== 'photos') throw new HttpError(400, 'זו גלריית סרטים, לא גלריית תמונות');
  return { me, g };
}

async function adminPhotos(env: Env, store: Store, me: StudioUser, galleryId: string, data: PhotoData | null) {
  if (!data) return null;
  const [allHearts, allInsta] = await Promise.all([store.listHearts(galleryId), store.listInsta(galleryId)]);
  // The studio sees the hearts of every photo in the list, hidden ones too (P70).
  const { favBy, insta } = heartsFor(data, allHearts, allInsta, { includeHidden: true });
  return { ...data, favorites: favoritesFrom(favBy), favBy, insta, previewToken: await studioPass(env, store, me, galleryId) };
}

/**
 * Changes the photo list without losing a change saved at the same moment (editPhotos), then writes
 * the four gallery columns that follow from it — only those, never the whole gallery row. An edit
 * written as what changed (`how: 'patch'`, P61) set the count and the cover in the same step.
 */
async function savePhotoData(store: Store, g: Gallery, change: (data: PhotoData | null) => PhotoData, how: 'whole' | 'patch' = 'whole') {
  const saved = await editPhotos(store, g, change, how);
  if (saved.patched || saved.unchanged) return saved;
  const { data } = saved;
  const row = await store.patchGallery(g.tenantId, g.id, {
    photoCount: data.items.filter((i) => !i.hidden).length,
    coverKey: coverOf(data) || undefined,
    folderUrl: data.folderUrl,
    folderProvider: data.provider === 'mock' ? undefined : data.provider,
  });
  if (!row) throw new HttpError(404, 'הגלריה לא נמצאה');
  return saved;
}

/** Photo keys the couple or the studio chose something for: hearts, Instagram marks, lists, album slots. */
async function chosenKeys(store: Store, galleryId: string): Promise<Set<string>> {
  const [favBy, insta, lists, album] = await Promise.all([store.listHearts(galleryId), store.listInsta(galleryId), store.listLists(galleryId), store.getAlbum(galleryId)]);
  const keys = new Set([...Object.keys(favBy), ...insta, ...lists.flatMap((l) => l.keys)]);
  if (album) for (const k of usedPhotos(album)) keys.add(k);
  return keys;
}

/** Loading the folder would leave more than a tenth of the chosen photos without their photo. */
class LoadNeedsConfirm {
  constructor(readonly lost: number, readonly total: number) {}
}

/**
 * Reads the gallery's folder again and merges it with the saved list (mergePhotoData keeps each
 * photo's key on its file, fix plan P64). When more than 10% of the photos with hearts, Instagram
 * marks, lists or album slots would be gone, nothing is saved and the answer is `needsConfirm` with
 * the numbers; the studio's screen asks, and sends again with `confirm: true` (decision D16).
 * P66: the generation (`gen`, in every photo address) goes up only when the link or a photo's file
 * changed (nextGen); a folder under a new shared link inherits nothing and its face data goes; Dropbox
 * photos that will have no preview (HEIC, over 20MB) come back as `warnings`.
 */
route('POST', '/api/admin/galleries/:id/photos/load', async ({ request, env, store, params }) => {
  const { me, g } = await ownedPhotoGallery(request, store, params.id, true);
  const s = await getSettings(env, store, me.tenantId);
  const { url, confirm } = await body<{ url: string; confirm?: boolean }>(request);
  // The folder is read once; only the merge with the saved list is repeated on a clash.
  const fresh = await listPhotos(env, s, String(url ?? ''), new URL(request.url).origin);
  const chosen = confirm === true ? null : await chosenKeys(store, g.id);
  try {
    const { before, data } = await savePhotoData(store, g, (old) => {
      const merged = mergePhotoData(fresh, old);
      const next = { ...merged, gen: nextGen(old, merged) };
      if (chosen && old) {
        const { lost, total } = chosenLost(chosen, old, next);
        if (lost * 10 > total) throw new LoadNeedsConfirm(lost, total);
      }
      return next;
    });
    // Another couple's folder under a new shared link: the old photos' face data goes at once (privacy).
    if (sharedLinkReplaced(before, data)) await store.deleteFaces(g.id);
    // Photos gone from the folder (or hidden by it): their face data goes (P68).
    else if (data.faceSearch) await removeFacePhotos(store, g, before, data);
    const warning = withoutPreviewWarning(data);
    return json({ ...(await adminPhotos(env, store, me, g.id, data)), ...(warning ? { warnings: [warning] } : {}) });
  } catch (e) {
    if (!(e instanceof LoadNeedsConfirm)) throw e;
    return json({ needsConfirm: true, lost: e.lost, total: e.total });
  }
});

route('GET', '/api/admin/galleries/:id/photos', async ({ request, env, store, params }) => {
  const { me, g } = await ownedPhotoGallery(request, store, params.id);
  return json(await adminPhotos(env, store, me, g.id, (await photoDoc(store, g))?.data ?? null));
});

/**
 * When each photo was taken and its Lightroom colour, from the first 64KB of each file. At most
 * datesBatchSize(provider, key) photos per call (shared/photosets.ts: the free plan allows about 50
 * outside requests per call, P62/P64). Answers `dates` and `labels` for the photos read (a time of
 * null = the file has none), `failed` for those the cloud did not answer with a picture (no date and no
 * label: not read), `skipped` for those past this call's size and `batch`, that size. The studio's
 * page asks again for both.
 */
route('POST', '/api/admin/galleries/:id/photos/dates', async ({ request, env, store, params, url }) => {
  const { me, g } = await ownedPhotoGallery(request, store, params.id);
  const data = (await photoDoc(store, g))?.data;
  if (!data) throw new HttpError(400, 'קודם טען את התמונות');
  const { keys } = await body<{ keys: string[] }>(request);
  const byKey = new Map(data.items.map((i) => [i.key, i]));
  const asked = [...new Set((Array.isArray(keys) ? keys : []).map(String))]
    .map((k) => byKey.get(k))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const s = await getSettings(env, store, me.tenantId);
  const limit = datesBatchSize(data.provider, { googleApiKey: Boolean(s.googleApiKey) });
  const wanted = asked.slice(0, limit);
  const dates: Record<string, number | null> = {};
  const labels: Record<string, string> = {};
  const failed: string[] = [];
  // Dropbox asks for a gentler pace than Drive and pCloud.
  const dropbox = data.provider === 'dropbox' || data.provider === 'dropbox-link';
  const lanes = dropbox ? 8 : limit;
  const queue = [...wanted];
  // A rejected Dropbox connection stops the whole batch with its message, instead of empty dates.
  let stop: HttpError | null = null;
  await Promise.all(
    Array.from({ length: Math.min(lanes, queue.length) }, async () => {
      while (queue.length && !stop) {
        const it = queue.shift()!;
        try {
          const res = await fetchOriginalStart(env, s, data, it, url.origin);
          if (dropbox && res.status === 401) {
            stop = dropboxError(401, await res.text().catch(() => ''));
            break;
          }
          // Only a picture counts: Drive's sign-in or quota page, an error in JSON or an empty answer
          // is a failure to read, never "this photo has no time" (P64).
          const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
          if ((!res.ok && res.status !== 206) || /text\/|json/.test(type)) {
            await res.body?.cancel().catch(() => {});
            failed.push(it.key);
            continue;
          }
          const buf = new Uint8Array(await res.arrayBuffer()).subarray(0, 65536);
          if (!pictureKind(buf)) {
            failed.push(it.key);
            continue;
          }
          dates[it.key] = exifTakenAt(buf);
          labels[it.key] = normalizeLabel(xmpLabel(buf));
        } catch (e) {
          if (dropbox && e instanceof HttpError) {
            stop = e;
            break;
          }
          failed.push(it.key);
        }
      }
    }),
  );
  if (stop) throw stop;
  // Past this call's size: not read now, asked for again by the studio's page.
  const skipped = asked.slice(limit).map((it) => it.key);
  return json({ dates, labels, failed, skipped, batch: limit });
});

route('PUT', '/api/admin/galleries/:id/photos', async ({ request, env, store, params }) => {
  const { me, g } = await ownedPhotoGallery(request, store, params.id, true, true);
  const input = await body<Parameters<typeof applyPhotoEdits>[1]>(request);
  // A read-only studio may only switch face search off (P55: it deletes the face data).
  if (me.readOnly && !(Object.keys(input ?? {}).length === 1 && input.faceSearch === false)) throw new HttpError(402, READ_ONLY_REDUCE_WORDS);
  let notes = { ambiguous: [] as string[] };
  // The edit is a patch (these photos, these fields), so on a clash it is applied again to the newer list;
  // only what it changed goes to the database (P61: diffPhotoData → films_photos_patch).
  const { before, data: next } = await savePhotoData(
    store,
    g,
    (data) => {
      if (!data) throw new HttpError(400, 'קודם טען את התמונות מהתיקייה');
      notes = { ambiguous: [] };
      return applyPhotoEdits(data, input, notes);
    },
    'patch',
  );
  // Face search switched off: its face data goes at once (privacy: not kept longer than needed).
  if (before?.faceSearch && !next.faceSearch) await store.deleteFaces(g.id);
  // Photos hidden: their face data leaves what guests download, and its files are rewritten (P68).
  else if (before?.faceSearch && next.faceSearch) await removeFacePhotos(store, g, before, next);
  const answer = await adminPhotos(env, store, me, g.id, next);
  // A key two photos share (a list from before P64) was not edited: the screen offers to load again.
  if (!notes.ambiguous.length) return json(answer);
  return json({ ...answer, ambiguous: notes.ambiguous, warning: 'חלק מהתמונות חולקות קוד אחד עם תמונה אחרת, ולכן השינוי לא נשמר עליהן. טענו את התיקייה מחדש כדי להפריד ביניהן.' });
});

// ---------- the studio's album sketch editor (work order item 41, port B9; worker/albumDesigner.ts) ----------
// Read only, the album roles (album manager too), the photos module, a writable or read-only studio alike.
async function designerGallery(request: Request, store: Store, id: string) {
  const me = await requireStudioAdmin(request, store, { module: 'photos', roles: DESIGNER_ROLES });
  const g = await getOwnedGallery(store, me.tenantId, id);
  if (kindOf(g) !== 'photos' || g.deletedAt) throw new HttpError(404, 'גלריית התמונות לא נמצאה');
  return { me, g };
}

/** The studio's photo galleries, with the hub event each belongs to (the editor picks the order's event's one). */
route('GET', '/api/admin/album-designer/galleries', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store, { module: 'photos', roles: DESIGNER_ROLES });
  return json(designerGalleries(await store.listGalleries(me.tenantId)));
});

/** The bank: the photos the couple sees, in the gallery's order, with their sets — and a thumbs token (small previews). */
route('GET', '/api/admin/album-designer/galleries/:id/photos', async ({ request, env, store, params }) => {
  const { me, g } = await designerGallery(request, store, params.id);
  const data = (await photoDoc(store, g))?.data ?? null;
  const token = await thumbsToken(stateSecret(env), { galleryId: g.id, tenantId: me.tenantId, version: versionOf(await store.getTenant(me.tenantId)) });
  return json({ gallery: designerGalleries([g])[0], ...designerPhotos(data), thumbsToken: token });
});

/** One photo, large (`?s=l`, the editor's big spread) or the original (`?s=full`, the print export). Never edge-cached. */
route('GET', '/api/admin/album-designer/galleries/:id/file/:key', async ({ request, env, store, params, url }) => {
  const { g } = await designerGallery(request, store, params.id);
  const size = url.searchParams.get('s') === 'full' ? 'full' : 'l';
  const read = await store.getPhotoItem(g.tenantId, g.id, params.key, { copies: size === 'full' });
  if (!read?.item || read.item.hidden) throw new HttpError(404, 'התמונה לא נמצאה');
  return photoResponse(env, () => getSettings(env, store, g.tenantId), read.data, read.item, size, request, false, g.id);
});

/**
 * Pixel sizes of photos (for the editor's "too small to print" warning), from the first 64KB of each original — at
 * most datesBatchSize(…) a call, like `…/photos/dates` (the free plan's outside requests). Answers `sizes` for the
 * photos read, `failed` (no picture / no size in those bytes), `skipped` (past this call's size) and `batch`.
 */
route('POST', '/api/admin/album-designer/galleries/:id/sizes', async ({ request, env, store, params, url }) => {
  const { me, g } = await designerGallery(request, store, params.id);
  const data = (await photoDoc(store, g))?.data;
  if (!data) return json({ sizes: {}, failed: [], skipped: [], batch: 0 });
  const { keys } = await body<{ keys: string[] }>(request);
  const byKey = new Map(data.items.filter((i) => !i.hidden).map((i) => [i.key, i]));
  const asked = [...new Set((Array.isArray(keys) ? keys : []).map(String))]
    .map((k) => byKey.get(k))
    .filter((i): i is NonNullable<typeof i> => Boolean(i));
  const s = await getSettings(env, store, me.tenantId);
  const limit = datesBatchSize(data.provider, { googleApiKey: Boolean(s.googleApiKey) });
  const queue = asked.slice(0, limit);
  const sizes: Record<string, [number, number]> = {};
  const failed: string[] = [];
  const dropbox = data.provider === 'dropbox' || data.provider === 'dropbox-link';
  await Promise.all(
    Array.from({ length: Math.min(dropbox ? 8 : limit, queue.length) }, async () => {
      while (queue.length) {
        const it = queue.shift()!;
        try {
          const res = await fetchOriginalStart(env, s, data, it, url.origin);
          const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
          if ((!res.ok && res.status !== 206) || /text\/|json/.test(type)) {
            await res.body?.cancel().catch(() => {});
            failed.push(it.key);
            continue;
          }
          const size = pixelSize(new Uint8Array(await res.arrayBuffer()).subarray(0, 65536), it.ar);
          if (size) sizes[it.key] = size;
          else failed.push(it.key);
        } catch {
          failed.push(it.key);
        }
      }
    }),
  );
  return json({ sizes, failed, skipped: asked.slice(limit).map((it) => it.key), batch: limit });
});

// ---------- the couple's sketch editing in the hub's album portal (work order item 42, port B10) ----------
// The couple has no studio session: the portal link itself (its SHA-256, like every album portal token) opens the
// photos of the studio's sketch — only while the studio opened editing to them (0173 films_album_design_bank: the
// order, not revoked, a studio not suspended with `photos`, a design open to the couple). Read only: the bank of each
// of the design's own galleries (photos the couple sees — never hidden ones) and a thumbs token for their SMALL
// previews (P73 `th1`: small preview only, 12 hours) — never a large preview, an original, a password or a code.
// Called from the hub's origin (CORS below); counted per address and per order.
route('POST', '/api/album-portal/design-bank', async ({ request, env, store }) => {
  const ip = clientIp(request);
  if (!(await store.hit(`design-bank:${ip}`, DESIGN_BANK_LIMITS.perAddress, DESIGN_BANK_LIMITS.windowSeconds))) throw new HttpError(429, 'יותר מדי בקשות, נסו שוב בעוד כמה דקות');
  const { token } = await body<{ token?: unknown }>(request);
  if (typeof token !== 'string' || token.length < 16 || token.length > 256) throw new HttpError(404, 'הקישור לא נמצא');
  const bank = await store.albumDesignBank(await sha256Hex(token));
  if (!bank.ok) {
    if (bank.reason === 'not_found' || bank.reason === 'revoked') throw new HttpError(404, 'הקישור לא נמצא');
    throw new HttpError(403, 'העריכה של האלבום לא פתוחה כרגע');
  }
  if (!(await store.hit(`design-bank-order:${bank.orderId}`, DESIGN_BANK_LIMITS.perOrder, DESIGN_BANK_LIMITS.windowSeconds))) throw new HttpError(429, 'יותר מדי בקשות, נסו שוב בעוד כמה דקות');
  const tenant = await store.getTenant(bank.tenantId);
  if (!tenant || tenant.access === 'blocked' || !tenant.photos) throw new HttpError(403, 'העריכה של האלבום לא פתוחה כרגע');
  const galleries = [];
  for (const id of bank.galleries.slice(0, DESIGN_BANK_LIMITS.galleries)) {
    const g = await store.getGallery(id);
    if (!g || g.tenantId !== bank.tenantId || kindOf(g) !== 'photos' || g.deletedAt) continue;
    const photos = designerPhotos((await photoDoc(store, g))?.data ?? null);
    const thumbs = await thumbsToken(stateSecret(env), { galleryId: g.id, tenantId: bank.tenantId, version: versionOf(tenant) });
    galleries.push({ id: g.id, ...photos, thumbsToken: thumbs });
  }
  return json({ readOnly: bank.readOnly, galleries }, { headers: { 'Cache-Control': 'no-store' } });
});

// ---------- linking a couple's film gallery and photo gallery ----------
route('PUT', '/api/admin/galleries/:id/link', async ({ request, store, params }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  const { linkedId } = await body<{ linkedId: string }>(request);
  // Only linked_id is written, and a partner is unlinked only while it still points here.
  const unlink = async (id: string | undefined, from: string) => {
    if (id) await store.patchGallery(g.tenantId, id, { linkedId: undefined }, { linkedId: from });
  };
  if (!linkedId) {
    await unlink(g.linkedId, g.id);
    if (!(await store.patchGallery(g.tenantId, g.id, { linkedId: undefined }))) throw new HttpError(404, 'הגלריה לא נמצאה');
    return json({ ok: true, linkedId: '' });
  }
  const other = await getOwnedGallery(store, me.tenantId, String(linkedId));
  if (kindOf(other) === kindOf(g)) throw new HttpError(400, 'אפשר לקשר רק גלריית סרטים עם גלריית תמונות');
  if (g.linkedId !== other.id) await unlink(g.linkedId, g.id);
  if (other.linkedId !== g.id) await unlink(other.linkedId, other.id);
  if (!(await store.patchGallery(g.tenantId, g.id, { linkedId: other.id }))) throw new HttpError(404, 'הגלריה לא נמצאה');
  if (!(await store.patchGallery(g.tenantId, other.id, { linkedId: g.id }))) throw new HttpError(404, 'הגלריה לא נמצאה');
  return json({ ok: true, linkedId: other.id });
});

// ---------- studio page (admin) ----------
route('GET', '/api/admin/studio', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store, { module: 'films' });
  const [page, tenant] = await Promise.all([getStudioPage(store, me.tenantId), store.getTenant(me.tenantId)]);
  return json({ ...page, slug: tenant?.slug ?? '' });
});

route('PUT', '/api/admin/studio', async ({ request, env, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true, module: 'films' });
  const s = await getSettings(env, store, me.tenantId);
  const f = await store.getFilmsStudio(me.tenantId);
  const page = await getStudioPage(store, me.tenantId);
  const before = structuredClone(page);
  const input = await body<Record<string, unknown>>(request);
  const extra: Partial<FilmsStudio> = {};
  if (typeof input.enabled === 'boolean') page.enabled = input.enabled;
  if (input.reviews !== undefined) {
    // Imported reviews keep mit4mit's words (only shown/hidden changes here); deleted ones are remembered (P71).
    const { reviews, removed } = cleanReviews(input.reviews, page.reviews);
    page.reviews = reviews;
    if (removed.length) extra.mit4mitRemoved = [...new Set([...(f.mit4mitRemoved ?? []), ...removed])].slice(-2000);
  }
  if (typeof input.mit4mitUrl === 'string') {
    const u = input.mit4mitUrl.trim();
    if (u && !isMit4mitUrl(u)) throw new HttpError(400, 'קישור mit4mit צריך להיות לדף העסק, בצורה mit4mit.co.il/biz/12345');
    const next = u ? isMit4mitUrl(u)! : undefined;
    // Once a business is bound (the first import), its address stays (P71).
    if (f.mit4mitBizId && next !== page.mit4mitUrl) throw new HttpError(400, 'הקישור ל-mit4mit נעול אחרי הייבוא הראשון. לשינוי פנו אלינו.');
    page.mit4mitUrl = next;
  }
  if (input.showcase && typeof input.showcase === 'object') {
    const sc = input.showcase as { folderUrl?: string; films?: unknown[] };
    // Same validation as a gallery's films, applied to a throwaway gallery-shaped object.
    const g: Gallery = { id: '0000000000000000', tenantId: me.tenantId, films: [], createdAt: new Date().toISOString(), expiresAt: '', days: 1, coupleName: 'showcase', date: '', hasCover: false, views: 0, downloads: 0 };
    applyFilmsAndFolder(g, { films: sc.films as never, folderUrl: sc.folderUrl ?? '' }, s, env);
    page.showcase = { films: g.films, folderUrl: g.folderUrl, folderProvider: g.folderProvider };
  }
  await saveStudioPage(store, me.tenantId, before, page, extra);
  const tenant = await store.getTenant(me.tenantId);
  return json({ ...page, slug: tenant?.slug ?? '' });
});

/**
 * Reviews from the studio's mit4mit page (P71). The first import binds the business to the studio, and only when
 * the studio says the page is its own (`confirmOwnership`); one business is one studio's (409), and later imports
 * come from that business only. The import is merged into the list (mergeImport), recorded in the studio's audit
 * log, and answers what it did (`counts`). Legal decision 2026-10-02 (3): importing reviews is the studio's own
 * responsibility. The studio confirms the declaration (MIT4MIT_DECLARATION) on the first import, the confirmation
 * and its wording are kept in the audit log, and the reviews it shows go to the public page right away (no operator
 * approval). The operator can still unlink a business from /platform.
 */
route('POST', '/api/admin/studio/reviews/import', async ({ request, store }) => {
  const me = await requireStudioAdmin(request, store, { write: true, module: 'films' });
  const { url, confirmOwnership } = await body<{ url: string; confirmOwnership?: boolean }>(request);
  const biz = mit4mitBizId(String(url ?? ''));
  if (!biz) throw new HttpError(400, 'זה לא נראה כמו קישור לדף עסק ב-mit4mit (צריך להיות בצורה mit4mit.co.il/biz/12345)');
  const f = await store.getFilmsStudio(me.tenantId);
  if (f.mit4mitBizId && f.mit4mitBizId !== biz) throw new HttpError(400, 'אפשר לייבא רק מדף העסק שכבר קושר לסטודיו. לשינוי פנו אלינו.', 'mit4mit_other_business');
  if (!f.mit4mitBizId && confirmOwnership !== true) throw new HttpError(400, 'לפני הייבוא הראשון צריך לאשר שזה דף העסק שלכם ושהעתקת ההמלצות באחריות הסטודיו.', 'mit4mit_confirm');
  let fetched;
  try {
    fetched = await fetchMit4mitReviews(String(url ?? ''));
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const page = await getStudioPage(store, me.tenantId);
  const read = structuredClone(page);
  const { reviews, counts } = mergeImport(page.reviews, fetched, f.mit4mitRemoved ?? []);
  page.reviews = reviews;
  page.mit4mitUrl = isMit4mitUrl(String(url))!;
  // The first import binds the business (a clash with another studio: 409, nothing saved).
  const now = new Date().toISOString();
  const bind: Partial<FilmsStudio> = f.mit4mitBizId ? {} : { mit4mitBizId: biz, mit4mitLinkedAt: now, mit4mitApprovedAt: now };
  await saveStudioPage(store, me.tenantId, read, page, bind);
  await store
    .audit({ tenantId: me.tenantId, actorId: me.userId, actorRole: me.role, table: 'films_studio_settings', recordId: me.tenantId, changes: { mit4mit_import: { bizId: biz, linked: !f.mit4mitBizId, ...(f.mit4mitBizId ? {} : { declaration: MIT4MIT_DECLARATION, confirmedAt: now }), ...counts } } })
    .catch((e) => console.error('[films] mit4mit import: the audit line was not written:', (e as Error).message));
  const saved = await getStudioPage(store, me.tenantId);
  return json({ ...saved, imported: counts.imported, counts });
});

// ---------- studio page (public) ----------
/**
 * The studio behind an address: the one that has it now, else the one that gave it up (P73: its page
 * redirects there — worker/pages.ts — and a lead left on the old address reaches that studio).
 */
/**
 * Studio uploads that write to KV / storage (a cover, the list's picture, a song): at most ADMIN_UPLOADS_PER_HOUR per
 * studio (fix plan P10) — KV writes are counted for the whole account, so one studio's loop must not use them all up.
 */
async function adminUploadLimit(store: Store, tenantId: string): Promise<void> {
  await rateLimit(store, `admin-upload:${tenantId}`, ADMIN_UPLOADS_PER_HOUR, 'יותר מדי העלאות בשעה האחרונה. נסו שוב מאוחר יותר.');
}

async function studioFor(store: Store, slug: string) {
  const tenantId = (await store.tenantIdBySlug(slug)) ?? (await store.tenantIdByOldSlug(slug));
  const tenant = tenantId ? await store.getTenant(tenantId) : null;
  if (!tenant || tenant.access === 'blocked' || !tenant.films) throw new HttpError(404, 'הדף לא נמצא');
  const page = await getStudioPage(store, tenant.id);
  if (!page.enabled) throw new HttpError(404, 'הדף לא פעיל');
  return { tenant, page };
}

route('GET', '/api/studio/:slug', async ({ env, store, params }) => {
  const { tenant, page } = await studioFor(store, params.slug);
  const s = await getSettings(env, store, tenant.id, tenant);
  return json(publicStudio(tenant.slug || params.slug, s, page, env), { headers: { 'Cache-Control': 'no-store' } });
});

route('POST', '/api/studio/:slug/lead', async ({ request, env, store, params }) => {
  const { tenant } = await studioFor(store, params.slug);
  const input = await body<Record<string, unknown>>(request);
  // Bots fill every field; people never see this one.
  if (String(input.website ?? '').trim()) throw new HttpError(400, 'הבקשה נחסמה');
  // Validate first, so a typo doesn't use up one of the couple's attempts.
  const lead = validateLead(input);
  // Fix plan P10 (D23(3)): a human (Turnstile, when its keys are set), then the address's and the studio's limits —
  // refused when they cannot be counted —, then one lead per phone. A repeat answers the same "sent" (it tells nothing).
  await checkTurnstile(env, input.turnstileToken, request.headers.get('CF-Connecting-IP'));
  await leadLimits(store, tenant.id, clientIp(request));
  await store.insertLead(tenant.id, lead);
  return json({ ok: true, lead: { coupleName: lead.coupleName, date: lead.date, venue: lead.venue, guests: lead.guests } });
});

async function mockClip(env: Env, request: Request, url: URL, watchUrl: string, fileId = ''): Promise<Response> {
  // The mock cloud's gone file (tests): a link whose id says "gone" answers as a cloud that lost it (P65).
  if (/gone/i.test(fileId)) return new Response('הקובץ לא זמין כרגע', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const demo = new URL(watchUrl && watchUrl.startsWith('/') ? watchUrl : '/demo/highlights.mp4', url.origin);
  return env.ASSETS.fetch(new Request(demo.toString(), { method: request.method, headers: request.headers }));
}

const STUDIO_STREAMS = ['dropbox', 'dropbox-link', 'dropbox-own', 'gdrive', 'pcloud'];

for (const method of ['GET', 'HEAD']) {
  route(method, '/api/studio/:slug/film/:n', async ({ request, env, store, params, url }) => {
    const { tenant, page } = await studioFor(store, params.slug);
    const film = page.showcase.films[Number(params.n)];
    // Every cloud the showcase can hold streams here (a film saved before `provider` existed is Dropbox);
    // MyAirBridge films open at their own address, so they never come here.
    const provider = film?.provider ?? 'dropbox';
    if (!film || !STUDIO_STREAMS.includes(provider)) throw new HttpError(404, 'הסרט לא נמצא');
    if (env.CLOUD_MOCK) return mockClip(env, request, url, film.watchUrl, film.fileId);
    const s = await getSettings(env, store, tenant.id, tenant);
    return streamFilm(s, env, film, request, false, url.origin);
  });
}

// ---------- couple's page (public) ----------
/**
 * A gallery for a public request; hidden when the studio is suspended. The
 * studio part of the couple's link (/<slug>/<id>) is not a secret, so a link
 * with an old or wrong slug still opens and the page corrects its address from
 * `slug` in the response (links sent before a slug change keep working).
 */
async function publicGallery(store: Store, id: string, _url: URL): Promise<{ g: Gallery; tenant: TenantInfo; role: Role }> {
  // The couple's id, or (photo galleries) the guests' id.
  const found = await viewerGallery(store, id);
  if (!found) throw new HttpError(404, 'הקישור לא נמצא');
  const { g, role } = found;
  const tenant = await store.getTenant(g.tenantId);
  if (!tenant || tenant.access === 'blocked' || !tenant[kindOf(g)]) throw new HttpError(404, 'הקישור לא נמצא');
  return { g, tenant, role };
}

/** Only the couple's own link may heart, mark or choose (never the guests'). */
async function coupleGallery(store: Store, id: string, url: URL) {
  const found = await publicGallery(store, id, url);
  if (found.role !== 'couple') throw new HttpError(403, 'הקישור לאורחים מיועד לצפייה ולהורדה בלבד');
  return found;
}

route('GET', '/api/watch/:id', async ({ request, env, store, params, url }) => {
  const { g, tenant, role } = await publicGallery(store, params.id, url);
  const secret = stateSecret(env);
  const pt = url.searchParams.get('pt');
  const version = versionOf(tenant);
  const access = await accessOf(request, secret, g, role, { version, pt });
  // "Open as the couple" from the hub: this browser may view and download until the token ends (at most 12 hours).
  const studioCookie = pt ? await studioCookieFor(request, secret, g, pt, version) : null;
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', ...(studioCookie ? { 'Set-Cookie': studioCookie } : {}) };
  const s = await getSettings(env, store, g.tenantId, tenant);
  // Without the download code: no download links, and films only in their smallest size.
  const full = coupleView(g, s, env, access.download);
  // Guests see the gallery under their own number, never the couple's.
  const view =
    role === 'guest' ? { ...full, id: params.id, coverUrl: full.coverUrl ? coverPath(params.id, g) : '', folderDownloadUrl: '', folderProvider: '' as const } : full;
  if (!access.view) {
    // Behind a password: only the names, until it's typed.
    return json(
      {
        id: view.id, kind: view.kind, coupleName: g.coupleName, date: g.date, venue: view.venue, studioName: view.studioName, logoUrl: view.logoUrl, accentColor: view.accentColor, expired: view.expired, daysLeft: view.daysLeft, slug: tenant.slug, locked: true, role,
        // Avira fix (2026-10-30): a closed gallery shows "הגלריה נסגרה" before the password, so it needs its closing
        // day and the studio's contact — without them it read "הסתיימה ב־." with no date and no way to reach the studio.
        // Neither is secret; no photo, film or link is given.
        ...(view.expired ? { expiresAt: view.expiresAt, contactLine: view.contactLine, instagram: view.instagram } : {}),
      },
      { headers },
    );
  }
  const locks = access.download ? {} : { downloadLocked: true };
  const pathOf = (id: string) => (tenant.slug ? `/${tenant.slug}/${id}` : `/watch/${id}`);
  // The same couple's other gallery (films ↔ photos), when the studio linked them and it's open.
  let linked: { kind: string; path: string } | null = null;
  if (role === 'couple' && g.linkedId && !view.expired) {
    const other = await store.getGallery(g.linkedId);
    if (other && other.tenantId === g.tenantId && !other.deletedAt && !isExpired(other) && tenant[kindOf(other)]) linked = { kind: kindOf(other), path: pathOf(other.id) };
  }
  if (kindOf(g) === 'photos' && !view.expired) {
    const [doc, films] = await Promise.all([photoDoc(store, g), store.getFilmsStudio(g.tenantId)]);
    const data = doc?.data ?? null;
    // The studio disconnected the Dropbox its photos are read through (P65): the page says so instead of empty squares.
    const cloudOff = readsThroughDropbox(data) && !s.dropbox.refreshToken;
    const photos = data ? { ...publicPhotos(params.id, data), music: musicUrl(g.tenantId, films, g.music), design: effectiveDesign(data.design, films.designDefault), ...(cloudOff ? { cloudOff: true } : {}) } : null;
    if (role === 'guest') return json({ ...view, ...locks, slug: tenant.slug, role, linked: null, photos, favorites: [], favBy: {}, insta: [] }, { headers });
    const [allHearts, allInsta, lists] = data ? await Promise.all([store.listHearts(g.id), store.listInsta(g.id), store.listLists(g.id)]) : [{}, [], []];
    // Only hearts and marks of photos the couple can see (P70): the counter never counts a hidden or gone photo.
    const { favBy, insta } = heartsFor(data, allHearts, allInsta);
    const guestPath = g.guestId ? pathOf(g.guestId) : '';
    return json({ ...view, ...locks, slug: tenant.slug, role, guestPath, linked, photos, favorites: favoritesFrom(favBy), favBy, insta, lists }, { headers });
  }
  return json({ ...view, ...locks, slug: tenant.slug, role, linked }, { headers });
});

/** Wrong passwords (or codes) a gallery takes in an hour, from all addresses together. */
const GALLERY_GUESSES = 40;

/** Wrong attempts in the last hour (after counting this one when `add`). Can't count → refused, never let through. */
async function wrongAttempts(store: Store, key: string, add: boolean): Promise<number> {
  try {
    return await store.failures(key, 3600, add);
  } catch (e) {
    console.error('[films] guess counter failed, refusing:', (e as Error).message);
    throw new HttpError(503, 'לא ניתן לבדוק את הסיסמה כרגע. נסו שוב בעוד רגע.');
  }
}

/** The gallery just reached the limit: the studio hears about it in the hub's bell (best effort). */
async function tellStudioLocked(store: Store, g: Gallery, kind: 'unlock' | 'pin') {
  try {
    await store.notifyStudio(g.tenantId, {
      type: 'films_gallery_locked',
      title: `${kind === 'unlock' ? 'הסיסמה' : 'קוד ההורדה'} של הגלריה ${g.coupleName} ננעלו לשעה`,
      body: `${GALLERY_GUESSES} ניסיונות שגויים בשעה האחרונה. אם זה לא הזוג, כדאי להחליף ${kind === 'unlock' ? 'סיסמה' : 'קוד'}.`,
    });
  } catch (e) {
    console.error('[films] lock notification failed:', (e as Error).message);
  }
}

/** The gallery's password or download code, typed by the couple or a guest (remembered on this device). */
for (const kind of ['unlock', 'pin'] as const) {
  route('POST', `/api/watch/:id/${kind}`, async ({ request, env, store, params, url }) => {
    const { g, role, tenant } = await publicGallery(store, params.id, url);
    if (!(await store.hit(`${kind}:${g.id}:${clientIp(request)}`, 10, 900))) throw new HttpError(429, 'יותר מדי ניסיונות. נסו שוב בעוד רבע שעה.');
    // And per gallery, from every address together: a guessing run from many addresses stops too.
    const failKey = `${kind}-fail:${g.id}`;
    if ((await wrongAttempts(store, failKey, false)) >= GALLERY_GUESSES) throw new HttpError(429, 'יותר מדי ניסיונות שגויים לגלריה הזו. נסו שוב בעוד שעה, או פנו לסטודיו.');
    const { code } = await body<{ code: string }>(request);
    const cookie = await unlockCookie(request, stateSecret(env), g, role, kind === 'unlock' ? 'pass' : 'pin', String(code ?? ''), versionOf(tenant));
    if (!cookie) {
      if ((await wrongAttempts(store, failKey, true)) === GALLERY_GUESSES) await tellStudioLocked(store, g, kind);
      throw new HttpError(400, kind === 'unlock' ? 'הסיסמה לא נכונה' : 'הקוד לא נכון');
    }
    return json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
  });
}

// A photo: previews (?s=m|md|l) for everyone with the link, the original (?s=full, &dl=1 to save).
// Hidden photos and closed galleries only for the studio's own screens (?pt=<preview token>).
// P66: addresses carry the gallery's generation (/api/photos/<id>/v<gen>/<key>, shared/photoUrl.ts); the
// address without it (links shared before) is the same photo, kept by a browser a day instead of a year.
for (const method of ['GET', 'HEAD']) {
  for (const path of ['/api/photos/:id/:key', '/api/photos/:id/:ver/:key']) {
    route(method, path, async (ctx) => {
      try {
        return await photoRoute(ctx);
      } catch (e) {
        // A download the browser opened as a page (?dl=1): a page with the reason and a way back, not raw JSON.
        if (!(e instanceof HttpError) || ctx.url.searchParams.get('dl') !== '1') throw e;
        return downloadFailedPage(e.status, e.message, `/watch/${ctx.params.id}`);
      }
    });
  }
}

/** The generation an address asks for: null = an address without one; not ours → 404. */
function addressVersion(params: Record<string, string>): number | null {
  if (params.ver === undefined) return null;
  const v = askedVersion(params.ver);
  if (v === null) throw new HttpError(404, 'לא נמצא');
  return v;
}

/**
 * In this order, always: the gallery and its studio (trash, suspended studio, module), access (the password,
 * the link's role), a closed gallery — then the edge cache, under the visible version read with the gallery
 * (P61, 0131: it goes up whenever a photo is hidden or shown again, and a hidden photo is never put in the
 * cache, so a hit is a photo the public may see). Only on a miss is the ONE photo read from the database
 * (films_photo_item, not the whole list) and checked for hidden; settings only when Dropbox needs them.
 */
async function photoRoute({ request, env, store, params, url, waitUntil }: Ctx): Promise<Response> {
  const asked = addressVersion(params);
  const { g, role, tenant } = await publicGallery(store, params.id, url);
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  const s = url.searchParams.get('s');
  const size = s === 'l' || s === 'md' || s === 'full' ? s : 'm';
  const download = url.searchParams.get('dl') === '1';
  // The hub's list picture (a thumbs token, P73) opens the small preview only.
  const access = await requireView(request, stateSecret(env), g, role, { version: versionOf(tenant), pt: url.searchParams.get('pt'), thumbs: size === 'm' && !download });
  const studio = access.studio;
  if (isExpired(g) && !studio) throw new HttpError(410, 'הגלריה נסגרה');
  if (size === 'full' && !access.download) throw new HttpError(403, 'להורדה באיכות מלאה צריך את קוד ההורדה מהסטודיו');
  // The edge copy is always the gallery as it is now; only how long the browser keeps it follows the address.
  const at = { visible: g.photosVisibleVersion ?? 0, gen: g.photosGen ?? 0 };
  const current = asked === at.gen;
  if (cachedSize(size, download)) {
    const hit = await cachedPreview(g.id, params.key, size, at, current);
    if (hit) return hit;
  }
  // "Full quality" may pick a larger copy of the photo: its possible copies come with it.
  const read = await store.getPhotoItem(g.tenantId, g.id, params.key, { copies: size === 'full' });
  const item = read?.item;
  if (!read || !item || (item.hidden && !studio)) throw new HttpError(404, 'התמונה לא נמצאה');
  // Never a copy the studio hid (the studio's own screens may). Cached only when the photo was read at the gallery
  // row's visible version: then its generation is the row's too (both change together on a whole save).
  const cache = read.visibleVersion === at.visible ? at : undefined;
  return photoResponse(env, () => getSettings(env, store, g.tenantId, tenant), read.data, item, size, request, download, g.id, { includeHidden: studio, cache, current, waitUntil });
}

/** The couple marks a few photos for Instagram (a list of its own, next to the hearts). */
route('POST', '/api/watch/:id/insta', async ({ request, env, store, params, url }) => {
  const { g, tenant } = await coupleGallery(store, params.id, url);
  await requireView(request, stateSecret(env), g, 'couple', { version: versionOf(tenant) });
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
  const ip = clientIp(request);
  await rateLimit(store, `fav:${g.id}:${ip}`, 1500, 'יותר מדי סימונים בזמן קצר. נסו שוב בעוד כמה דקות.');
  // One photo ({ key }) or several chosen together ({ keys }).
  const { key, keys, on } = await body<{ key?: string; keys?: string[]; on: boolean }>(request);
  const data = (await photoDoc(store, g))?.data ?? null;
  // Every photo in one write (P70; was one request per photo).
  await store.setInstaMany(g.tenantId, g.id, visibleKeys(data, keys ?? [String(key)]), Boolean(on));
  return json({ ok: true, insta: heartsFor(data, {}, await store.listInsta(g.id)).insta });
});

/** Photo keys the couple may mark: real, not hidden, at most 500 at once — from the gallery's list already read. */
function visibleKeys(data: PhotoData | null | undefined, input: unknown[]): string[] {
  if (!Array.isArray(input) || input.length === 0) throw new HttpError(400, 'לא נבחרו תמונות');
  if (input.length > 500) throw new HttpError(400, 'עד 500 תמונות בכל פעם');
  const visible = new Set((data?.items ?? []).filter((i) => !i.hidden).map((i) => i.key));
  const keys = [...new Set(input.map(String))].filter((k) => /^[0-9a-f]{8}$/.test(k) && visible.has(k));
  if (keys.length === 0) throw new HttpError(404, 'התמונה לא נמצאה');
  return keys;
}

// ---------- personal lists ("התמונות של אופק"), apart from the favourites for the album ----------
const cleanListName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);

/** The couple's own link, a photo gallery, open, past its password, within the rate limit. */
async function listGallery(request: Request, env: Env, store: Store, id: string, url: URL) {
  const { g, tenant } = await coupleGallery(store, id, url);
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
  await requireView(request, stateSecret(env), g, 'couple', { version: versionOf(tenant) });
  const ip = clientIp(request);
  await rateLimit(store, `fav:${g.id}:${ip}`, 1500, 'יותר מדי סימונים בזמן קצר. נסו שוב בעוד כמה דקות.');
  return g;
}

route('POST', '/api/watch/:id/lists', async ({ request, env, store, params, url }) => {
  const g = await listGallery(request, env, store, params.id, url);
  const { name, keys } = await body<{ name: string; keys?: string[] }>(request);
  const clean = cleanListName(name);
  if (!clean) throw new HttpError(400, 'צריך שם לרשימה');
  const chosen = Array.isArray(keys) && keys.length ? visibleKeys((await photoDoc(store, g))?.data, keys) : [];
  // One step in the database: the list of that name gets the photos, or a new list is made (at most MAX_LISTS).
  const list = await store.createList(g.id, { id: randomId().slice(0, 12), name: clean, keys: chosen });
  if (list === 'too_many') throw new HttpError(400, `אפשר עד ${MAX_LISTS} רשימות בגלריה`);
  if (!list) throw new HttpError(404, 'הגלריה לא נמצאה');
  return json({ id: list.id, lists: await store.listLists(g.id) });
});

route('PUT', '/api/watch/:id/lists/:list', async ({ request, env, store, params, url }) => {
  const g = await listGallery(request, env, store, params.id, url);
  const { name, keys, on } = await body<{ name?: string; keys?: string[]; on?: boolean }>(request);
  let found = false;
  if (typeof name === 'string') {
    const clean = cleanListName(name);
    if (!clean) throw new HttpError(400, 'צריך שם לרשימה');
    if (!(await store.renameList(g.id, params.list, clean))) throw new HttpError(404, 'הרשימה לא נמצאה');
    found = true;
  }
  if (Array.isArray(keys)) {
    // Only these photos are added or removed, so quick marks one after another all stay.
    if (!(await store.toggleList(g.id, params.list, visibleKeys((await photoDoc(store, g))?.data, keys), on !== false))) throw new HttpError(404, 'הרשימה לא נמצאה');
    found = true;
  }
  const lists = await store.listLists(g.id);
  if (!found && !lists.some((l) => l.id === params.list)) throw new HttpError(404, 'הרשימה לא נמצאה');
  return json({ lists });
});

route('DELETE', '/api/watch/:id/lists/:list', async ({ request, env, store, params, url }) => {
  const g = await listGallery(request, env, store, params.id, url);
  await store.deleteList(g.id, params.list);
  return json({ lists: await store.listLists(g.id) });
});

// ---------- a picture for film galleries in the studio's list (a frame taken from a film) ----------
/**
 * A film for the hub's list picture: the studio's browser plays it (with the gallery's preview token,
 * since a <video> can't send the session) and takes a frame. CORS comes with every /api/admin/ answer.
 */
/**
 * A gallery for the studio's list picture, opened with its preview token (no session: an <img> or
 * <video> can't send one). Like the admin API it refuses a gallery in the trash, a suspended studio
 * and a module the studio no longer has.
 */
async function previewGallery(env: Env, store: Store, id: string, url: URL, missing: string): Promise<Gallery> {
  const g = await store.getGallery(id);
  if (!g || g.deletedAt) throw new HttpError(404, missing);
  const tenant = await store.getTenant(g.tenantId);
  if (!tenant || tenant.access === 'blocked' || !tenant[kindOf(g)]) throw new HttpError(404, missing);
  // The studio's preview token or the list's thumbs token (P73), of this gallery and studio, under its access version.
  if (!(await isStudioPreview(stateSecret(env), g, url.searchParams.get('pt'), versionOf(tenant), { thumbs: true }))) throw new HttpError(404, missing);
  return g;
}

for (const method of ['GET', 'HEAD']) {
  route(method, '/api/admin/galleries/:id/film/:n', async ({ request, env, store, params, url }) => {
    const g = await previewGallery(env, store, params.id, url, 'הסרט לא נמצא');
    const film = g.films[Number(params.n)];
    if (!film) throw new HttpError(404, 'הסרט לא נמצא');
    if (env.CLOUD_MOCK) return mockClip(env, request, url, film.watchUrl, film.fileId);
    const s = await getSettings(env, store, g.tenantId);
    return streamFilm(s, env, film, request, false, url.origin);
  });
}

route('POST', '/api/admin/galleries/:id/thumb', async ({ request, env, store, params }) => {
  const me = await requireStudioAdmin(request, store, { write: true });
  const g = await getOwnedGallery(store, me.tenantId, params.id);
  await adminUploadLimit(store, me.tenantId);
  if ((request.headers.get('Content-Type') ?? '') !== 'image/jpeg') throw new HttpError(400, 'צריך תמונת JPEG');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 400_000) throw new HttpError(400, 'התמונה גדולה מדי');
  await env.KV.put(`thumb:${g.id}`, bytes);
  if (!g.hasThumb && !(await store.patchGallery(g.tenantId, g.id, { hasThumb: true }))) throw new HttpError(404, 'הגלריה לא נמצאה');
  const pt = await thumbsToken(stateSecret(env), { galleryId: g.id, tenantId: g.tenantId, version: versionOf(await store.getTenant(me.tenantId)) });
  return json({ ok: true, thumb: `/api/admin/galleries/${g.id}/thumb?pt=${encodeURIComponent(pt)}` });
});

route('GET', '/api/admin/galleries/:id/thumb', async ({ env, store, params, url }) => {
  const g = await previewGallery(env, store, params.id, url, 'אין תמונה');
  const bytes = await env.KV.get(`thumb:${g.id}`, 'arrayBuffer');
  if (!bytes) throw new HttpError(404, 'אין תמונה');
  return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
});

// ---------- albums (the couple designs, the studio reopens) ----------
/** A photo gallery opened by its couple (guests can't design), open, and past its password. */
async function albumGallery(request: Request, env: Env, store: Store, id: string, url: URL) {
  const found = await coupleGallery(store, id, url);
  if (kindOf(found.g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  const access = await requireView(request, stateSecret(env), found.g, found.role, { version: versionOf(found.tenant) });
  return { ...found, access };
}

route('GET', '/api/watch/:id/album', async ({ request, env, store, params, url }) => {
  const { g, access } = await albumGallery(request, env, store, params.id, url);
  if (isExpired(g) && !access.studio) throw new HttpError(410, 'הגלריה נסגרה');
  // P57: the order's state is extra — when it cannot be read, the couple still gets their album.
  const [album, state] = await Promise.all([store.getAlbum(g.id), orderStateOrNull(store, g.id)]);
  return json({ album, ordering: state ? orderingOf(state) : null, ...(state ? {} : { orderingFailed: true }) }, { headers: { 'Cache-Control': 'no-store' } });
});

// The studio's print export (/<studio>/<gallery>/print, src/print/StudioPrint.tsx): the album for the studio only —
// its preview token or the studio cookie it leaves. A couple's or a guest's cookie (even with the download code) is
// refused here, so the page cannot be used from the couple's link (UI cleanup U1).
route('GET', '/api/watch/:id/print', async ({ request, env, store, params, url }) => {
  const { g, access } = await albumGallery(request, env, store, params.id, url);
  if (!access.studio) throw new HttpError(403, 'הדף הזה נפתח מתוך המערכת של הסטודיו (הורדה לדפוס).');
  return json({ album: await store.getAlbum(g.id) }, { headers: { 'Cache-Control': 'no-store' } });
});

/** A JSON body of at most `max` bytes (P57: an album save), else 413 before anything is read into memory. */
async function limitedBody<T>(request: Request, max: number): Promise<T> {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > max) throw new HttpError(413, 'האלבום גדול מדי לשמירה');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > max) throw new HttpError(413, 'האלבום גדול מדי לשמירה');
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new HttpError(400, 'בקשה לא תקינה');
  }
}

// The couple's draft (P57): one write, only onto the copy the page has (`rev`), checked for its shape only — the
// photo list is not read here (the photos are checked when the album is sent).
route('PUT', '/api/watch/:id/album', async ({ request, env, store, params, url }) => {
  const { g } = await albumGallery(request, env, store, params.id, url);
  if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
  const ip = clientIp(request);
  await rateLimit(store, `album:${g.id}:${ip}`, 2000, 'יותר מדי שמירות בזמן קצר. נסו שוב בעוד כמה דקות.');
  const { album, rev } = await limitedBody<{ album: unknown; rev?: unknown }>(request, MAX_ALBUM_BYTES);
  const saved = await saveAlbumDraft(store, g.tenantId, g.id, album, revOf(rev));
  return json({ album: saved });
});

// Sending (P57): the album is marked sent, then its order is made — and made again on a later send whenever it is
// missing or was made for another page count (a failure half way never leaves the couple stuck: the answer is 200
// with `orderPending`, and "להמשך ההזמנה" sends again). An album already sent may be sent again after the gallery
// closed (only to make its order).
route('POST', '/api/watch/:id/album/submit', async ({ request, env, store, params, url }) => {
  const { g } = await albumGallery(request, env, store, params.id, url);
  const input = request.headers.get('Content-Type')?.includes('json') ? await limitedBody<{ rev?: unknown }>(request, 4096).catch(() => ({}) as { rev?: unknown }) : {};
  const { album, sent, removed } = await submitAlbum(store, g.tenantId, g.id, {
    rev: revOf(input.rev),
    closed: isExpired(g),
    visibleKeys: async () => new Set(((await photoDoc(store, g))?.data.items ?? []).filter((i) => !i.hidden).map((i) => i.key)),
  });
  // A new copy for the print shop (P55): this Worker forgets the one it kept.
  if (sent) printKept.delete(g.id);
  let state = await orderStateOrNull(store, g.id);
  let orderPending = false;
  if (orderNeeded(album, sent, state)) {
    try {
      const made = await store.albumOrderFromDesign(g.id, album.spreads.length, await sha256Hex(await albumOrderToken(stateSecret(env), g.id)));
      if (made) state = await orderStateOrNull(store, g.id);
    } catch (e) {
      console.error('[films] album order failed:', (e as Error).message);
      orderPending = true;
    }
  } else if (!state) orderPending = true;
  const ordering = state ? orderingOf(state) : null;
  return json({ album, summary: albumSummary(album, ordering), ordering, removed, ...(orderPending ? { orderPending: true } : {}) });
});

// Where "continue to the order" goes: the hub's album portal. Works after the gallery closes too.
route('GET', '/api/watch/:id/album/order', async ({ request, env, store, params, url }) => {
  const { g } = await albumGallery(request, env, store, params.id, url);
  const state = await orderStateOrNull(store, g.id);
  if (!state) throw new HttpError(503, 'לא הצלחנו לבדוק את ההזמנה כרגע. נסו שוב בעוד רגע.');
  const r = await orderLink(stateSecret(env), hubUrl(env, url), g.id, state);
  if ('error' in r) throw new HttpError(r.status, r.error);
  return json(r, { headers: { 'Cache-Control': 'no-store' } });
});

// The studio's saved page layouts, offered in every album of that studio. Only the studio (opened
// from the hub with its preview token) saves to that list; couples keep layouts inside their album.
route('GET', '/api/watch/:id/layouts', async ({ request, env, store, params, url }) => {
  const { g, access } = await albumGallery(request, env, store, params.id, url);
  if (isExpired(g) && !access.studio) throw new HttpError(410, 'הגלריה נסגרה');
  const f = await store.getFilmsStudio(g.tenantId);
  return json({ layouts: cleanCustom(f.albumLayouts ?? []), canSave: access.studio }, { headers: { 'Cache-Control': 'no-store' } });
});

route('POST', '/api/watch/:id/layouts', async ({ request, env, store, params, url }) => {
  const { g, access } = await albumGallery(request, env, store, params.id, url);
  if (!access.studio) throw new HttpError(403, 'רק הסטודיו יכול לשמור פריסות לכל האלבומים');
  const input = await body<{ layout?: unknown; remove?: string }>(request);
  const f = await store.getFilmsStudio(g.tenantId);
  let list = cleanCustom(f.albumLayouts ?? []);
  if (typeof input.remove === 'string') list = list.filter((t) => t.id !== input.remove);
  if (input.layout) {
    const [t] = cleanCustom([input.layout]);
    if (!t) throw new HttpError(400, 'הפריסה לא תקינה');
    list = [...list.filter((x) => x.id !== t.id), { ...t, name: t.name || `פריסה ${list.length + 1}` }].slice(-60);
  }
  f.albumLayouts = list;
  await store.patchFilmsStudio(g.tenantId, { albumLayouts: list });
  return json({ layouts: list });
});

route('GET', '/api/admin/galleries/:id/album', async ({ request, env, store, params, url }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id);
  const [album, state, copy] = await Promise.all([store.getAlbum(g.id), store.albumOrderState(g.id), store.getPrintAlbum(g.id)]);
  const link = state.order ? await orderLink(stateSecret(env), hubUrl(env, url), g.id, state) : null;
  const order = state.order
    ? { id: state.order.id, workflowStatus: state.order.workflowStatus, paymentStatus: state.order.paymentStatus, spreads: state.order.spreads ?? null, coupleLink: link && 'url' in link ? link.url : '' }
    : null;
  // P57: a sent album of a studio with album orders whose order is missing (the send failed half way).
  const orderMissing = Boolean(album?.status === 'submitted' && state.crm && !state.order);
  // P55: what the print shop gets (the copy as sent) and why it is paused; 'pages_changed' → the hub's 'אישור מספר הדפים'.
  const print = { sentSpreads: copy?.album?.spreads.length ?? null, paused: printBlock(copy, state) };
  return json({ album, summary: albumSummary(album, orderingOf(state)), order, print, ...(orderMissing ? { orderMissing } : {}) });
});

route('POST', '/api/admin/galleries/:id/album/unlock', async ({ request, store, params }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id, true);
  const album = await unlockAlbum(store, g.tenantId, g.id);
  // The print link pauses by itself while the album is open (P55, D17(3)); this Worker forgets its copy now.
  printKept.delete(g.id);
  const live = Boolean(g.printToken) && !printLinkExpired(g);
  return json({
    album,
    summary: albumSummary(album, orderingOf(await store.albumOrderState(g.id))),
    ...(live ? { warning: 'קישור בית הדפוס מושהה עד שהזוג ישלח את האלבום שוב.', printPaused: true } : {}),
  });
});

/**
 * The studio accepts the page count of an album the couple sent again after paying (P55): the order takes the count of
 * the SENT copy, and the print link works again. Refused while the album is open for the couple.
 */
route('POST', '/api/admin/galleries/:id/album/confirm-pages', async ({ request, store, params }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id, true);
  const copy = await store.getPrintAlbum(g.id);
  if (!copy?.album) throw new HttpError(409, PRINT_BLOCK_WORDS.not_sent, 'not_sent');
  if (copy.open) throw new HttpError(409, PRINT_BLOCK_WORDS.album_open, 'album_open');
  const done = await store.confirmAlbumSpreads(g.id, copy.album.spreads.length);
  if (!done) throw new HttpError(404, 'לאלבום הזה אין הזמנה');
  printKept.delete(g.id);
  return json({ ok: true, spreads: done.spreads, before: done.before });
});

// ---------- guest face search ----------
// The studio's browser finds the faces (on this site, opened from the hub with the preview token,
// so the photos and the face models are same-origin) and uploads only numbers. A guest's phone
// downloads the numbers and compares its own selfie; the selfie never leaves the phone.

/**
 * The face card in the hub (fix plan P68): the numbers come from the photo keys, not totals — `visible` photos shown,
 * `scanned` of them scanned, `left` to scan; `offBecauseDeleted` = face search was switched off when its data was
 * deleted (closed, trash, clean-up), so the card says why.
 */
route('GET', '/api/admin/galleries/:id/faces', async ({ request, store, params }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id);
  const [m, done, doc] = await Promise.all([store.facesMeta(g.id), store.facesDone(g.id), photoDoc(store, g)]);
  const visible = (doc?.data.items ?? []).filter((i) => !i.hidden).map((i) => i.key);
  const doneSet = new Set(done);
  const scanned = visible.filter((k) => doneSet.has(k)).length;
  return json({ chunks: m.chunks, photos: m.photos, faces: m.faces, visible: visible.length, scanned, left: visible.length - scanned, offBecauseDeleted: Boolean(g.facesOffAt) });
});

route('DELETE', '/api/admin/galleries/:id/faces', async ({ request, store, params }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id, true, true);
  // Deleted face data switches face search off (D06(2)): guests never see an empty search.
  await store.deleteFaces(g.id, { searchOff: true });
  return json({ ok: true });
});

/** The studio's scanning page: a photo gallery with face search on, opened as the studio. */
async function scanGallery(request: Request, env: Env, store: Store, id: string, url: URL) {
  const { g, tenant } = await coupleGallery(store, id, url);
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  const access = await accessOf(request, stateSecret(env), g, 'couple', { version: versionOf(tenant) });
  if (!access.studio) throw new HttpError(403, 'רק הסטודיו סורק פנים. פתחו את הסריקה מהמערכת.');
  if (tenant.access !== 'ok') throw new HttpError(402, 'המנוי לא פעיל');
  const data = (await photoDoc(store, g))?.data;
  if (!data?.faceSearch) throw new HttpError(400, 'החיפוש לפי פנים כבוי בגלריה הזו. הדליקו אותו במערכת.');
  return { g, data };
}

route('GET', '/api/watch/:id/faces/scan', async ({ request, env, store, params, url }) => {
  const { g, data } = await scanGallery(request, env, store, params.id, url);
  const [m, done] = await Promise.all([store.facesMeta(g.id), store.facesDone(g.id)]);
  const keys = data.items.filter((i) => !i.hidden).map((i) => i.key);
  return json({ keys, done, faces: m.faces, base: photoBase(g.id, data.gen) }, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * A chunk of face numbers made in the studio's browser (raw bytes, see shared/faces.ts). Photos scanned already or
 * hidden meanwhile are left out before the upload (`skipped`); nothing new → nothing stored.
 */
route('POST', '/api/watch/:id/faces', async ({ request, env, store, params, url }) => {
  const { g, data } = await scanGallery(request, env, store, params.id, url);
  await rateLimit(store, `faces:${g.id}`, 1000, 'יותר מדי העלאות בזמן קצר. נסו שוב בעוד כמה דקות.');
  const hidden = new Set(data.items.filter((i) => i.hidden).map((i) => i.key));
  const m = await addFacesChunk(store, g, new Uint8Array(await request.arrayBuffer()), new Set(data.items.map((i) => i.key)), { hidden });
  return json({ chunks: m.chunks, photos: m.photos, faces: m.faces, skipped: m.skipped });
});

/**
 * "הסר אדם זה" (D06(4)): the faces of one person, found in the studio's browser with a reference photo, leave the
 * face data. Up to FACE_REWRITE_PER_REQUEST files per request; the page sends `remaining` again.
 */
route('POST', '/api/watch/:id/faces/remove', async ({ request, env, store, params, url }) => {
  const { g } = await scanGallery(request, env, store, params.id, url);
  const { faces } = await body<{ faces: PersonFace[] }>(request);
  if (!Array.isArray(faces) || faces.length === 0) throw new HttpError(400, 'לא נבחרו פנים');
  if (faces.length > 5000) throw new HttpError(400, 'יותר מדי פנים בבקשה אחת');
  const r = await removePerson(store, g, faces.map((f) => ({ key: String(f?.key ?? ''), face: Number(f?.face) })));
  return json(r);
});

/**
 * What a guest's phone needs to search (couple's or guests' link, past the password, while open). Face search is
 * read on its own (P68: never the whole photo list); `skipOn` skips it (the chunks: no face data, no chunk).
 */
async function guestFaces(request: Request, env: Env, store: Store, id: string, url: URL, opts: { skipOn?: boolean } = {}) {
  const { g, role, tenant } = await publicGallery(store, id, url);
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  const access = await requireView(request, stateSecret(env), g, role, { version: versionOf(tenant) });
  if (isExpired(g)) {
    // The gallery closed: its face data goes too (the clean-up would remove it anyway).
    await store.deleteFaces(g.id, { searchOff: true }).catch(() => {});
    throw new HttpError(410, 'הגלריה נסגרה');
  }
  if (!opts.skipOn && !(await store.faceSearchOn(g.id))) throw new HttpError(404, 'חיפוש לפי פנים לא פעיל בגלריה הזו');
  return { g, role, access };
}

/** Face data ready for guests: some scanned; `partial` while photos shown are still not scanned. */
const readiness = (g: Gallery, m: { chunks: number; photos: number }) => ({ ready: m.chunks > 0 && m.photos > 0, partial: m.photos < (g.photoCount ?? 0) });

route('GET', '/api/watch/:id/faces', async ({ request, env, store, params, url }) => {
  const { g } = await guestFaces(request, env, store, params.id, url);
  const m = await store.facesMeta(g.id);
  return json({ ...readiness(g, m), chunks: m.chunks, version: m.version }, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * A guest's search starts here (D06(3)): the consent ticked, a rate limit per address and gallery (high: the
 * guests of a hall share one), a line in films_face_searches, and a token for the chunks (FACE_TOKEN_SECONDS).
 * The studio's own page ("הסר אדם זה") needs no consent.
 */
route('POST', '/api/watch/:id/faces/search', async ({ request, env, store, params, url }) => {
  const { g, role, access } = await guestFaces(request, env, store, params.id, url);
  const { consent } = await body<{ consent?: string }>(request);
  if (!access.studio && consent !== FACE_CONSENT) throw new HttpError(400, 'צריך לאשר את ההסכמה לפני החיפוש', 'consent');
  await rateLimit(store, `face-search:${g.id}:${clientIp(request)}`, FACE_SEARCHES_PER_HOUR, 'היו הרבה חיפושים מהרשת הזו בזמן קצר. נסו שוב בעוד כמה דקות.');
  const m = await store.facesMeta(g.id);
  if (!m.chunks || !m.photos) return json({ ready: false, partial: false }, { headers: { 'Cache-Control': 'no-store' } });
  await store.logFaceSearch(g.tenantId, g.id, access.studio ? 'studio' : role, access.studio ? 'studio' : FACE_CONSENT);
  const token = await faceToken(stateSecret(env), g.id);
  return json({ ...readiness(g, m), chunks: m.chunks, version: m.version, token, expiresIn: FACE_TOKEN_SECONDS }, { headers: { 'Cache-Control': 'no-store' } });
});

/**
 * One chunk (`?v=` the version the search began with), only with the search's token (header X-Face-Token): only
 * the photos still shown, read without the photo list. Its address changes with every change of the face data,
 * so the phone keeps it (a second selfie, a reload) and never gets an old one.
 */
route('GET', '/api/watch/:id/faces/:n', async ({ request, env, store, params, url }) => {
  const { g } = await guestFaces(request, env, store, params.id, url, { skipOn: true });
  if (!(await faceTokenValid(stateSecret(env), request.headers.get('X-Face-Token'), g.id))) throw new HttpError(403, 'החיפוש פג. צלמו סלפי שוב.', 'face_token');
  const n = Number(params.n);
  if (!Number.isInteger(n) || n < 0) throw new HttpError(404, 'לא נמצא');
  const v = url.searchParams.get('v');
  const bytes = await guestChunk(store, g.id, n, v && /^\d+$/.test(v) ? Number(v) : null);
  return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': v ? 'private, max-age=86400' : 'private, no-store' } });
});

// ---------- print files: the studio's own export, and a private link for the print shop ----------
const printUrl = (url: URL, token: string) => `${url.origin}/print/${token}`;

/**
 * Photos in the couple's album that the studio hid since: the print shop still gets them (D15), and
 * the studio sees how many next to the link.
 */
async function hiddenInAlbum(store: Store, g: Gallery): Promise<number> {
  // The album the print shop gets: the copy as sent (P55), else the draft.
  const [copy, doc] = await Promise.all([store.getPrintAlbum(g.id), photoDoc(store, g)]);
  const album = copy?.album ?? (copy ? await store.getAlbum(g.id) : null);
  if (!album || !doc) return 0;
  const used = usedPhotos(album);
  return doc.data.items.filter((i) => i.hidden && used.has(i.key)).length;
}

/**
 * The link as the hub shows it (P55): its address, when it was made and when it stops (30 days, renewable), whether it
 * has passed, and why it gives no files now (`paused`: 'not_sent' | 'album_open' | 'pages_changed', else null).
 */
async function printLinkView(store: Store, g: Gallery, url: URL) {
  const [hidden, block] = await Promise.all([hiddenInAlbum(store, g), printBlockOf(store, g).catch(() => null)]);
  if (!g.printToken) return { url: '', createdAt: '', expiresAt: '', expired: false, paused: block, hiddenInAlbum: hidden };
  return { url: printUrl(url, g.printToken), createdAt: g.printTokenAt ?? '', expiresAt: printLinkExpiresAt(g), expired: printLinkExpired(g), paused: block, hiddenInAlbum: hidden };
}

/** Why the print shop gets no files now, read fresh (the hub's card and the studio's actions). */
async function printBlockOf(store: Store, g: Gallery) {
  const [copy, state] = await Promise.all([store.getPrintAlbum(g.id), orderStateOrNull(store, g.id)]);
  return printBlock(copy, state);
}

route('GET', '/api/admin/galleries/:id/print-link', async ({ request, store, params, url }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id);
  return json(await printLinkView(store, g, url));
});

/**
 * Makes the link (only for an album the couple sent, P55), or `renew: true`: the same link for 30 more days from now.
 * An expired link is replaced by a new one (the old address stays dead); a live one is answered as it is.
 */
route('POST', '/api/admin/galleries/:id/print-link', async ({ request, store, params, url }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id, true);
  const input = request.headers.get('Content-Type')?.includes('json') ? await body<{ renew?: unknown }>(request).catch(() => ({}) as { renew?: unknown }) : {};
  const copy = await store.getPrintAlbum(g.id);
  if (!copy) throw new HttpError(400, 'לזוג עוד אין אלבום');
  if (!copy.album) throw new HttpError(409, PRINT_BLOCK_WORDS.not_sent, 'not_sent');
  const now = new Date().toISOString();
  if (g.printToken && input.renew === true) {
    // Only while the link is still the one read (a revoke meanwhile wins).
    const renewed = await store.patchGallery(g.tenantId, g.id, { printTokenAt: now }, { printToken: g.printToken });
    if (!renewed?.printToken) throw new HttpError(409, 'הקישור השתנה בינתיים. רעננו את הדף.');
    Object.assign(g, { printToken: renewed.printToken, printTokenAt: renewed.printTokenAt });
  } else if (!g.printToken || printLinkExpired(g)) {
    // Made only while the link is the one read: two clicks at once give the same link, never two.
    const made = (await store.patchGallery(g.tenantId, g.id, { printToken: randomToken(24), printTokenAt: now }, { printToken: g.printToken ?? null })) ?? (await store.getGallery(g.id));
    if (!made?.printToken) throw new HttpError(404, 'הגלריה לא נמצאה');
    Object.assign(g, { printToken: made.printToken, printTokenAt: made.printTokenAt });
  }
  return json(await printLinkView(store, g, url));
});

// Revoking lowers exposure: also for a read-only studio (P55).
route('DELETE', '/api/admin/galleries/:id/print-link', async ({ request, store, params }) => {
  const { g } = await ownedPhotoGallery(request, store, params.id, true, true);
  await store.patchGallery(g.tenantId, g.id, { printToken: undefined, printTokenAt: undefined });
  printKept.delete(g.id);
  return json({ ok: true });
});

/**
 * The print shop's page asks for every photo of the album, one request each. The album as SENT (P55: never a draft)
 * and its order are kept here for a minute per gallery, for at most two galleries (P62), and the photo list for its
 * version (photoDoc, P61); the link itself, its 30 days, the gallery and its studio are checked in the database on
 * every request, so a cancelled or expired link, a trashed gallery or a suspended studio stops at once. A reopened
 * album pauses the link (409) within that minute (at once on the Worker that reopened it).
 */
const PRINT_KEEP_MS = 60_000;
const PRINT_KEEP_GALLERIES = 2;
const printKept = new Map<string, { at: number; album: Album | null; block: ReturnType<typeof printBlock> }>();

async function printTarget(store: Store, token: string) {
  const g = /^[A-Za-z0-9_-]{20,64}$/.test(token) ? await store.getGalleryByPrintToken(token) : null;
  const tenant = g ? await store.getTenant(g.tenantId) : null;
  const ok = g && !g.deletedAt && g.printToken === token && tenant && tenant.access !== 'blocked' && tenant.photos;
  if (!g || !tenant || !ok) throw new HttpError(404, 'הקישור לא בתוקף. בקשו קישור חדש מהסטודיו.');
  if (printLinkExpired(g)) throw new HttpError(404, PRINT_EXPIRED_WORDS, 'print_expired');
  let kept = printKept.get(g.id);
  const fresh = !kept || Date.now() - kept.at >= PRINT_KEEP_MS;
  if (fresh) {
    printKept.delete(g.id);
    const [copy, state] = await Promise.all([store.getPrintAlbum(g.id), store.albumOrderState(g.id).catch(() => undefined)]);
    // The order could not be read: its page count is not known — ask again on the next request.
    if (state === undefined && copy?.album && !copy.open) throw new HttpError(503, 'לא הצלחנו לבדוק את ההזמנה כרגע. נסו שוב בעוד רגע.');
    kept = { at: Date.now(), album: copy?.album ?? null, block: printBlock(copy, state ?? null) };
    printKept.set(g.id, kept);
    // The oldest goes first (a Map keeps the order things were put in).
    while (printKept.size > PRINT_KEEP_GALLERIES) printKept.delete(printKept.keys().next().value!);
  }
  if (kept!.block) throw new HttpError(409, PRINT_BLOCK_WORDS[kept!.block], kept!.block);
  const album = kept!.album!;
  const doc = await photoDoc(store, g);
  if (!doc) throw new HttpError(404, 'הקישור לא בתוקף. בקשו קישור חדש מהסטודיו.');
  // The list read now is the one the gallery row names: its previews may use the edge cache (visible ones only).
  const cache = doc.version === g.photosVersion ? { visible: g.photosVisibleVersion ?? 0, gen: g.photosGen ?? 0 } : undefined;
  return { g, tenant, album, photos: doc.data, cache };
}

/** The print shop's page data: the album as sent and the shapes of its photos. Works after the gallery closes (30 days from the link). */
route('GET', '/api/print/:token', async ({ store, params }) => {
  const { g, tenant, album, photos } = await printTarget(store, params.token);
  const used = usedPhotos(album);
  return json(
    {
      coupleName: g.coupleName,
      studioName: g.studioName || studioNameOf(tenant),
      album,
      photos: photos.items.filter((i) => used.has(i.key)).map((i) => ({ key: i.key, ar: i.ar ?? 1.5 })),
      base: printPhotoBase(params.token, photos.gen),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
});

/** One photo of the album for the print shop; the address with the generation (P66) or without (links sent before). */
async function printPhoto({ request, env, store, params, url, waitUntil }: Ctx): Promise<Response> {
  const asked = addressVersion(params);
  const { g, tenant, album, photos, cache } = await printTarget(store, params.token);
  // Only photos that are in the album; nothing else from the gallery.
  if (!usedPhotos(album).has(params.key)) throw new HttpError(404, 'התמונה לא באלבום');
  const item = photos.items.find((i) => i.key === params.key);
  if (!item) throw new HttpError(404, 'התמונה לא נמצאה');
  // A photo hidden after it went into the album still prints (D15), never through the public edge cache
  // (photoResponse); the studio is warned in the hub.
  return photoResponse(env, () => getSettings(env, store, g.tenantId, tenant), photos, item, url.searchParams.get('s') === 'l' ? 'l' : 'full', request, false, g.id, { includeHidden: true, cache, current: asked === (photos.gen ?? 0), waitUntil });
}
route('GET', '/api/print/:token/photo/:key', printPhoto);
route('GET', '/api/print/:token/photo/:ver/:key', printPhoto);

// ---------- slideshow songs (per studio, up to 3) ----------
const MUSIC_TYPES = /^audio\/(mpeg|mp3|mp4|x-m4a|aac|ogg|wav|x-wav)$/;
const MUSIC_MAX = 10 * 1024 * 1024;

async function settingsView(env: Env, store: Store, tenantId: string, url: URL) {
  const [s, f, tenant] = await Promise.all([getSettings(env, store, tenantId), store.getFilmsStudio(tenantId), store.getTenant(tenantId)]);
  return { ...adminView(s, f), slug: tenant?.slug ?? '', redirectUri: redirectUri(url) };
}

route('POST', '/api/admin/music', async ({ request, env, store, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true, module: 'photos' });
  await adminUploadLimit(store, me.tenantId);
  const f = await store.getFilmsStudio(me.tenantId);
  if ((f.music ?? []).length >= 3) throw new HttpError(400, 'אפשר לשמור עד 3 שירים. מחקו אחד כדי להוסיף.');
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  if (!MUSIC_TYPES.test(type)) throw new HttpError(400, 'צריך קובץ שמע (MP3 או M4A)');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) throw new HttpError(400, 'הקובץ ריק');
  if (bytes.byteLength > MUSIC_MAX) throw new HttpError(400, 'השיר גדול מדי (עד 10MB). אפשר לייצא אותו ב-MP3 באיכות 192.');
  let name = '';
  try {
    name = decodeURIComponent(request.headers.get('X-File-Name') ?? '');
  } catch {
    name = '';
  }
  const track = { id: randomToken(9), name: name.replace(/\.[^.]+$/, '').replace(/[\r\n]+/g, ' ').slice(0, 80) || 'שיר', type, size: bytes.byteLength };
  await store.putMusic(me.tenantId, track.id, bytes, type);
  f.music = [...(f.music ?? []), track];
  if (!f.musicDefault) f.musicDefault = track.id;
  await store.patchFilmsStudio(me.tenantId, { music: f.music, musicDefault: f.musicDefault });
  return json(await settingsView(env, store, me.tenantId, url));
});

route('DELETE', '/api/admin/music/:id', async ({ request, env, store, params, url }) => {
  const me = await requireStudioAdmin(request, store, { write: true, module: 'photos' });
  const f = await store.getFilmsStudio(me.tenantId);
  if (!f.music?.some((t) => t.id === params.id)) throw new HttpError(404, 'השיר לא נמצא');
  await store.deleteMusic(me.tenantId, params.id);
  f.music = f.music.filter((t) => t.id !== params.id);
  if (f.musicDefault === params.id) f.musicDefault = f.music[0]?.id ?? '';
  await store.patchFilmsStudio(me.tenantId, { music: f.music, musicDefault: f.musicDefault });
  return json(await settingsView(env, store, me.tenantId, url));
});

/** A studio's song, for the slideshow (with Range: players ask for pieces). */
for (const method of ['GET', 'HEAD']) {
  route(method, '/api/music/:tid/:id', async ({ request, store, params }) => {
    if (!/^[0-9a-f-]{36}$/.test(params.tid) || !/^[A-Za-z0-9_-]{6,20}$/.test(params.id)) throw new HttpError(404, 'לא נמצא');
    const tenant = await store.getTenant(params.tid);
    if (!tenant || tenant.access === 'blocked' || !tenant.photos) throw new HttpError(404, 'לא נמצא');
    const f = await store.getFilmsStudio(params.tid);
    const track = f.music?.find((t) => t.id === params.id);
    if (!track) throw new HttpError(404, 'השיר לא נמצא');
    const up = await store.getMusic(params.tid, params.id, request.headers.get('Range'));
    if (!up) throw new HttpError(404, 'השיר לא נמצא');
    const headers = new Headers({ 'Content-Type': track.type || 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' });
    for (const h of ['Content-Length', 'Content-Range']) {
      const v = up.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(request.method === 'HEAD' ? null : up.body, { status: up.status, headers });
  });
}

/** A heart from the couple (or someone with their link), by name when they gave one. */
route('POST', '/api/watch/:id/fav', async ({ request, env, store, params, url }) => {
  const { g, tenant } = await coupleGallery(store, params.id, url);
  await requireView(request, stateSecret(env), g, 'couple', { version: versionOf(tenant) });
  if (kindOf(g) !== 'photos') throw new HttpError(404, 'הגלריה לא נמצאה');
  if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
  const ip = clientIp(request);
  await rateLimit(store, `fav:${g.id}:${ip}`, 1500, 'יותר מדי סימונים בזמן קצר. נסו שוב בעוד כמה דקות.');
  const { key, keys, on, who } = await body<{ key?: string; keys?: string[]; on: boolean; who?: string }>(request);
  const data = (await photoDoc(store, g))?.data ?? null;
  // Every photo in one write (P70; 500 photos were 500 requests), then the hearts of the photos the couple sees.
  await store.setHearts(g.tenantId, g.id, visibleKeys(data, keys ?? [String(key)]), Boolean(on), cleanWho(who));
  const { favBy } = heartsFor(data, await store.listHearts(g.id), []);
  return json({ ok: true, favorites: favoritesFrom(favBy), favBy });
});

// Every film streams through here, with Range for seeking. Closed galleries stop streaming.
for (const method of ['GET', 'HEAD']) {
  route(method, '/api/watch/:id/film/:n', async ({ request, env, store, params, url }) => {
    const { g, role, tenant } = await publicGallery(store, params.id, url);
    if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
    const access = await requireView(request, stateSecret(env), g, role, { version: versionOf(tenant) });
    if (url.searchParams.get('dl') === '1' && !access.download) throw new HttpError(403, 'להורדה צריך את קוד ההורדה מהסטודיו');
    const n = Number(params.n);
    const film = g.films[n];
    if (!film) throw new HttpError(404, 'הסרט לא נמצא');
    // Without the code only the smallest size of each film streams (see filmsWithoutCode).
    if (!access.download && !filmsWithoutCode(g).has(n)) throw new HttpError(403, 'הגרסה הזו זמינה עם קוד ההורדה מהסטודיו');
    if (env.CLOUD_MOCK) return mockClip(env, request, url, film.watchUrl, film.fileId);
    const s = await getSettings(env, store, g.tenantId, tenant);
    return streamFilm(s, env, film, request, url.searchParams.get('dl') === '1', url.origin);
  });
}

// "Download all" for Dropbox folders, zipped by Dropbox and streamed through us.
route('GET', '/api/watch/:id/all', async ({ request, env, store, params, url }) => {
  const { g, role, tenant } = await publicGallery(store, params.id, url);
  // Photo galleries: their folder also holds the hidden photos; the couple's ZIP is made in the browser.
  if (kindOf(g) !== 'films') throw new HttpError(404, 'אין תיקייה להורדה');
  if (isExpired(g)) throw new HttpError(410, 'הגלריה נסגרה');
  const access = await requireView(request, stateSecret(env), g, role, { version: versionOf(tenant) });
  if (role !== 'couple' || !access.download) throw new HttpError(403, 'להורדה צריך את קוד ההורדה מהסטודיו');
  if (!g.folderUrl || !(g.folderProvider === 'dropbox' || g.folderProvider === 'dropbox-link' || !g.folderProvider)) throw new HttpError(404, 'אין תיקייה להורדה');
  if (env.CLOUD_MOCK) return json({ mock: true, folder: g.folderUrl });
  return streamFolderZip(g.folderUrl, request, g.coupleName || 'films');
});

/**
 * Views and downloads for the studio's list. Only someone who may open the gallery is counted (the
 * password, as every public route); the studio looking at its own gallery is not; a view through the
 * guests' link is counted apart from the couple's (P72, D15). Answers ok either way, so it tells nothing.
 */
route('POST', '/api/watch/:id/event', async ({ request, env, store, params, url }) => {
  const { type } = await body<{ type: string }>(request);
  if (type !== 'view' && type !== 'download') return json({ ok: true });
  const { g, role, tenant } = await publicGallery(store, params.id, url);
  if (isExpired(g)) return json({ ok: true });
  const access = await accessOf(request, stateSecret(env), g, role, { version: versionOf(tenant) });
  if (!access.view || access.studio) return json({ ok: true });
  // A few events per visitor per hour is plenty; more is noise or abuse. Per gallery, whichever link.
  if (!(await store.hit(`event:${g.id}:${clientIp(request)}`, 30, 3600))) return json({ ok: true });
  await store.countEvent(g.id, type === 'view' && role === 'guest' ? 'guest_view' : type);
  return json({ ok: true });
});

/** The couple accepted the terms: kept as a record (when, which text, which browser; the IP only hashed). */
route('POST', '/api/watch/:id/terms', async ({ request, env, store, params, url }) => {
  const { g, role, tenant } = await publicGallery(store, params.id, url);
  if (isExpired(g)) throw new HttpError(404, 'הקישור לא נמצא');
  // Only someone who may open the gallery; the studio looking at it is not the couple accepting.
  const access = await requireView(request, stateSecret(env), g, role, { version: versionOf(tenant) });
  if (access.studio) return json({ ok: true });
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  await rateLimit(store, `terms:${g.id}:${clientIp(request)}`, 20);
  const s = await getSettings(env, store, g.tenantId);
  await store.recordTermsAccept({
    tenantId: g.tenantId,
    galleryId: g.id,
    termsHash: await shortHash(s.termsText),
    ipHash: await shortHash(`${stateSecret(env)}:${ip}`),
    userAgent: request.headers.get('User-Agent') ?? '',
    // The couple's link or the guests' (the hub counts only the couple as "the couple accepted").
    role,
    linkId: params.id,
  });
  return json({ ok: true });
});

route('GET', '/api/manifest/:id', async ({ store, params }) => {
  const res = await manifestFor(store, params.id);
  if (!res) throw new HttpError(404, 'לא נמצא');
  return res;
});

route('GET', '/api/cover/:id', async ({ request, env, store, params, url, waitUntil }) => {
  // The couple's id or the guests' id; behind a password only for who may open the gallery
  // (the studio's screens add their preview token). Checked on every request; the picture itself is kept at
  // the edge for 10 minutes (P66), so KV is not read every time.
  const { g, role, tenant } = await publicGallery(store, params.id, url);
  // The hub's list picture may carry a thumbs token (P73).
  if (!(await accessOf(request, stateSecret(env), g, role, { version: versionOf(tenant), pt: url.searchParams.get('pt'), thumbs: true })).view) throw new HttpError(404, 'לא נמצא');
  return getCover(env, g.id, Boolean(g.password), url.searchParams.get('v'), { version: g.coverVersion, waitUntil });
});

// ---------- test-only (CLOUD_MOCK + in-memory store) ----------
route('POST', '/api/__test/tenant', async ({ request, env, store }) => {
  if (!env.CLOUD_MOCK || env.SUPABASE_URL) throw new HttpError(404, 'לא נמצא');
  const { albumOrders, ...t } = await body<Record<string, unknown>>(request);
  const { MemoryStore } = await import('./store-memory');
  if (!(store instanceof MemoryStore)) throw new HttpError(404, 'לא נמצא');
  // `albumOrders: false`: a studio without the hub's album orders (no crm).
  if (albumOrders === false) store.noAlbumOrders.add(String(t.id));
  return json(store.seedTenant(t as never));
});

// A hub event of a studio (P57: the gallery form links a gallery to one; the mock checks it belongs to the studio).
route('POST', '/api/__test/event', async ({ request, env, store }) => {
  if (!env.CLOUD_MOCK || env.SUPABASE_URL) throw new HttpError(404, 'לא נמצא');
  const e = await body<{ id: string; tenantId: string }>(request);
  const { MemoryStore } = await import('./store-memory');
  if (!(store instanceof MemoryStore)) throw new HttpError(404, 'לא נמצא');
  store.seedEvent(String(e.id), String(e.tenantId));
  return json({ ok: true });
});

// The hub's e2e (port B10): a sketch design open to the couple, by the SHA-256 of its portal link (as 0173 answers).
route('POST', '/api/__test/design-bank', async ({ request, env, store }) => {
  if (!env.CLOUD_MOCK || env.SUPABASE_URL) throw new HttpError(404, 'לא נמצא');
  const d = await body<{ tokenHash: string; tenantId: string; orderId: string; galleries: string[]; open?: boolean }>(request);
  const { MemoryStore } = await import('./store-memory');
  if (!(store instanceof MemoryStore)) throw new HttpError(404, 'לא נמצא');
  store.seedDesignBank(String(d.tokenHash), { tenantId: String(d.tenantId), orderId: String(d.orderId), galleries: (d.galleries ?? []).map(String), open: d.open !== false });
  return json({ ok: true });
});

route('GET', '/api/__test/leads', async ({ env, store }) => {
  if (!env.CLOUD_MOCK || env.SUPABASE_URL) throw new HttpError(404, 'לא נמצא');
  const { MemoryStore } = await import('./store-memory');
  if (!(store instanceof MemoryStore)) throw new HttpError(404, 'לא נמצא');
  return json(store.leads);
});

/**
 * One run of the nightly link check (worker/cleanup.ts checkFilmLinks), logged by gallery id and place only. A run that
 * could not start (no database) throws, so Cron Events show it; a film that failed to check is a log line.
 */
async function linkCheckRun(env: Env): Promise<void> {
  let report: LinkCheckReport;
  try {
    report = await checkFilmLinks(await storeFor(env), env);
  } catch (e) {
    console.error('linkcheck: the run failed', e);
    throw e;
  }
  console.log(
    `linkcheck: ${report.checked} films in ${report.galleries} galleries checked, ${report.broken.length} broken` +
      (report.broken.length ? ` (${report.broken.map((b) => `${b.galleryId} #${b.index}`).join(', ')})` : '') +
      `, ${report.fixed} found again, ${report.unknown} could not be checked, ${report.alerted} studios told (${report.emailed} by mail), ` +
      `${report.subrequests} requests` +
      (report.stopped ? `, stopped: ${report.stopped}` : '') +
      (report.wrapped ? ', the list starts again next run' : ''),
  );
  for (const e of report.errors) console.error(`linkcheck: ${e.step}${e.id ? ` ${e.id}` : ''} failed: ${e.error}`);
}

// A studio's Dropbox connection, for the hub's tests (the mock has no Dropbox to connect to).
route('POST', '/api/__test/dropbox', async ({ request, env, store }) => {
  if (!env.CLOUD_MOCK || env.SUPABASE_URL) throw new HttpError(404, 'לא נמצא');
  const { tenantId, accountName: name } = await body<{ tenantId: string; accountName?: string }>(request);
  const { MemoryStore } = await import('./store-memory');
  if (!(store instanceof MemoryStore)) throw new HttpError(404, 'לא נמצא');
  await store.setSecret(String(tenantId), DROPBOX_SECRET, 'mock-refresh-token');
  await store.patchFilmsStudio(String(tenantId), { dropboxAccountName: String(name ?? 'חשבון בדיקה') });
  return json({ ok: true });
});

// ---------- CORS for the hub ----------
function corsHeaders(env: Env, request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = env.CLOUD_MOCK && !env.HUB_URL ? origin : (env.HUB_URL ?? '').replace(/\/$/, '');
  if (!origin || !allowed || origin !== allowed) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-File-Name',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/**
 * The site's own rules for every page and answer: framed only by itself and the hub (its design
 * preview), no plugins, no <base> redirection. A full script-src waits until index.html has no
 * inline handlers left and face search is checked with it.
 */
function siteCsp(env: Env): string {
  let hub = '';
  try {
    hub = env.HUB_URL ? new URL(env.HUB_URL).origin : '';
  } catch {
    hub = '';
  }
  const rest = "object-src 'none'; base-uri 'self'";
  // Tests and local previews without a hub address: the hub (or a test page) frames from anywhere.
  if (!hub && env.CLOUD_MOCK) return rest;
  return `frame-ancestors 'self'${hub ? ` ${hub}` : ''}; ${rest}`;
}

/** Every page and API answer: the browser must not guess file types, and links don't leak paths. */
function withHeaders(res: Response, extra: Record<string, string>, env: Env): Response {
  // Some answers (streamed from a cloud) come with fixed headers; a copy can be changed.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // A photo keeps its own stricter policy (photoResponse).
  if (!out.headers.has('Content-Security-Policy')) out.headers.set('Content-Security-Policy', siteCsp(env));
  return out;
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      // A couple's or a studio's link: the page with a preview card for WhatsApp. Anything else: the files as they are.
      if (request.method === 'GET') {
        try {
          const page = await pageWithMeta(request, env, await storeFor(env));
          if (page) return withHeaders(page, {}, env);
        } catch (err) {
          console.error(err);
        }
      }
      return withHeaders(await env.ASSETS.fetch(request), {}, env);
    }
    // The hub calls the admin routes, and the couple's album portal (a hub page) the design bank.
    const cors = url.pathname.startsWith('/api/admin/') || url.pathname.startsWith('/api/album-portal/') ? corsHeaders(env, request) : {};
    if (request.method === 'OPTIONS') return new Response(null, { status: Object.keys(cors).length ? 204 : 403, headers: cors });
    try {
      const store = await storeFor(env);
      for (const r of routes) {
        if (r.method !== request.method) continue;
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        const params: Record<string, string> = {};
        try {
          r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        } catch {
          throw new HttpError(400, 'כתובת לא תקינה');
        }
        const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
        return withHeaders(await r.handler({ request, env, params, url, store, waitUntil }), cors, env);
      }
      return withHeaders(json({ error: 'לא נמצא' }, { status: 404 }), cors, env);
    } catch (err) {
      if (err instanceof HttpError) return withHeaders(json({ ...(err.extra ?? {}), error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status }), cors, env);
      console.error(err);
      return withHeaders(json({ error: 'שגיאה לא צפויה בשרת' }, { status: 500 }), cors, env);
    }
  },
  /**
   * Every hour (wrangler.jsonc "crons"): see worker/cleanup.ts. A run with failures throws at the end,
   * so Cloudflare's Cron Events show it as failed (the rest of the run was still done).
   */
  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    // The nightly link check (P65) is its own cron: its own run, budget and failures, never the clean-up's.
    if (event?.cron === LINK_CHECK_CRON) return linkCheckRun(env);
    let report: NightlyReport;
    try {
      report = await nightly(await storeFor(env), env);
    } catch (e) {
      console.error('cleanup: the run failed', e);
      throw e;
    }
    console.log(
      `cleanup: face data removed for ${report.facesRemoved.length} galleries (${report.pendingFaces} waiting), ` +
        (report.facesRewritten.length ? `face files rewritten in ${report.facesRewritten.length} galleries, ` : '') +
        `${report.purged.length} removed from the trash (${report.pendingTrash} waiting), ` +
        (report.printLinksExpired ? `${report.printLinksExpired} print links past 30 days removed, ` : '') +
        (report.lapsed.studios ? `${report.lapsed.studios} cancelled studios closed (${report.lapsed.galleries} galleries, ${report.lapsed.printLinks} print links), ` : '') +
        (report.blockedTotal ? `${report.blockedTotal} kept for an album order (${report.blocked.map((b) => `${b.id} ${b.reason}`).join(', ')}), ` : '') +
        `${report.subrequests} requests` +
        (report.stopped ? `, stopped: ${report.stopped}` : ''),
    );
    for (const e of report.errors) console.error(`cleanup: ${e.step}${e.id ? ` ${e.id}` : ''} failed: ${e.error}`);
    if (report.errors.length) throw new Error(`cleanup: ${report.errors.length} failure(s), see the lines above`);
  },
} satisfies ExportedHandler<Env>;
