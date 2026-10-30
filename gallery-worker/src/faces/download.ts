// A search's face data, as the guest's phone (or the studio's "הסר אדם זה") gets it (fix plan P68): the search
// starts on the server (consent, rate limit, a line in the log, a short token), then the chunks come 8 at a time
// with that token. Their addresses carry the face data's version, so the phone keeps them, and what was decoded is
// kept on the page: a second selfie downloads nothing again.
import { decodeChunk, type StoredPhoto } from '../../shared/faces';
import { api } from '../lib/api';

export interface SearchStart {
  ready: boolean;
  partial: boolean;
  chunks?: number;
  version?: number;
  token?: string;
}

/** Chunks downloaded at once. */
export const PARALLEL_CHUNKS = 8;

const kept = new Map<string, StoredPhoto[]>();

export function startSearch(galleryId: string, consent?: string): Promise<SearchStart> {
  return api<SearchStart>('POST', `/api/watch/${galleryId}/faces/search`, consent ? { consent } : {});
}

/** Every chunk of this search (kept on the page per gallery and version). */
export async function searchPhotos(galleryId: string, s: SearchStart, onProgress?: (done: number, total: number) => void): Promise<StoredPhoto[]> {
  const total = s.chunks ?? 0;
  const id = `${galleryId}:${s.version ?? 0}`;
  const have = kept.get(id);
  if (have) return have;
  const parts: StoredPhoto[][] = new Array(total);
  let next = 0;
  let done = 0;
  const lane = async () => {
    while (next < total) {
      const n = next++;
      const r = await fetch(`/api/watch/${galleryId}/faces/${n}?v=${s.version ?? 0}`, { headers: { 'X-Face-Token': s.token ?? '' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status === 409 ? 'נתוני החיפוש התעדכנו בדיוק עכשיו. נסו שוב.' : 'הורדת הנתונים נכשלה');
      parts[n] = decodeChunk(new Uint8Array(await r.arrayBuffer()));
      onProgress?.(++done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, total) }, lane));
  const photos = parts.flat();
  kept.clear();
  kept.set(id, photos);
  return photos;
}
