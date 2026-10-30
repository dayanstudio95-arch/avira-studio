import { describe, expect, it } from 'vitest';
import { parsePageRange, readJpegInfo, setJpegDpi, spreadFileName } from '../shared/print';

// Smallest valid JFIF JPEG header + SOF0 for a 9449×3543 image (enough for the header logic).
const jfif = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0d, 0xd7, 0x24, 0xe9, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);
const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0d, 0xd7, 0x24, 0xe9, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9]);

describe('print files', () => {
  it('names spreads like the studio sends them to the printer', () => {
    expect(spreadFileName('דניאל & סבינה', 1)).toBe('דניאל & סבינה 1.jpg');
    expect(spreadFileName('a/b:c', 12)).toBe('a b c 12.jpg');
  });
  it('marks a JPEG as 300 DPI, with or without a JFIF header', () => {
    expect(readJpegInfo(jfif)).toEqual({ width: 9449, height: 3543, dpi: 0 });
    expect(readJpegInfo(setJpegDpi(jfif, 300))).toEqual({ width: 9449, height: 3543, dpi: 300 });
    const fixed = setJpegDpi(bare, 300);
    expect(fixed.length).toBe(bare.length + 18);
    expect(readJpegInfo(fixed)).toEqual({ width: 9449, height: 3543, dpi: 300 });
  });
  it('reads page ranges', () => {
    expect(parsePageRange('', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('1-3, 8, 40', 31)).toEqual([1, 2, 3, 8]);
    expect(parsePageRange('5-2', 31)).toEqual([2, 3, 4, 5]);
  });
});
