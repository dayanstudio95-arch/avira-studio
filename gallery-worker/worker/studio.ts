import { groupVersions, sortByTag } from '../shared/dropbox';
import { isIsoDate } from '../shared/event';
import { randomId } from './auth';
import { filmUrls } from './providers';
import { whatsappNumber } from './settings';
import { reviewKeys, type ImportedReview } from './mit4mit';
import type { Env, Lead, Review, Settings, StudioPage } from './types';
import { studioChanges, type FilmsStudio, type Store } from './store';
import { HttpError } from './types';

/** The studio page (showcase, reviews, on/off) from films_studio_settings. */
export async function getStudioPage(store: Store, tenantId: string): Promise<StudioPage> {
  const f = await store.getFilmsStudio(tenantId);
  return {
    enabled: f.pageEnabled,
    showcase: { ...(f.showcase ?? {}), films: f.showcase?.films ?? [] },
    mit4mitUrl: f.mit4mitUrl,
    reviews: f.reviews ?? [],
    ...(f.mit4mitBizId ? { mit4mitBizId: f.mit4mitBizId, mit4mitApproved: Boolean(f.mit4mitApprovedAt) } : {}),
  };
}

/** Writes only what changed since `before` was read (the rest of films_studio_settings is not touched). */
export async function saveStudioPage(store: Store, tenantId: string, before: StudioPage, page: StudioPage, extra: Partial<FilmsStudio> = {}): Promise<void> {
  const asStudio = (p: StudioPage) => ({ pageEnabled: p.enabled, showcase: p.showcase, mit4mitUrl: p.mit4mitUrl, reviews: p.reviews }) as FilmsStudio;
  const fields = { ...studioChanges(asStudio(before), asStudio(page)), ...extra };
  if (Object.keys(fields).length) await store.patchFilmsStudio(tenantId, fields);
}

/** At most this many reviews on a studio's list (imported ones are kept, so the list grows: P71). */
export const MAX_REVIEWS = 200;

/**
 * Reviews sent by the studio's screen (P71). An imported review is the one saved (`saved`, by its id): its name,
 * text and score stay as mit4mit had them, and the screen changes only whether it is shown. Anything else is the
 * studio's own review ('manual'), long text trimmed and names kept as written. `removed`: the identity keys of the
 * imported reviews the screen no longer sends (deleted by the studio: never imported again).
 */
export function cleanReviews(input: unknown, saved: Review[] = []): { reviews: Review[]; removed: string[] } {
  const imported = new Map(saved.filter((r) => r.source === 'mit4mit').map((r) => [r.id, r]));
  const list = Array.isArray(input) ? input : [];
  const reviews = list
    .slice(0, MAX_REVIEWS)
    .map((r): Review => {
      const was = r?.source === 'mit4mit' ? imported.get(String(r?.id ?? '')) : undefined;
      if (was) return { ...was, visible: Boolean(r?.visible) };
      return {
        id: String(r?.id || randomId()).slice(0, 40),
        name: String(r?.name ?? '').trim().slice(0, 80) || 'זוג מאושר',
        score: Math.max(0, Math.min(100, Math.round(Number(r?.score) || 0))),
        text: String(r?.text ?? '').trim().slice(0, 4000),
        when: String(r?.when ?? '').trim().slice(0, 40),
        visible: Boolean(r?.visible),
        source: 'manual',
      };
    })
    .filter((r) => r.text);
  // One copy of each imported review.
  const seen = new Set<string>();
  const out = reviews.filter((r) => r.source !== 'mit4mit' || (!seen.has(r.id) && seen.add(r.id)));
  const kept = new Set(out.filter((r) => r.source === 'mit4mit').map((r) => r.id));
  const removed = [...imported.values()].filter((r) => !kept.has(r.id)).flatMap((r) => reviewKeys(r));
  return { reviews: out, removed };
}

/** What one import did (P71): read from the page, new (hidden until the studio shows them), found again, not on the page any more. */
export interface ImportCounts {
  imported: number;
  added: number;
  kept: number;
  stale: number;
  skipped: number;
}

/**
 * An import merged into the saved list (P71): a review found again keeps its id and its show/hide choice (its
 * words follow the page); a new one comes in hidden; one the studio deleted (`removed`) never comes back; an
 * imported review no longer on the page stays, marked stale ('לא בעמוד האחרון'). The studio's own reviews stay
 * as they are, after the imported ones. At most MAX_REVIEWS: stale ones go first when there are more.
 */
