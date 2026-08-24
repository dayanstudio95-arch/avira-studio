// Client-side convenience cache for the couple portal link's RAW token, keyed per
// album order. The DB only ever stores a one-way hash (album_orders.portal_token_hash
// — see CLAUDE.md's Wedding Albums module security rules), so this is the only place
// the raw token can persist across a page refresh/navigation, and only in this browser.
const PREFIX = "album_portal_token:";

export function saveCachedPortalToken(orderId, raw) {
  try {
    localStorage.setItem(`${PREFIX}${orderId}`, raw);
  } catch {
    // private browsing / storage quota — silently skip caching
  }
}

export function getCachedPortalTokenRaw(orderId) {
  try {
    return localStorage.getItem(`${PREFIX}${orderId}`);
  } catch {
    return null;
  }
}

export function clearCachedPortalToken(orderId) {
  try {
    localStorage.removeItem(`${PREFIX}${orderId}`);
  } catch {
    // ignore
  }
}
