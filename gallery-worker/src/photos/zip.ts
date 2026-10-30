// Many photos in one ZIP file, made in the visitor's own browser (nothing heavy on our server).
// On a computer with Chrome or Edge the ZIP is written straight to a file the visitor picks, so
// even a whole wedding fits. Elsewhere (Safari, phones) it's made in memory in parts of up to
// 500MB, each saved as it's ready ("…-part-1.zip").
import { downloadZip } from 'client-zip';

export interface ZipProgress {
  done: number;
  total: number;
  part: number;
  /** Bytes written so far. */
  bytes: number;
  failed: number;
}

export interface ZipItem {
  key: string;
  name: string;
}

const PART_BYTES = 500 * 1024 * 1024;

type SavePicker = (o: { suggestedName: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ createWritable: () => Promise<WritableStream> }>;

/** Chrome and Edge on a computer can write a big file as it's made. */
export function canStreamToDisk(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

/** Photos downloaded at the same time (P62): one after another left most of the connection idle. */
export const ZIP_PARALLEL = 4;

/**
 * Names inside the ZIP: the photo's own name, made unique ("IMG_1.jpg", "IMG_1 (2).jpg"). A name is
 * taken whatever its case, and every photo's own name is reserved first, so a numbered name never
 * lands on another photo's real name ("a.jpg", "a.jpg", "a (2).jpg" → "a (3).jpg" for the second).
 */
export function zipNames(items: ZipItem[], small: boolean): string[] {
  const own = items.map((it) => {
    const name = (it.name || `${it.key}.jpg`).replace(/[\\/:*?"<>|]+/g, '_');
    return small ? name.replace(/\.[^.]+$/, '') + '-small.jpg' : name;
  });
  const taken = new Set(own.map((n) => n.toLowerCase()));
  const given = new Set<string>();
  return own.map((name) => {
    const lower = name.toLowerCase();
    if (!given.has(lower)) {
      given.add(lower);
      return name;
    }
    let out = name;
    for (let n = 2; taken.has(out.toLowerCase()); n++) out = name.replace(/(\.[^.]+)?$/, (ext) => ` (${n})${ext}`);
    taken.add(out.toLowerCase());
    given.add(out.toLowerCase());
    return out;
  });
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadPhotosZip(opts: {
  items: ZipItem[];
  base: string;
  /** full = the originals; small = the large preview (about 2048px), quick for phones. */
  quality: 'full' | 'small';
  /** File name without ".zip". */
  name: string;
  signal: AbortSignal;
  onProgress: (p: ZipProgress) => void;
  /** Extra query (e.g. a download code) for each photo address. */
  query?: string;
  /** Tests: a smaller part size, and where each finished part goes (default: saved by the browser). */
  partBytes?: number;
  save?: (zip: Blob, name: string) => void;
}): Promise<ZipProgress> {
  const { items, base, quality, signal, onProgress } = opts;
  const names = zipNames(items, quality === 'small');
  const progress: ZipProgress = { done: 0, total: items.length, part: 1, bytes: 0, failed: 0 };
  onProgress({ ...progress });
  const size = quality === 'full' ? 'full' : 'l';
  const save = opts.save ?? saveBlob;

  // Up to ZIP_PARALLEL photos are downloaded ahead, and go into the ZIP in their own order. A photo
  // downloaded ahead when a part is full stays here and opens the next part: never lost (P62).
  const ahead = new Map<number, Promise<Blob | null>>();
  let started = 0;
  let next = 0;
  const fetchOne = async (i: number): Promise<Blob | null> => {
    try {
      const r = await fetch(`${base}/${items[i].key}?s=${size}${opts.query ?? ''}`, { signal, credentials: 'same-origin' });
      if (!r.ok) throw new Error(String(r.status));
      // Only a picture goes into the ZIP: an error page is counted as a photo that failed (P66).
      if (!(r.headers.get('Content-Type') ?? '').toLowerCase().startsWith('image/')) {
        await r.body?.cancel().catch(() => {});
        throw new Error('not a picture');
      }
      return await r.blob();
    } catch {
      return null;
    }
  };
  const fill = () => {
    while (started < items.length && started < next + ZIP_PARALLEL) {
      ahead.set(started, fetchOne(started));
      started++;
    }
  };

  /** The photos in order; stops a part when it reaches the size limit (in-memory parts only). */
  async function* files(limit: number) {
    let partBytes = 0;
    while (next < items.length && partBytes < limit) {
      if (signal.aborted) return;
      fill();
      const i = next;
      const blob = await ahead.get(i)!;
      if (signal.aborted) return;
      ahead.delete(i);
      next++;
      progress.done++;
      if (!blob) {
        progress.failed++;
        onProgress({ ...progress });
        continue;
      }
      partBytes += blob.size;
      progress.bytes += blob.size;
      onProgress({ ...progress });
      yield { name: names[i], input: blob, lastModified: new Date() };
    }
  }

  if (canStreamToDisk()) {
    const picker = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
    let handle: Awaited<ReturnType<SavePicker>> | null = null;
    try {
      handle = await picker({ suggestedName: `${opts.name}.zip`, types: [{ description: 'ZIP', accept: { 'application/zip': ['.zip'] } }] });
    } catch (e) {
      // Closed the window: stop. Not allowed right now (e.g. after typing a code): use parts instead.
      if ((e as Error).name === 'AbortError') throw e;
    }
    if (handle) {
      const out = await handle.createWritable();
      await downloadZip(files(Infinity)).body!.pipeTo(out, { signal }).catch((e) => {
        if (!signal.aborted) throw e;
      });
      return progress;
    }
  }

  const partLimit = opts.partBytes ?? PART_BYTES;
  while (next < items.length && !signal.aborted) {
    const zip = await downloadZip(files(partLimit)).blob();
    if (signal.aborted) break;
    const many = next < items.length || progress.part > 1;
    save(zip, many ? `${opts.name}-part-${progress.part}.zip` : `${opts.name}.zip`);
    if (next < items.length) {
      progress.part++;
      onProgress({ ...progress });
    }
  }
  return progress;
}
