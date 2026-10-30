// The clean-up (a Cloudflare cron every hour, wrangler.jsonc). Ported from the Avira films app's
// worker/cleanup.ts (2026-09-27); rewritten for fix plan P69. The database chooses what to do (0105),
// every gallery is handled on its own (one that fails is marked, goes to the end of its queue and the
// run goes on), and a run stays inside its subrequest budget (Cloudflare counts every request a run
// sends: 50 on the free Workers plan, 1000 on the paid one; CLEANUP_MAX_SUBREQUESTS, docs/runbook.md)
// and a time limit. What is left waits for the next hour.
//   1. Face data (biometric: not kept longer than needed, decision D06): galleries that closed, were
//      deleted or trashed, or had face search switched off; scans older than FACE_MAX_AGE_DAYS; studios
//      canceled or suspended for CLOSED_STUDIO_GRACE_DAYS; face files left without a record. Face
//      search is switched off with it, so guests never see an empty search.
//   1b. Face files still holding faces no longer shown (photos hidden or gone since, fix plan P68): rewritten
//      without them, FACE_REWRITE_FILES files per gallery per run (guests never get those faces meanwhile).
//   2. Galleries TRASH_DAYS in the trash, removed for good, in turns between studios. A gallery whose album order
//      is open, paid or in print is never removed (P71, 0135: the database lists it apart, after the others, so it
//      never holds the queue up): it is skipped and reported in `blocked`, not as an error.
//   3. The films Worker's old rate-limit rows (every run, whatever happened before).
//   0. Before all of these (fix plan P55, 0140), two calls: print links past their PRINT_LINK_DAYS go
//      (films_print_links_expire), and the public galleries of studios cancelled more than LAPSED_STUDIO_GRACE_DAYS ago
//      close and their print links go (films_close_lapsed_studios, decision D17(3)) — the ONLY caller of that
//      function; nothing does it on a database push. Their numbers are in the log line, not in films_cleanup_runs.
// Each run is recorded in films_cleanup_runs (what was done, what failed, what is still waiting).
import { rewriteFaceFiles } from './faces';
import { purgeGallery, TRASH_DAYS } from './galleries';
import { filmKey, probeFilm, readMarks, writeMarks, type FilmMarks } from './linkCheck';
import { PRINT_LINK_DAYS } from './printLink';
import { accessToken } from './providers/dropbox';
import { getSettings } from './settings';
import type { BlockedTrash, CleanupRun, Store } from './store';
import type { Env, Film } from './types';

/** A cancelled studio's public galleries close this long after the cancellation (D17(3)). */
export const LAPSED_STUDIO_GRACE_DAYS = 30;
/** Face data is kept at most this long from the scan (D06(1): 12 months). */
export const FACE_MAX_AGE_DAYS = 365;
/** A canceled or suspended studio's face data goes this long after the change (D06(1)). */
export const CLOSED_STUDIO_GRACE_DAYS = 30;
/** Safe on the free Workers plan (50 per run); raise it on the paid plan (see docs/runbook.md). */
export const DEFAULT_MAX_SUBREQUESTS = 45;
const TIME_LIMIT_MS = 60_000;
const DAY = 86_400_000;

// Worst-case requests per item with SupabaseStore, so a started item always has room to finish:
// face data = list + delete + record, plus a failure mark;
const FACE_COST = 3 + 1;
// a trash item = read the gallery, its face data, the partner's link, the row, cover + thumbnail in KV, a failure mark;
const PURGE_COST = 1 + 3 + 1 + 1 + 2 + 1;
// a face-file rewrite = the plan, a download and an upload per file, the swap, the delete of the old files, a mark;
export const FACE_REWRITE_FILES = 5;
const REWRITE_COST = 1 + 2 * FACE_REWRITE_FILES + 1 + 1 + 1;
// the rate-limit sweep and the run record are always left room for.
const RESERVE = 2;

export interface NightlyReport extends Omit<CleanupRun, 'facesRemoved' | 'purged' | 'blocked'> {
  /** Print links past their 30 days, removed this run (P55). */
  printLinksExpired: number;
  /** Studios cancelled past their grace whose galleries closed this run, and what closed (P55, D17(3)). */
  lapsed: { studios: number; galleries: number; printLinks: number };
  facesRemoved: string[];
  /** Galleries whose face files were rewritten this run (P68; in the log line, not in films_cleanup_runs). */
  facesRewritten: string[];
  purged: string[];
  /** Trash galleries past their 30 days kept for their album order (at most 50 listed) and how many in all. */
  blocked: BlockedTrash[];
  blockedTotal: number;
}

