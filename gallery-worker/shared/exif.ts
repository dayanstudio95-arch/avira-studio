// When a photo was taken, read from the start of a JPEG, TIFF or HEIC file (EXIF DateTimeOriginal +
// SubSecTimeOriginal). The first 64KB of the file is enough, so the full 10MB original never has to be
// downloaded.

/** A TIFF header ("II*\0" little endian, "MM\0*" big endian) at `o`. */
const tiffAt = (b: Uint8Array, o: number) => o + 3 < b.length && ((b[o] === 0x49 && b[o + 1] === 0x49 && b[o + 2] === 0x2a && b[o + 3] === 0) || (b[o] === 0x4d && b[o + 1] === 0x4d && b[o + 2] === 0 && b[o + 3] === 0x2a));

/** An ISO media file (HEIC, HEIF, AVIF): "ftyp" right after the first box's size. */
const isoMedia = (b: Uint8Array) => b.length > 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;

/**
 * What kind of picture the first bytes are, or '' when they are not one (an HTML page, an error in
 * JSON, an empty answer): the capture-time reader checks what the cloud sent (fix plan P64).
 */
export function pictureKind(b: Uint8Array): '' | 'jpeg' | 'png' | 'tiff' | 'heif' | 'webp' | 'gif' {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (tiffAt(b, 0)) return 'tiff';
  if (isoMedia(b)) return 'heif';
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  if (b.length >= 6 && String.fromCharCode(...b.subarray(0, 4)) === 'GIF8') return 'gif';
  return '';
}

/** Milliseconds (the camera's clock, read as UTC so every photographer compares the same way), or null. */
export function exifTakenAt(bytes: Uint8Array): number | null {
  // A TIFF file is itself the EXIF block (P64).
  if (tiffAt(bytes, 0)) return fromTiff(bytes);
  // HEIC: the EXIF item is "Exif\0\0" + a TIFF block, stored near the start of the file (P64).
  if (isoMedia(bytes)) return fromIsoMedia(bytes);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66) {
      return fromTiff(bytes.subarray(i + 10, Math.min(bytes.length, i + 2 + len)));
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return null;
}

/** The first "Exif\0\0" followed by a TIFF header in an ISO media file, read as EXIF. */
function fromIsoMedia(b: Uint8Array): number | null {
  for (let i = 12; i + 10 < b.length; i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66 && b[i + 4] === 0 && b[i + 5] === 0 && tiffAt(b, i + 6)) {
      const t = fromTiff(b.subarray(i + 6));
      if (t !== null) return t;
    }
  }
  return null;
}

function fromTiff(t: Uint8Array): number | null {
  if (t.length < 8) return null;
  const le = t[0] === 0x49; // "II" little endian, "MM" big endian
  const u16 = (o: number) => (o + 1 < t.length ? (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]) : 0);
  const u32 = (o: number) => (o + 3 < t.length ? (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16) | (t[o + 3] << 24)) >>> 0 : ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0) : 0);
  const ascii = (off: number, count: number) => {
    let s = '';
    for (let k = 0; k < count && off + k < t.length && t[off + k] !== 0; k++) s += String.fromCharCode(t[off + k]);
    return s;
  };
  const readIfd = (off: number) => {
    const tags = new Map<number, { type: number; count: number; value: number; at: number }>();
    const n = u16(off);
    for (let k = 0; k < n && k < 400; k++) {
      const e = off + 2 + k * 12;
      if (e + 12 > t.length) break;
      tags.set(u16(e), { type: u16(e + 2), count: u32(e + 4), value: u32(e + 8), at: e + 8 });
    }
    return tags;
  };
  const text = (tag?: { count: number; value: number; at: number }) => (tag ? (tag.count <= 4 ? ascii(tag.at, tag.count) : ascii(tag.value, tag.count)) : '');
  const ifd0 = readIfd(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const sub = exifPtr ? readIfd(exifPtr.value) : new Map();
  const when = text(sub.get(0x9003)) || text(sub.get(0x9004)) || text(ifd0.get(0x0132));
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(when);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const frac = text(sub.get(0x9291)).replace(/\D/g, '');
  return Number.isFinite(ms) ? ms + (frac ? Math.round(Number(`0.${frac}`) * 1000) : 0) : null;
}

/**
 * The Lightroom colour label, when the export kept it (XMP "xmp:Label"). Lightroom writes the
 * label's name, which is "Red", "Yellow", "Green", "Blue", "Purple" (or the Hebrew names).
 */
export function xmpLabel(bytes: Uint8Array): string {
  // XMP is plain text inside the header; read it as Latin-1/UTF-8 and look for the label.
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const m = /xmp:Label\s*=\s*"([^"]{1,30})"/.exec(text) ?? /<xmp:Label>([^<]{1,30})<\/xmp:Label>/.exec(text);
  return m ? m[1].trim() : '';
}

/** English and Hebrew label names → one key. */
export function normalizeLabel(label: string): string {
  const l = label.trim().toLowerCase();
  const map: Record<string, string> = { red: 'red', 'אדום': 'red', yellow: 'yellow', 'צהוב': 'yellow', green: 'green', 'ירוק': 'green', blue: 'blue', 'כחול': 'blue', purple: 'purple', 'סגול': 'purple' };
  return map[l] ?? '';
}

/**
 * The owner's colours (Avira, 2026-10-31): red = getting ready, yellow = outdoor, green = families, blue = the
 * ceremony, purple = party — and a photo with no colour at all ("none") is the hall, which has no colour left.
 */
export const DEFAULT_LABEL_MAP: Record<string, string> = { red: 'התארגנות', yellow: 'צילומי חוץ', green: 'משפחות', blue: 'טקס חופה', purple: 'מסיבה', none: 'אולם' };
