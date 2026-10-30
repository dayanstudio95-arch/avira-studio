// Hearts and Instagram marks on the couple's page (P72): quick taps, answers out of order, failures.
import { describe, expect, it } from 'vitest';
import { heartState, instaRecord, instaState } from '../src/photos/favState';

describe('favState', () => {
  it('an older answer never overwrites a newer one; one fresh read is asked for', () => {
    const s = heartState({});
    const a = s.begin({ p1: [''] }); // heart photo 1
    const b = s.begin({ p2: [''] }); // heart photo 2
    expect(Object.keys(s.view()).sort()).toEqual(['p1', 'p2']);
    // The second answer comes first: both are in it.
    expect(s.answer(b, { p1: [''], p2: [''] })).toEqual({ refresh: true });
    // The first answer (older) arrives late, without photo 2: dropped.
    expect(s.answer(a, { p1: [''] })).toEqual({ refresh: true });
    expect(Object.keys(s.view()).sort()).toEqual(['p1', 'p2']);
  });

  it('answers in order: no fresh read, and later taps stay on top of an earlier answer', () => {
    const s = heartState({ p0: ['מאי'] });
    const a = s.begin({ p1: ['מאי'] });
    expect(s.answer(a, { p0: ['מאי'], p1: ['מאי'] })).toEqual({ refresh: false });
    const b = s.begin({ p1: [] });
    const c = s.begin({ p3: ['מאי'] });
    expect(s.answer(b, { p0: ['מאי'] })).toEqual({ refresh: false });
    // c is still on its way: photo 3 stays hearted, photo 1 is gone.
    expect(Object.keys(s.view()).sort()).toEqual(['p0', 'p3']);
    s.answer(c, { p0: ['מאי'], p3: ['מאי'] });
    expect(Object.keys(s.view()).sort()).toEqual(['p0', 'p3']);
  });

  it('a failure takes back only its own photos', () => {
    const s = instaState(['p0']);
    const a = s.begin({ p1: true });
    const b = s.begin({ p2: true, p0: false });
    s.fail(a);
    expect(Object.keys(s.view()).sort()).toEqual(['p2']);
    s.fail(b);
    expect(Object.keys(s.view()).sort()).toEqual(['p0']);
    expect(s.answer(s.begin({}), instaRecord(['p0', 'p9']))).toEqual({ refresh: false });
    expect(Object.keys(s.view()).sort()).toEqual(['p0', 'p9']);
  });

  it('the same photo tapped twice quickly ends as the last tap said', () => {
    const s = heartState({});
    const on = s.begin({ p1: [''] });
    const off = s.begin({ p1: [] });
    s.answer(on, { p1: [''] });
    expect(s.view()).toEqual({});
    s.answer(off, {});
    expect(s.view()).toEqual({});
  });
});
