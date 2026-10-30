import React, { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, Copy, KeyRound, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { pixiesetAppsScript } from "@/lib/pixiesetScript";

// What the album group hears, each with its own switch ('false' = off, no row = on). The last
// three come from the couple's album portal (2026-10-30, album-portal + _shared/albumGroupNotify.ts).
const MESSAGES = [
  { key: "pixieset_notify_enabled", label: "זוג סיים לבחור תמונות בפיקסיסט", hint: "צריך את הסקריפט למטה" },
  { key: "album_group_notify_revision", label: "הזוג ביקש תיקון בסקיצה", hint: "עם מספרי הכפולות" },
  { key: "album_group_notify_payment", label: "הזוג סיים לבחור — ממתין לתשלום", hint: "מוצר, כריכה, תוספות וסכום" },
  { key: "album_group_notify_transfer", label: "הזוג העלה אישור העברה", hint: "לבדוק שהכסף נכנס" },
];

const KEYS = [...MESSAGES.map((m) => m.key), "pixieset_notify_group_chat_id", "pixieset_notify_group_name", "pixieset_notify_token_hash", "pixieset_notify_last_at"];

// "קבוצת האלבומים בוואטסאפ". Born 2026-10-29 for Pixieset: when a couple presses "send to
// photographer" on their favorites, the album group gets a WhatsApp. Pixieset has no API — a
// Google Apps Script in the Gmail it emails (avira.media1) posts the email to
// pixieset-favorites-notify. From 2026-10-30 the same group also hears the album portal (asked
// for corrections / waiting for payment / transfer proof). Here: the group, a switch for each
// message, and the script with its own token (only the token's SHA-256 is saved; the script
// text is shown once — making a new one cancels the old).
export default function PixiesetNotifyCard() {
  const [vals, setVals] = useState({});
  const [ids, setIds] = useState({});
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: { $in: KEYS } }).catch(() => []);
      setVals(Object.fromEntries(rows.map((r) => [r.key, r.value])));
      setIds(Object.fromEntries(rows.map((r) => [r.key, r.id])));
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("chat_id, display_name, last_inbound_at")
        .like("chat_id", "%@g.us")
        .order("last_inbound_at", { ascending: false, nullsFirst: false })
        .limit(300);
      setGroups(data || []);
      setLoading(false);
    })();
  }, []);

  const upsert = async (key, value) => {
    if (ids[key]) await base44.entities.AppSetting.update(ids[key], { value });
    else {
      const created = await base44.entities.AppSetting.create({ key, value });
      setIds((m) => ({ ...m, [key]: created.id }));
    }
    setVals((v) => ({ ...v, [key]: value }));
  };

  const shown = useMemo(() => {
    const q = search.trim();
    return groups.filter((g) => !q || String(g.display_name || "").includes(q));
  }, [groups, search]);

  const chosen = vals.pixieset_notify_group_chat_id;

  const pickGroup = async (g) => {
    setSaving(true);
    try {
      await upsert("pixieset_notify_group_chat_id", g.chat_id);
      await upsert("pixieset_notify_group_name", g.display_name || "");
      toast.success(`נבחרה הקבוצה "${g.display_name}"`);
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
    setSaving(false);
  };

  const toggle = async (key) => {
    setSaving(true);
    try { await upsert(key, vals[key] === "false" ? "true" : "false"); } catch (e) { toast.error("השמירה נכשלה", { description: e?.message }); }
    setSaving(false);
  };

  const makeScript = async () => {
    if (vals.pixieset_notify_token_hash && !window.confirm("כבר נוצר סקריפט. ליצור חדש? הסקריפט הקודם יפסיק לעבוד.")) return;
    setSaving(true);
    try {
      const raw = generateRawToken();
      await upsert("pixieset_notify_token_hash", await hashToken(raw));
      setScript(pixiesetAppsScript({ url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pixieset-favorites-notify`, token: raw }));
      toast.success("הסקריפט מוכן — העתק אותו עכשיו, הוא לא יוצג שוב");
    } catch (e) {
      toast.error("לא הצלחתי ליצור סקריפט", { description: e?.message });
    }
    setSaving(false);
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(script); toast.success("הסקריפט הועתק"); }
    catch { toast.error("לא הצלחתי להעתיק — סמן את הטקסט והעתק ידנית"); }
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
            <Camera className="w-4 h-4 text-amber-300" />
          </div>
          קבוצת האלבומים בוואטסאפ
        </CardTitle>
        <p className="text-sm text-gray-400">
          הודעה לקבוצה כשזוג מסיים לבחור תמונות בפיקסיסט, ועל מה שהזוג עושה בפורטל האלבום. רק פעולות של הזוג שולחות — שינוי סטטוס שאתם עושים במערכת לא. נוסח ההודעות: הגדרות ← תבניות.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 text-sm" dir="rtl">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-500" /></div>
        ) : (
          <>
            <div className="text-gray-300">
              {chosen ? <>קבוצה: <b className="text-white">{vals.pixieset_notify_group_name || chosen}</b></> : <span className="text-amber-300">עוד לא נבחרה קבוצה — לא נשלחת אף הודעה</span>}
              {vals.pixieset_notify_last_at && <span className="block text-xs text-gray-500">הודעה אחרונה מפיקסיסט: {new Date(vals.pixieset_notify_last_at).toLocaleString("he-IL")}</span>}
            </div>

            <div className="space-y-2">
              <div className="text-gray-400">מה נשלח לקבוצה</div>
              <div className="divide-y divide-gray-800 rounded-lg border border-gray-800">
                {MESSAGES.map((m) => {
                  const on = vals[m.key] !== "false";
                  return (
                    <div key={m.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-gray-200">{m.label}</div>
                        <div className="text-xs text-gray-500">{m.hint}</div>
                      </div>
                      <button type="button" onClick={() => toggle(m.key)} disabled={saving} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-green-600 text-white" : "bg-gray-700 text-gray-300"}`}>
                        {on ? "פעיל" : "כבוי"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-gray-400">הקבוצה</div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש קבוצה…" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-white" />
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-800 p-1">
                {shown.length === 0 && <div className="py-3 text-center text-xs text-gray-500">לא נמצאו קבוצות</div>}
                {shown.map((g) => (
                  <button
                    key={g.chat_id}
                    type="button"
                    disabled={saving}
                    onClick={() => pickGroup(g)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-right ${g.chat_id === chosen ? "bg-amber-500/15 text-amber-200" : "text-gray-200 hover:bg-gray-800"}`}
                  >
                    <span className="truncate">{g.display_name || g.chat_id}</span>
                    {g.chat_id === chosen && <span className="text-xs">✓ נבחרה</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-gray-400">הסקריפט לג'ימייל (avira.media1) — רק בשביל פיקסיסט</div>
              <Button onClick={makeScript} disabled={saving} variant="outline" className="gap-2 border-gray-700 bg-gray-800 text-gray-200">
                <KeyRound className="h-4 w-4" /> {vals.pixieset_notify_token_hash ? "צור סקריפט חדש" : "צור סקריפט"}
              </Button>
              {script && (
                <div className="space-y-2">
                  <textarea readOnly value={script} rows={10} dir="ltr" className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 font-mono text-xs text-gray-200" />
                  <Button onClick={copy} className="gap-2 bg-amber-500 text-gray-900 hover:bg-amber-600"><Copy className="h-4 w-4" /> העתק סקריפט</Button>
                  <ol className="list-decimal space-y-1 pr-5 text-xs text-gray-400">
                    <li>נכנסים ל-script.google.com <b className="text-gray-200">מחוברים ל-avira.media1@gmail.com</b> ← "פרויקט חדש".</li>
                    <li>מוחקים את מה שכתוב שם, מדביקים את הסקריפט ושומרים (💾).</li>
                    <li>למעלה בוחרים את הפונקציה <b className="text-gray-200">setup</b> ולוחצים "הפעלה" (▶).</li>
                    <li>גוגל יבקש אישור לקרוא את הג'ימייל ולשלוח בקשות — מאשרים (זה הסקריפט שלך).</li>
                    <li>זהו. מעכשיו הוא בודק כל 5 דקות. מיילים ישנים לא יישלחו לקבוצה.</li>
                  </ol>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500"><Save className="h-3.5 w-3.5" /> כל שינוי נשמר מיד.</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
