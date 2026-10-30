// Guest face search. The studio's browser finds the faces in a gallery once and stores, for each
// face, a 128-number "descriptor" (not a picture). A guest's selfie becomes a descriptor in the
// guest's own phone, which then finds the photos with a close face. Photos and selfies never go
// to any outside service.
//
// Storage format (one "chunk" = up to a few hundred photos), all little-endian:
//   u16 photoCount, then per photo: 4 bytes key (8 hex chars), u8 faceCount,
//   then per face: 4 × u16 box (x, y, w, h as fractions × 65535) and 128 × i8 descriptor.

export const DESCRIPTOR = 128;
/** The consent the guest page shows (its wording's version, recorded with each search in films_face_searches, P68). */
export const FACE_CONSENT = 'v2';
/** Face-api descriptors sit roughly within ±0.3; ×400 keeps them inside a signed byte. */
const SCALE = 400;
/** Distance under which two faces are the same person (face-api's usual 0.6 is too loose for crowds). */
export const MATCH_DISTANCE = 0.5;

export interface IndexedFace {
  /** x, y, w, h as fractions of the photo. */
  box: [number, number, number, number];
  vec: ArrayLike<number>;
}
export interface IndexedPhoto {
  key: string;
  faces: IndexedFace[];
}
export interface StoredPhoto {
  key: string;
  faces: { box: [number, number, number, number]; vec: Int8Array }[];
}

const FACE_BYTES = 8 + DESCRIPTOR;