export function subrequestBudget(env: Env): number {
  const n = Math.floor(Number(env.CLEANUP_MAX_SUBREQUESTS));
  return Number.isFinite(n) && n >= 20 ? Math.min(n, 1000) : DEFAULT_MAX_SUBREQUESTS;
}

const message = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

export async function nightly(store: Store, env: Env, now = Date.now()): Promise<NightlyReport> {
  const started = Date.now();
  const budget = subrequestBudget(env);
  const base = store.callCount();
  // KV deletes (a purged gallery's cover) are requests too.
  let kvCalls = 0;
  const kv = new Proxy(env.KV, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? (...args: unknown[]) => (kvCalls++, v.apply(target, args)) : v;
    },
  });
  const countedEnv: Env = { ...env, KV: kv };
  const used = () => store.callCount() - base + kvCalls;
  const report: NightlyReport = {
    facesRemoved: [], facesRewritten: [], purged: [], errors: [], pendingFaces: 0, pendingTrash: 0, subrequests: 0, stopped: null, blocked: [], blockedTotal: 0,
    printLinksExpired: 0, lapsed: { studios: 0, galleries: 0, printLinks: 0 },
  };
  const stop = (why: 'budget' | 'time') => {
    report.stopped ??= why;
  };
  const fail = (step: string, id: string | undefined, e: unknown) => {
    report.errors.push({ step, ...(id ? { id } : {}), error: message(e) });
  };

  /**
   * Takes pages of a queue (each page one request) and handles each item on its own, while the
   * budget (keeping `keep` for later steps) and the time allow. Returns how many are still waiting.
   */
  async function drain(
    step: string,
    cost: number,
    keep: number,
    page: (limit: number) => Promise<{ ids: string[]; total: number }>,
    handle: (id: string) => Promise<boolean>,
    markFailed: (id: string) => Promise<void>,
  ): Promise<number> {
    const seen = new Set<string>();
    let pending = 0;
    for (;;) {
      if (Date.now() - started > TIME_LIMIT_MS) return (stop('time'), pending);
      const limit = Math.floor((budget - keep - used() - 1) / cost);
      if (limit < 1) return (stop('budget'), pending);
      let res: { ids: string[]; total: number };
      try {
        res = await page(limit);
      } catch (e) {
        fail(step, undefined, e);
        return pending;
      }
      pending = res.total;
      const fresh = res.ids.filter((id) => !seen.has(id));
      // Only items that failed earlier in this run are left: they wait for the next run.
      if (fresh.length === 0) return pending;
      for (const id of fresh) {
        if (Date.now() - started > TIME_LIMIT_MS) return (stop('time'), pending);
        if (used() + cost + keep > budget) return (stop('budget'), pending);
        seen.add(id);
        try {
          if (await handle(id)) pending--;
        } catch (e) {
          fail(step, id, e);
          await markFailed(id).catch((e2) => fail(`${step}-mark`, id, e2));
        }
      }
      // The page held the whole queue.
      if (res.ids.length < limit || res.ids.length >= res.total) return pending;
    }
  }

  // 0. Print links past their days, then the galleries of studios cancelled past their grace (one call each).
  report.printLinksExpired = await store.expirePrintLinks(PRINT_LINK_DAYS).catch((e) => (fail('print-links', undefined, e), 0));
  report.lapsed = await store.closeLapsedStudios(LAPSED_STUDIO_GRACE_DAYS).catch((e) => (fail('lapsed-studios', undefined, e), report.lapsed));

  // 1. Face data first (privacy), leaving room for one gallery from the trash.
  report.pendingFaces = await drain(
    'faces',
    FACE_COST,
    RESERVE + 1 + PURGE_COST,
    async (limit) => {
      const { items, total } = await store.faceCleanupCandidates({ maxAgeDays: FACE_MAX_AGE_DAYS, graceDays: CLOSED_STUDIO_GRACE_DAYS, limit });
      return { ids: items.map((c) => c.galleryId), total };
    },
    async (id) => {
      await store.deleteFaces(id, { searchOff: true });
      report.facesRemoved.push(id);
      return true;
    },
    (id) => store.markFaceCleanupFailed(id),
  );

  // 1b. Face files that still hold faces no longer shown (P68), leaving room for one gallery from the trash.
  await drain(
    'faces-rewrite',
    REWRITE_COST,
    RESERVE + 1 + PURGE_COST,
    (limit) => store.faceDirtyCandidates(limit),
    async (id) => {
      const r = await rewriteFaceFiles(store, id, { limit: FACE_REWRITE_FILES });
      report.facesRewritten.push(id);
      return r.more === 0;
    },
    (id) => store.markFaceCleanupFailed(id),
  );

  // 2. The trash, until the queue is empty or the budget ends.
  const before = new Date(now - TRASH_DAYS * DAY).toISOString();
  report.pendingTrash = await drain(
    'trash',
    PURGE_COST,
    RESERVE,
    async (limit) => {
      const res = await store.trashCandidates(before, limit);
      // Kept for their album order: listed apart by the database, never handled here.
      if (res.blocked) {
        report.blocked = res.blocked;
        report.blockedTotal = res.blockedTotal ?? res.blocked.length;
      }
      return res;
    },
    async (id) => {
      const g = await store.getGallery(id);
      // Restored (or removed) meanwhile: nothing to do.
      if (!g?.deletedAt) return true;
      await purgeGallery(store, countedEnv, g);
      report.purged.push(id);
      return true;
    },
    (id) => store.markPurgeFailed(id),
  );

  // 3. Always.
  await store.sweepRateHits().catch((e) => fail('rate-limits', undefined, e));

  report.subrequests = used() + 1;
  // films_cleanup_runs keeps its fields as before (E08 reads it); the P55 numbers are only in the log line.
  const { printLinksExpired: _p, lapsed: _l, ...run } = report;
  await store
    .recordCleanupRun({ ...run, facesRemoved: report.facesRemoved.length, purged: report.purged.length, blocked: report.blockedTotal })
    .catch((e) => fail('record', undefined, e));
  return report;
}

