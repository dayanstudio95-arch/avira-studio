import { describe, expect, it } from 'vitest';
import { decodeChunk, distance, encodeChunk, expandSearch, findPerson, keysFromHash, keysToHash, MATCH_DISTANCE } from '../shared/faces';

// A person = a direction in 128 numbers; two photos of the same person are close, others far.
function person(seed: number, noise = 0): number[] {
  const v = Array.from({ length: 128 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 0.25);
  return v.map((x, i) => x + (noise ? Math.sin(i * 3.1 + noise) * 0.01 : 0));
}

describe('guest face search', () => {
  it('stores faces compactly and reads them back', () => {
    const bytes = encodeChunk([
      { key: '1a2b3c4d', faces: [{ box: [0.1, 0.2, 0.05, 0.08], vec: person(1) }, { box: [0.5, 0.5, 0.1, 0.1], vec: person(2) }] },
      { key: 'ffeeddcc', faces: [] },
    ]);
    expect(bytes.length).toBe(2 + (5 + 2 * 136) + 5);
    const back = decodeChunk(bytes);
    expect(back.map((p) => [p.key, p.faces.length])).toEqual([
      ['1a2b3c4d', 2],
      ['ffeeddcc', 0],
    ]);
    expect(back[0].faces[0].box[0]).toBeCloseTo(0.1, 3);
    // Compression keeps a face practically where it was.
    expect(findPerson(person(1), back)[0]).toMatchObject({ key: '1a2b3c4d' });
    expect(findPerson(person(1), back)[0].distance).toBeLessThan(0.02);
  });

  it("finds the photos a person is in, and not other people's", () => {
    const photos = decodeChunk(
      encodeChunk([
        { key: '00000001', faces: [{ box: [0, 0, 0.1, 0.1], vec: person(7, 1) }] },
        { key: '00000002', faces: [{ box: [0, 0, 0.1, 0.1], vec: person(8) }, { box: [0.3, 0, 0.1, 0.1], vec: person(7, 2) }] },
        { key: '00000003', faces: [{ box: [0, 0, 0.1, 0.1], vec: person(9) }] },
      ]),
    );
    const hits = findPerson(person(7), photos);
    expect(hits.map((h) => h.key).sort()).toEqual(['00000001', '00000002']);
    expect(hits.every((h) => h.distance < MATCH_DISTANCE)).toBe(true);
  });

  it("a guest's personal link carries only photo keys", () => {
    expect(keysFromHash(`#${keysToHash(['1a2b3c4d', 'ffeeddcc'])}`)).toEqual(['1a2b3c4d', 'ffeeddcc']);
    expect(keysFromHash('#p=zz.1a2b3c4d')).toEqual(['1a2b3c4d']);
    expect(keysFromHash('')).toEqual([]);
  });
});

describe('more photos of me', () => {
  // The selfie, and the same face in the event's light (a drift the selfie doesn't have).
  const selfie = person(3);
  const dir = Array.from({ length: 128 }, (_, i) => Math.cos(i * 1.7 + 0.4));
  const norm = Math.hypot(...dir);
  const drift = (amount: number, wobble = 0) => selfie.map((x, i) => x + (dir[i] / norm) * amount + Math.sin(i * 5.3 + wobble) * 0.004);
  const photos = decodeChunk(
    encodeChunk([
      { key: '0000000a', faces: [{ box: [0, 0, 0.1, 0.1], vec: drift(0.28, 1) }] },
      { key: '0000000b', faces: [{ box: [0, 0, 0.1, 0.1], vec: drift(0.3, 2) }] },
      { key: '0000000c', faces: [{ box: [0, 0, 0.1, 0.1], vec: drift(0.26, 3) }] },
      // From the side, far away: the selfie alone misses it.
      { key: '0000000d', faces: [{ box: [0, 0, 0.1, 0.1], vec: drift(0.56, 4) }] },
      { key: '0000000e', faces: [{ box: [0, 0, 0.1, 0.1], vec: person(40) }] },
    ]),
  );

  it('finds a photo the selfie alone missed, and not other people', () => {
    const hits = findPerson(selfie, photos);
    expect(hits.map((h) => h.key).sort()).toEqual(['0000000a', '0000000b', '0000000c']);
    expect(distance(selfie, photos[3].faces[0].vec)).toBeGreaterThan(MATCH_DISTANCE);
    expect(expandSearch(selfie, photos, hits).map((h) => h.key)).toEqual(['0000000d']);
  });

  it('"not me" leaves a photo out and needs enough sure matches', () => {
    const hits = findPerson(selfie, photos);
    expect(expandSearch(selfie, photos, hits, new Set(['0000000d']))).toEqual([]);
    expect(expandSearch(selfie, photos, hits.slice(0, 1))).toEqual([]);
  });
});
