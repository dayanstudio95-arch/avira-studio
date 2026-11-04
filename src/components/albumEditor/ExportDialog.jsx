import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X, Send, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { startExport, continueExport, discardExport } from "@/lib/albumExport";
import { cellRects } from "@/lib/albumTemplates";
import { pageTemplate } from "@/lib/albumCells";
import { effectiveDpi } from "@/lib/albumDesign";
import { reasonText, isNetworkError } from "@/lib/netRetry";
import { supabase } from "@/api/supabaseClient";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import VersionActions from "./VersionActions";

// "📤 ייצוא לזוג" (stage 3). Builds every spread at full print size and adds it as a new version
// of the order — the couple sees it in their existing portal link once ALL spreads are in.
// Nothing is sent by itself: after the export (2026-11-05, the owner's request) the window offers
// "💌 שליחה לזוג" and "🔗 קישור להורדה באיכות מלאה" for the new version (VersionActions).
// A stopped export keeps its spreads: "להמשיך" goes on from where it stopped; closing the window or "ביטול" removes
// the half-made version (albumExport.js).
export default function ExportDialog({ design, doc, order, names, phone, tenantId, branding = null, beforeExport, onClose, onExported }) {
  const orderId = design.album_order_id;
  const [state, setState] = useState({ phase: "idle" });
  const [retrying, setRetrying] = useState("");
  const cancelled = useRef(false);
  const job = useRef(null);
  const [lastExport, setLastExport] = useState(null); // { versionId, versionNumber } — the version made last time

  useEffect(() => {
    const id = design.last_exported_version_id;
    if (!id) return;
    supabase.from("album_versions").select("id, version_number").eq("id", id).maybeSingle().then(({ data }) => data && setLastExport({ versionId: data.id, versionNumber: data.version_number }));
  }, [design.last_exported_version_id]);

  const checks = useMemo(() => {
    let empty = 0;
    let lowDpi = 0;
    const byId = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
    for (const p of doc.pages) {
      const rects = cellRects(pageTemplate(p), p.flip);
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

  const running = state.phase === "running";
  const pending = state.phase === "error" && job.current && !job.current.published;

  // Leaving mid-export loses it; a stopped one with spreads in it too.
  useEffect(() => {
    if (!running && !pending) return;
    const stop = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", stop);
    return () => window.removeEventListener("beforeunload", stop);
  }, [running, pending]);

  // Keep the screen (and the computer) awake while it runs — sleep cut the connection mid-export.
  useEffect(() => {
    if (!running || !navigator.wakeLock) return;
    let lock = null;
    let alive = true;
    const take = () => navigator.wakeLock.request("screen").then((l) => (alive ? (lock = l) : l.release())).catch(() => {});
    take();
    const again = () => document.visibilityState === "visible" && take();
    document.addEventListener("visibilitychange", again);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", again);
      lock?.release().catch(() => {});
    };
  }, [running]);

  // The window goes away with a half-made version (navigating off the editor) → remove it.
  useEffect(() => () => discardExport(job.current), []);

  const run = async () => {
    cancelled.current = false;
    const onRetry = (n, e) => setRetrying(`${isNetworkError(e) ? "לא התקבלה תשובה" : reasonText(e)} — מנסה שוב (${n} מתוך 4)…`);
    const onProgress = (p) => {
      setRetrying("");
      setState({ phase: "running", ...p });
    };
    setState({ phase: "running", done: job.current?.done || 0, total: doc.pages.length, step: job.current ? "ממשיך" : "מתחיל" });
    try {
      if (job.current?.discarded) job.current = null;
      if (!job.current) {
        await beforeExport?.();
        job.current = await startExport({ doc, orderId, isCancelled: () => cancelled.current, onRetry });
      }
      const r = await continueExport(job.current, { design, tenantId, branding, onProgress, onRetry, isCancelled: () => cancelled.current });
      job.current = null;
      setRetrying("");
      setState({ phase: "done", ...r });
      setLastExport({ versionId: r.versionId, versionNumber: r.versionNumber });
      onExported?.(r);
    } catch (e) {
      setRetrying("");
      if (e?.cancelled) {
        await discardExport(job.current);
        job.current = null;
        setState({ phase: "idle" });
        return;
      }
      setState({ phase: "error", message: e?.message || "הייצוא נכשל", done: job.current?.done || 0, total: doc.pages.length });
    }
  };

  const close = async () => {
    if (running) return;
    if (pending && state.done > 0 && !(await confirmDialog({ title: "לסגור ולמחוק את הייצוא?", message: `${state.done} הכפולות שכבר עלו יימחקו. כדי להמשיך מאיפה שנעצר — "להמשיך".`, confirmText: "סגור ומחק", cancelText: "חזרה", danger: true }))) return;
    if (job.current && !job.current.published) {
      setState({ phase: "closing" });
      await discardExport(job.current);
      job.current = null;
    }
    onClose();
  };
  const giveUp = async () => {
    setState({ phase: "closing" });
    await discardExport(job.current);
    job.current = null;
    setState({ phase: "idle" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={running || pending || state.phase === "closing" ? undefined : close}>
      <div className="max-h-[92vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl" data-testid="export-dialog">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-white"><Send className="h-5 w-5 text-amber-300" /> ייצוא גרסה לזוג</div>
          {!running && state.phase !== "closing" && <button type="button" onClick={close} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>}
        </div>

        {state.phase === "idle" && (
          <>
            <div className="text-sm text-slate-400">
              כל כפולה נבנית בגודל הדפסה מלא (80×30 ס״מ, 300dpi) מהתמונות המקוריות ב-Drive, ונכנסת כגרסה חדשה בהזמנה —
              בדיוק כמו העלאה ידנית. הזוג רואה אותה בקישור שלו, רק אחרי שכל הכפולות עלו. שום הודעה לא נשלחת לבד.
            </div>
            <div className="space-y-1 rounded-lg bg-white/[0.04] p-3 text-sm">
              <div>{doc.pages.length} כפולות · זמן משוער: {Math.max(1, Math.round((doc.pages.length * 12) / 60))}–{Math.max(2, Math.round((doc.pages.length * 25) / 60))} דקות</div>
              {checks.empty > 0 && <div className="text-amber-300">⚠️ {checks.empty} מסגרות ריקות — ייצאו כמשטח לבן</div>}
              {checks.lowDpi > 0 && <div className="text-amber-300">⚠️ {checks.lowDpi} תמונות קטנות מדי למסגרת שלהן (פחות מ-200dpi)</div>}
              {checks.noNames && <div className="text-amber-300">⚠️ בכפולת הפתיחה אין שמות</div>}
              {!checks.empty && !checks.lowDpi && !checks.noNames && <div className="text-emerald-300">✓ הכל מוכן</div>}
            </div>
            <div className="text-xs text-slate-500">מומלץ Chrome. אל תסגרו את הלשונית עד הסוף. אם החיבור נקטע — המערכת מנסה שוב לבד.</div>
            <button type="button" onClick={run} className="h-11 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500" data-testid="export-run">ייצוא {doc.pages.length} כפולות</button>
            {lastExport && (
              <div className="space-y-2 border-t border-white/10 pt-3">
                <div className="text-xs text-slate-400">גרסה {lastExport.versionNumber} — הגרסה שיצאה בפעם הקודמת:</div>
                <VersionActions order={order} names={names} phone={phone} versionId={lastExport.versionId} versionNumber={lastExport.versionNumber} />
              </div>
            )}
          </>
        )}

        {running && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin text-amber-300" /> כפולה {Math.min(state.done + 1, state.total)} מתוך {state.total} — {state.step}…</div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${Math.round((state.done / Math.max(1, state.total)) * 100)}%` }} />
            </div>
            {retrying && <div className="text-xs text-amber-300" data-testid="export-retrying">{retrying}</div>}
            <div className="text-xs text-amber-200">לא לסגור את הלשונית.</div>
            <button type="button" onClick={() => { cancelled.current = true; }} className="text-xs text-slate-400 underline hover:text-white">ביטול</button>
          </div>
        )}

        {state.phase === "closing" && <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> מוחק את הגרסה החלקית…</div>}

        {state.phase === "done" && (
          <div className="space-y-3 text-sm" data-testid="export-done">
            <div className="flex items-center gap-2 text-emerald-300"><CheckCircle2 className="h-5 w-5" /> גרסה {state.versionNumber} עלתה ({state.spreads} כפולות)</div>
            <div className="text-slate-400">הסקיצה שמורה כגרסה בהזמנה. עכשיו אפשר לשלוח לזוג ולייצר קישור להורדה:</div>
            <VersionActions order={order} names={names} phone={phone} versionId={state.versionId} versionNumber={state.versionNumber} />
            <Link to={`/AlbumOrders/${orderId}`} className="block text-center text-xs text-sky-300 hover:underline">לדף ההזמנה</Link>
          </div>
        )}

        {state.phase === "error" && (
          <div className="space-y-3 text-sm" data-testid="export-error">
            <div className="flex items-start gap-2 text-rose-300"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> {state.message}</div>
            {pending && state.done > 0 ? (
              <>
                <div className="text-slate-400">
                  {state.done} מתוך {state.total} כפולות כבר עלו ונשמרו. הזוג עדיין לא רואה כלום — הגרסה מתפרסמת רק כשכל הכפולות עלו.
                </div>
                <button type="button" onClick={run} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900" data-testid="export-resume">להמשיך מכפולה {state.done + 1}</button>
                <button type="button" onClick={giveUp} className="w-full text-xs text-slate-400 underline hover:text-white">לבטל את הייצוא ולמחוק את מה שעלה</button>
              </>
            ) : (
              <>
                <div className="text-slate-400">שום דבר לא פורסם לזוג. אפשר לנסות שוב.</div>
                <button type="button" onClick={run} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900" data-testid="export-resume">נסה שוב</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
