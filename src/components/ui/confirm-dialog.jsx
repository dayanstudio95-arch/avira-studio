import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

// In-app confirmation (2026-10-09, the owner's request: "שתראה יפה בתוך המערכת ולא כאילו
// היא מהדפדפן"). Use it like window.confirm, but awaited:
//
//   if (!(await confirmDialog({ title: "לסגור את דניאל ומאי?", message: "…", confirmText: "סגור" }))) return;
//
// One <ConfirmHost/> is mounted in App.jsx. Without it (another entry point) it falls back
// to the browser's confirm, so a call never silently does nothing.
let show = null;

// A plain string (the old window.confirm text) works too: its first line becomes the title,
// the rest the explanation; a delete question gets a red "מחק" button.
function fromText(text) {
  const t = String(text || "").trim();
  const nl = t.indexOf("\n");
  const title = nl < 0 ? t : t.slice(0, nl).trim();
  const message = nl < 0 ? "" : t.slice(nl + 1).trim();
  const del = /למחוק|מחיקה|לצמיתות/.test(t);
  return { title, message, danger: del, confirmText: del ? "מחק" : "אישור" };
}

export function confirmDialog(opts) {
  const o = typeof opts === "string" ? fromText(opts) : opts || {};
  if (!show) return Promise.resolve(window.confirm([o.title, o.message].filter(Boolean).join("\n\n")));
  return new Promise((resolve) =>
    show((prev) => {
      prev?.resolve(false); // a second question replaces an open one → the first is "no"
      return { ...o, resolve };
    })
  );
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
  // Its own layer above everything: the album editor and other full-screen pages sit above
  // the normal dialog layer (z-50), and a question must never open hidden behind them.
  return (
    <DialogPrimitive.Root open={!!cur} onOpenChange={(o) => !o && done(false)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[2147483000] bg-black/70" />
        <DialogPrimitive.Content
          dir="rtl"
          data-confirm-dialog=""
          className="fixed left-1/2 top-1/2 z-[2147483001] max-h-[85vh] w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-[#2A3B57] bg-[#0F1B33] p-6 text-white shadow-2xl"
        >
          <DialogPrimitive.Title className="text-right text-lg font-semibold">{cur?.title || "לאשר?"}</DialogPrimitive.Title>
          {cur?.message ? (
            <DialogPrimitive.Description className="mt-2 whitespace-pre-line text-right text-sm leading-relaxed text-slate-300">{cur.message}</DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="sr-only">אישור פעולה</DialogPrimitive.Description>
          )}
          <div className="mt-5 flex gap-2">
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
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