// ---------- the nightly link check (fix plan P65) ----------
// Its own cron (wrangler.jsonc LINK_CHECK_CRON), so it never shares a run, a budget or a failure with the clean-up
// above. Each run checks at most LINK_CHECK_FILMS films of open galleries (films_link_check_candidates, 0153: not in
// the trash, not closed, of studios couples can reach) and goes on next time from where it stopped (KV
// `filmcheck:cursor`); after the last gallery it starts again from the first. A film whose cloud says it is gone is
// marked (worker/linkCheck.ts), shown in the hub's gallery screen, and its studio is told ONCE until a later check
// finds it again (decision D15(4)): a bell always, and an email to the owners through the platform's mail when its
// verified sender is set up. Existing galleries' public Dropbox links are never changed (D15(4)).

/** The cron string of the link check (wrangler.jsonc): 20 past each hour from 22:00 to 03:00 UTC, six runs a night. */
export const LINK_CHECK_CRON = '20 0-3,22-23 * * *';
/** Films one run checks at most (about 72 a night). */
export const LINK_CHECK_FILMS = 12;
/** Galleries one run reads at most (one request). */
const LINK_CHECK_GALLERIES = 10;
const LINK_CURSOR = 'filmcheck:cursor';
/** Worst case per film: its check (pCloud may ask both regions). */
const FILM_CHECK_COST = 2;
/** A studio's Dropbox token, once per run: its films settings, its sealed token, the cached token, a refresh. */
const STUDIO_TOKEN_COST = 4;
/** After a gallery's films: the bell, the mail, the marks written. */
const GALLERY_END_COST = 3;
const LINK_TIME_LIMIT_MS = 45_000;

/** Where the next run starts: after a gallery, or inside one (`start` at film `film`). */
interface LinkCursor {
  after?: string;
  start?: string;
  film?: number;
}

export interface LinkCheckReport {
  checked: number;
  /** Films marked broken this run (gallery id + place), and those found again. */
  broken: { galleryId: string; index: number; reason: string }[];
  fixed: number;
  /** Checks that could not tell (busy, not connected, unreadable): marks stay as they were. */
  unknown: number;
  /** Bells and mails sent this run (one per gallery with films newly broken). */
  alerted: number;
  emailed: number;
  galleries: number;
  /** The run reached the end of the list: the next one starts from the first gallery. */
  wrapped: boolean;
  stopped: 'budget' | 'time' | 'films' | null;
  subrequests: number;
  errors: { step: string; id?: string; error: string }[];
}

