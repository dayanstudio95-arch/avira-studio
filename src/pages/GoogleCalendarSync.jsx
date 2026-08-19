import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
const { GoogleCalendarAccount, EventCalendarSync, Event } = base44.entities;
import GoogleCalendarAccountCard from "@/components/settings/GoogleCalendarAccountCard";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, Calendar, CheckCircle2, XCircle, Clock, Send, ListChecks, CalendarSync } from "lucide-react";
import { toast } from "sonner";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

// Dedicated page for Google Calendar: connect/manage the two account slots
// (primary + backup), see sync health, and manually control failed syncs —
// requested explicitly by the user alongside real-time dual-account sync.
//
// Also renders a full "all events in the system" table (not just the ones
// with a sync problem) so the user can see at a glance which events are
// green (synced) vs red (not synced / failed) — and lets them select any
// subset of already-synced events to manually trigger a Google Calendar
// crew invite for, independent of syncing itself. Syncing an event
// (sync-event-to-calendar / reconcile-calendar-sync, see
// _shared/googleCalendarSync.ts's pushEventToAccount) never emails
// attendees — the `sendUpdates` query param is deliberately left empty —
// so "sync everything" and "invite the crew" are already two fully
// separate actions; this page just exposes the second one as an explicit,
// selectable, manual step instead of it happening implicitly per-assignment
// (as it still does automatically in EventsTableWithBulkDelete.jsx).
export default function GoogleCalendarSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [syncRows, setSyncRows] = useState([]);
  const [allEvents, setAllEvents] = useState([]); // every event in the tenant
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState(() => new Set());
  const [sendingInvites, setSendingInvites] = useState(false);

  // "סנכרן אירועים" (sync-by-month) dialog: pick a month+year, then choose
  // whether to sync-only or sync-and-invite-crew for every event in range.
  const now = new Date();
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncMonth, setSyncMonth] = useState(now.getMonth() + 1);
  const [syncYear, setSyncYear] = useState(now.getFullYear());
  const [syncRunning, setSyncRunning] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsData, syncData, eventsData] = await Promise.all([
        GoogleCalendarAccount.list(),
        EventCalendarSync.list("-updated_date", 10000),
        Event.list("-date", 10000),
      ]);
      setAccounts(accountsData || []);
      setSyncRows(syncData || []);
      setAllEvents(eventsData || []);
    } catch (e) {
      toast.error("שגיאה בטעינת נתוני היומן: " + e.message);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Handle the redirect back from Google (see google-calendar-oauth-callback)
  useEffect(() => {
    const connected = searchParams.get("connected");
    const error = searchParams.get("error");
    if (connected) {
      toast.success(`${connected === "primary" ? "החשבון הראשי" : "חשבון הגיבוי"} חובר בהצלחה ✅`);
      setSearchParams({}, { replace: true });
      loadData();
    } else if (error) {
      toast.error("שגיאה בחיבור: " + error);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const primaryAccount = accounts.find((a) => a.accountRole === "primary") || null;
  const backupAccount = accounts.find((a) => a.accountRole === "backup") || null;
  const connectedRoles = accounts.filter((a) => a.status === "connected").map((a) => a.accountRole);

  const statusCounts = { success: 0, failed: 0, pending: 0, deleted: 0 };
  syncRows.forEach((s) => { if (statusCounts[s.status] !== undefined) statusCounts[s.status]++; });

  const eventsMap = useMemo(() => {
    const map = {};
    allEvents.forEach((e) => { map[e.id] = e; });
    return map;
  }, [allEvents]);

  // eventId -> { primary: syncRow, backup: syncRow }
  const syncByEvent = useMemo(() => {
    const map = {};
    syncRows.forEach((row) => {
      if (!map[row.eventId]) map[row.eventId] = {};
      map[row.eventId][row.accountRole] = row;
    });
    return map;
  }, [syncRows]);

  const failedRows = syncRows.filter((s) => s.status === "failed");

  // An event counts as "fully synced" when every currently-connected account
  // has a successful sync row for it.
  const fullySyncedCount = useMemo(() => {
    if (connectedRoles.length === 0) return 0;
    return allEvents.filter((e) =>
      connectedRoles.every((role) => syncByEvent[e.id]?.[role]?.status === "success")
    ).length;
  }, [allEvents, connectedRoles, syncByEvent]);

  const isEventSyncedToPrimary = (event) =>
    !!event.googleCalendarEventId && !String(event.googleCalendarEventId).startsWith("creating_");

  const selectableEventIds = useMemo(
    () => allEvents.filter(isEventSyncedToPrimary).map((e) => e.id),
    [allEvents]
  );
  const allSelected = selectableEventIds.length > 0 && selectableEventIds.every((id) => selectedEventIds.has(id));

  const toggleEventSelection = (eventId) => {
    setSelectedEventIds((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedEventIds(allSelected ? new Set() : new Set(selectableEventIds));
  };

  const handleSendInvites = async () => {
    const ids = Array.from(selectedEventIds);
    if (ids.length === 0) return;
    setSendingInvites(true);
    let successCount = 0, failCount = 0, skippedCount = 0;
    try {
      for (const eventId of ids) {
        const event = eventsMap[eventId];
        if (!event) { failCount++; continue; }
        const teamMembers = (event.team || []).filter((m) => m.staffMemberName && m.role !== "editor");
        if (teamMembers.length === 0) { skippedCount++; continue; }
        const results = await Promise.allSettled(
          teamMembers.map((m) => base44.functions.invoke("sendStaffInvite", { eventId, staffName: m.staffMemberName }))
        );
        results.forEach((r) => {
          if (r.status === "fulfilled" && !r.value?.data?.error) successCount++;
          else failCount++;
        });
      }
      const parts = [`נשלחו ${successCount} זימונים בהצלחה`];
      if (failCount > 0) parts.push(`${failCount} נכשלו`);
      if (skippedCount > 0) parts.push(`${skippedCount} אירועים ללא צוות לזימון`);
      if (successCount > 0) toast.success(parts.join(", "));
      else toast.warning(parts.join(", "));
      setSelectedEventIds(new Set());
      await loadData();
    } catch (e) {
      toast.error("שגיאה בשליחת זימונים: " + e.message);
    }
    setSendingInvites(false);
  };

  const eventsInSelectedMonth = useMemo(() => {
    return allEvents.filter((e) => {
      if (!e.date) return false;
      const d = new Date(e.date);
      return d.getMonth() + 1 === syncMonth && d.getFullYear() === syncYear;
    });
  }, [allEvents, syncMonth, syncYear]);

  // Runs a real sync-event-to-calendar call (force re-sync, regardless of
  // current status — same call the "נסה שוב" retry button uses) for every
  // event in the chosen month/year, and optionally also sends a crew
  // calendar invite right after each successful sync — same per-member
  // invite logic as handleSendInvites above, just automatically for the
  // whole month instead of a manual checkbox selection.
  const handleRunMonthSync = async (withInvites) => {
    const targets = eventsInSelectedMonth;
    if (targets.length === 0) {
      toast.warning("לא נמצאו אירועים בחודש/שנה שנבחרו");
      return;
    }
    setSyncRunning(true);
    let syncSuccess = 0, syncFail = 0, inviteSuccess = 0, inviteFail = 0, inviteSkipped = 0;
    try {
      for (const event of targets) {
        let syncOk = false;
        try {
          const res = await base44.functions.invoke("syncEventToCalendar", { eventId: event.id });
          syncOk = !!res.data?.success;
          if (syncOk) syncSuccess++; else syncFail++;
        } catch {
          syncFail++;
        }
        if (withInvites && syncOk) {
          const teamMembers = (event.team || []).filter((m) => m.staffMemberName && m.role !== "editor");
          if (teamMembers.length === 0) {
            inviteSkipped++;
          } else {
            const results = await Promise.allSettled(
              teamMembers.map((m) => base44.functions.invoke("sendStaffInvite", { eventId: event.id, staffName: m.staffMemberName }))
            );
            results.forEach((r) => {
              if (r.status === "fulfilled" && !r.value?.data?.error) inviteSuccess++;
              else inviteFail++;
            });
          }
        }
      }
      const parts = [`סונכרנו ${syncSuccess} מתוך ${targets.length} אירועים`];
      if (syncFail > 0) parts.push(`${syncFail} נכשלו`);
      if (withInvites) {
        parts.push(`נשלחו ${inviteSuccess} זימוני צוות`);
        if (inviteFail > 0) parts.push(`${inviteFail} זימונים נכשלו`);
        if (inviteSkipped > 0) parts.push(`${inviteSkipped} אירועים ללא צוות`);
      }
      if (syncFail === 0) toast.success(parts.join(", "));
      else toast.warning(parts.join(", "));
      setSyncDialogOpen(false);
      await loadData();
    } catch (e) {
      toast.error("שגיאה בסנכרון: " + e.message);
    }
    setSyncRunning(false);
  };

  const handleRetry = async (eventId) => {
    setRetryingId(eventId);
    try {
      const res = await base44.functions.invoke("syncEventToCalendar", { eventId });
      if (res.data?.success) {
        toast.success("הסנכרון בוצע בהצלחה");
      } else {
        toast.error("הסנכרון נכשל שוב — בדוק את הודעת השגיאה");
      }
      await loadData();
    } catch (e) {
      toast.error("שגיאה בניסיון הסנכרון: " + e.message);
    }
    setRetryingId(null);
  };

  const handleReconcileNow = async () => {
    setReconciling(true);
    try {
      // The backend now processes as many candidates as it can within its own
      // time budget per call instead of a fixed 50-item cap, but a very large
      // backlog (e.g. right after connecting a new backup account with 200+
      // pre-existing events) can still take more than one call to fully
      // clear. Keep calling until the server reports nothing left, so one
      // click of this button always finishes the whole backlog.
      let totalProcessed = 0;
      let remaining = null;
      let round = 0;
      const MAX_ROUNDS = 10; // safety ceiling — avoids ever looping forever
      do {
        round++;
        const res = await base44.functions.invoke("reconcileCalendarSync", {});
        const processed = res.data?.processed ?? 0;
        remaining = res.data?.remaining ?? 0;
        totalProcessed += processed;
        if (remaining > 0 && round < MAX_ROUNDS) {
          toast.message(`טופלו ${processed} אירועים, ממשיך לנקות את היתרה (${remaining} נותרו)...`);
        }
      } while (remaining > 0 && round < MAX_ROUNDS);

      if (remaining > 0) {
        toast.warning(`טופלו ${totalProcessed} אירועים בסך הכל — נותרו עוד ${remaining}, לחצו שוב כדי להמשיך`);
      } else {
        toast.success(`הרצת סנכרון הושלמה — טופלו ${totalProcessed} אירועים, הכל מסונכרן`);
      }
      await loadData();
    } catch (e) {
      toast.error("שגיאה בהרצת הסנכרון: " + e.message);
    }
    setReconciling(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="mb-8 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-white flex items-center gap-2">
            <Calendar className="w-8 h-8 text-blue-400" />
            יומן Google
          </h1>
          <p className="text-gray-400 mt-1 text-sm">חיבור חשבונות, בריאות סנכרון ושליטה ידנית</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          onClick={() => setSyncDialogOpen(true)}
          className="border-gray-700 text-gray-200 hover:bg-gray-800 gap-1.5"
        >
          <CalendarSync className="w-4 h-4" />
          סנכרן אירועים
        </Button>
        <Button
          onClick={handleReconcileNow}
          disabled={reconciling}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
        >
          {reconciling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          סנכרן הכל עכשיו
        </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Account cards */}
          <div className="grid md:grid-cols-2 gap-4">
            <GoogleCalendarAccountCard accountRole="primary" account={primaryAccount} onChanged={loadData} />
            <GoogleCalendarAccountCard accountRole="backup" account={backupAccount} onChanged={loadData} />
          </div>

          {/* Sync health summary */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
              <h2 className="text-white font-semibold">בריאות סנכרון</h2>
              {connectedRoles.length > 0 && (
                <div className="text-sm text-gray-300">
                  <span className={`font-bold ${fullySyncedCount === allEvents.length ? "text-green-400" : "text-yellow-400"}`}>
                    {fullySyncedCount}
                  </span>
                  {" "}מתוך <span className="font-bold text-white">{allEvents.length}</span> אירועים מסונכרנים במלואם
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <div>
                  <div className="text-green-300 font-semibold">{statusCounts.success}</div>
                  <div className="text-xs text-gray-400">הצליחו</div>
                </div>
              </div>
              <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-3 flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-400" />
                <div>
                  <div className="text-red-300 font-semibold">{statusCounts.failed}</div>
                  <div className="text-xs text-gray-400">נכשלו</div>
                </div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-gray-300 font-semibold">{statusCounts.pending}</div>
                  <div className="text-xs text-gray-400">ממתינים</div>
                </div>
              </div>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <div>
                  <div className="text-gray-300 font-semibold">{syncRows.length}</div>
                  <div className="text-xs text-gray-400">סה״כ רשומות</div>
                </div>
              </div>
            </div>
          </div>

          {/* Failed events table */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <h2 className="text-white font-semibold mb-4">אירועים עם בעיית סנכרון</h2>
            {failedRows.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">אין אירועים עם בעיית סנכרון כרגע 🎉</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="py-2 px-2 font-medium">זוג</th>
                      <th className="py-2 px-2 font-medium">תאריך</th>
                      <th className="py-2 px-2 font-medium">חשבון</th>
                      <th className="py-2 px-2 font-medium">שגיאה</th>
                      <th className="py-2 px-2 font-medium"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {failedRows.map((row) => {
                      const event = eventsMap[row.eventId];
                      return (
                        <tr key={row.id} className="border-b border-gray-800/50">
                          <td className="py-2 px-2 text-white">{event?.coupleNames || row.eventId}</td>
                          <td className="py-2 px-2 text-gray-400">
                            {event?.date ? new Date(event.date).toLocaleDateString("he-IL") : "—"}
                          </td>
                          <td className="py-2 px-2 text-gray-400">{row.accountRole === "primary" ? "ראשי" : "גיבוי"}</td>
                          <td className="py-2 px-2 text-red-300 max-w-xs truncate" title={row.lastError}>
                            {row.lastError || "—"}
                          </td>
                          <td className="py-2 px-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retryingId === row.eventId}
                              onClick={() => handleRetry(row.eventId)}
                              className="border-gray-700 text-gray-300 hover:bg-gray-800 gap-1.5"
                            >
                              {retryingId === row.eventId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <RefreshCw className="w-3.5 h-3.5" />
                              )}
                              נסה שוב
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* All events — full sync status per event, with selectable checkboxes
              for manually triggering crew calendar invites separately from sync */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-blue-400" />
                כל האירועים במערכת ({allEvents.length})
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                {selectedEventIds.size > 0 && (
                  <span className="text-xs text-gray-400">{selectedEventIds.size} נבחרו</span>
                )}
                <Button
                  size="sm"
                  onClick={handleSendInvites}
                  disabled={sendingInvites || selectedEventIds.size === 0}
                  className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
                >
                  {sendingInvites ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  שלח זימון יומן לצוות ({selectedEventIds.size})
                </Button>
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              סימון תיבה מאפשר בחירת אירועים (רק כאלה שכבר סונכרנו ליומן הראשי) ושליחת זימון יומן (מייל) לחברי הצוות שלהם —
              בנפרד לגמרי מהסנכרון עצמו, שלעולם לא שולח זימון אוטומטית.
            </p>
            {allEvents.length === 0 ? (
              <p className="text-gray-500 text-sm py-4 text-center">אין אירועים במערכת</p>
            ) : (
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm text-right">
                  <thead className="sticky top-0 bg-gray-900">
                    <tr className="border-b border-gray-800 text-gray-400">
                      <th className="py-2 px-2 font-medium">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                          disabled={selectableEventIds.length === 0}
                        />
                      </th>
                      <th className="py-2 px-2 font-medium">זוג</th>
                      <th className="py-2 px-2 font-medium">תאריך</th>
                      <th className="py-2 px-2 font-medium">חשבון ראשי</th>
                      <th className="py-2 px-2 font-medium">חשבון גיבוי</th>
                      <th className="py-2 px-2 font-medium">זימוני צוות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allEvents.map((event) => {
                      const primaryRow = syncByEvent[event.id]?.primary;
                      const backupRow = syncByEvent[event.id]?.backup;
                      const canSelect = isEventSyncedToPrimary(event);
                      const nonEditorTeam = (event.team || []).filter((m) => m.staffMemberName && m.role !== "editor");
                      const invitedCount = nonEditorTeam.filter((m) => m.calendarStatus).length;
                      return (
                        <tr key={event.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="py-2 px-2">
                            <Checkbox
                              checked={selectedEventIds.has(event.id)}
                              onCheckedChange={() => toggleEventSelection(event.id)}
                              disabled={!canSelect}
                              title={!canSelect ? "יש לסנכרן ליומן קודם" : undefined}
                            />
                          </td>
                          <td className="py-2 px-2 text-white">{event.coupleNames || "—"}</td>
                          <td className="py-2 px-2 text-gray-400">
                            {event.date ? new Date(event.date).toLocaleDateString("he-IL") : "—"}
                          </td>
                          <td className="py-2 px-2">
                            <SyncStatusBadge connected={connectedRoles.includes("primary")} row={primaryRow} />
                          </td>
                          <td className="py-2 px-2">
                            <SyncStatusBadge connected={connectedRoles.includes("backup")} row={backupRow} />
                          </td>
                          <td className="py-2 px-2">
                            {nonEditorTeam.length === 0 ? (
                              <span className="text-gray-600 text-xs">אין צוות</span>
                            ) : (
                              <span className={`text-xs font-medium ${invitedCount === nonEditorTeam.length ? "text-green-400" : invitedCount > 0 ? "text-yellow-400" : "text-gray-500"}`}>
                                {invitedCount}/{nonEditorTeam.length} זומנו
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sync-by-month dialog */}
      <Dialog open={syncDialogOpen} onOpenChange={(open) => { if (!syncRunning) setSyncDialogOpen(open); }}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white">סנכרן אירועים לפי חודש</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">חודש</label>
                <Select value={String(syncMonth)} onValueChange={(v) => setSyncMonth(Number(v))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {HEBREW_MONTHS.map((label, idx) => (
                      <SelectItem key={idx + 1} value={String(idx + 1)}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">שנה</label>
                <Select value={String(syncYear)} onValueChange={(v) => setSyncYear(Number(v))}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {Array.from({ length: 6 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-gray-400">
              נמצאו <span className="text-white font-semibold">{eventsInSelectedMonth.length}</span> אירועים ב-{HEBREW_MONTHS[syncMonth - 1]} {syncYear}
            </p>
            <p className="text-xs text-gray-500">
              בחר אם לסנכרן את האירועים האלה ליומן Google בלבד, או לסנכרן ולשלוח מיד גם זימון יומן (מייל) לכל חברי הצוות המשויכים בהם (לא כולל עורך).
            </p>
          </div>
          <DialogFooter className="flex-col sm:flex-col gap-2">
            <Button
              onClick={() => handleRunMonthSync(true)}
              disabled={syncRunning || eventsInSelectedMonth.length === 0}
              className="w-full bg-green-600 hover:bg-green-700 text-white gap-1.5"
            >
              {syncRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              סנכרן ושלח זימון לצוות
            </Button>
            <Button
              onClick={() => handleRunMonthSync(false)}
              disabled={syncRunning || eventsInSelectedMonth.length === 0}
              variant="outline"
              className="w-full border-gray-700 text-gray-200 hover:bg-gray-800 gap-1.5"
            >
              {syncRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              סנכרן בלבד (ללא זימון)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SyncStatusBadge({ connected, row }) {
  if (!connected) {
    return <span className="text-gray-600 text-xs">לא מחובר</span>;
  }
  const status = row?.status;
  if (status === "success") {
    return (
      <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
        <CheckCircle2 className="w-3.5 h-3.5" /> מסונכרן
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-medium">
        <Clock className="w-3.5 h-3.5" /> ממתין
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-red-400 text-xs font-medium" title={row?.lastError}>
        <XCircle className="w-3.5 h-3.5" /> נכשל
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-400 text-xs font-medium">
      <XCircle className="w-3.5 h-3.5" /> לא סונכרן
    </span>
  );
}