export function encodeChunk(photos: IndexedPhoto[]): Uint8Array {
  const size = 2 + photos.reduce((n, p) => n + 5 + Math.min(255, p.faces.length) * FACE_BYTES, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint16(0, photos.length, true);
  let o = 2;
  for (const p of photos) {
    for (let i = 0; i < 4; i++) out[o + i] = parseInt(p.key.slice(i * 2, i * 2 + 2), 16) || 0;
    o += 4;
    const faces = p.faces.slice(0, 255);
    out[o++] = faces.length;
    for (const f of faces) {
      for (let i = 0; i < 4; i++) view.setUint16(o + i * 2, Math.round(Math.max(0, Math.min(1, f.box[i])) * 65535), true);
      o += 8;
      for (let i = 0; i < DESCRIPTOR; i++) view.setInt8(o + i, Math.max(-127, Math.min(127, Math.round((f.vec[i] ?? 0) * SCALE))));
      o += DESCRIPTOR;
    }
  }
  return out;
}

export function decodeChunk(bytes: Uint8Array): StoredPhoto[] {
  if (bytes.length < 2) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(0, true);
  const out: StoredPhoto[] = [];
  let o = 2;
  for (let p = 0; p < count && o + 5 <= bytes.length; p++) {
    let key = '';
    for (let i = 0; i < 4; i++) key += bytes[o + i].toString(16).padStart(2, '0');
    o += 4;
    const n = bytes[o++];
    const faces: StoredPhoto['faces'] = [];
    for (let f = 0; f < n && o + FACE_BYTES <= bytes.length; f++) {
      const box = [0, 1, 2, 3].map((i) => view.getUint16(o + i * 2, true) / 65535) as [number, number, number, number];
      o += 8;
      faces.push({ box, vec: new Int8Array(bytes.buffer, bytes.byteOffset + o, DESCRIPTOR) });
      o += DESCRIPTOR;
    }
    out.push({ key, faces });
  }
  return out;
}

export interface FilteredChunk {
  bytes: Uint8Array;
  /** The photos kept, in order. */
  keys: string[];
  faces: number;
  /** Faces left out (of dropped photos, and `dropFace`). */
  dropped: number;
}

/**
 * The same chunk with only the photos `keep` says (and without the faces `dropFace` says), copied byte for byte
 * (no re-rounding). Used for what a guest downloads (only photos still shown, P68), the studio's uploads (photos
 * not scanned yet) and rewriting a file (photos hidden since, a person removed).
 */
export function filterChunk(bytes: Uint8Array, keep: (key: string) => boolean, dropFace?: (key: string, face: number) => boolean): FilteredChunk {
  const parts: Uint8Array[] = [];
  const keys: string[] = [];
  let faces = 0;
  let dropped = 0;
  let size = 2;
  if (bytes.length >= 2) {
    const count = bytes[0] | (bytes[1] << 8);
    let o = 2;
    for (let p = 0; p < count && o + 5 <= bytes.length; p++) {
      let key = '';
      for (let i = 0; i < 4; i++) key += bytes[o + i].toString(16).padStart(2, '0');
      const n = bytes[o + 4];
      const start = o + 5;
      const whole = Math.min(n, Math.floor((bytes.length - start) / FACE_BYTES));
      o = start + whole * FACE_BYTES;
      if (!keep(key)) {
        dropped += whole;
        continue;
      }
      const kept: Uint8Array[] = [];
      for (let f = 0; f < whole; f++) {
        if (dropFace?.(key, f)) dropped++;
        else kept.push(bytes.subarray(start + f * FACE_BYTES, start + (f + 1) * FACE_BYTES));
      }
      const head = new Uint8Array(5);
      head.set(bytes.subarray(start - 5, start - 1));
      head[4] = kept.length;
      parts.push(head, ...kept);
      size += 5 + kept.length * FACE_BYTES;
      keys.push(key);
      faces += kept.length;
    }
  }
  const out = new Uint8Array(size);
  out[0] = keys.length & 0xff;
  out[1] = keys.length >> 8;
  let o = 2;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return { bytes: out, keys, faces, dropped };
}

/** Euclidean distance between a selfie descriptor and a stored (compressed) face. */
export function distance(selfie: ArrayLike<number>, stored: Int8Array): number {
  let sum = 0;
  for (let i = 0; i < DESCRIPTOR; i++) {
    const d = selfie[i] - stored[i] / SCALE;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface Hit {
  key: string;
  distance: number;
  /** Which face in the photo matched. */
  face: number;
}

/** The photos a person appears in, closest first. */
export function findPerson(selfie: ArrayLike<number>, photos: StoredPhoto[], maxDistance = MATCH_DISTANCE): Hit[] {
  const hits: Hit[] = [];
  for (const p of photos) {
    let best = Infinity;
    let face = -1;
    p.faces.forEach((f, i) => {
      const d = distance(selfie, f.vec);
      if (d < best) {
        best = d;
        face = i;
      }
    });
    if (best < maxDistance) hits.push({ key: p.key, distance: best, face });
  }
  return hits.sort((a, b) => a.distance - b.distance);
}

/** Matches this close are surely the same person: their faces help find more photos. */
export const SURE_DISTANCE = 0.42;

/**
 * "More photos of me": the selfie is one angle in one light. The faces found with high certainty
 * show the same person from other angles and in the event's light; their average (with the
 * selfie) finds photos the selfie alone missed (from the side, farther away). Photos the guest
 * said are not them are left out, and their faces don't count.
 */
export function expandSearch(selfie: ArrayLike<number>, photos: StoredPhoto[], hits: Hit[], notMe: Set<string> = new Set(), maxDistance = MATCH_DISTANCE): Hit[] {
  const byKey = new Map(photos.map((p) => [p.key, p]));
  const sure = hits.filter((h) => h.distance < SURE_DISTANCE && !notMe.has(h.key)).slice(0, 25);
  if (sure.length < 2) return [];
  const mean = new Float32Array(DESCRIPTOR);
  for (let i = 0; i < DESCRIPTOR; i++) mean[i] = selfie[i];
  for (const h of sure) {
    const vec = byKey.get(h.key)?.faces[h.face]?.vec;
    if (!vec) continue;
    for (let i = 0; i < DESCRIPTOR; i++) mean[i] += vec[i] / SCALE;
  }
  const n = sure.length + 1;
  for (let i = 0; i < DESCRIPTOR; i++) mean[i] /= n;
  const found = new Set(hits.map((h) => h.key));
  return findPerson(mean, photos, maxDistance)
    .filter((h) => !found.has(h.key) && !notMe.has(h.key))
    // Still reasonably close to the selfie itself: the average must not drift to someone else.
    .filter((h) => distance(selfie, byKey.get(h.key)!.faces[h.face].vec) < maxDistance + 0.12);
}

/** Keys of photos a guest found, carried in their personal link ("#p=1a2b3c4d.5e6f…"), so no selfie is needed again. */
export function keysToHash(keys: string[]): string {
  return `p=${keys.join('.')}`;
}
export function keysFromHash(hash: string): string[] {
  const m = /(?:^|[#&])p=([0-9a-z.]+)/i.exec(hash);
  return m ? m[1].split('.').filter((k) => /^[0-9a-f]{8}$/.test(k)) : [];
}