export function mergeImport(saved: Review[], fetched: ImportedReview[], removed: string[]): { reviews: Review[]; counts: ImportCounts } {
  const gone = new Set(removed);
  const old = saved.filter((r) => r.source === 'mit4mit');
  const manual = saved.filter((r) => r.source !== 'mit4mit');
  const byKey = new Map<string, Review>();
  for (const r of old) for (const k of reviewKeys(r)) if (!byKey.has(k)) byKey.set(k, r);
  const used = new Set<string>();
  const counts: ImportCounts = { imported: fetched.length, added: 0, kept: 0, stale: 0, skipped: 0 };
  const fresh: Review[] = [];
  for (const f of fetched) {
    const keys = reviewKeys(f);
    if (keys.some((k) => gone.has(k))) {
      counts.skipped++;
      continue;
    }
    const prev = keys.map((k) => byKey.get(k)).find((r) => r && !used.has(r.id));
    if (prev) used.add(prev.id);
    const ext = f.ext ?? prev?.ext;
    const r: Review = { id: prev?.id ?? randomId(), name: f.name, score: f.score, text: f.text, when: f.when, visible: prev ? prev.visible : false, source: 'mit4mit', ...(ext ? { ext } : {}) };
    if (prev) counts.kept++;
    else counts.added++;
    fresh.push(r);
  }
  const stale = old.filter((r) => !used.has(r.id)).map((r): Review => ({ ...r, stale: true }));
  counts.stale = stale.length;
  let reviews = [...fresh, ...stale, ...manual];
  // Too many: the oldest stale reviews go first, then the end of the list.
  for (let i = reviews.length - 1; reviews.length > MAX_REVIEWS && i >= 0; i--) if (reviews[i].stale) reviews.splice(i, 1);
  reviews = reviews.slice(0, MAX_REVIEWS);
  return { reviews, counts };
}

/**
 * A reviewer's name on the public page (decision D15(5)): each person's first name and the first letter of the
 * rest ("שירה כהן" → "שירה כ."; "נועה & איתי" stays). Applied to imported reviews: the studio types its own.
 */
export function shortName(name: string): string {
  return name
    .split(/\s*(?:&|\+|,|\s-\s)\s*/)
    .map((person) => {
      const [first, second] = person.trim().split(/\s+/);
      return second ? `${first} ${second[0]}.` : (first ?? '');
    })
    .filter(Boolean)
    .join(' & ');
}

/** What the couple's browser receives for /<slug>. */
export function publicStudio(slug: string, s: Settings, page: StudioPage, env: Env) {
  const live = page.showcase.films.map((f, index) => {
    // The showcase is not a gallery: every film but MyAirBridge's (its own address) streams through
    // the studio's route (/api/studio/<slug>/film/<n>), never a gallery route with no gallery id.
    const own = f.provider === 'myairbridge' ? filmUrls(f, s, env).watchUrl : `/api/studio/${slug}/film/${index}`;
    const watchUrl = f.playable ? own : '';
    return { ...f, index, watchUrl, downloadUrl: '', playable: f.playable && Boolean(watchUrl) };
  });
  const films = sortByTag(
    groupVersions(live).map((grp) => {
      const versions = grp.versions.map((v) => ({ label: v.label, height: v.height, watchUrl: v.watchUrl, downloadUrl: '', sizeBytes: v.sizeBytes, playable: v.playable }));
      const top = grp.versions[0];
      return { title: grp.versions.length > 1 ? grp.title : top.title, tag: grp.tag, watchUrl: top.watchUrl, downloadUrl: '', sizeBytes: top.sizeBytes, playable: versions.some((v) => v.playable), versions };
    }),
  ).filter((f) => f.playable);
  return {
    slug,
    studioName: s.studioName,
    logoUrl: s.logoUrl,
    accentColor: s.accentColor,
    headline: s.headline,
    about: s.about,
    phone: s.phone,
    whatsapp: whatsappNumber(s.phone),
    instagram: s.instagram,
    facebook: s.facebook,
    vimeo: s.vimeo,
    youtube: s.youtube,
    films,
    mit4mitUrl: page.mit4mitUrl ?? '',
    // The quote form's human check (fix plan P10): only when the Worker has both Turnstile keys.
    turnstileSiteKey: env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : '',
    // Imported reviews only once the platform operator approved the business (P71, D15(5)), by first name and initial.
    reviews: page.reviews
      .filter((r) => r.visible && (r.source !== 'mit4mit' || page.mit4mitApproved === true))
      .map(({ name, score, text, when, source }) => ({ name: source === 'mit4mit' ? shortName(name) : name, score, text, when, source })),
  };
}

// ---------- leads ----------
// Quote requests go to the hub's leads list (store.insertLead); the validation, the human check and the limits
// live here (fix plan P10, decision D23(3)): Cloudflare Turnstile when the Worker has its keys, at most
// LEAD_LIMITS.perAddressHour from one address, perStudioHour / perStudioDay for one studio (a script can no longer
// fill a studio's leads list and its couples' reminders), the limiter failing CLOSED, and one lead per phone.

/** The studio page's quote form limits — the one place for these numbers (D23(3): moderate, by real use later). */
export const LEAD_LIMITS = { perAddressHour: 5, perStudioHour: 20, perStudioDay: 100 } as const;
/** Studio admin uploads that write to KV / storage (cover, list picture, song): per studio and hour (fix plan P10). */
export const ADMIN_UPLOADS_PER_HOUR = 200;

