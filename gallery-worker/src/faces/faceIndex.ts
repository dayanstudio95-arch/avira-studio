// The studio's browser finds the faces in a gallery once (resumable) and uploads only the
// descriptors. Ported from the Avira films app's admin (2026-09-27): here it runs on the films
// site, opened from the hub as the studio (its preview-token cookie), so the photos and the face
// models are same-origin. The large preview (?s=l) is plenty for faces.
// Fix plan P68: a photo whose preview did not download (after one more try; longer after a 429) or whose
// search failed is NOT recorded as scanned — it is counted in `failed` and the next run tries it again; ten
// failures in a row stop the scan (the cloud or the browser is in trouble); a batch leaves the queue only after
// the server accepted it.
import { encodeChunk, type IndexedPhoto } from '../../shared/faces';
import { getFaceEngine, toCanvas } from './engine';

export interface FaceProgress {
  done: number;
  total: number;
  faces: number;
  /** Photos that could not be scanned this run (not recorded: the next run tries them again). */
  failed: number;
  /** Seconds left (0 until known). */
  eta: number;
  status: string;
}

export interface FaceSink {
  /** Finds the faces in one photo (one at a time; the caller waits its turn). A null blob = it did not download. */
  add(key: string, blob: Blob | null): Promise<void>;
  /** Uploads what's left and returns the totals. */
  finish(): Promise<FaceProgress>;
}

/** Failures in a row that stop the scan. */
export const MAX_FAILURES_IN_A_ROW = 10;
/** How long to wait before the one retry of a photo (after a 429: the cloud asked us to slow down). */
export const RETRY_WAIT_MS = 1_000;
export const RETRY_WAIT_429_MS = 8_000;

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

/** Takes photos as they come (from any loop) and uploads their face numbers every 120 photos. */
export async function faceSink(opts: { galleryId: string; total: number; alreadyDone: number; onProgress: (p: FaceProgress) => void; left: number }): Promise<FaceSink> {
  const { galleryId, onProgress } = opts;
  const progress: FaceProgress = { done: opts.alreadyDone, total: opts.total, faces: 0, failed: 0, eta: 0, status: '' };
  onProgress({ ...progress, status: 'טוען את מנוע זיהוי הפנים…' });
  const engine = await getFaceEngine();
  let batch: IndexedPhoto[] = [];
  let chain: Promise<void> = Promise.resolve();
  const began = Date.now();
  let madeNow = 0;
  let inARow = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const sending = batch;
    const body = encodeChunk(sending);
    const r = await fetch(`/api/watch/${galleryId}/faces`, { method: 'POST', body: body as Uint8Array<ArrayBuffer>, credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' } });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'שמירת נתוני הפנים נכשלה');
    // Out of the queue only now: a failed upload keeps them for the next try (or the next run).
    batch = batch.slice(sending.length);
  };

  const failed = () => {
    progress.failed++;
    madeNow++;
    if (++inARow >= MAX_FAILURES_IN_A_ROW) throw new Error(`הסריקה נעצרה: ${MAX_FAILURES_IN_A_ROW} תמונות ברצף לא נטענו. בדקו את החיבור ואת התיקייה, והריצו שוב.`);
    onProgress({ ...progress, status: '' });
  };

  const work = async (key: string, blob: Blob | null) => {
    if (!blob) return failed();
    let faces: IndexedPhoto['faces'];
    try {
      faces = await engine.detectAll(await toCanvas(blob, 1280));
    } catch {
      // Not "no faces": the photo was not searched.
      return failed();
    }
    inARow = 0;
    batch.push({ key, faces });
    progress.done++;
    progress.faces += faces.length;
    madeNow++;
    progress.eta = Math.round((((Date.now() - began) / madeNow) * Math.max(0, opts.left - madeNow)) / 1000);
    onProgress({ ...progress, status: '' });
    if (batch.length >= 120) await flush();
  };

  let broken: Error | null = null;
  return {
    add(key, blob) {
      const run = chain.then(() => {
        if (broken) throw broken;
        return work(key, blob);
      });
      chain = run.catch((e) => {
        broken ??= e as Error;
      });
      return run;
    },
    async finish() {
      await chain;
      // Whatever was found is kept, also when stopped half way.
      await flush();
      return progress;
    },
  };
}

/** One photo's large preview; one more try after a failure (a longer wait after 429). null = not downloaded. */
export async function loadPreview(url: string, signal: AbortSignal): Promise<Blob | null> {
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
    let status = 0;
    try {
      const r = await fetch(url, { credentials: 'same-origin', signal });
      if (r.ok) return await r.blob();
      status = r.status;
    } catch {
      status = 0;
    }
    if (attempt === 0) await wait(status === 429 ? RETRY_WAIT_429_MS : RETRY_WAIT_MS, signal);
  }
  return null;
}

export async function indexFaces(opts: {
  galleryId: string;
  /** Where the gallery's photos are (`/api/photos/<id>/v<gen>`, from the scan page's answer, P66). */
  base: string;
  keys: string[];
  alreadyDone: Set<string>;
  onProgress: (p: FaceProgress) => void;
  signal: AbortSignal;
}): Promise<FaceProgress> {
  const { galleryId, signal } = opts;
  const todo = opts.keys.filter((k) => !opts.alreadyDone.has(k));
  const sink = await faceSink({ galleryId, total: opts.keys.length, alreadyDone: opts.keys.length - todo.length, onProgress: opts.onProgress, left: todo.length });
  const load = (key: string) => loadPreview(`${opts.base}/${key}?s=l`, signal);

  // Download the next photo while the current one is being searched.
  let next = todo.length ? load(todo[0]) : null;
  let stopped: Error | null = null;
  try {
    for (let i = 0; i < todo.length && !signal.aborted; i++) {
      const blob = await next;
      // Stopped while it downloaded: that photo was not searched, so it is not recorded.
      if (signal.aborted) break;
      next = i + 1 < todo.length ? load(todo[i + 1]) : null;
      await sink.add(todo[i], blob);
    }
  } catch (e) {
    stopped = e as Error;
  }
  // What was found is kept, also after a stop.
  const done = await sink.finish();
  if (stopped) throw stopped;
  return done;
}
