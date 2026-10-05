import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, Check, X } from "lucide-react";

// "What is the Green API instance actually set to?" — READ-ONLY (2026-10-05).
//
// Built before anything else in the WhatsApp upgrade because the plan rests on two facts
// nobody had checked: that no other system receives this number's webhooks (an instance
// has exactly one webhook URL), and which notifications are switched on. It calls
// GetSettings, which Green API documents as read-only (no reboot). Nothing on this card
// can change a setting — changes are made by the owner in the Green API console.
const ROWS = [
  ["incoming", "הודעות נכנסות", "חובה — בלי זה דף השיחות לא מקבל כלום"],
  ["outgoingFromPhone", "הודעות שאתה שולח מהטלפון", "חובה — כך הבוט יודע שענית ומשתתק"],
  ["outgoingFromApi", "הודעות שהמערכת שולחת", "חובה — כך הן מופיעות בשיחה"],
  ["deliveryStatus", "סטטוסי מסירה (✓ / ✓✓ / נקרא)", "חדש — מדליקים כדי לראות אם הודעה נמסרה"],
];

export default function WhatsAppSettingsCheck() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke("whatsappManager", { action: "get_settings" });
      if (res.data?.error) throw new Error(res.data.error);
      setData(res.data);
    } catch (e) {
      setError(e?.message || "שגיאה לא ידועה");
    }
    setLoading(false);
  };

  return (
    <div className="border border-gray-700 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-white text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            בדיקת הגדרות ב-Green API
          </div>
          <p className="text-gray-500 text-xs mt-1">קריאה בלבד. לא משנה שום הגדרה ולא מנתק את המספר.</p>
        </div>
        <Button onClick={run} disabled={loading} variant="outline" className="border-gray-600 text-gray-200">
          {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
          {loading ? "בודק..." : "בדוק"}
        </Button>
      </div>

      {error && <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded-lg p-2">{error}</div>}

      {data && (
        <div className="space-y-3 text-sm">
          <div
            className={`rounded-lg border p-3 ${
              data.isOurWebhook ? "border-emerald-700/50 bg-emerald-950/20 text-emerald-200" : "border-amber-700/50 bg-amber-950/20 text-amber-200"
            }`}
          >
            {data.isOurWebhook
              ? "ההודעות מהמספר נשלחות למערכת הזו בלבד."
              : data.webhookHost
              ? `ההודעות נשלחות למערכת אחרת: ${data.webhookHost}. דף השיחות לא יקבל אותן עד שזה ישתנה.`
              : "לא מוגדרת כתובת לקבלת הודעות. דף השיחות לא מקבל כלום."}
            {data.isOurWebhook && !data.hasWebhookToken && (
              <div className="mt-1 text-amber-200">חסר טוקן אבטחה בהגדרות Green API — המערכת תדחה את ההודעות.</div>
            )}
          </div>
          <ul className="space-y-1.5">
            {ROWS.map(([key, label, hint]) => {
              const on = !!data.webhooks?.[key];
              return (
                <li key={key} className="flex items-start gap-2">
                  {on ? <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> : <X className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />}
                  <span>
                    <span className={on ? "text-gray-200" : "text-red-300"}>{label}</span>
                    <span className="block text-xs text-gray-500">{hint}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {data.delaySendMessagesMilliseconds != null && (
            <p className="text-xs text-gray-500">
              השהיה בין הודעות שמוגדרת ב-Green API: {Math.round(data.delaySendMessagesMilliseconds / 100) / 10} שניות
            </p>
          )}
        </div>
      )}
    </div>
  );
}
