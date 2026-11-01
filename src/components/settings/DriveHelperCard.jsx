import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, HardDrive, KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { driveAppsScript } from "@/lib/driveScript";
import { driveSpaceText } from "@/lib/driveSpace";

const KEYS = ["drive_helper_token_hash", "drive_helper_connected_at", "drive_helper_last_at", "drive_storage_used", "drive_storage_limit"];

const TASK_WORDS = { trash: "לפח של הדרייב", to_favorites: "ל\"גלריות מועדפים\"", restore: "חזרה למקום" };
const STATUS_WORDS = { pending: "ממתין", done: "✓ בוצע", failed: "נכשל", cancelled: "בוטל" };
const STATUS_COLOR = { pending: "text-amber-300", done: "text-green-300", failed: "text-red-400", cancelled: "text-gray-500" };

// "גוגל דרייב" (2026-11-02, the owner's request; 0101). The system only reads Drive; a Google Apps Script in the owner's
// own Google account (the one that holds the photos) does the rest every 5 minutes through drive-helper: a gallery
// removed for good → its folder to the Drive trash, a starred gallery → its folder into "גלריות מועדפים" and back, and
// the Drive's used / total space for the galleries page. Here: the script with its own token (only its SHA-256 is
// saved; the text is shown once — making a new one cancels the old, and work written before it is never handed out),
// whether it is running, and the latest work.
export default function DriveHelperCard() {
  const [vals, setVals] = useState({});
  const [ids, setIds] = useState({});
  const [tasks, setTasks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: { $in: KEYS } }).catch(() => []);
      setVals(Object.fromEntries(rows.map((r) => [r.key, r.value])));
      setIds(Object.fromEntries(rows.map((r) => [r.key, r.id])));
      const { data } = await supabase.from("drive_tasks").select("id, couple_name, kind, status, error, created_at").order("created_at", { ascending: false }).limit(8);
      setTasks(data || []);
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

  const makeScript = async () => {
    if (vals.drive_helper_token_hash && !(await confirmDialog("כבר נוצר סקריפט. ליצור חדש?\nהסקריפט הקודם יפסיק לעבוד, וצריך להדביק את החדש במקומו."))) return;
    setSaving(true);
    try {
      const raw = generateRawToken();
      await upsert("drive_helper_token_hash", await hashToken(raw));
      await upsert("drive_helper_connected_at", new Date().toISOString());
      setScript(driveAppsScript({ url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/drive-helper`, token: raw }));
      toast.success("הסקריפט מוכן — העתק אותו עכשיו, הוא לא יוצג שוב");
    } catch (e) {
      toast.error("לא הצלחתי ליצור סקריפט", { description: e?.message });
    }
    setSaving(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script);
      toast.success("הסקריפט הועתק");
    } catch {
      toast.error("לא הצלחתי להעתיק — סמן את הטקסט והעתק ידנית");
    }
  };

  const last = vals.drive_helper_last_at ? new Date(vals.drive_helper_last_at) : null;
  // The script runs every 5 minutes: more than 20 minutes of silence means it stopped.
  const alive = last && Date.now() - last.getTime() < 20 * 60 * 1000;
  const space = driveSpaceText(vals.drive_storage_used, vals.drive_storage_limit);

  return (
    <Card className="bg-gray-900/50 border-gray-800" data-testid="drive-helper-card">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-sky-500/20 rounded-lg flex items-center justify-center">
            <HardDrive className="w-4 h-4 text-sky-300" />
          </div>
          גוגל דרייב — מחיקה, מועדפים ושטח אחסון
        </CardTitle>
        <p className="text-sm text-gray-400">
          גלריה שנמחקת לצמיתות — התיקייה שלה בדרייב עוברת לפח של הדרייב (אפשר לשחזר משם 30 יום). גלריה עם כוכב — התיקייה עוברת ל"גלריות מועדפים", והורדת הכוכב מחזירה אותה. ובדף הגלריות רואים כמה מקום תפוס.
        </p>
      </CardHeader>
      <CardContent className="space-y-5 pt-5 text-sm" dir="rtl">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
          </div>
        ) : (
          <>
            <div className="text-gray-300" data-testid="drive-helper-state">
              {!vals.drive_helper_token_hash ? (
                <span className="text-amber-300">עוד לא מחובר — צרו סקריפט והדביקו אותו בחשבון הגוגל של התמונות.</span>
              ) : alive ? (
                <span className="text-green-300">✓ מחובר · עודכן ב-{last.toLocaleString("he-IL")}</span>
              ) : last ? (
                <span className="text-red-400">הסקריפט לא דיווח מאז {last.toLocaleString("he-IL")}. כדאי לבדוק אותו ב-script.google.com.</span>
              ) : (
                <span className="text-amber-300">נוצר סקריפט, אבל הוא עוד לא רץ. הדביקו אותו והריצו "setup".</span>
              )}
              {space && <span className="block text-xs text-gray-500">שטח: {space}</span>}
            </div>

            {tasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-gray-400">פעולות אחרונות בדרייב</div>
                <div className="divide-y divide-gray-800 rounded-lg border border-gray-800">
                  {tasks.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-3 px-3 py-2" title={t.error || ""}>
                      <span className="truncate text-gray-200">
                        {t.couple_name || "גלריה"} · {TASK_WORDS[t.kind] || t.kind}
                      </span>
                      <span className={`shrink-0 text-xs ${STATUS_COLOR[t.status] || "text-gray-400"}`}>
                        {STATUS_WORDS[t.status] || t.status} · {new Date(t.created_at).toLocaleDateString("he-IL")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-gray-400">הסקריפט לחשבון הגוגל שבו נמצאות התמונות</div>
              <Button onClick={makeScript} disabled={saving} variant="outline" className="gap-2 border-gray-700 bg-gray-800 text-gray-200" data-testid="drive-make-script">
                <KeyRound className="h-4 w-4" /> {vals.drive_helper_token_hash ? "צור סקריפט חדש" : "צור סקריפט"}
              </Button>
              {script && (
                <div className="space-y-2">
                  <textarea readOnly value={script} rows={10} dir="ltr" className="w-full rounded-lg border border-gray-700 bg-gray-950 p-2 font-mono text-xs text-gray-200" data-testid="drive-script" />
                  <Button onClick={copy} className="gap-2 bg-amber-500 text-gray-900 hover:bg-amber-600">
                    <Copy className="h-4 w-4" /> העתק סקריפט
                  </Button>
                  <ol className="list-decimal space-y-1 pr-5 text-xs text-gray-400">
                    <li>
                      נכנסים ל-script.google.com <b className="text-gray-200">מחוברים לחשבון הגוגל שבו נמצאות תיקיות התמונות</b> ← "פרויקט חדש".
                    </li>
                    <li>מוחקים את מה שכתוב שם, מדביקים את הסקריפט ושומרים (💾).</li>
                    <li>
                      למעלה בוחרים את הפונקציה <b className="text-gray-200">setup</b> ולוחצים "הפעלה" (▶).
                    </li>
                    <li>גוגל יבקש אישור לגשת לדרייב ולשלוח בקשות — מאשרים (זה הסקריפט שלך).</li>
                    <li>זהו. מעכשיו הוא רץ כל 5 דקות, ונוצרת לבד התיקייה "גלריות מועדפים". מחיקות מלפני היום לא יבוצעו.</li>
                  </ol>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
