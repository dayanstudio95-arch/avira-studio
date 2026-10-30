// The couple's portal link for a reminder (2026-10-29). Only the token's hash is stored
// (CLAUDE.md, albums security), so the link can only be re-sent when this browser still
// holds the raw token for the CURRENT hash (albumPortalTokenCache). Otherwise a new link is
// made — the owner's choice — which replaces the old one; the couple's comments stay, they
// belong to the order, not to the link. If the message then fails, restorePortalLink puts the
// old link back, so a failed send never leaves the couple with a dead link.
import { base44 } from "@/api/base44Client";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { getCachedPortalTokenRaw, saveCachedPortalToken, clearCachedPortalToken } from "@/lib/albumPortalTokenCache";
import { filmsApi, filmsConfigured } from "@/lib/filmsApi";

const urlFor = (raw) => `${window.location.origin}/album/${raw}`;

export async function ensurePortalLink(order) {
  const cached = getCachedPortalTokenRaw(order.id);
  if (cached && order.portalTokenHash && !order.portalTokenRevokedAt && (await hashToken(cached)) === order.portalTokenHash) {
    return { url: urlFor(cached), minted: false };
  }
  // An album the couple designed in their photo gallery (2026-10-30): its order link is derived from the gallery (the
  // gallery Worker, migration 0096), and the gallery's "להמשך ההזמנה" button uses that same link. A new link here
  // would replace it and break that button — so ask the Worker for the couple's link instead, and never make one.
  if (order.source === "couple_designer" && order.filmsGalleryId && filmsConfigured()) {
    const a = await filmsApi("GET", `/api/admin/galleries/${order.filmsGalleryId}/album`);
    const url = a?.order?.coupleLink;
    if (!url) throw new Error("לא הצלחנו לקבל מהגלריה את הקישור של הזוג להזמנה");
    return { url, minted: false };
  }
  const raw = generateRawToken();
  await base44.entities.AlbumOrder.update(order.id, { portalTokenHash: await hashToken(raw), portalTokenRevokedAt: null });
  saveCachedPortalToken(order.id, raw);
  return { url: urlFor(raw), minted: true, previous: { hash: order.portalTokenHash || null, revokedAt: order.portalTokenRevokedAt || null, cached } };
}

export async function restorePortalLink(order, previous) {
  if (!previous) return;
  await base44.entities.AlbumOrder.update(order.id, { portalTokenHash: previous.hash, portalTokenRevokedAt: previous.revokedAt });
  if (previous.cached) saveCachedPortalToken(order.id, previous.cached);
  else clearCachedPortalToken(order.id);
}
