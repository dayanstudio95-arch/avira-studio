import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { friendlySendError } from "@/lib/sendErrors";

// "לוז קיץ / חורף / שישי" no longer sends straight away (2026-10-27, the owner's request): the
// text (editable), then who gets it — the bride, the groom, both, or the lead's phone — and
// "העתק טקסט" for sending it by hand. `recipients` comes from scheduleRecipients(lead).
// `onSend(phone, text)` throws on failure.
export default function ScheduleSendDialog({ open, title, subtitle, initialText, recipients, onSend, onClose }) {
  const [text, setText] = useState("");
  const [to, setTo] = useState(null); // a recipient key, or "all"
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const textRef = useRef(null);

  // Filled once per opening — the host re-renders while the window is open (and builds a new
  // recipients array each time), which must not wipe what was typed.
  useEffect(() => {
    if (!open) return;
    setText(initialText || "");
    setTo(recipients?.[0]?.key || null);
    setSending(false);
    setError(null);
  }, [open]);

  const list = recipients || [];
  // "לשניהם" = the bride and the groom (the lead's own phone is a separate choice)
  const pair = list.filter((r) => r.key === "bride" || r.key === "groom");
  const chosen = to === "all" ? pair : list.filter((r) => r.key === to);

  const send = async () => {
    if (!chosen.length || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    const failed = [];
    for (const r of chosen) {
      try {
        await onSend(r.phone, text);
      } catch (e) {
        console.error("schedule send failed:", e);
        failed.push(`${r.label}: ${friendlySendError(e?.message)}`);
      }
    }
    setSending(false);
    if (failed.length === 0) {
      toast.success(chosen.length > 1 ? `${title} נשלח ל${chosen.map((r) => r.label).join(" ול")}` : `${title} נשלח ל${chosen[0].label}`);
      onClose?.();
    } else {
      setError(failed.join("\n"));
    }
  };

  // The clipboard API first; where it is refused (an older iPhone, a page without the
  // permission) the text in the box is selected and copied the old way.
  const copy = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      const el = textRef.current;
      if (el) {
        el.focus();
        el.select();
        el.setSelectionRange(0, text.length);
        try { ok = document.execCommand("copy"); } catch { ok = false; }
      }
    }
    if (ok) toast.success("הטקסט הועתק — אפשר להדביק בוואטסאפ");
    else toast.error("לא הצלחתי להעתיק — סמנו את הטקסט והעתיקו ידנית");
  };

  const sendLabel = !chosen.length
    ? "בחר למי לשלוח"
    : to === "all"
    ? "שלח לכלה ולחתן"
    : `שלח ל${chosen[0].label}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose?.(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-gray-700 bg-gray-900 text-white" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{title} — למי לשלוח?</DialogTitle>
          {subtitle && <p className="text-right text-xs text-gray-400">{subtitle}</p>}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1">
            <textarea
              ref={textRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              disabled={sending}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-white"
            />
            <p className="text-xs text-gray-500">אפשר לערוך את הטקסט לפני השליחה.</p>
          </div>

          {list.length === 0 ? (
            <p className="rounded-lg border border-amber-700/50 bg-amber-900/20 p-2.5 text-xs text-amber-200">
              אין מספר טלפון לזוג — אפשר להעתיק את הטקסט ולשלוח ידנית.
            </p>
          ) : (
            <div className="space-y-1.5">
              {list.length === 1 && <p className="text-xs text-gray-400">יש רק מספר אחד:</p>}
              {list.map((r) => (
                <label key={r.key} className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${to === r.key ? "border-green-500 bg-green-950/30" : "border-gray-700 hover:bg-gray-800"}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="scheduleTo" checked={to === r.key} onChange={() => setTo(r.key)} className="accent-green-500" />
                    {r.label}
                  </span>
                  <span dir="ltr" className="text-xs text-gray-400">{r.phone}</span>
                </label>
              ))}
              {pair.length === 2 && (
                <label className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 ${to === "all" ? "border-green-500 bg-green-950/30" : "border-gray-700 hover:bg-gray-800"}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="scheduleTo" checked={to === "all"} onChange={() => setTo("all")} className="accent-green-500" />
                    לשניהם — כלה וחתן
                  </span>
                  <span className="text-xs text-gray-400">2 הודעות</span>
                </label>
              )}
            </div>
          )}

          {error && <p className="whitespace-pre-line text-xs text-red-300">{error}</p>}

          {list.length > 0 && (
            <Button onClick={send} disabled={sending || !chosen.length || !text.trim()} className="w-full gap-2 bg-green-600 text-white hover:bg-green-700">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {sendLabel}
            </Button>
          )}
          <Button variant="outline" onClick={copy} disabled={!text.trim()} className="w-full gap-2 border-gray-700 bg-gray-800 text-gray-200">
            <Copy className="h-4 w-4" /> העתק טקסט (לשליחה ידנית)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
