// Which menu entry a notification "belongs to" (2026-09-24).
//
// The owner asked for a count next to each menu item that has news: "a contract was
// signed → 1 next to לידים; an album update → 1 next to הזמנות אלבומים". The bell
// already holds every notification; this file only says which menu row each type
// lights up. A type that maps to nothing (technical failures, backups) stays in the bell
// alone — a failed backup is not "news on the Payments page".
//
// Keyed by notification.type as written by the Edge Functions / triggers:
//   contract_signed              0026_notifications_trigger.sql
//   whatsapp_hot_lead            _shared/whatsappStudioAlerts.ts
//   album_*                      album-portal/index.ts
//   staff_availability_response  respond-staff-availability-public/index.ts
// A new type is one line here and it appears in the menu; nothing else to touch.
export const NAV_ROUTE_BY_NOTIFICATION_TYPE = {
  contract_signed: "/Leads",
  whatsapp_hot_lead: "/WhatsAppInbox",
  album_round_approved: "/AlbumOrders",
  album_revision_requested: "/AlbumOrders",
  album_transfer_proof_uploaded: "/AlbumOrders",
  staff_availability_response: "/StaffScheduling",
};

export function navRouteForNotification(type) {
  if (typeof type !== "string") return null;
  return NAV_ROUTE_BY_NOTIFICATION_TYPE[type] || null;
}

// { "/Leads": 1, "/AlbumOrders": 2 } — unread only, routes with zero left out.
export function unreadCountsByRoute(notifications) {
  const out = {};
  for (const n of notifications || []) {
    if (n?.isRead) continue;
    const route = navRouteForNotification(n?.type);
    if (!route) continue;
    out[route] = (out[route] || 0) + 1;
  }
  return out;
}

// The unread notifications that a visit to `route` should mark as read.
export function unreadNotificationsForRoute(notifications, route) {
  if (!route) return [];
  return (notifications || []).filter((n) => !n?.isRead && navRouteForNotification(n?.type) === route);
}
