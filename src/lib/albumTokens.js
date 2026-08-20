// Mirrors supabase/functions/_shared/albumTokens.ts's hashToken() exactly (same
// SHA-256 algorithm, same hex encoding) -- used client-side when the admin/
// album_manager UI mints a new couple-portal link or print-shop access link. The RAW
// token is only ever shown to the studio user once, right after generation; only its
// hash is ever sent to the DB (album_orders.portal_token_hash /
// print_access_links.token_hash), matching CLAUDE.md's "never store a raw token"
// rule for this module.

export function generateRawToken() {
  // 2x UUIDv4 concatenated (no dashes) -- 64 hex chars of randomness, plenty for a
  // bearer-token-style public link, generated via the browser's crypto API.
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export async function hashToken(raw) {
  const data = new TextEncoder().encode(raw);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
