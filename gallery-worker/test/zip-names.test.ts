// Names inside the couple's ZIP (P72): two photos never get the same name, whatever the case.
import { describe, expect, it } from 'vitest';
import { zipNames } from '../src/photos/zip';

const items = (...names: string[]) => names.map((name, i) => ({ key: `k${i}`, name }));
const unique = (names: string[]) => new Set(names.map((n) => n.toLowerCase())).size === names.length;

describe('ZIP entry names', () => {
  it('a numbered name never lands on another photo\'s own name', () => {
    const out = zipNames(items('a.jpg', 'a.jpg', 'a (2).jpg'), false);
    expect(out).toEqual(['a.jpg', 'a (3).jpg', 'a (2).jpg']);
    expect(unique(out)).toBe(true);
  });
  it('the same name in another case is the same name', () => {
    const out = zipNames(items('IMG_1.JPG', 'img_1.jpg', 'IMG_1 (2).jpg', 'img_1.JPG'), false);
    expect(unique(out)).toBe(true);
    expect(out[0]).toBe('IMG_1.JPG');
    expect(out[2]).toBe('IMG_1 (2).jpg');
  });
  it('small copies: a RAW and a JPEG of the same photo get two names', () => {
    expect(zipNames(items('a.CR3', 'a.jpg'), true)).toEqual(['a-small.jpg', 'a-small (2).jpg']);
    expect(unique(zipNames(items('b.jpg', 'b.jpeg', 'b.png', 'B.JPG'), true))).toBe(true);
  });
});
