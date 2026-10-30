// The galleries summary at the top of the studio's galleries page (and a card on the hub's
// dashboard): what needs attention today, in one request. Ported from the Avira films app's
// worker/dashboard.ts (2026-09-27). Album orders and their payments live in the hub (crm module),
// which reads them itself. Fix plan P70: computed by the database (films_dashboard, 0133) instead of
// reading every gallery (PostgREST answers at most 1,000 rows); summaryFrom is the same rule for
// MemoryStore, and the store contract test checks the two agree.
import { daysLeft, isExpired, kindOf } from './galleries';
import type { GalleriesSummary, GalleryBrief, Store } from './store';
import type { Gallery } from './types';

export type { GalleryBrief } from './store';

const brief = (g: Gallery, now: number): GalleryBrief => ({
  id: g.id,
  coupleName: g.coupleName,
  kind: kindOf(g),
  date: g.date,
  daysLeft: daysLeft(g, now),
  views: g.views,
  downloads: g.downloads,
  expiresAt: g.expiresAt,
});

/** Only galleries of the modules the studio has (`kinds`), never those in the trash. */
export function dashboard(store: Store, tenantId: string, kinds: { films: boolean; photos: boolean }): Promise<GalleriesSummary> {
  return store.galleriesSummary(tenantId, kinds);
}

/**
 * The summary from the studio's galleries (newest first) and its sent albums — films_dashboard's rule:
 * ties in time keep the newest gallery first.
 */
export function summaryFrom(
  all: Gallery[],
  sent: { galleryId: string; submittedAt: string }[],
  kinds: { films: boolean; photos: boolean },
  now = Date.now(),
): GalleriesSummary {
  const newest = [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const mine = newest.filter((g) => !g.deletedAt && kinds[kindOf(g)]);
  const open = mine.filter((g) => !isExpired(g, now));
  const closing = open
    .filter((g) => daysLeft(g, now) <= 7)
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(0, 12)
    .map((g) => brief(g, now));
  const mostViewed = [...open]
    .filter((g) => g.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 5)
    .map((g) => brief(g, now));
  const byId = new Map(mine.map((g) => [g.id, g]));
  const albumsSent = kinds.photos
    ? sent
        .filter((a) => byId.has(a.galleryId))
        .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || '') || a.galleryId.localeCompare(b.galleryId))
        .sort((a, b) => Number(!a.submittedAt) - Number(!b.submittedAt))
        .slice(0, 10)
        .map((a) => ({ galleryId: a.galleryId, coupleName: byId.get(a.galleryId)!.coupleName, submittedAt: a.submittedAt }))
    : [];
  return {
    open: open.length,
    closed: mine.length - open.length,
    trash: newest.filter((g) => g.deletedAt && kinds[kindOf(g)]).length,
    closing,
    mostViewed,
    albumsSent,
  };
}
