// The studio's Dropbox refresh token is stored sealed (fix plan P16, worker/secretBox.ts): sealed on connect,
// opened when the settings are read, bound to its studio, a forged value is "not connected", a token stored
// before P16 still works, and without TENANT_SECRETS_KEY nothing breaks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { sign } from '../worker/auth';
import { openSecret, openSecretOrNull, sealSecret, SEALED_PREFIX } from '../worker/secretBox';
import { getSettings } from '../worker/settings';
import { DROPBOX_SECRET, storeFor } from '../worker/store';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

// 32 bytes, base64url — a test value, not a real key.
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const OTHER_KEY = 'HxwdHh8aGxkYFxYVFBMSERAPDg0MCwoJCAcGBQQDAgE';
const T = '44444444-4444-4444-8444-444444444444';
const U = '55555555-5555-4555-8555-555555555555';
const env = { ...fakeEnv(), CLOUD_MOCK: '1', DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', TENANT_SECRETS_KEY: KEY } as Env;
const noKey = { ...env, TENANT_SECRETS_KEY: undefined } as Env;

async function fakeDropbox(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (url === 'https://api.dropboxapi.com/oauth2/token') {
    const p = new URLSearchParams(String(init?.body));
    if (p.get('grant_type') === 'authorization_code') return Response.json({ refresh_token: `refresh-${p.get('code')}` });
    return Response.json({ access_token: `${p.get('refresh_token')}-at`, expires_in: 14400 });
  }
  if (url.endsWith('/users/get_current_account')) {
    const auth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? '';
    return Response.json({ name: { display_name: `Account of ${auth.replace(/^Bearer /, '')}` } });
  }
  return Response.json({});
}

beforeEach(() => vi.stubGlobal('fetch', fakeDropbox));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('secretBox', () => {
  it('seals and opens a value; the sealed text is not the value', async () => {
    const sealed = await sealSecret(env, T, DROPBOX_SECRET, 'my-refresh-token');
    expect(sealed.startsWith(SEALED_PREFIX)).toBe(true);
    expect(sealed).not.toContain('my-refresh-token');
    expect(await openSecret(env, T, DROPBOX_SECRET, sealed)).toBe('my-refresh-token');
    expect(await sealSecret(env, T, DROPBOX_SECRET, 'my-refresh-token')).not.toBe(sealed);
  });

  it('a value sealed for one studio (or key) does not open for another', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sealed = await sealSecret(env, T, DROPBOX_SECRET, 'my-refresh-token');
    await expect(openSecret(env, U, DROPBOX_SECRET, sealed)).rejects.toThrow();
    await expect(openSecret(env, T, 'whatsapp_api_key', sealed)).rejects.toThrow();
    expect(await openSecretOrNull(env, U, DROPBOX_SECRET, sealed)).toBeNull();
  });

  it('a forged or changed value, or another key, is refused — never used', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const sealed = await sealSecret(env, T, DROPBOX_SECRET, 'my-refresh-token');
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'B' : 'A') + sealed.slice(-1);
    expect(await openSecretOrNull(env, T, DROPBOX_SECRET, flipped)).toBeNull();
    expect(await openSecretOrNull(env, T, DROPBOX_SECRET, 'ts1.bm90LWEtcmVhbC12YWx1ZQ.Zm9yZ2Vk')).toBeNull();
    expect(await openSecretOrNull(env, T, DROPBOX_SECRET, 'ts1.only-one-part')).toBeNull();
    expect(await openSecretOrNull({ ...env, TENANT_SECRETS_KEY: OTHER_KEY } as Env, T, DROPBOX_SECRET, sealed)).toBeNull();
    expect(await openSecretOrNull(noKey, T, DROPBOX_SECRET, sealed)).toBeNull();
  });

  it('a token stored before P16 (not sealed) is read as it is; empty is none', async () => {
    expect(await openSecret(env, T, DROPBOX_SECRET, 'old-plain-token')).toBe('old-plain-token');
    expect(await openSecret(env, T, DROPBOX_SECRET, null)).toBeNull();
    expect(await openSecret(env, T, DROPBOX_SECRET, '')).toBeNull();
  });

  it('without TENANT_SECRETS_KEY a new token is stored as it is (the connect does not fail)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sealSecret(noKey, T, DROPBOX_SECRET, 'tok')).toBe('tok');
  });

  it('refuses a key that is not 32 bytes', async () => {
    await expect(sealSecret({ ...env, TENANT_SECRETS_KEY: 'c2hvcnQ' } as Env, T, DROPBOX_SECRET, 'x')).rejects.toThrow(/32 bytes/);
  });
});

describe('the Dropbox connection in the store', () => {
  const finish = async (tid: string, code: string, e: Env = env) => {
    const state = await sign('mock-state-secret', `dbx:${tid}:owner:${Date.now()}`);
    return worker.fetch(new Request('https://films.test/api/admin/dropbox/finish', {
      method: 'POST',
      headers: { Authorization: `Bearer test:owner:${tid}:owner`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
    }), e);
  };

  it('connect stores the token sealed; the settings open it, and Dropbox gets the real token', async () => {
    const res = await finish(T, 'one');
    const body = (await res.json()) as { dropbox?: { connected?: boolean; accountName?: string } };
    expect(res.status).toBe(200);
    expect(body.dropbox?.connected).toBe(true);
    expect(body.dropbox?.accountName).toBe('Account of refresh-one-at');
    const store = await storeFor(env);
    const stored = await store.getSecret(T, DROPBOX_SECRET);
    expect(stored?.startsWith(SEALED_PREFIX)).toBe(true);
    expect(stored).not.toContain('refresh-one');
    expect((await getSettings(env, store, T)).dropbox.refreshToken).toBe('refresh-one');
  });

  it('a value copied from another studio, or changed by hand, reads as "not connected"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await finish(T, 'two');
    const store = await storeFor(env);
    await store.setSecret(U, DROPBOX_SECRET, await store.getSecret(T, DROPBOX_SECRET));
    expect((await getSettings(env, store, U)).dropbox.refreshToken).toBeUndefined();
    await store.setSecret(U, DROPBOX_SECRET, 'ts1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect((await getSettings(env, store, U)).dropbox.refreshToken).toBeUndefined();
  });

  it('a token stored before P16 keeps working', async () => {
    const store = await storeFor(env);
    await store.setSecret(U, DROPBOX_SECRET, 'refresh-legacy');
    expect((await getSettings(env, store, U)).dropbox.refreshToken).toBe('refresh-legacy');
  });
});
