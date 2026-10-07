import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { exportDesignAsVersion } from "@/lib/albumExport";
import { getTemplate, cellRects } from "@/lib/albumTemplates";
import { effectiveDpi } from "@/lib/albumDesign";

// "📤 ייצוא לזוג" (stage 3). Builds every spread at full print size and adds it as a new version
// of the order — the couple sees it in their existing portal link once ALL spreads are in.
// Nothing is sent to the couple by message; the studio shares the portal link as today.
export default function ExportDialog({ design, doc, orderId, tenantId, beforeExport, onClose, onExported }) {
  const [state, setState] = useState({ phase: "idle" });
  const cancelled = useRef(false);

  const checks = useMemo(() => {
    let empty = 0;
    let lowDpi = 0;
    const byId = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
    for (const p of doc.pages) {
      const rects = cellRects(getTemplate(p.templateId), p.flip);
      p.slots.forEach((s, i) => {
        if (!s.assetId) empty++;
        else {
          const dpi = effectiveDpi(byId[s.assetId], rects[i], s.zoom);
          if (dpi != null && dpi < 200) lowDpi++;
        }
      });
    }
    const title = doc.pages.find((p) => p.title)?.title;
    return { empty, lowDpi, noNames: title && !title.names };
  }, [doc]);

  useEffect(() => {
    if (state.phase !== "running") return;
    const stop = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [state.phase]);

  const run = async () => {
    cancelled.current = false;
    setState({ phase: "running", done: 0, total: doc.pages.length, step: "מתחיל" });
    try {
      await beforeExport?.();
      const r = await exportDesignAsVersion({
        design,
        doc,
        orderId,
        tenantId,
        onProgress: (p) => setState({ phase: "running", ...p }),
        isCancelled: () => cancelled.current,
      });
      setState({ phase: "done", ...r });
      onExported?.(r);
    } catch (e) {
      setState({ phase: "error", message: e?.message || "הייצוא נכשל" });
    }
  };

  const running = state.phase === "running";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={running ? undefined : onClose}>
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-white"><Send className="h-5 w-5 text-amber-300" /> ייצוא גרסה לזוג</div>
          {!running && <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>}
        </div>

        {state.phase === "idle" && (
          <>
            <div className="text-sm text-slate-400">
              כל כפולה נבנית בגודל הדפסה מלא (80×30 ס״מ, 300dpi) מהתמונות המקוריות ב-Drive, ונכנסת כגרסה חדשה בהזמנה —
              בדיוק כמו העלאה ידנית. הזוג רואה אותה בקישור שכבר יש לו, רק אחרי שכל הכפולות עלו. שום הודעה לא נשלחת.
            </div>
            <div className="space-y-1 rounded-lg bg-white/[0.04] p-3 text-sm">
              <div>{doc.pages.length} כפולות · זמן משוער: {Math.max(1, Math.round((doc.pages.length * 12) / 60))}–{Math.max(2, Math.round((doc.pages.length * 25) / 60))} דקות</div>
              {checks.empty > 0 && <div className="text-amber-300">⚠️ {checks.empty} מסגרות ריקות — ייצאו כמשטח לבן</div>}
              {checks.lowDpi > 0 && <div className="text-amber-300">⚠️ {checks.lowDpi} תמונות קטנות מדי למסגרת שלהן (פחות מ-200dpi)</div>}
              {checks.noNames && <div className="text-amber-300">⚠️ בכפולת הפתיחה אין שמות</div>}
              {!checks.empty && !checks.lowDpi && !checks.noNames && <div className="text-emerald-300">✓ הכל מוכן</div>}
            </div>
            <div className="text-xs text-slate-500">מומלץ Chrome. אל תסגרו את הלשונית עד הסוף.</div>
            <button type="button" onClick={run} className="h-11 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500">ייצוא {doc.pages.length} כפולות</button>
          </>
        )}

        {running && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin text-amber-300" /> כפולה {Math.min(state.done + 1, state.total)} מתוך {state.total} — {state.step}…</div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round((state.done / Math.max(1, state.total)) * 100)}%` }} />
            </div>
            <div className="text-xs text-amber-200">לא לסגור את הלשונית ולא להעביר את המחשב למצב שינה.</div>
            <button type="button" onClick={() => { cancelled.current = true; }} className="text-xs text-slate-400 underline hover:text-white">ביטול</button>
          </div>
        )}

        {state.phase === "done" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-5 w-5" /> גרסה {state.versionNumber} עלתה ({state.spreads} כפולות)</div>
            <div className="text-slate-400">הזוג יראה אותה בקישור הפורטל שלהם. כדי לשלוח להם את הקישור — מדף ההזמנה, כמו תמיד.</div>
            <Link to={`/AlbumOrders/${orderId}`} className="block h-10 rounded-lg bg-sky-500 text-center font-semibold leading-10 text-white hover:bg-sky-600">לדף ההזמנה</Link>
          </div>
        )}

        {state.phase === "error" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2 text-rose-300"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> {state.message}</div>
            <div className="text-slate-400">שום דבר לא פורסם לזוג — הגרסה החלקית נמחקה. אפשר לנסות שוב.</div>
            <button type="button" onClick={run} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900">נסה שוב</button>
          </div>
        )}
      </div>
    </div>
  );
}
