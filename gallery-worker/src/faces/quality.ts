// Is this selfie good enough to search with? A dark, blurry or far-away face gives numbers that
// match badly, and the guest would see "we didn't find you". Better to say so before searching.

export interface SelfieCheck {
  /** Face width / photo width (0–1). */
  faceRatio: number;
  /** How sure the detector is that it's a face (0–1). */
  score: number;
  /** Average brightness of the face (0–255). */
  brightness: number;
  /** Sharpness of the face (variance of the Laplacian; higher = sharper). */
  sharpness: number;
}

/** Grey values of an RGBA picture. */
export function toGray(rgba: ArrayLike<number>, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return g;
}

export function meanOf(gray: Float32Array): number {
  let s = 0;
  for (const v of gray) s += v;
  return gray.length ? s / gray.length : 0;
}

/** How sharp a picture is: edges make a strong Laplacian; blur flattens it. */
export function laplacianVariance(gray: Float32Array, w: number, h: number): number {
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sq += lap * lap;
      n++;
    }
  }
  if (!n) return 0;
  const mean = sum / n;
  return sq / n - mean * mean;
}

/** What's wrong with a selfie, in words a guest understands ('' = fine). */
export function selfieProblem(c: SelfieCheck): string {
  if (c.faceRatio < 0.12) return 'הפנים קטנות מדי בתמונה. צלמו מקרוב יותר, שהפנים ימלאו את רוב התמונה.';
  if (c.brightness < 55) return 'התמונה חשוכה מדי. נסו ליד חלון או באור חזק יותר.';
  if (c.brightness > 225) return 'יש יותר מדי אור על הפנים. התרחקו מהשמש או מהפלאש.';
  if (c.sharpness < 12) return 'התמונה מטושטשת. החזיקו את הטלפון יציב ונסו שוב.';
  if (c.score < 0.7) return 'קשה לראות את הפנים. הסירו משקפי שמש או כובע ונסו שוב.';
  return '';
}

/** Measures the face area of a canvas (downscaled, so it's quick on any phone). */
export function measureFace(canvas: HTMLCanvasElement, box: { x: number; y: number; width: number; height: number }, score: number): SelfieCheck {
  const side = 128;
  const c = document.createElement('canvas');
  c.width = side;
  c.height = side;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, Math.max(0, box.x), Math.max(0, box.y), Math.max(1, box.width), Math.max(1, box.height), 0, 0, side, side);
  const gray = toGray(ctx.getImageData(0, 0, side, side).data, side, side);
  return { faceRatio: box.width / canvas.width, score, brightness: meanOf(gray), sharpness: laplacianVariance(gray, side, side) };
}
