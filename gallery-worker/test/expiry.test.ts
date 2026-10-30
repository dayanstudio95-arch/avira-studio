// When a gallery closes (P72, D15): at the end of its last day, 23:59 Israel time; "today" and
// "tomorrow" are calendar days in Israel (the last day never says "tomorrow").
import { describe, expect, it } from 'vitest';
import { closeAfterDays, closeOfDay, endOfIsraelDay, israelDay, israelDaysBetween } from '../shared/day';
import { availabilityText, closingLabel } from '../src/lib/expiry';
import { createGallery, daysLeft, extendGallery, updateGallery } from '../worker/galleries';
import { MemoryStore } from '../worker/store-memory';
import type { Env, Settings } from '../worker/types';

const HOUR = 3_600_000;

describe('Israel days', () => {
  it('23:59:59 on the day, in summer (+3) and in winter (+2)', () => {
    expect(new Date(endOfIsraelDay('2026-07-15')).toISOString()).toBe('2026-07-15T20:59:59.000Z');
    expect(new Date(endOfIsraelDay('2026-12-15')).toISOString()).toBe('2026-12-15T21:59:59.000Z');
    // 23:30 UTC on 1.12 is already 2.12 in Israel.
    expect(israelDay(Date.parse('2026-12-01T23:30:00Z'))).toBe('2026-12-02');
    expect(new Date(closeOfDay(Date.parse('2026-12-01T23:30:00Z'))).toISOString()).toBe('2026-12-02T21:59:59.000Z');
    expect(israelDaysBetween(Date.parse('2026-07-15T06:00:00Z'), Date.parse('2026-07-16T01:00:00Z'))).toBe(1);
  });
});

describe('closing words', () => {
  const close = '2026-07-15T20:59:59.000Z'; // 15.7, 23:59 in Israel
  it('on the last day: today, never tomorrow', () => {
    expect(closingLabel(close, Date.parse('2026-07-15T05:00:00Z'))).toBe('היום ב-23:59');
    expect(availabilityText(close, false, Date.parse('2026-07-15T05:00:00Z'))).toBe('זמין עד היום ב-23:59');
  });
  it('the day before: tomorrow; further: in N days; after: closed', () => {
    expect(closingLabel(close, Date.parse('2026-07-14T20:30:00Z'))).toBe('מחר ב-23:59');
    expect(closingLabel(close, Date.parse('2026-07-10T09:00:00Z'))).toBe('בעוד 5 ימים');
    expect(availabilityText(close, false, Date.parse('2026-07-10T09:00:00Z'))).toBe('זמין לעוד 5 ימים');
    expect(availabilityText(close, false, Date.parse('2026-07-15T21:00:00Z'))).toBe('הגלריה נסגרה');
  });
  it('an older gallery that closes at its creation hour says that hour', () => {
    expect(closingLabel('2026-07-15T11:20:00.000Z', Date.parse('2026-07-15T05:00:00Z'))).toBe('היום ב-14:20');
  });
});

describe('galleries close at the end of the day', () => {
  const env = { CLOUD_MOCK: '1' } as unknown as Env;
  const settings = { studioName: 'S', defaultDays: 30 } as Settings;
  it('made in the morning with 30 days: open until 23:59 of the 30th day; 30 days left, 0 on the last day', async () => {
    const store = new MemoryStore();
    const g = await createGallery(store, env, settings, { coupleName: 'א', days: 30 }, 't1');
    // 30 calendar days after its day in Israel (P71: not 30 × 24 hours, which fell a day short when made just
    // after midnight in the month before winter time).
    const day = new Date(Date.parse(`${israelDay(Date.parse(g.createdAt))}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    expect(g.expiresAt).toBe(new Date(endOfIsraelDay(day)).toISOString());
    expect(daysLeft(g)).toBe(30);
    expect(daysLeft(g, Date.parse(g.expiresAt) - HOUR)).toBe(0);
    expect(daysLeft(g, Date.parse(g.expiresAt) + 1000)).toBe(0);
    const longer = await extendGallery(store, g, 5);
    expect(longer.expiresAt).toBe(new Date(endOfIsraelDay(israelDay(Date.parse(g.expiresAt) + 5 * 86_400_000))).toISOString());
  });
  it('P71: days are calendar days, also for a gallery made just after midnight before winter time', () => {
    // 00:30 on 1.10.26 in Israel (summer time); winter time starts on 25.10.
    expect(closeAfterDays(Date.parse('2026-09-30T21:30:00Z'), 30)).toBe(endOfIsraelDay('2026-10-31'));
    expect(closeAfterDays(Date.parse('2026-10-01T20:00:00Z'), 1)).toBe(endOfIsraelDay('2026-10-02'));
  });
  it('a chosen closing date is kept to the end of that day', async () => {
    const store = new MemoryStore();
    const g = await createGallery(store, env, settings, { coupleName: 'א', expiresAt: '2027-03-10T08:00:00Z' }, 't1');
    expect(g.expiresAt).toBe('2027-03-10T21:59:59.000Z');
  });
});

describe('the wedding date', () => {
  const env = { CLOUD_MOCK: '1' } as unknown as Env;
  const settings = { studioName: 'S', defaultDays: 30 } as Settings;
  it('only a real day or nothing; an old free-text date sent back unchanged stays', async () => {
    const store = new MemoryStore();
    await expect(createGallery(store, env, settings, { coupleName: 'א', date: '2026-02-31' }, 't1')).rejects.toThrow(/תאריך/);
    await expect(createGallery(store, env, settings, { coupleName: 'א', date: '11/8/26' }, 't1')).rejects.toThrow(/תאריך/);
    const g = await createGallery(store, env, settings, { coupleName: 'א', date: '2026-08-11' }, 't1');
    expect(g.date).toBe('2026-08-11');
    const old = (await store.patchGallery('t1', g.id, { date: 'בקיץ' }))!;
    expect((await updateGallery(store, env, settings, structuredClone(old), { date: 'בקיץ', venue: 'אולם' })).venue).toBe('אולם');
    await expect(updateGallery(store, env, settings, structuredClone(old), { date: 'בחורף' })).rejects.toThrow(/תאריך/);
    expect((await updateGallery(store, env, settings, structuredClone(old), { date: '' })).date).toBe('');
  });
  it('names are kept as written (the "&" is only the form\'s suggestion)', async () => {
    const g = await createGallery(new MemoryStore(), env, settings, { coupleName: '  דניאל   וסבינה ' }, 't1');
    expect(g.coupleName).toBe('דניאל וסבינה');
  });
});
