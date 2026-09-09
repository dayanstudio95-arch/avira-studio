import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, Undo2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

// The other half of migration 0058: the recycle bin's window.
//
// The trigger captures every deleted lead and event no matter who issued the DELETE.
// This screen is what makes that useful to a human rather than to a DBA — without it
// a mistaken deletion is still recoverable, but only by someone who can write SQL.
//
// Restore puts the original row back verbatim, including its id, so everything that
// referenced it — events.source_lead_id, invoices, the signed contract URL — points at
// the right record again. Restoring under a new id would produce a lead that looks
// correct and is silently disconnected from its own history.

const TABLE_LABELS = { leads: "ליד", events: "אירוע" };

export default function RecycleBinCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);
  const [rows, setRows] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restoringId, setRestoringId] = useState(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("deleted_records")
        .select("id, table_name, record_id, label, deleted_at, deleted_by_name")
        .is("restored_at", null)
        .order("deleted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      console.error("Error loading recycle bin:", e);
      // Quiet on the missing-table case: the card renders empty until 0058 is applied,
      // rather than shouting at a studio that hasn't run the migration yet.
      if (!String(e?.message || "").includes("deleted_records")) {
        toast.error(`שגיאה בטעינת סל המיחזור: ${e?.message || "שגיאה לא ידועה"}`);
      }
      setRows([]);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (canManage) load();
    else setIsLoading(false);
  }, [canManage, load]);

  const handleRestore = async (row) => {
    if (!window.confirm(`לשחזר את ${TABLE_LABELS[row.table_name] || row.table_name} "${row.label}"?`)) return;
    setRestoringId(row.id);
    try {
      // Fetch the payload only now — the list query deliberately leaves `data` out so
      // opening this screen doesn't pull every deleted contract into the browser.
      const { data: full, error: readErr } = await supabase
        .from("deleted_records")
        .select("data")
        .eq("id", row.id)
        .single();
      if (readErr) throw readErr;

      const { error: insertErr } = await supabase.from(row.table_name).insert(full.data);
      if (insertErr) {
        // The usual cause is that the row was already restored, or recreated by hand
        // under the same id. Say so instead of showing a raw Postgres error.
        if (insertErr.code === "23505") {
          throw new Error("הרשומה כבר קיימת במערכת — ייתכן ששוחזרה כבר");
        }
        throw insertErr;
      }

      await supabase
        .from("deleted_records")
        .update({ restored_at: new Date().toISOString() })
        .eq("id", row.id);

      toast.success(`"${row.label}" שוחזר`);
      await load();
    } catch (e) {
      console.error("Restore failed:", e);
      toast.error(`השחזור נכשל: ${e?.message || "שגיאה לא ידועה"}`);
    }
    setRestoringId(null);
  };

  if (!canManage) return null;

  return (
    <Card className="bg-gray-900/50 border-gray-800">
      <CardHeader className="border-b border-gray-800 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-500/20 rounded-lg flex items-center justify-center">
                <Trash2 className="w-4 h-4 text-orange-400" />
              </div>
              סל מיחזור
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">לידים ואירועים שנמחקו — ניתן לשחזר</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={load}
            disabled={isLoading}
            className="border-gray-700 bg-gray-800 text-gray-300"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6">
        {isLoading && <p className="text-gray-500 text-sm">טוען…</p>}

        {!isLoading && rows.length === 0 && (
          <p className="text-gray-500 text-sm">
            אין רשומות שנמחקו. כל ליד או אירוע שיימחק מכאן והלאה יישמר כאן וניתן יהיה לשחזר אותו.
          </p>
        )}

        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-gray-700 bg-gray-800/40 p-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-medium truncate">{row.label}</span>
                  <span className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] text-gray-400">
                    {TABLE_LABELS[row.table_name] || row.table_name}
                  </span>
                </div>
                <p className="text-gray-500 text-xs mt-0.5">
                  נמחק ב-{new Date(row.deleted_at).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
                  {row.deleted_by_name ? ` · ${row.deleted_by_name}` : ""}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => handleRestore(row)}
                disabled={restoringId === row.id}
                className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {restoringId === row.id ? (
                  <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                ) : (
                  <Undo2 className="w-4 h-4 ml-1" />
                )}
                שחזר
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
