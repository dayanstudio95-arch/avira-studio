import { describe, expect, it } from 'vitest';
import { cleanDesign, columnsLayout, DEFAULT_DESIGN, effectiveDesign, gridMetrics } from '../shared/design';

describe('gallery design', () => {
  it('keeps valid choices and drops the rest', () => {
    expect(cleanDesign({ cover: 'frame', font: 'bold', color: 'dark', grid: 'columns', thumb: 'large', spacing: 'large', nav: 'icons' })).toEqual({ cover: 'frame', font: 'bold', color: 'dark', grid: 'columns', thumb: 'large', spacing: 'large', nav: 'icons' });
    expect(cleanDesign({ cover: 'nope', color: 42 })).toEqual(DEFAULT_DESIGN);
    expect(cleanDesign('junk')).toEqual(DEFAULT_DESIGN);
  });

  it('a gallery overrides the studio default, which overrides the built-in look', () => {
    expect(effectiveDesign({ color: 'rose' }, { color: 'gold', font: 'serif' })).toMatchObject({ color: 'rose', font: 'serif', cover: 'center' });
    expect(effectiveDesign(undefined, undefined)).toEqual(DEFAULT_DESIGN);
  });

  it('lays photos in columns from the right, each to the shortest column', () => {
    const boxes = columnsLayout([1, 1, 0.5, 1], 310, 3, 5);
    expect(boxes[0]).toMatchObject({ x: 210, y: 0, w: 100, h: 100 });
    expect(boxes[1].x).toBe(105);
    expect(boxes[2].x).toBe(0);
    expect(boxes[2].h).toBe(200);
    expect(boxes[3]).toMatchObject({ x: 210, y: 105 }); // under the first, the shortest again
  });

  it('bigger photos and spacing when asked', () => {
    expect(gridMetrics({ grid: 'rows', thumb: 'regular', spacing: 'regular' }, 1400)).toEqual({ target: 300, columns: 4, gap: 8 });
    expect(gridMetrics({ grid: 'columns', thumb: 'large', spacing: 'large' }, 390)).toEqual({ target: 260, columns: 1, gap: 10 });
  });
});
