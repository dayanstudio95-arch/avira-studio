/**
 * The studio's Dropbox refresh token, sealed in tenant_secrets (fix plan P16).
 *
 * The same format as the Edge Functions' supabase/functions/_shared/tenantSecrets.ts — AES-GCM under
 * TENANT_SECRETS_KEY (the SAME value in the Worker and in Supabase), bound to `tenant_secrets:<studio>:<key>`,
 * stored as `ts1.<iv>.<ciphertext>` — so tools/prod/encrypt-secrets.mjs seals every key the same way, and
 * apps/hub/scripts/test-tenant-secrets.mjs checks the two open each other's values.
 *  - A value not sealed yet (before encrypt-secrets ran) is read as it is.
 *  - A `ts1.` value that does not open is "not connected" (logged, never used).
 *  - While TENANT_SECRETS_KEY is not set (local previews, tests, a deploy before the runbook's first
 *    step) a new token is stored as it is, logged — the connect never fails over a missing setting.
 * TENANT_SECRETS_KEY is never rotated: every sealed value would become unreadable.
 */
import type { Env } from './types';

export const SEALED_PREFIX = 'ts1.';

export const secretScope = (tenantId: string, key: string) => `tenant_secrets:${tenantId}:${key}`;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64Url(input: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('not base64url');
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const s = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const keys = new Map<string, Promise<CryptoKey>>();
function secretsKey(env: Env): Promise<CryptoKey> | null {
  const raw = (env.TENANT_SECRETS_KEY ?? '').trim();
  if (!raw) return null;
  let key = keys.get(raw);
  if (!key) {
    const bytes = fromB64Url(raw.replace(/=+$/, ''));
    if (bytes.length !== 32) throw new Error('TENANT_SECRETS_KEY must be 32 bytes (base64url)');
    key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
    keys.set(raw, key);
  }
  return key;
}

export const isSealed = (value: unknown): value is string => typeof value === 'string' && value.startsWith(SEALED_PREFIX);

/** Seals `plain` for one studio's key; without TENANT_SECRETS_KEY the value is returned as it is (logged). */
export async function sealSecret(env: Env, tenantId: string, key: string, plain: string): Promise<string> {
  const k = secretsKey(env);
  if (!k) {
    console.error('[secretBox] TENANT_SECRETS_KEY is not set — the token is stored unsealed (runbook P16)');
    return plain;
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(secretScope(tenantId, key)) }, await k, enc.encode(plain)));
  return `${SEALED_PREFIX}${toB64Url(iv)}.${toB64Url(ct)}`;
}

/** The stored value's text: null for none; as it is when not sealed; throws when a sealed value does not open. */
export async function openSecret(env: Env, tenantId: string, key: string, stored: string | null | undefined): Promise<string | null> {
  if (stored === null || stored === undefined || stored === '') return null;
  if (!isSealed(stored)) return stored;
  const k = secretsKey(env);
  if (!k) throw new Error('TENANT_SECRETS_KEY is not set');
  const parts = stored.slice(SEALED_PREFIX.length).split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('sealed value is malformed');
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64Url(parts[0]), additionalData: enc.encode(secretScope(tenantId, key)) },
    await k,
    fromB64Url(parts[1]),
  );
  return dec.decode(pt);
}

/** Like openSecret, but a value that does not open is null ("not connected"), logged without the value. */
export async function openSecretOrNull(env: Env, tenantId: string, key: string, stored: string | null | undefined): Promise<string | null> {
  try {
    return await openSecret(env, tenantId, key, stored);
  } catch (e) {
    console.error(`[secretBox] ${key} of studio ${tenantId} could not be read: ${(e as Error)?.message || e}`);
    return null;
  }
}
