// A Supabase stand-in for the films tests (from store-contract.test.ts, P88-b; shared since P62):
// a real Postgres in memory (PGlite) built from every migration on tools/db-test/stubs.sql, and a
// fetch that answers the REST calls SupabaseStore makes, through the demo's PostgREST stand-in
// (tools/demo/postgrest.mjs), as the service role. No network.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { buildTableQuery, parsePrefer, q } from './support/postgrest.mjs';
import stubs from './support/stubs.sql?raw';

// Every migration, as text, in file-name order (read by Vite, so the Worker's types need no Node).
const MIGRATIONS = Object.entries(import.meta.glob<string>('../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }))
  .sort(([a], [b]) => a.localeCompare(b));

/**
 * Avira: 0095's tenant_has_module keeps films OFF (photo galleries only). Most of these tests were written in Studio
 * Plan with film galleries as their sample data and test machinery both kinds share (batches, the trash, extending…),
 * so the test database turns films on unless `films: false` is asked for — test/avira-modules.test.ts checks the real
 * migration with films off.
 */
export async function buildDb(opts: { films?: boolean } = {}): Promise<PGlite> {
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(stubs);
  if (MIGRATIONS.length < 90) throw new Error(`only ${MIGRATIONS.length} migrations found`);
  for (const [f, text] of MIGRATIONS) {
    const sql = text.replace(/create extension if not exists (pg_cron|pg_net)\s*;/gi, '-- (stub) $&');
    await pg.exec(sql).catch((e: Error) => {
      throw new Error(`migration ${f}: ${e.message}`);
    });
  }
  // What a Supabase project grants its service role on everything in public (default privileges).
  await pg.exec(`grant usage on schema public to service_role;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
    grant execute on all functions in schema public to service_role;`);
  if (opts.films !== false) {
    await pg.exec(`create or replace function public.tenant_has_module(tid uuid, module_key text)
      returns boolean language sql stable security definer set search_path = public as $$
        select module_key in ('photos', 'crm', 'films') and exists (select 1 from public.tenants t where t.id = tid);
      $$;`);
  }
  return pg;
}

type PgError = Error & { code?: string; status?: number; detail?: string };

function pgResponse(e: PgError): Response {
  const code = e.code || 'PGRST000';
  const status = e.status || (['23505', '23503'].includes(code) ? 409 : code === '42501' ? 403 : 400);
  return Response.json({ code, message: e.message, details: e.detail ?? null }, { status });
}

/**
 * A fetch that answers `<base>/rest/v1/…` (tables and RPCs) from `db`, as the service role. Like Supabase's
 * PostgREST (P70): a read answers at most `maxRows` rows (1,000) and says `Content-Range: <from>-<to>/<total>`
 * (the total only with `Prefer: count=exact`).
 */
export function supabaseFetchFor(db: PGlite, base: string, opts: { maxRows?: number } = {}) {
  const maxRows = opts.maxRows ?? 1000;
  async function asService<T>(fn: (tx: Pick<PGlite, 'query'>) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'service_role' })]);
      return fn(tx);
    });
  }

  async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
    const info = (
      await db.query<{ set: boolean; kind: string; type: string }>(
        `select p.proretset as set, t.typtype as kind, t.typname as type from pg_proc p join pg_type t on t.oid = p.prorettype
         join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`,
        [fn],
      )
    ).rows[0];
    if (!info) return Response.json({ code: 'PGRST202', message: `no function ${fn}` }, { status: 404 });
    const names = Object.keys(args);
    const vals = names.map((k) => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k]));
    const call = `public.${q(fn)}(${names.map((k, i) => `${q(k)} => $${i + 1}`).join(', ')})`;
    const sql = info.set || info.kind === 'c'
      ? `select coalesce(json_agg(_r), '[]'::json) as j from ${call} _r`
      : info.type === 'void'
        ? `select ${call}, null::json as j`
        : `select to_json(${call}) as j`;
    try {
      const out = await asService(async (tx) => (await tx.query<{ j: unknown }>(sql, vals)).rows[0].j);
      return new Response(JSON.stringify(!info.set && info.kind === 'c' ? ((out as unknown[])[0] ?? null) : out), { status: 200 });
    } catch (e) {
      return pgResponse(e as PgError);
    }
  }

  return async function supabaseFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(String(input));
    if (url.origin !== base) throw new Error(`unexpected request to ${url.origin}`);
    const method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {};
    const rest = url.pathname.replace(/^\/rest\/v1\/?/, '');
    if (!url.pathname.startsWith('/rest/v1/')) throw new Error(`not in the contract: ${url.pathname}`);
    if (rest.startsWith('rpc/')) return rpc(rest.slice(4), body);
    const prefer = parsePrefer(headers.get('prefer') ?? '');
    try {
      const built = buildTableQuery({ method, table: decodeURIComponent(rest), url, body, prefer, range: undefined });
      const { rows, count } = await asService(async (tx) => ({
        rows: (await tx.query<{ j: unknown[] }>(built.sql, built.params)).rows[0].j,
        count: built.countSql ? (await tx.query<{ n: number }>(built.countSql, built.params)).rows[0].n : null,
      }));
      if (method !== 'GET' && prefer.return !== 'representation') return new Response(null, { status: method === 'POST' ? 201 : 204 });
      if (method !== 'GET') return Response.json(rows, { status: method === 'POST' ? 201 : 200 });
      const page = rows.slice(0, maxRows);
      const from = Number(built.offset ?? 0);
      const range = `${page.length ? `${from}-${from + page.length - 1}` : '*'}/${count ?? '*'}`;
      return Response.json(page, { status: 200, headers: { 'Content-Range': range } });
    } catch (e) {
      return pgResponse(e as PgError);
    }
  };
}
