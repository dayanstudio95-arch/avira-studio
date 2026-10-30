import type { Env } from '../worker/types';

/** In-memory stand-in for Cloudflare KV, enough for the worker modules under test. */
export function fakeEnv(): Env & { dump: () => Record<string, string> } {
  const store = new Map<string, string>();
  // Binary values (covers, list pictures) with their metadata, as KV keeps them.
  const raw = new Map<string, { value: ArrayBuffer; metadata: unknown }>();
  const KV = {
    async get(key: string, type?: string) {
      if (raw.has(key)) return raw.get(key)!.value;
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key: string, value: string | ArrayBuffer, opts?: { metadata?: unknown }) {
      if (typeof value === 'string') store.set(key, value);
      else raw.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string) {
      store.delete(key);
      raw.delete(key);
    },
    async getWithMetadata(key: string) {
      return raw.get(key) ?? { value: null, metadata: null };
    },
  };
  return { KV, ASSETS: {} as Fetcher, dump: () => Object.fromEntries(store) } as unknown as Env & { dump: () => Record<string, string> };
}
