// Client-side convenience cache for the print-shop access link's RAW token, keyed per
// album order. The DB only ever stores a one-way hash (print_access_links.token_hash --
// see CLAUDE.md's Wedding Albums module security rules), so this is the only place the
// raw token can persist across a page refresh/navigation, and only in this browser.
//
// Stores {linkId, raw} together (not just raw) because print links aren't singular like
// the couple portal link -- print_access_links intentionally allows multiple simultaneous
// links per order (e.g. reprints, see 0031_wedding_albums.sql). Caching the pair lets the
// caller verify, on reload, that the cached raw token still corresponds to a specific,
// still-valid (non-revoked) row before trusting it, instead of blindly trusting "some"
// cached token for the order.
const PREFIX = "album_print_token:";

export function saveCachedPrintToken(orderId, linkId, raw) {
  try {
    localStorage.setItem(`${PREFIX}${orderId}`, JSON.stringify({ linkId, raw }));
  } catch {
    // private browsing / storage quota — silently skip caching
  }
}

export function getCachedPrintToken(orderId) {
  try {
    const stored = localStorage.getItem(`${PREFIX}${orderId}`);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

export function clearCachedPrintToken(orderId) {
  try {
    localStorage.removeItem(`${PREFIX}${orderId}`);
  } catch {
    // ignore
  }
}
