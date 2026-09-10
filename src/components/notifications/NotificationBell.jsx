import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { usePermission } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, FileCheck, CheckCheck, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { he } from "date-fns/locale";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

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
// Follows the same 30s-polling convention already established by
// WhatsAppPanel.jsx — this codebase has no Supabase Realtime usage yet.

const TYPE_ICONS = {
  contract_signed: FileCheck,
};

// Written by monthly-events-backup/index.ts and contract-signed-webhook/index.ts.
// Anything ending in _failed gets the same treatment, so a future job that reports a
// failure is legible here without touching this file.
const isFailure = (type) => typeof type === "string" && type.endsWith("_failed");

export default function NotificationBell() {
  const { isAdmin } = usePermission();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const rows = await base44.entities.Notification.list("-createdAt", 30);
      setNotifications(rows || []);
    } catch (e) {
      console.error("Error loading notifications:", e);
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [isAdmin, load]);

  if (!isAdmin) return null;

  const markAsRead = async (notification) => {
    if (notification.isRead) return;
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n))
    );
    try {
      await base44.entities.Notification.update(notification.id, {
        isRead: true,
        readAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Error marking notification as read:", e);
    }
  };

  const markAllAsRead = async () => {
    const unread = notifications.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    setLoading(true);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await Promise.all(
        unread.map((n) =>
          base44.entities.Notification.update(n.id, { isRead: true, readAt: new Date().toISOString() })
        )
      );
    } catch (e) {
      console.error("Error marking all notifications as read:", e);
    }
    setLoading(false);
  };

  const handleClick = (notification) => {
    markAsRead(notification);
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
      <PopoverContent align="end" className="w-80 bg-gray-900 border-gray-700 text-white p-0" dir="rtl">
        <div className="flex items-center justify-between p-3 border-b border-gray-800">
          <span className="font-semibold text-sm">התראות</span>
          {unreadCount > 0 && (
            <button
              onClick={markAllAsRead}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-yellow-400 disabled:opacity-50"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              סמן הכל כנקרא
            </button>
          )}
        </div>
        {/* Plain scrollable div instead of the shadcn ScrollArea -- matches the
            established pattern used by every other popover-nested scrollable
            list in this codebase (StaffAssignmentRoleList.jsx,
            EventsTableWithBulkDelete.jsx): Radix's ScrollArea wraps native
            overflow in its own custom scrollbar/viewport handling, which was
            unreliable for touch-scrolling on mobile here, whereas a plain
            overflow-y-auto div + WebkitOverflowScrolling works reliably and
            lets the user actually scroll through the full notification list
            instead of it just being clipped at a fixed height. */}
        <div
          className="max-h-[70vh] overflow-y-auto"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {notifications.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">אין התראות</p>
          ) : (
            <div className="divide-y divide-gray-800">
              {notifications.map((n) => {
                const failed = isFailure(n.type);
                const Icon = failed ? AlertTriangle : (TYPE_ICONS[n.type] || Bell);
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-right p-3 flex items-start gap-2 hover:bg-gray-800/60 transition-colors ${
                      !n.isRead ? "bg-blue-500/10" : ""
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 mt-0.5 shrink-0 ${failed ? "text-red-400" : "text-yellow-400"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!n.isRead ? "font-semibold text-white" : "text-gray-300"}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-gray-500 mt-0.5">{n.body}</p>}
                      <p className="text-[10px] text-gray-600 mt-1">
                        {n.createdAt ? format(new Date(n.createdAt), "d בMMMM, HH:mm", { locale: he }) : ""}
                      </p>
                    </div>
                    {!n.isRead && <span className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
