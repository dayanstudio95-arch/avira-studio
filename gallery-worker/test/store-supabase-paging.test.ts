// Fix plan P70: SupabaseStore reads past PostgREST's 1,000 rows and writes many photos in one request. Run on a
// real Postgres with every migration (test/pglite-supabase.ts) that, like Supabase, answers at most 1,000 rows,
// behind a fetch that fails from the 51st request (Cloudflare's limit per call on the free plan).
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseStore } from '../worker/store-supabase';
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const BASE = 'http://supabase.paging.test';
const T = '00000000-0000-4000-8000-0000000070a1';
const G = '7070707070707001';
const hex = (i: number) => i.toString(16).padStart(8, '0');

let db: PGlite;
let rest: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** Requests since the last reset ("host/path method"). */
let sent: string[] = [];
const sql = (text: string, params: unknown[] = []) => db.query(text, params);

async function limited(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(String(input));
  sent.push(`${u.pathname} ${init?.method ?? 'GET'}`);
  // What Cloudflare does past the limit: the request is refused with an error.
  if (sent.length > 50) throw new Error('Too many subrequests.');
  return rest(input, init);
}

const store = () => new SupabaseStore(BASE, 'service-role-test-key');

beforeAll(async () => {
  db = await buildDb();
  rest = supabaseFetchFor(db, BASE);
  await sql(`insert into tenants (id, name, slug) values ($1, 'P70 Studio', 'p70-studio')`, [T]);
  await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Couple 70', now() + interval '30 days', 'photos')`, [G, T]);
  // 2,500 hearts: 2,000 photos by one person and 500 of those by a second (a key's names keep their order).
  await sql(`insert into films_hearts (gallery_id, tenant_id, photo_key, who, created_at)
    select $1, $2, lpad(to_hex(i), 8, '0'), 'מאי', now() - interval '1 day' + i * interval '1 second' from generate_series(0, 1999) i`, [G, T]);
  await sql(`insert into films_hearts (gallery_id, tenant_id, photo_key, who, created_at)
    select $1, $2, lpad(to_hex(i), 8, '0'), 'אמא', now() - interval '1 hour' + i * interval '1 second' from generate_series(0, 499) i`, [G, T]);
  await sql(`insert into films_insta (gallery_id, tenant_id, photo_key, created_at)
    select $1, $2, lpad(to_hex(i), 8, '0'), now() - interval '1 day' + i * interval '1 second' from generate_series(0, 1499) i`, [G, T]);
  // 1,200 galleries.
  await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, created_at, password)
    select '71' || lpad(to_hex(i), 14, '0'), $1, 'Couple ' || i, now() + interval '10 days', 'films', now() - i * interval '1 minute', 'pw-' || i from generate_series(0, 1198) i`, [T]);
  // 1,300 acceptances of the terms: 1,100 by guests, 150 by the couple, 50 older ones without a role.
  await sql(`insert into films_terms_accepts (tenant_id, gallery_id, terms_hash, ip_hash, role, accepted_at)
    select $1, $2, 'h', 'ip', case when i < 1100 then 'guest' when i < 1250 then 'couple' else null end, timestamptz '2026-09-01T00:00:00Z' + i * interval '1 minute'
      from generate_series(0, 1299) i`, [T, G]);
  vi.stubGlobal('fetch', limited);
}, 120_000);

beforeEach(() => {
  sent = [];
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db?.close();
});

describe('reads past 1,000 rows', () => {
  it('2,500 hearts are read whole (3 pages), in the order they were given', async () => {
    const favBy = await store().listHearts(G);
    expect(Object.keys(favBy)).toHaveLength(2000);
    expect(Object.values(favBy).flat()).toHaveLength(2500);
    expect(favBy[hex(0)]).toEqual(['מאי', 'אמא']);
    expect(favBy[hex(1999)]).toEqual(['מאי']);
    expect(Object.keys(favBy).slice(0, 3)).toEqual([hex(0), hex(1), hex(2)]);
    expect(sent.length).toBe(3);
  });

  it('1,500 Instagram marks, 1,200 galleries (and their link-picker options) are read whole', async () => {
    const insta = await store().listInsta(G);
    expect(insta).toHaveLength(1500);
    expect(new Set(insta).size).toBe(1500);
    const list = await store().listGalleries(T);
    expect(list).toHaveLength(1200);
    expect(new Set(list.map((g) => g.id)).size).toBe(1200);
    // Newest first, and never a secret.
    expect(list[0].id).toBe('7100000000000000');
    expect(list[1199].id).toBe('71000000000004ae');
    expect(list.every((g) => g.password === undefined)).toBe(true);
    expect((await store().galleryOptions(T)).length).toBe(1200);
    expect(sent.length).toBeLessThanOrEqual(2 + 2 + 2);
  });

  it('one page of galleries says the total', async () => {
    const p = await store().pageGalleries(T, 500, 1000);
    expect(p.total).toBe(1200);
    expect(p.galleries).toHaveLength(200);
    expect(sent.length).toBe(1);
  });

  it('the terms record is counted by the database: one request, not 1,300 rows', async () => {
    const s = await store().termsAccepts(G);
    expect(s).toMatchObject({ count: 150, guests: 1100, unknown: 50 });
    expect(new Date(s.first).toISOString()).toBe(new Date(Date.parse('2026-09-01T00:00:00Z') + 1100 * 60_000).toISOString());
    expect(new Date(s.last).toISOString()).toBe(new Date(Date.parse('2026-09-01T00:00:00Z') + 1249 * 60_000).toISOString());
    expect(sent).toEqual(['/rest/v1/rpc/films_terms_summary POST']);
    expect(await store().termsAccepts('7070707070707999')).toEqual({ count: 0, first: '', last: '', guests: 0, unknown: 0 });
  });
});

describe('many photos in one write', () => {
  const G2 = '7070707070707002';
  const keys = Array.from({ length: 500 }, (_, i) => hex(0x10000 + i));

  beforeAll(async () => {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind) values ($1, $2, 'Couple 70b', now() + interval '30 days', 'photos')`, [G2, T]);
  });

  it('500 hearts are saved in one request, and taken off in groups of 200 (3 requests)', async () => {
    await store().setHearts(T, G2, keys, true, 'מאי');
    expect(sent).toEqual(['/rest/v1/films_hearts POST']);
    expect(Object.keys(await store().listHearts(G2))).toEqual(keys);
    // Again: nothing doubles.
    await store().setHearts(T, G2, keys.slice(0, 10), true, 'מאי');
    expect(Object.values(await store().listHearts(G2)).flat()).toHaveLength(500);
    sent = [];
    await store().setHearts(T, G2, keys.slice(0, 450), false, 'מאי');
    expect(sent).toEqual(Array(3).fill('/rest/v1/films_hearts DELETE'));
    expect(Object.keys(await store().listHearts(G2))).toEqual(keys.slice(450));
  });

  it('500 Instagram marks likewise', async () => {
    await store().setInstaMany(T, G2, keys, true);
    expect(sent).toEqual(['/rest/v1/films_insta POST']);
    sent = [];
    await store().setInstaMany(T, G2, keys, false);
    expect(sent).toHaveLength(3);
    expect(await store().listInsta(G2)).toEqual([]);
  });
});
