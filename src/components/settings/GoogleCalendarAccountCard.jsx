import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
const { GoogleCalendarAccount } = base44.entities;
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Link2, Unlink, CheckCircle2, XCircle, AlertTriangle, Circle, Save } from "lucide-react";
import { toast } from "sonner";

// One connection-status card for a single Google account slot ('primary' or
// 'backup') of the tenant. Reused twice on GoogleCalendarSync.jsx. Mirrors
// WhatsAppPanel.jsx's status-badge pattern but polling is driven by the
// parent page (which also needs the data for the sync-health summary), not
// internally here.
const STATUS_META = {
  connected: { label: "מחובר", color: "green", icon: CheckCircle2 },
  disconnected: { label: "לא מחובר", color: "gray", icon: Circle },
  needs_reauth: { label: "נדרש חיבור מחדש", color: "red", icon: AlertTriangle },
  error: { label: "שגיאה", color: "red", icon: XCircle },
};

const COLOR_CLASSES = {
  green: "bg-green-900/20 border-green-700/40 text-green-400",
  gray: "bg-gray-800/50 border-gray-700 text-gray-400",
  red: "bg-red-900/20 border-red-700/40 text-red-400",
};

export default function GoogleCalendarAccountCard({ accountRole, account, onChanged }) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [calendarIdInput, setCalendarIdInput] = useState(account?.calendarId || "primary");
  const [savingCalendarId, setSavingCalendarId] = useState(false);

  useEffect(() => {
    setCalendarIdInput(account?.calendarId || "primary");
  }, [account?.calendarId]);

  const status = account?.status || "disconnected";
  const meta = STATUS_META[status] || STATUS_META.disconnected;
  const StatusIcon = meta.icon;
  const isConnected = status === "connected";
  const roleLabel = accountRole === "primary" ? "חשבון ראשי" : "חשבון גיבוי";

  const handleSaveCalendarId = async () => {
    if (!account?.id) return;
    setSavingCalendarId(true);
    try {
      await GoogleCalendarAccount.update(account.id, { calendarId: calendarIdInput.trim() || "primary" });
      toast.success("Calendar ID נשמר");
      if (onChanged) onChanged();
    } catch (e) {
      toast.error("שגיאה בשמירת Calendar ID: " + e.message);
    }
    setSavingCalendarId(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await base44.functions.invoke("googleCalendarOAuthStart", { accountRole });
      if (res.data?.authorizeUrl) {
        window.location.href = res.data.authorizeUrl;
      } else {
        toast.error("שגיאה בהתחלת תהליך החיבור");
        setConnecting(false);
      }
    } catch (e) {
      toast.error("שגיאה בהתחלת תהליך החיבור: " + e.message);
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(`לנתק את ה${roleLabel}?`)) return;
    setDisconnecting(true);
    try {
      await base44.functions.invoke("googleCalendarOAuthDisconnect", { accountRole });
      toast.success(`${roleLabel} נותק`);
      if (onChanged) onChanged();
    } catch (e) {
      toast.error("שגיאה בניתוק: " + e.message);
    }
    setDisconnecting(false);
  };

  return (
    <div className="border border-gray-800 rounded-xl p-4 space-y-3 bg-gray-900/50">
      <div className="flex items-center justify-between">
        <div className="text-white font-medium">{roleLabel}</div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${COLOR_CLASSES[meta.color]}`}>
          <StatusIcon className="w-3.5 h-3.5" />
          {meta.label}
        </div>
      </div>

      {account?.googleEmail && (
        <div className="text-sm text-gray-300" dir="ltr">
          {account.googleEmail}
        </div>
      )}

      {isConnected && (
        <div>
          <Label className="text-gray-400 text-xs">Calendar ID (אופציונלי — השאר "primary" ליומן הראשי)</Label>
          <div className="flex gap-2 mt-1">
            <Input
              value={calendarIdInput}
              onChange={(e) => setCalendarIdInput(e.target.value)}
              placeholder="primary"
              className="bg-gray-800 border-gray-700 text-white text-xs h-8"
              dir="ltr"
            />
            <Button
              onClick={handleSaveCalendarId}
              disabled={savingCalendarId || calendarIdInput.trim() === (account?.calendarId || "primary")}
              size="sm"
              variant="outline"
              className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 h-8 px-2.5"
            >
              {savingCalendarId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      )}

      {account?.lastSyncedAt && (
        <div className="text-xs text-gray-500">
          סונכרן לאחרונה: {new Date(account.lastSyncedAt).toLocaleString("he-IL")}
        </div>
      )}

      {account?.lastError && (status === "error" || status === "needs_reauth") && (
        <div className="text-xs text-red-300 bg-red-900/10 border border-red-900/30 rounded-lg p-2 break-words">
          {account.lastError}
        </div>
      )}

      {accountRole === "backup" && !isConnected && (
        <div className="text-xs text-amber-300 bg-amber-900/10 border border-amber-700/30 rounded-lg p-2">
          ⚠️ חשבון הגיבוי חייב להיות חשבון Google <strong>שונה</strong> מהחשבון הראשי. אם כבר מחוברים לחשבון הראשי בדפדפן, לחצו על "השתמש בחשבון אחר" במסך הבחירה של Google.
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {isConnected ? (
          <Button
            onClick={handleDisconnect}
            disabled={disconnecting}
            variant="outline"
            size="sm"
            className="border-red-800 bg-red-950/40 text-red-400 hover:bg-red-900/20 gap-1.5"
          >
            {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlink className="w-3.5 h-3.5" />}
            נתק
          </Button>
        ) : null}
        <Button
          onClick={handleConnect}
          disabled={connecting}
          size="sm"
          className={isConnected ? "bg-gray-800 hover:bg-gray-700 text-white gap-1.5" : "bg-blue-600 hover:bg-blue-700 text-white gap-1.5"}
        >
          {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          {isConnected ? "חבר מחדש" : "חבר חשבון"}
        </Button>
      </div>
    </div>
  );
}
