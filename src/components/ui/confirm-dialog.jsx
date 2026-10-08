import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";

// In-app confirmation (2026-10-09, the owner's request: "שתראה יפה בתוך המערכת ולא כאילו
// היא מהדפדפן"). Use it like window.confirm, but awaited:
//
//   if (!(await confirmDialog({ title: "לסגור את דניאל ומאי?", message: "…", confirmText: "סגור" }))) return;
//
// One <ConfirmHost/> is mounted in App.jsx. Without it (another entry point) it falls back
// to the browser's confirm, so a call never silently does nothing.
let show = null;

export function confirmDialog(opts) {
  const o = typeof opts === "string" ? { message: opts } : opts || {};
  if (!show) return Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join("\n\n")));
  return new Promise((resolve) => show({ ...o, resolve }));
}

export function ConfirmHost() {
  const [cur, setCur] = useState(null);
  useEffect(() => {
    show = setCur;
    return () => {
      show = null;
    };
  }, []);
  const done = (answer) => {
    cur?.resolve(answer);
    setCur(null);
  };
  return (
    <Dialog open={!!cur} onOpenChange={(o) => !o && done(false)}>
      <DialogContent dir="rtl" className="max-w-md border-[#2A3B57] bg-[#0F1B33] text-white">
        <DialogHeader>
          <DialogTitle className="text-right text-lg">{cur?.title || "לאשר?"}</DialogTitle>
          {cur?.message && (
            <DialogDescription className="whitespace-pre-line text-right text-sm leading-relaxed text-slate-300">{cur.message}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter className="flex-row-reverse gap-2 sm:justify-start">
          <button
            type="button"
            autoFocus
            onClick={() => done(true)}
            className={`rounded-lg px-5 py-2 text-sm font-semibold text-white ${cur?.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {cur?.confirmText || "אישור"}
          </button>
          <button type="button" onClick={() => done(false)} className="rounded-lg border border-[#2A3B57] bg-white/[0.04] px-5 py-2 text-sm text-slate-300 hover:text-white">
            {cur?.cancelText || "ביטול"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