/**
 * The mock cloud of tests and local previews (CLOUD_MOCK): never the network. A file whose link or id says "gone" is
 * gone (like the films route's mock clip); everything else is there.
 */
async function mockCloud(input: string, init?: RequestInit): Promise<Response> {
  const gone = /gone/i.test(`${input} ${typeof init?.body === 'string' ? init.body : ''}`);
  if (init?.method === 'PROPFIND') {
    return gone
      ? new Response('', { status: 404 })
      : new Response('<d:multistatus xmlns:d="DAV:"><d:response><d:href>/f/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>', { status: 207 });
  }
  if (/api\.dropboxapi\.com\/2\//.test(input)) return gone ? Response.json({ error_summary: 'path/not_found/' }, { status: 409 }) : Response.json({ '.tag': 'file' });
  if (/pcloud\.com\//.test(input)) return Response.json({ result: gone ? 7002 : 0 });
  if (/googleapis\.com\//.test(input)) return gone ? new Response('', { status: 404 }) : Response.json({ id: 'mock', trashed: false });
  return gone ? new Response('', { status: 404 }) : new Response('x', { status: 206, headers: { 'Content-Type': 'video/mp4' } });
}

/** The words of the studio's bell and mail for films newly found broken in one gallery. */
export function linkAlertText(coupleName: string, films: { title: string; reason: string }[]): { title: string; body: string } {
  const one = films.length === 1;
  const names = films.map((f) => `"${f.title}"`).join(', ');
  const reasons = [...new Set(films.map((f) => f.reason))].join('; ');
  return {
    title: one ? `סרט בגלריה של ${coupleName} כבר לא זמין` : `${films.length} סרטים בגלריה של ${coupleName} כבר לא זמינים`,
    body: `${names}: ${reasons}. הזוג רואה "הסרט כבר לא זמין". כדאי לבדוק את הקישור בעריכת הגלריה, או לטעון את הסרטים מהתיקייה מחדש.`,
  };
}

export async function checkFilmLinks(store: Store, env: Env, now = Date.now()): Promise<LinkCheckReport> {
  const started = Date.now();
  const budget = subrequestBudget(env);
  const base = store.callCount();
  let kvCalls = 0;
  let fetches = 0;
  const kv = new Proxy(env.KV, {
    get(target, prop) {
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? (...args: unknown[]) => (kvCalls++, v.apply(target, args)) : v;
    },
  });
  const countedEnv: Env = { ...env, KV: kv };
  const used = () => store.callCount() - base + kvCalls + fetches;
  const counted = (input: string, init?: RequestInit) => {
    fetches++;
    return env.CLOUD_MOCK ? mockCloud(input, init) : fetch(input, init);
  };
  const report: LinkCheckReport = { checked: 0, broken: [], fixed: 0, unknown: 0, alerted: 0, emailed: 0, galleries: 0, wrapped: false, stopped: null, subrequests: 0, errors: [] };
  const fail = (step: string, id: string | undefined, e: unknown) => report.errors.push({ step, ...(id ? { id } : {}), error: message(e) });

  let cursor: LinkCursor = {};
  try {
    cursor = ((await kv.get<LinkCursor>(LINK_CURSOR, 'json')) as LinkCursor | null) ?? {};
  } catch (e) {
    fail('cursor', undefined, e);
  }
  let page: Awaited<ReturnType<Store['filmCheckCandidates']>>;
  try {
    page = await store.filmCheckCandidates({ after: cursor.start ? undefined : cursor.after, start: cursor.start, limit: LINK_CHECK_GALLERIES });
  } catch (e) {
    fail('candidates', undefined, e);
    report.subrequests = used();
    return report;
  }

  // Each studio's Dropbox token, read once per run (null = not connected); a refresh is counted as one request.
  const tokens = new Map<string, Promise<string | null>>();
  const tokenFor = (tenantId: string) => {
    let t = tokens.get(tenantId);
    if (!t) {
      t = (async () => {
        const s = await getSettings(countedEnv, store, tenantId, null);
        if (!s.dropbox.refreshToken) return null;
        if (env.CLOUD_MOCK) return 'mock-token';
        fetches++;
        return accessToken(s, countedEnv);
      })();
      tokens.set(tenantId, t);
    }
    return t;
  };
  const needsToken = (f: Film) => f.provider === 'dropbox-own' || f.provider === 'dropbox-link';

  const reserve = () => 1; // the cursor write
  let next: LinkCursor | null = null;
  outer: for (const g of page) {
    const from = cursor.start === g.id ? Math.max(0, Math.floor(Number(cursor.film) || 0)) : 0;
    if (report.checked >= LINK_CHECK_FILMS) report.stopped = 'films';
    else if (used() + 1 + FILM_CHECK_COST + GALLERY_END_COST + reserve() > budget) report.stopped = 'budget';
    if (report.stopped) {
      next = { start: g.id, film: from };
      break;
    }
    let marks: FilmMarks;
    try {
      marks = await readMarks(kv, g.id);
    } catch (e) {
      fail('marks', g.id, e);
      marks = {};
    }
    const before = JSON.stringify(marks);
    const keys = await Promise.all(g.films.map((f) => filmKey(f)));
    const fresh: { title: string; reason: string; key: string }[] = [];
    report.galleries++;
    let stopAt = -1;
    for (let i = from; i < g.films.length; i++) {
      const f = g.films[i];
      const extra = needsToken(f) && !tokens.has(g.tenantId) ? STUDIO_TOKEN_COST : 0;
      if (report.checked >= LINK_CHECK_FILMS) report.stopped = 'films';
      else if (Date.now() - started > LINK_TIME_LIMIT_MS) report.stopped = 'time';
      else if (used() + FILM_CHECK_COST + extra + GALLERY_END_COST + reserve() > budget) report.stopped = 'budget';
      if (report.stopped) {
        stopAt = i;
        break;
      }
      const state = await probeFilm(f, {
        fetch: counted,
        dropboxToken: () => tokenFor(g.tenantId),
        googleApiKey: env.GOOGLE_API_KEY ?? '',
        now,
      });
      report.checked++;
      const key = keys[i];
      if (state.state === 'ok') {
        if (marks[key]) {
          delete marks[key];
          report.fixed++;
        }
      } else if (state.state === 'broken') {
        const had = marks[key];
        marks[key] = { at: had?.at ?? new Date(now).toISOString(), reason: state.reason, ...(had?.alerted ? { alerted: true } : {}) };
        report.broken.push({ galleryId: g.id, index: i, reason: state.reason });
        if (!had?.alerted) fresh.push({ title: f.title || f.fileName, reason: state.reason, key });
      } else {
        report.unknown++;
        console.log(`linkcheck: ${g.id} #${i} (${f.provider ?? 'dropbox'}) could not be checked: ${state.reason}`);
      }
    }
    // Marks of films no longer in the gallery go.
    const current = new Set(keys);
    for (const k of Object.keys(marks)) if (!current.has(k)) delete marks[k];

    // Once per film until it is found again: the bell first (it always works), then the owners' mail.
    if (fresh.length) {
      const text = linkAlertText(g.coupleName, fresh);
      let told = false;
      try {
        await store.notifyStudio(g.tenantId, { type: 'films_link_broken', ...text });
        told = true;
        report.alerted++;
        for (const f of fresh) marks[f.key] = { ...marks[f.key], alerted: true };
      } catch (e) {
        fail('bell', g.id, e);
      }
      // The mail only with the bell (a failed bell is tried again next run, the mail with it).
      if (told) {
        const sent = await store.emailStudio(g.tenantId, { kind: 'films_link_broken', galleryId: g.id, coupleName: g.coupleName, films: fresh.map((f) => f.title) });
        if (sent === 'sent') report.emailed++;
        else if (sent === 'failed') fail('mail', g.id, new Error('the mail was not sent'));
      }
    }
    if (JSON.stringify(marks) !== before) {
      try {
        await writeMarks(kv, g.id, marks);
      } catch (e) {
        fail('marks-write', g.id, e);
      }
    }
    if (stopAt >= 0) {
      next = { start: g.id, film: stopAt };
      break outer;
    }
    next = { after: g.id };
  }
  if (!report.stopped && page.length < LINK_CHECK_GALLERIES) {
    // The end of the list: the next run starts from the first gallery.
    report.wrapped = true;
    next = {};
  }
  try {
    await kv.put(LINK_CURSOR, JSON.stringify(next ?? cursor));
  } catch (e) {
    fail('cursor-write', undefined, e);
  }
  report.subrequests = used();
  return report;
}
