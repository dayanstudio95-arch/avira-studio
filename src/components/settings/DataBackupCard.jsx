import React, { useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// One button, one file, everything that would hurt to lose.
//
// Why this exists: there was no real backup. The studio had two CSV exports (events,
// staff) that each drop most columns and mangle any value containing a comma, a PDF of
// upcoming events, and `monthly-events-backup` — which emails only FUTURE events with
// no prices, no payments and no contract, and returns HTTP 200 even when it fails.
// Meanwhile there is no soft delete anywhere in the schema, and `leads` is not covered
// by the audit trigger, so deleting a lead by mistake destroys its invoice history,
// signature, ID number and signed-contract link with no record it ever existed.
//
// Daniel chose "inside the system, with a download button" over an emailed copy, and
// named contracts, event schedule, and payments/debts as what would hurt to lose.
//
// Three deliberate choices:
//
// 1. JSON, not CSV. This is a backup, not a report — every column of every row is
//    preserved, including the jsonb ones (`invoices_list`, `team`) that CSV cannot
//    represent at all. The existing CSV buttons stay for reading in Excel.
//
// 2. Explicit pagination. PostgREST caps rows server-side, so a plain .select('*')
//    would quietly return the first page and produce a backup that LOOKS complete.
//    A backup that silently truncates is worse than no backup, because it is trusted.
//
// 3. It refuses to download nothing. If every table comes back empty, that is a
//    failure being presented as a file, and the file would sit there looking like
//    insurance until the day it was needed.

const PAGE = 1000;

// Ordered by what Daniel said would hurt to lose. `whatsapp_messages` is excluded on
// purpose: it is the fastest-growing table in the DB and the conversation rows below
// already carry the extracted details (names, date, venue, guests) that matter.
const TABLES = [
  { name: "leads", label: "לידים (כולל חוזים חתומים, חשבוניות ותשלומים)" },
  { name: "events", label: "אירועים, לוז וצוות" },
  { name: "staff_members", label: "אנשי צוות ותעריפים" },
  { name: "packages", label: "חבילות ומחירים" },
  { name: "whatsapp_conversations", label: "שיחות וואטסאפ (פרטי הפנייה)" },
];

async function fetchAll(table) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

export default function DataBackupCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);
  const [isWorking, setIsWorking] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const handleBackup = async () => {
    setIsWorking(true);
    setLastResult(null);
    try {
      const data = {};
      const counts = {};
      for (const t of TABLES) {
        const rows = await fetchAll(t.name);
        data[t.name] = rows;
        counts[t.name] = rows.length;
      }

      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      if (total === 0) {
        // Never hand over an empty file. See note 3 in the header.
        toast.error("הגיבוי חזר ריק — לא נוצר קובץ. פנה לתמיכה לפני שתסמוך על זה.");
        setIsWorking(false);
        return;
      }

      const payload = {
        _meta: {
          created_at: new Date().toISOString(),
          created_by: user?.email || null,
          app: "AVIRA Studio",
          format: "full-json-v1",
          counts,
          note:
            "גיבוי מלא של הטבלאות המרכזיות. כל שדה נשמר כפי שהוא במסד הנתונים. " +
            "הודעות וואטסאפ בודדות לא נכללות (רק פרטי השיחה).",
        },
        ...data,
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8;",
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `avira-backup-${new Date().toISOString().split("T")[0]}.json`;
      link.click();
      URL.revokeObjectURL(link.href);

      setLastResult({ counts, total, at: new Date() });
      toast.success(`הגיבוי ירד — ${total} רשומות`);
    } catch (e) {
      // Loud on purpose. A backup that fails quietly is the worst outcome here: the
      // studio would carry on believing it has a copy.
      console.error("Backup failed:", e);
      toast.error(`הגיבוי נכשל: ${e?.message || "שגיאה לא ידועה"}`);
      setLastResult({ error: e?.message || "שגיאה לא ידועה" });
    }
    setIsWorking(false);
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="border-b border-gray-800 pb-4">
        <CardTitle className="text-white flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          גיבוי נתונים
        </CardTitle>
        <p className="text-gray-400 text-sm">עותק מלא של כל המידע העסקי, בקובץ אחד</p>
      </CardHeader>

      <CardContent className="pt-6 space-y-5">
        <div>
          <p className="text-gray-300 text-sm mb-2">מה נכלל בגיבוי:</p>
          <ul className="space-y-1">
            {TABLES.map((t) => (
              <li key={t.name} className="text-gray-400 text-sm flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">✓</span>
                <span>
                  {t.label}
                  {lastResult?.counts && (
                    <span className="text-gray-500"> — {lastResult.counts[t.name]} רשומות</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex gap-3 rounded-lg border border-amber-700/50 bg-amber-950/30 p-3">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-amber-200/80 text-xs leading-relaxed">
            שמור את הקובץ <strong>מחוץ למחשב הזה</strong> — בדרייב, בדיסק חיצוני או במייל לעצמך.
            גיבוי ששוכב באותו מקום כמו המקור לא מגן מפני הרבה.
          </p>
        </div>

        {canManage ? (
          <Button
            onClick={handleBackup}
            disabled={isWorking}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isWorking ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Download className="w-4 h-4 ml-2" />}
            {isWorking ? "אוסף נתונים..." : "הורד גיבוי מלא"}
          </Button>
        ) : (
          <p className="text-gray-500 text-sm">רק מנהל מערכת יכול להוריד גיבוי.</p>
        )}

        {lastResult?.error && (
          <p className="text-red-400 text-sm">הגיבוי האחרון נכשל: {lastResult.error}</p>
        )}
        {lastResult?.total > 0 && (
          <p className="text-emerald-400 text-sm">
            ✓ ירדו {lastResult.total} רשומות ב-{lastResult.at.toLocaleTimeString("he-IL")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
