// Shared SHA-256 hex-digest helper for the Wedding Albums module's two public,
// token-based surfaces (album-portal, album-print-access). Tokens are minted
// client-side (crypto.randomUUID() + crypto.getRandomValues()) and only ever sent to
// the server once, at creation time, to be hashed and stored — the raw token is never
// persisted anywhere (album_orders.portal_token_hash / print_access_links.token_hash),
// per CLAUDE.md's "Security" rules. SHA-256 (deterministic) is used deliberately
// instead of bcrypt so a lookup can go directly by hash value on every request, which a
// salted bcrypt hash cannot support.
//
// Deno's global Web Crypto API (crypto.subtle) is used directly — no npm dependency
// needed. The frontend uses the browser's identical window.crypto.subtle API for the
// same digest, so both sides produce the same hex string for the same raw token.
export async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
