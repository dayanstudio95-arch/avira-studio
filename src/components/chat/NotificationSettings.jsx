import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, BellRing, Share } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { base44 } from "@/api/base44Client";
import {
  PREF_ROWS, mergePrefs, pushSupported, isIOS, isStandalone,
  currentSubscriptionRow, enablePush, disablePush, savePrefs,
} from "@/lib/push";

// Notification switches for THIS device (stage 1ב, 2026-10-05). The owner's choice:
// every notification on, and changeable from the app whenever he wants.
export default function NotificationSettings({ tenantId, userId }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const prefs = mergePrefs(row?.prefs);

  useEffect(() => {
    let alive = true;
    currentSubscriptionRow()
      .then((r) => alive && setRow(r))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const update = async (next) => {
    const merged = mergePrefs({ ...prefs, ...next });
    setRow((r) => ({ ...r, prefs: merged }));
    try {
      await savePrefs(row.id, merged);
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
  };

  const turnOn = async () => {
    setBusy(true);
    try {
      const created = await enablePush({ tenantId, userId, prefs });
      setRow(created);
      toast.success("ההתראות הופעלו במכשיר הזה");
    } catch (e) {
      toast.error(e?.message || "ההפעלה נכשלה");
    }
    setBusy(false);
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      setRow(null);
      toast.success("ההתראות כובו במכשיר הזה");
    } catch (e) {
      toast.error("הכיבוי נכשל", { description: e?.message });
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("pushTest", { subscriptionId: row.id });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success(res?.data?.sent ? "נשלחה התראת בדיקה — היא אמורה להופיע תוך שניות" : "לא נשלחה. נסה לכבות ולהפעיל מחדש.");
    } catch (e) {
      toast.error("הבדיקה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const mute = (kind) => {
    if (kind === "off") return update({ muteUntil: null });
    const d = new Date();
    if (kind === "hour") d.setHours(d.getHours() + 1);
    if (kind === "morning") {
      if (d.getHours() >= 8) d.setDate(d.getDate() + 1);
      d.setHours(8, 0, 0, 0);
    }
    return update({ muteUntil: d.toISOString() });
  };
  const muteUntil = prefs.muteUntil && new Date(prefs.muteUntil) > new Date() ? new Date(prefs.muteUntil) : null;
  const muteKind = !muteUntil ? "off" : muteUntil.getHours() === 8 && muteUntil.getMinutes() === 0 ? "morning" : "hour";

  if (loading) return <div className="flex justify-center py-8 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /></div>;

  if (!pushSupported() || (isIOS() && !isStandalone())) {
    return (
      <div className="space-y-3 rounded-2xl border border-gray-800 p-4 text-sm leading-relaxed text-gray-300">
        <p className="font-semibold text-white">כדי לקבל התראות באייפון</p>
        <p>באייפון, התראות עובדות רק מתוך האפליקציה שעל מסך הבית (iOS 16.4 ומעלה):</p>
        <ol className="list-decimal space-y-1 pr-5">
          <li>פותחים ב-Safari את new.avira-studio.com/chat ומתחברים.</li>
          <li>לוחצים על <Share className="inline h-4 w-4" /> שיתוף ← "הוסף למסך הבית".</li>
          <li>פותחים מהאייקון "אווירה צ'אט" ונכנסים לכאן שוב.</li>
        </ol>
      </div>
    );
  }

  if (typeof Notification !== "undefined" && Notification.permission === "denied" && !row) {
    return (
      <div className="rounded-2xl border border-amber-800/60 bg-amber-950/30 p-4 text-sm text-amber-200">
        ההתראות חסומות במכשיר הזה. באייפון: הגדרות ← התראות ← "אווירה צ'אט" ← אפשר התראות. ואז לחזור לכאן.
      </div>
    );
  }

  if (!row) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-gray-400">ההתראות כבויות במכשיר הזה.</p>
        <button type="button" onClick={turnOn} disabled={busy} className="inline-flex min-h-[48px] items-center gap-2 rounded-2xl bg-yellow-400 px-6 font-semibold text-gray-900 disabled:opacity-50">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <BellRing className="h-5 w-5" />}
          הפעל התראות במכשיר הזה
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">ההגדרות האלה הן ל{row.device_label || "מכשיר הזה"} בלבד. אפשר לשנות בכל רגע.</p>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-gray-500">השתק הכל</h3>
        <div className="grid grid-cols-3 gap-2">
          {[["off", "לא מושתק"], ["hour", "לשעה"], ["morning", "עד 08:00"]].map(([k, l]) => (
            <button key={k} type="button" onClick={() => mute(k)} aria-pressed={muteKind === k} className={`min-h-[44px] rounded-xl text-sm ${muteKind === k ? "bg-yellow-400 font-semibold text-gray-900" : "border border-gray-800 bg-gray-900 text-gray-300"}`}>
              {l}
            </button>
          ))}
        </div>
        {muteUntil && <p className="text-xs text-amber-300">מושתק עד {muteUntil.toLocaleString("he-IL", { weekday: "short", hour: "2-digit", minute: "2-digit" })}. ההודעות ממשיכות להיכנס.</p>}
      </section>

      <section className="overflow-hidden rounded-2xl bg-gray-900">
        <h3 className="px-4 pb-1 pt-3 text-xs font-semibold text-gray-500">על מה לקבל התראה</h3>
        {PREF_ROWS.map(([key, label, hint]) => (
          <label key={key} className="flex items-center gap-3 border-t border-gray-800 px-4 py-3">
            <span className="flex-1">
              <span className="block text-sm text-gray-100">{label}</span>
              <span className="block text-xs text-gray-500">{hint}</span>
            </span>
            <Switch checked={!!prefs[key]} onCheckedChange={(v) => update({ [key]: v })} aria-label={label} />
          </label>
        ))}
        <div className="flex items-center gap-3 border-t border-gray-800 px-4 py-3">
          <span className="flex-1">
            <span className="block text-sm text-gray-100">📅 תזכורות פגישות</span>
            <span className="block text-xs text-gray-500">תמיד פועלות — גם בלילה וגם כשההתראות מושתקות. 10 דק׳ לפני, ושוב אחרי 5 דק׳ אם לא לחצת.</span>
          </span>
          <span className="text-xs font-semibold text-emerald-400">תמיד</span>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl bg-gray-900">
        <label className="flex items-center gap-3 px-4 py-3">
          <span className="flex-1">
            <span className="block text-sm text-gray-100">בלי התראות בלילה</span>
            <span className="block text-xs text-gray-500">{prefs.night.start}–{prefs.night.end} · ההודעות נכנסות, רק בלי התראה</span>
          </span>
          <Switch checked={!!prefs.night.enabled} onCheckedChange={(v) => update({ night: { ...prefs.night, enabled: v } })} aria-label="בלי התראות בלילה" />
        </label>
        {prefs.night.enabled && (
          <div className="flex items-center gap-3 border-t border-gray-800 px-4 py-3 text-sm text-gray-300">
            <label className="flex items-center gap-2">מ-
              <input type="time" value={prefs.night.start} onChange={(e) => update({ night: { ...prefs.night, start: e.target.value } })} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-white" dir="ltr" />
            </label>
            <label className="flex items-center gap-2">עד
              <input type="time" value={prefs.night.end} onChange={(e) => update({ night: { ...prefs.night, end: e.target.value } })} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-white" dir="ltr" />
            </label>
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={test} disabled={busy} className="min-h-[44px] flex-1 rounded-xl bg-gray-800 px-4 text-sm text-gray-100 disabled:opacity-50">שלח התראת בדיקה</button>
        <button type="button" onClick={turnOff} disabled={busy} className="min-h-[44px] rounded-xl border border-red-900 px-4 text-sm text-red-300 disabled:opacity-50">כבה במכשיר הזה</button>
      </div>
    </div>
  );
}
