// Types for Studio Plan's PostgREST stand-in (copied to test/support/postgrest.mjs), used by pglite-supabase.ts (store-contract and supabase-calls tests).
// The films build type-checks test/ too, and that file is plain JavaScript.
declare module '*/support/postgrest.mjs' {
  export function q(identifier: string): string;
  export function parsePrefer(header?: string): Record<string, string>;
  export function buildTableQuery(req: {
    method: string;
    table: string;
    url: URL;
    body: unknown;
    prefer: Record<string, string>;
    range?: string;
  }): { sql: string; params: unknown[]; countSql?: string | null; offset?: number };
}
