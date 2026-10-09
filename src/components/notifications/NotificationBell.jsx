import React, { useMemo, useState } from "react";
import { usePermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { useNotifications } from "./NotificationsContext";
import { NOTIFICATION_TABS, notificationTab, notificationEmoji, notificationDayGroup, availabilityAnswer } from "@/lib/notificationCategories";

// In-app notifications bell — the one place in the app that reports things nobody
// asked to see. Started as contract-signed only (migration
// 0026_notifications_trigger.sql); it now also carries the FAILURE notifications that
// background jobs write when they cannot reach the studio any other way (a failed
// monthly backup, a contract alert that never made it to WhatsApp). Those are the whole
// reason those jobs stopped answering 200 on failure, so they must be legible AS
// failures here — hence the separate icon and colour below, instead of the same cheerful
// yellow as "a couple just signed!".
// Visible only to owner/admin/studio_manager
// (matches the notifications table's own admin-only RLS — a non-admin role's
// query would just come back empty anyway, but gating in the UI too avoids a
// pointless polling request for roles that can never see anything here).
// Polling (30s, the WhatsAppPanel.jsx convention) moved to NotificationsContext.jsx on
// 2026-09-24, when the menu started showing a per-page count of the same rows.

// The entity layer names created_at "created_date"; read as createdAt it was always empty,
// so no notification ever showed its time (fixed 2026-10-07).
const createdOf = (n) => n.createdAt || n.created_date || null;
const DAY_LABELS = { today: "היום", yesterday: "אתמול", earlier: "קודם" };
const timeOf = (iso, group) => {
  if (!iso) return "";
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  return group === "earlier" ? `${d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" })} · ${hm}` : hm;
};

// Written by monthly-events-backup/index.ts and contract-signed-webhook/index.ts.
// Anything ending in _failed gets the same treatment, so a future job that reports a
// failure is legible here without touching this file.
const isFailure = (type) => typeof type === "string" && type.endsWith("_failed");

export default function NotificationBell() {
  const { isAdmin } = usePermission();
  const navigate = useNavigate();
  // The list itself lives in NotificationsContext (shared with the menu badges, one poll
  // for the whole shell). This component only renders it and forwards clicks.
  const { notifications, unreadCount, markAsRead, markAllAsRead, markMany } = useNotifications();
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  // Tabs by subject (2026-10-07). Opens on the first tab that has something unread.
  const [tab, setTab] = useState("all");

  const unreadByTab = useMemo(() => {
    const out = { all: 0 };
    for (const n of notifications) {
      if (n.isRead) continue;
      out.all += 1;
      const k = notificationTab(n.type);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }, [notifications]);

  const sections = useMemo(() => {
    const list = notifications.filter((n) => tab === "all" || notificationTab(n.type) === tab);
    const out = [];
    for (const n of list) {
      const g = notificationDayGroup(createdOf(n));
      let sec = out.find((x) => x.key === g);
      if (!sec) { sec = { key: g, items: [] }; out.push(sec); }
      sec.items.push(n);
    }
    return out;
  }, [notifications, tab]);

  if (!isAdmin) return null;

  const tabUnread = tab === "all" ? notifications.filter((n) => !n.isRead) : notifications.filter((n) => !n.isRead && notificationTab(n.type) === tab);
  const handleMarkAll = async () => {
    setLoading(true);
    if (tab === "all") await markAllAsRead();
    else await markMany(tabUnread);
    setLoading(false);
  };

  const handleClick = (notification) => {
    markAsRead(notification);
    // A crew member's availability answer opens "📥 תשובות זמינות" on that couple (2026-10-07).
    if (notification.type === "staff_availability_response") {
      setOpen(false);
      navigate(`/StaffScheduling?tab=answers${notification.relatedLeadId ? `&leadId=${notification.relatedLeadId}` : ""}`);
      return;
    }
    if (notification.relatedLeadId) {
      setOpen(false);
      // Reuses the ?openLeadId= deep-link pattern already established by
      // GlobalSearch.jsx -- Leads.jsx picks this query param up once its data
      // has loaded and opens that lead straight in UnifiedSidePanel, instead
      // of just landing on the bare Leads list.
      navigate(`${createPageUrl("Leads")}?openLeadId=${notification.relatedLeadId}`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-gray-400 hover:text-yellow-400 hover:bg-gray-800"
          title="התראות"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -left-1 h-5 min-w-5 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] border-0">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] max-w-[calc(100vw-1rem)] bg-gray-900 border-gray-700 text-white p-0" dir="rtl">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="font-semibold text-sm">התראות</span>
          {tabUnread.length > 0 && (
            <button
              onClick={handleMarkAll}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-yellow-400 disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {tab === "all" ? "סמן הכל כנקרא" : "סמן לשונית כנקראה"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5 border-b border-gray-800 px-3 pb-2.5">
          {NOTIFICATION_TABS.map((t) => {
            const n = unreadByTab[t.key] || 0;
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  on ? "border-yellow-400/70 bg-yellow-400/15 font-semibold text-yellow-200" : "border-gray-700 text-gray-300 hover:text-white"
                }`}
              >
                {t.icon && <span>{t.icon}</span>}
                {t.label}
                {n > 0 && <span className="rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-4 text-white">{n}</span>}
              </button>
            );
          })}
        </div>
        {/* Plain scrollable div instead of the shadcn ScrollArea — touch scrolling inside a
            Radix ScrollArea was unreliable on mobile (see StaffAssignmentRoleList.jsx). */}
        <div className="max-h-[65vh] overflow-y-auto" style={{ WebkitOverflowScrolling: "touch" }}>
          {sections.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">אין התראות כאן</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.key}>
                <div className="sticky top-0 z-10 bg-gray-900/95 px-3 pb-1 pt-2 text-[11px] font-semibold text-gray-400 backdrop-blur">{DAY_LABELS[sec.key]}</div>
                {sec.items.map((n) => {
                  const failed = isFailure(n.type);
                  const answer = availabilityAnswer(n); // "available" → green, "declined" → red
                  const tone = answer === "available"
                    ? "border-r-[3px] border-emerald-500 bg-emerald-500/10"
                    : answer === "declined"
                    ? "border-r-[3px] border-red-500 bg-red-500/10"
                    : !n.isRead ? "bg-blue-500/10" : "";
                  return (
                    <button
                      key={n.id}
                      onClick={() => handleClick(n)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-right transition-colors hover:bg-gray-800/60 ${tone}`}
                    >
                      <span className="mt-0.5 w-5 shrink-0 text-center text-sm">{notificationEmoji(n.type)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className={`truncate text-sm ${failed || answer === "declined" ? "text-red-300" : answer === "available" ? "text-emerald-300" : !n.isRead ? "font-semibold text-white" : "text-gray-300"} ${!n.isRead ? "font-semibold" : ""}`}>{n.title}</p>
                          <span className="shrink-0 text-[10px] text-gray-500 tabular-nums">{timeOf(createdOf(n), sec.key)}</span>
                        </div>
                        {n.body && <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{n.body}</p>}
                      </div>
                      {!n.isRead && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
