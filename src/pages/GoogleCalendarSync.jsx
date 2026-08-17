import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
const { GoogleCalendarAccount, EventCalendarSync, Event } = base44.entities;
import GoogleCalendarAccountCard from "@/components/settings/GoogleCalendarAccountCard";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Calendar, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

// Dedicated page for Google Calendar: connect/manage the two account slots
// (primary + backup), see sync health, and manually control failed syncs —
// requested explicitly by the user alongside real-time dual-account sync.
export default function GoogleCalendarSync() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState([]);
  const [syncRows, setSyncRows] = useState([]);
  const [events, setEvents] = useState({}); // eventId -> event
  const [isLoading, setIsLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);
  const [reconciling, setReconciling] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [accountsData, syncData] = await Promise.all([
        GoogleCalendarAccount.list(),
        EventCalendarSync.list("-updated_date", 500),
      ]);
      setAccounts(accountsData || []);
      setSyncRows(syncData || []);

      const failedEventIds = [...new Set((syncData || []).filter((s) => s.status === "failed").map((s) => s.eventId))];
      if (failedEventIds.length > 0) {
        const eventsData = await Event.filter({ id: { $in: failedEventIds } });
        const map = {};
        (eventsData || []).forEach((e) => { map[e.id] = e; });
        setEvents(map);
      } else {
        setEvents({});
      }
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

  const statusCounts = { success: 0, failed: 0, pending: 0, deleted: 0 };
  syncRows.forEach((s) => { if (statusCounts[s.status] !== undefined) statusCounts[s.status]++; });

  const failedRows = syncRows.filter((s) => s.status === "failed");

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
      const res = await base44.functions.invoke("reconcileCalendarSync", {});
      const processed = res.data?.processed ?? 0;
      toast.success(`הרצת סנכרון הושלמה — טופלו ${processed} אירועים`);
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
        <Button
          onClick={handleReconcileNow}
          disabled={reconciling}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
        >
          {reconciling ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          סנכרן הכל עכשיו
        </Button>
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
            <h2 className="text-white font-semibold mb-4">בריאות סנכרון</h2>
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
                      const event = events[row.eventId];
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
        </div>
      )}
    </div>
  );
}
