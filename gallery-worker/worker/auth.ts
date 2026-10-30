// Small crypto helpers: random ids and HMAC-signed tokens (Dropbox OAuth state).
// Logins are Supabase sessions now (supabaseAuth.ts); no passwords live here.

const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64(a);
}

/** Random id for galleries: 16 hex chars, the shape the couple sees in the link. */
export function randomId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/**
 * A key for one purpose, derived from the Worker's secret (FILMS_STATE_SECRET): the gallery cookies (P67),
 * the studio's preview tokens and the album-order links (P73) each sign with their own, so a signature made
 * for one purpose never passes for another. Kept per secret for the Worker's life (it never changes).
 */
const derivedKeys = new Map<string, Promise<string>>();
export function derivedKey(secret: string, purpose: string): Promise<string> {
  const id = `${purpose}\n${secret}`;
  let key = derivedKeys.get(id);
  if (!key) derivedKeys.set(id, (key = hmac(secret, purpose)));
  return key;
}

/** Signs a payload so it can round-trip through a cookie or an OAuth state parameter. */
export async function sign(secret: string, payload: string): Promise<string> {
  return `${b64(enc.encode(payload))}.${await hmac(secret, payload)}`;
}

export async function verify(secret: string, token: string): Promise<string | null> {
  const [p, sig] = token.split('.');
  if (!p || !sig) return null;
  let payload: string;
  try {
    payload = new TextDecoder().decode(unb64(p));
  } catch {
    return null;
  }
  const expected = await hmac(secret, payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? payload : null;
}
