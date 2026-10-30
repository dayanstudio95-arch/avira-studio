import { describe, expect, it } from 'vitest';
import { isIsoDate, parseDate, parseEventLine, parseEventList } from '../shared/event';

describe('event lines', () => {
  it('reads the owner\'s list: names, date, venue', () => {
    const rows = parseEventList(`הדר ואלירז 6/8/26 הופה
מאיה וקובי 30/6/26 חוות אלבני
נועה ואיתי 28/6/26 גן הפקאן

נטלי ועידו 14/6/26 בית על הים
מור ורון 4/6/26 משמר הנגב
מור ורון 4/6/26 משמר הנגב`);
    expect(rows).toEqual([
      { coupleName: 'הדר ואלירז', date: '2026-08-06', venue: 'הופה' },
      { coupleName: 'מאיה וקובי', date: '2026-06-30', venue: 'חוות אלבני' },
      { coupleName: 'נועה ואיתי', date: '2026-06-28', venue: 'גן הפקאן' },
      { coupleName: 'נטלי ועידו', date: '2026-06-14', venue: 'בית על הים' },
      { coupleName: 'מור ורון', date: '2026-06-04', venue: 'משמר הנגב' },
    ]);
  });
  it('reads a Dropbox folder name with dashes and dots', () => {
    expect(parseEventLine('רוני ורז - 11.8.26 - אלה')).toEqual({ coupleName: 'רוני ורז', date: '2026-08-11', venue: 'אלה' });
    expect(parseEventLine('Roni & Raz | 11-08-2026 | Ella Hall')).toEqual({ coupleName: 'Roni & Raz', date: '2026-08-11', venue: 'Ella Hall' });
  });
  it('copes with no date, no venue, and bad dates', () => {
    expect(parseEventLine('שירה ועומר')).toEqual({ coupleName: 'שירה ועומר', date: '', venue: '' });
    expect(parseEventLine('שירה ועומר 20.9.26')).toEqual({ coupleName: 'שירה ועומר', date: '2026-09-20', venue: '' });
    expect(parseDate('40/13/26')).toBe('');
    expect(parseDate('nothing')).toBe('');
    expect(parseDate('1.1.2031')).toBe('2031-01-01');
  });
  it('reads year-first dates as they are (P72)', () => {
    expect(parseDate('2026-06-14')).toBe('2026-06-14');
    expect(parseEventLine('רוני ורז 2026-08-11 אלה')).toEqual({ coupleName: 'רוני ורז', date: '2026-08-11', venue: 'אלה' });
  });
  it('turns down days that do not exist and dates inside longer numbers (P72)', () => {
    expect(parseDate('31/2/26')).toBe('');
    expect(parseDate('29.2.2027')).toBe('');
    expect(parseDate('29.2.2028')).toBe('2028-02-29');
    expect(parseDate('2026-02-30')).toBe('');
    expect(parseDate('123/4/56')).toBe('');
    expect(parseDate('14/6/2026123')).toBe('');
    expect(parseEventLine('שירה ועומר 31/2/26 אולם')).toEqual({ coupleName: 'שירה ועומר', date: '', venue: 'אולם' });
  });
  it('a date at the start of the line: the names come after it (P72)', () => {
    expect(parseEventLine('14.6.26 רוני ורז')).toEqual({ coupleName: 'רוני ורז', date: '2026-06-14', venue: '' });
    expect(parseEventLine('2026-06-14 - רוני ורז - אלה')).toEqual({ coupleName: 'רוני ורז', date: '2026-06-14', venue: 'אלה' });
  });
});

describe('P57: a gallery date is a real day or nothing', () => {
  it('31/2, 2026-02-30 and 29/2 of a common year are not days (the album order would get none)', () => {
    expect(parseDate('31/2/26')).toBe('');
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2027-02-29')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(parseEventLine('זוג בדיקה 31/2/26 אולם 01')).toEqual({ coupleName: 'זוג בדיקה', date: '', venue: 'אולם 01' });
  });
});
