import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/api/supabaseClient";

const LABELS = { autosave: "שמירה אוטומטית", manual: "נשמרה ידנית", before_restore: "לפני שחזור", exported: "יוצאה לזוג", client_edits: "שינויי הזוג" };

// Saved versions of the design (album_design_revisions). Restoring first snapshots the current
// state ("לפני שחזור"), so a restore can itself be undone.
export default function RevisionsDialog({ designId, onClose, onRestore }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    supabase
      .from("album_design_revisions")
      .select("id, created_at, label, doc_version")
      .eq("design_id", designId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setRows(data || []));
  }, [designId]);

  const restore = async (id) => {
    setBusy(id);
    const { data } = await supabase.from("album_design_revisions").select("doc").eq("id", id).single();
    if (data?.doc) await onRestore(data.doc);
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#0B1529] text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="font-semibold text-white">היסטוריית גרסאות</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {rows == null ? (
            <Loader2 className="mx-auto my-8 h-6 w-6 animate-spin text-slate-400" />
          ) : !rows.length ? (
            <div className="py-8 text-center text-sm text-slate-400">עוד אין גרסאות שמורות. נשמרת גרסה אוטומטית כל 10 דקות של עבודה, או בלחיצה על "שמור גרסה".</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 hover:bg-white/5">
                <div>
                  <div className="text-sm">{new Date(r.created_at).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                  <div className="text-[11px] text-slate-400">{LABELS[r.label] || r.label}</div>
                </div>
                <button type="button" onClick={() => restore(r.id)} disabled={busy} className="rounded-md border border-white/10 px-3 py-1 text-xs hover:border-amber-400/60 hover:text-amber-200 disabled:opacity-50">
                  {busy === r.id ? "…" : "שחזר"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
