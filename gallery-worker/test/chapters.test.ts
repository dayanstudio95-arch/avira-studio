import { describe, expect, it } from 'vitest';
import { chapterAt, chaptersText, cleanChapters, formatTime, parseChapters, parseTime, worthResuming } from '../shared/chapters';

describe('film chapters', () => {
  it('reads times', () => {
    expect(parseTime('12:30')).toBe(750);
    expect(parseTime('1:02:03')).toBe(3723);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('12:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(formatTime(3723)).toBe('1:02:03');
    expect(formatTime(750)).toBe('12:30');
    expect(formatTime(5)).toBe('0:05');
  });

  it('reads the studio lines in any common shape, sorted, skipping bad ones', () => {
    const c = parseChapters('34:10 נאומים\nחופה 12:30\n0:00 - התארגנות\nשורה בלי זמן\n\n51:00 — ריקודים');
    expect(c).toEqual([
      { t: 0, title: 'התארגנות' },
      { t: 750, title: 'חופה' },
      { t: 2050, title: 'נאומים' },
      { t: 3060, title: 'ריקודים' },
    ]);
    expect(parseChapters(chaptersText(c))).toEqual(c);
  });

  it('cleans what the browser sent', () => {
    expect(cleanChapters([{ t: 5, title: 'א' }, { t: 5, title: 'כפול' }, { t: -1, title: 'x' }, { t: 3, title: '' }, 'junk'])).toEqual([{ t: 5, title: 'א' }]);
    expect(cleanChapters('nope')).toEqual([]);
    expect(cleanChapters(Array.from({ length: 60 }, (_, i) => ({ t: i, title: `${i}` })))).toHaveLength(40);
  });

  it('knows the current chapter and when resuming makes sense', () => {
    const c = [
      { t: 0, title: 'a' },
      { t: 100, title: 'b' },
    ];
    expect(chapterAt(c, 50)).toBe(0);
    expect(chapterAt(c, 100)).toBe(1);
    expect(chapterAt([{ t: 10, title: 'x' }], 5)).toBe(-1);
    expect(worthResuming(20, 600)).toBe(false);
    expect(worthResuming(300, 600)).toBe(true);
    expect(worthResuming(590, 600)).toBe(false);
  });
});
