import { describe, expect, it } from 'vitest';
import { laplacianVariance, meanOf, selfieProblem, toGray } from '../src/faces/quality';

const picture = (w: number, h: number, at: (x: number, y: number) => number) => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = at(x, y);
      rgba.set([v, v, v, 255], (y * w + x) * 4);
    }
  return toGray(rgba, w, h);
};

describe('selfie quality', () => {
  it('tells sharp from blurry and dark from bright', () => {
    const sharp = picture(64, 64, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 220 : 40);
    const blurry = picture(64, 64, (x) => 100 + x * 0.5);
    expect(laplacianVariance(sharp, 64, 64)).toBeGreaterThan(1000);
    expect(laplacianVariance(blurry, 64, 64)).toBeLessThan(1);
    expect(meanOf(picture(8, 8, () => 30))).toBeCloseTo(30, 0);
  });

  it('says what to fix, in plain words', () => {
    const good = { faceRatio: 0.35, score: 0.95, brightness: 130, sharpness: 80 };
    expect(selfieProblem(good)).toBe('');
    expect(selfieProblem({ ...good, faceRatio: 0.05 })).toMatch(/מקרוב/);
    expect(selfieProblem({ ...good, brightness: 30 })).toMatch(/חשוכה/);
    expect(selfieProblem({ ...good, brightness: 240 })).toMatch(/יותר מדי אור/);
    expect(selfieProblem({ ...good, sharpness: 3 })).toMatch(/מטושטשת/);
    expect(selfieProblem({ ...good, score: 0.5 })).toMatch(/משקפי שמש/);
  });
});