export const LEAD_LIMIT_MESSAGE = 'נשלחו הרבה פניות בזמן קצר. נסו שוב בעוד שעה, או התקשרו לסטודיו.';
const STUDIO_BUSY_MESSAGE = 'הסטודיו קיבל הרבה פניות היום. נסו שוב מחר, או התקשרו לסטודיו.';

/**
 * Counts a quote request against the address and the studio; refuses (429) past a limit and (503) when the count
 * cannot be read — never lets it through unchecked.
 */
export async function leadLimits(store: Store, tenantId: string, ip: string): Promise<void> {
  const counted = async (key: string, max: number, windowSeconds: number) => {
    try {
      return await store.hit(key, max, windowSeconds, { failClosed: true });
    } catch (e) {
      console.error('[films] lead limit unavailable, refusing:', (e as Error).message);
      throw new HttpError(503, 'לא ניתן לשלוח את הפנייה כרגע. נסו שוב בעוד כמה דקות, או התקשרו לסטודיו.');
    }
  };
  if (!(await counted(`lead:${tenantId}:${ip}`, LEAD_LIMITS.perAddressHour, 3600))) throw new HttpError(429, LEAD_LIMIT_MESSAGE);
  if (!(await counted(`lead-studio-hour:${tenantId}`, LEAD_LIMITS.perStudioHour, 3600))) throw new HttpError(429, STUDIO_BUSY_MESSAGE);
  if (!(await counted(`lead-studio-day:${tenantId}`, LEAD_LIMITS.perStudioDay, 86400))) throw new HttpError(429, STUDIO_BUSY_MESSAGE);
}

/**
 * Cloudflare Turnstile on the quote form (the hub's signup uses the same service). On only when the Worker has both
 * TURNSTILE_SITE_KEY (shown to the page) and TURNSTILE_SECRET_KEY; without them the form works as before and the
 * runbook says to set them (P10). A token Cloudflare does not confirm — or no answer from it — is refused.
 */
export async function checkTurnstile(env: Env, token: unknown, ip: string | null, fetcher: typeof fetch = fetch): Promise<void> {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) return;
  const form = new FormData();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', typeof token === 'string' ? token.slice(0, 4096) : '');
  if (ip) form.set('remoteip', ip);
  let passed = false;
  try {
    const r = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    passed = Boolean(((await r.json()) as { success?: boolean }).success);
  } catch {
    passed = false;
  }
  if (!passed) throw new HttpError(400, 'האימות נכשל. רעננו את הדף ונסו שוב.');
}

function clip(v: unknown, n: number): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

/** Checks and cleans what the couple typed. Throws a readable Hebrew error. */
export function validateLead(input: Record<string, unknown>): Lead {
  // As the couple wrote them (P72: "&" is only a suggestion in the studio's own gallery form).
  const coupleName = clip(input.coupleName, 80);
  const phone = clip(input.phone, 30);
  if (!coupleName) throw new HttpError(400, 'נא למלא את שמות הזוג');
  if (!/^\+?[\d\s-]{9,20}$/.test(phone) || phone.replace(/\D/g, '').length < 9) throw new HttpError(400, 'נא למלא מספר טלפון תקין');
  const date = isIsoDate(String(input.date ?? '')) ? String(input.date) : '';
  const lead: Lead = {
    id: randomId(),
    coupleName,
    phone,
    date,
    venue: clip(input.venue, 80),
    guests: clip(input.guests, 10).replace(/[^\d]/g, ''),
    note: String(input.note ?? '').trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
    status: 'new',
  };
  return lead;
}

/**
 * At most `limit` requests per key per hour. One mechanism for the whole Worker: the
 * database's rate_limit_hits table (same as the Edge Functions, rate_hit — 0154), through the store.
 */
export async function rateLimit(store: Store, key: string, limit: number, message = 'נשלחו הרבה פניות בזמן קצר. נסו שוב בעוד שעה, או התקשרו לסטודיו.'): Promise<void> {
  if (!(await store.hit(key, limit, 3600))) throw new HttpError(429, message);
}

/**
 * Who is asking, for rate limits: the IPv4 address, or an IPv6 address's /64 (one home or phone
 * gets a whole /64, so counting single addresses would let it guess without end).
 */
export function clientIp(request: Request): string {
  const ip = (request.headers.get('CF-Connecting-IP') ?? '').trim().toLowerCase();
  if (!ip) return 'local';
  if (!ip.includes(':')) return ip;
  // An IPv4 address written as IPv6 (::ffff:1.2.3.4) is that IPv4 address.
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (v4) return v4[1];
  const [head, tail] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((x) => (parseInt(x, 16) || 0).toString(16))
    .join(':')}::/64`;
}
