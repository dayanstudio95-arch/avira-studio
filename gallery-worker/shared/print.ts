// Print-file helpers that don't need a browser (tested directly).

/** "דניאל & סבינה" + 3 → "דניאל & סבינה 3.jpg" (characters a file system can't store are dropped). */
export function spreadFileName(coupleName: string, n: number): string {
  const safe = coupleName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'album';
  return `${safe} ${n}.jpg`;
}

/**
 * Marks a JPEG as `dpi` dots per inch (JFIF density), so print software opens it at the right size:
 * 9449×3543 at 300 DPI = 80×30 cm. Adds a JFIF header when the encoder didn't write one.
 */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0x00;
  if (isJfif) {
    const out = bytes.slice();
    out[13] = 1; // units: dots per inch
    out[14] = (dpi >> 8) & 0xff;
    out[15] = dpi & 0xff;
    out[16] = (dpi >> 8) & 0xff;
    out[17] = dpi & 0xff;
    return out;
  }
  const app0 = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, (dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff, 0x00, 0x00]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** Reads width, height and DPI back from a JPEG (used by tests and the export's self-check). */
export function readJpegInfo(bytes: Uint8Array): { width: number; height: number; dpi: number } {
  let dpi = 0;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe0 && bytes[i + 4] === 0x4a && bytes[i + 11] === 1) dpi = (bytes[i + 12] << 8) | bytes[i + 13];
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height, dpi };
    }
    i += 2 + len;
  }
  return { width: 0, height: 0, dpi };
}

/** "1-5, 8" → [1,2,3,4,5,8] within 1..max; empty text = all. */
export function parsePageRange(text: string, max: number): number[] {
  const t = text.trim();
  if (!t) return Array.from({ length: max }, (_, i) => i + 1);
  const out = new Set<number>();
  for (const part of t.split(/[,\s]+/)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}
