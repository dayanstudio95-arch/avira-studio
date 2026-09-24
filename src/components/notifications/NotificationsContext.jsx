import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { usePermission } from "@/lib/permissions";
import { unreadCountsByRoute, unreadNotificationsForRoute } from "@/lib/notificationCategories";

// One shared notification list for the whole shell (2026-09-24).
//
// Until now NotificationBell polled on its own — and it is rendered twice (sidebar +
// mobile header), so two polls. The menu badges need the same rows, so the list moved
// up here: one 30s poll, and the bell, the menu and "visiting a page marks its news as
// read" all look at the same state. The badges and the bell can therefore never
// disagree, which is the whole point — a "1" next to לידים that the bell does not know
// about would be exactly the kind of lie this app keeps having to be cured of.
//
// Admin-only, like the notifications table's RLS: for any other role this provides an
// empty list and never polls.

const NotificationsContext = createContext(null);

const EMPTY = { notifications: [], unreadCount: 0, countsByRoute: {}, markAsRead: async () => {}, markAllAsRead: async () => {}, markRouteAsRead: async () => {} };

export function NotificationsProvider({ children }) {
  const { isAdmin } = usePermission();
  const [notifications, setNotifications] = useState([]);

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

  // Optimistic: the badge disappears now; the write follows. On failure the next poll
  // brings the row back unread, which is the honest outcome.
  const markMany = useCallback(async (rows) => {
    const unread = (rows || []).filter((n) => n && !n.isRead);
    if (unread.length === 0) return;
    const ids = new Set(unread.map((n) => n.id));
    setNotifications((prev) => prev.map((n) => (ids.has(n.id) ? { ...n, isRead: true } : n)));
    const readAt = new Date().toISOString();
    try {
      await Promise.all(unread.map((n) => base44.entities.Notification.update(n.id, { isRead: true, readAt })));
    } catch (e) {
      console.error("Error marking notifications as read:", e);
    }
  }, []);

  const markAsRead = useCallback((n) => markMany([n]), [markMany]);
  const markAllAsRead = useCallback(() => markMany(notifications), [markMany, notifications]);
  const markRouteAsRead = useCallback(
    (route) => markMany(unreadNotificationsForRoute(notifications, route)),
    [markMany, notifications]
  );

  const value = useMemo(() => {
    if (!isAdmin) return EMPTY;
    return {
      notifications,
      unreadCount: notifications.filter((n) => !n.isRead).length,
      countsByRoute: unreadCountsByRoute(notifications),
      markAsRead,
      markAllAsRead,
      markRouteAsRead,
    };
  }, [isAdmin, notifications, markAsRead, markAllAsRead, markRouteAsRead]);

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationsContext) || EMPTY;
}
