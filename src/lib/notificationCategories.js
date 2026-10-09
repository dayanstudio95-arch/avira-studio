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
//   whatsapp_return_reminder     _shared/whatsappHousekeeping.ts ("מתי לחזור אליהם")
//   album_*                      album-portal/index.ts
//   staff_availability_response  respond-staff-availability-public/index.ts
// A new type is one line here and it appears in the menu; nothing else to touch.
export const NAV_ROUTE_BY_NOTIFICATION_TYPE = {
  contract_signed: "/Leads",
  whatsapp_hot_lead: "/chat", // the merged chat screen (2026-10-07); ChatApp marks these read
  album_round_approved: "/AlbumOrders",
  album_revision_requested: "/AlbumOrders",
  album_transfer_proof_uploaded: "/AlbumOrders",
  album_design_client_edits: "/AlbumOrders",
  staff_availability_response: "/StaffScheduling",
  meeting_reminder: "/Meetings",
  whatsapp_return_reminder: "/chat",
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

// The bell's tabs (2026-10-07, the owner: one long list was too crowded). Pure — PART 38.
export const NOTIFICATION_TABS = [
  { key: "all", label: "הכל", icon: "" },
  { key: "whatsapp", label: "וואטסאפ", icon: "💬" },
  { key: "staff", label: "צוות", icon: "👥" },
  { key: "contracts", label: "חוזים", icon: "✍️" },
  { key: "albums", label: "אלבומים", icon: "📒" },
  { key: "system", label: "מערכת", icon: "⚙️" },
];

export function notificationTab(type) {
  const t = String(type || "");
  if (t.startsWith("whatsapp_")) return "whatsapp";
  if (t.startsWith("staff_")) return "staff";
  if (t.startsWith("contract_")) return "contracts";
  if (t.startsWith("album_")) return "albums";
  return "system"; // backups, failures, meeting reminders, anything new
}

// A small emoji per notification, so the kind reads at a glance.
export function notificationEmoji(type) {
  const t = String(type || "");
  if (t.endsWith("_failed")) return "⚠️";
  if (t === "whatsapp_hot_lead") return "🔥";
  if (t === "whatsapp_opt_out") return "🚫";
  if (t === "meeting_reminder" || t === "whatsapp_return_reminder") return "⏰";
  return NOTIFICATION_TABS.find((x) => x.key === notificationTab(t))?.icon || "🔔";
}

// "היום" / "אתמול" / "קודם" by Israel date.
export function notificationDayGroup(iso, now = new Date()) {
  if (!iso) return "earlier";
  const day = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86400000));
  const d = day(iso);
  return d === today ? "today" : d === yesterday ? "yesterday" : "earlier";
}

// A staff availability answer in the bell (2026-10-09, the owner's request): green when the
// person is free, red when not. The answer is in the title the server writes
// ("<name> פנוי/ה — <couple>" / "<name> לא פנוי/ה — <couple>").
export function availabilityAnswer(n) {
  if (n?.type !== "staff_availability_response") return null;
  const t = String(n.title || "");
  if (t.includes("לא פנוי")) return "declined";
  if (t.includes("פנוי")) return "available";
  return null;
}
