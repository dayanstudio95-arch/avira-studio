// Avira (0095): photo galleries and the CRM are on, films are off — the same switch Studio Plan uses for a studio
// without the films module. Checked on the real migrations (buildDb with films: false).
import { describe, expect, it } from 'vitest';
import { buildDb } from './pglite-supabase';

describe('Avira modules', () => {
  it('photos and crm on, films off; a studio is never blocked', async () => {
    const db = await buildDb({ films: false });
    const T = '00000000-0000-4000-8000-00000000a001';
    await db.query(`insert into public.tenants (id, name, slug) values ($1, 'Avira', 'avira-test')`, [T]);
    const r = await db.query<{ photos: boolean; crm: boolean; films: boolean; access: string; info: Record<string, unknown> }>(
      `select public.tenant_has_module($1, 'photos') photos, public.tenant_has_module($1, 'crm') crm,
              public.tenant_has_module($1, 'films') films, public.tenant_access_state($1) access, public.films_tenant_info($1) info`,
      [T],
    );
    expect(r.rows[0]).toMatchObject({ photos: true, crm: true, films: false, access: 'ok' });
    expect(r.rows[0].info).toMatchObject({ slug: 'avira-test', photos: true, films: false, access: 'ok', accent_color: '#FACC15' });
    const none = await db.query<{ access: string }>(`select public.tenant_access_state('00000000-0000-4000-8000-00000000a0ff') access`);
    expect(none.rows[0].access).toBe('blocked');
    await db.close();
  }, 60_000);
});
