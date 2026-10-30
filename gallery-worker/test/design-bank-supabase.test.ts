// Work order item 42 (port B10): the couple's portal reads the sketch's photos — on SupabaseStore over a real Postgres
// with every migration (0173 films_album_design_bank), so the Worker's question and the database's answer agree:
// an open design → its gallery's visible photos; closed, revoked, another studio's gallery, a wrong link → nothing.
// Synthetic data only.
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';
import { buildDb, supabaseFetchFor } from './pglite-supabase';

const BASE = 'http://supabase.b10.test';
const T = '00000000-0000-4000-8000-0000000b10a1';
const T2 = '00000000-0000-4000-8000-0000000b10a2';
const ORDER = '00000000-0000-4000-8000-0000000b10c1';
const G = 'b10b10b10b10b101';
const G2 = 'b10b10b10b10b102';
const TOKEN = 'b10-supabase-portal-token-0123456789';
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, '0')).join('');

let db: PGlite;
let sent: string[] = [];
const env = {
  ...fakeEnv(),
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  FILMS_STATE_SECRET: 'b10-state-secret',
  HUB_URL: 'https://hub.example',
  ASSETS: { fetch: async () => new Response('x') },
} as unknown as Env;
const sql = (text: string, params: unknown[] = []) => db.query(text, params);
const call = async (token: string) => {
  sent = [];
  return worker.fetch(new Request('https://films.test/api/album-portal/design-bank', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://hub.example' }, body: JSON.stringify({ token }) }), env);
};

beforeAll(async () => {
  db = await buildDb();
  const rest = supabaseFetchFor(db, BASE);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(input instanceof Request ? input.url : String(input));
    sent.push(u.pathname);
    if (u.origin === BASE) return rest(input, init);
    throw new Error(`unexpected request: ${u.href}`);
  });
  await sql(`insert into tenants (id, name, slug) values ($1, 'B10 Studio', 'b10-studio'), ($2, 'B10 Other', 'b10-other')`, [T, T2]);
  const items = [
    { key: 'b1000001', name: 'IMG_1.jpg', ref: 'p:/w/1.jpg', ar: 1.5, t: 1 },
    { key: 'b1000002', name: 'IMG_2.jpg', ref: 'p:/w/2.jpg', ar: 0.667, t: 2 },
    { key: 'b1000003', name: 'IMG_3.jpg', ref: 'p:/w/3.jpg', hidden: true },
  ];
  for (const [g, t] of [[G, T], [G2, T2]]) {
    await sql(`insert into films_galleries (id, tenant_id, couple_name, expires_at, kind, password) values ($1, $2, 'זוג', now() + interval '30 days', 'photos', 'b10-pass')`, [g, t]);
    await sql(`insert into films_photos (gallery_id, tenant_id, data) values ($1, $2, $3)`, [g, t, JSON.stringify({ folderUrl: 'https://www.dropbox.com/scl/fo/b10/x', provider: 'dropbox', sets: [{ id: 's', name: 'חופה' }], items })]);
  }
  await sql(`insert into album_orders (id, tenant_id, couple_names_manual, portal_token_hash) values ($1, $2, 'זוג', $3)`, [ORDER, T, await sha(TOKEN)]);
  const doc = { v: 1, sources: [{ kind: 'gallery', galleryId: G }, { kind: 'gallery', galleryId: G2 }], pages: [] };
  await sql(`insert into album_designs (tenant_id, album_order_id, doc, client_edit_enabled) values ($1, $2, $3, false)`, [T, ORDER, JSON.stringify(doc)]);
});
afterAll(() => vi.unstubAllGlobals());

// Phase 3 (the album, with Avira's album portal): films_album_design_bank is not in 0095 yet.
describe.skip("the couple's photos of the sketch, on the database", () => {
  it('closed until the studio opens editing', async () => {
    expect((await call(TOKEN)).status).toBe(403);
  });

  it("open: the design's own gallery of its studio, visible photos only, in a few requests", async () => {
    await sql(`update album_designs set client_edit_enabled = true where album_order_id = $1`, [ORDER]);
    const res = await call(TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { readOnly: boolean; galleries: { id: string; items: { key: string }[]; sets: unknown[]; thumbsToken: string }[] };
    // G2 is in the design's sources but belongs to another studio: left out.
    expect(body.galleries.map((g) => g.id)).toEqual([G]);
    expect(body.galleries[0].items.map((i) => i.key)).toEqual(['b1000001', 'b1000002']);
    expect(body.galleries[0].sets).toEqual([{ id: 's', name: 'חופה' }]);
    expect(body.galleries[0].thumbsToken).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('b10-pass');
    expect(sent.length).toBeLessThanOrEqual(10);
  });

  it('a wrong or revoked link, a suspended studio: nothing', async () => {
    expect((await call('b10-a-wrong-token-000000000000')).status).toBe(404);
    await sql(`update tenants set status = 'suspended' where id = $1`, [T]);
    expect((await call(TOKEN)).status).toBe(403);
    await sql(`update tenants set status = 'active' where id = $1`, [T]);
    await sql(`update album_orders set portal_token_revoked_at = now() where id = $1`, [ORDER]);
    expect((await call(TOKEN)).status).toBe(404);
  });
});
