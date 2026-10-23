import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

// "שלח לצוות" (2026-10-24, the owner's request): the "תזכורת צלם יום לפני" message for one
// event, to its crew, now — after a preview. The server (send-event-crew-brief) builds the
// message exactly like the automation and checks every recipient; here the owner unticks
// whoever shouldn't get it and may edit the text. Nothing is sent before "שלח".
const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" });
  } catch {
    return "";
  }
};

export default function SendCrewBriefDialog({ eventId, isOpen, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState({}); // staffId → true
  const [texts, setTexts] = useState({}); // staffId → message (edited)
  const [shownId, setShownId] = useState(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState(null);

  useEffect(() => {
    if (!isOpen || !eventId) return;
    let cancelled = false;
    setPreview(null); setError(null); setResults(null); setPicked({}); setTexts({}); setShownId(null);
    base44.functions.invoke("sendEventCrewBrief", { eventId, mode: "preview" })
      .then((res) => {
        if (cancelled) return;
        const data = res?.data;
        setPreview(data);
        const ok = (data?.recipients || []).filter((r) => r.staffId && !r.problem);
        // Someone who already got the reminder today starts unticked — sending again is a choice.
        setPicked(Object.fromEntries(ok.map((r) => [r.staffId, !r.sentTodayAt])));
        setTexts(Object.fromEntries(ok.map((r) => [r.staffId, r.message])));
        setShownId(ok[0]?.staffId || null);
      })
      .catch((e) => { if (!cancelled) setError(e?.message || "שגיאה בטעינה"); });
    return () => { cancelled = true; };
  }, [isOpen, eventId]);

  const recipients = preview?.recipients || [];
  const chosen = recipients.filter((r) => r.staffId && !r.problem && picked[r.staffId]);
  const shown = recipients.find((r) => r.staffId === shownId);

  const send = async () => {
    if (chosen.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendEventCrewBrief", {
        eventId,
        mode: "send",
        recipients: chosen.map((r) => ({ staffId: r.staffId, message: texts[r.staffId] })),
      });
      const out = res?.data?.results || [];
      setResults(out);
      const sent = out.filter((r) => r.status === "sent").length;
      if (sent === out.length) toast.success(sent === 1 ? "ההודעה נשלחה" : `נשלח ל-${sent} אנשי צוות`);
      else toast.error(`נשלח ל-${sent} מתוך ${out.length}`);
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !sending) onClose?.(); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">שלח לצוות{preview?.coupleNames ? ` — ${preview.coupleNames}` : ""}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-red-300">{error}</p>}
        {!preview && !error && (
          <div className="flex items-center justify-center gap-2 py-8 text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> טוען…</div>
        )}

        {preview && !results && (
          <div className="space-y-3">
            <p className="text-xs text-slate-400">אותה הודעה כמו "{preview.automationName || "תזכורת צלם יום לפני"}"</p>
            {preview.testMode && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">התזכורת במצב בדיקה — לא יישלחו הודעות אמיתיות. אפשר לכבות בדף האוטומציות.</div>
            )}
            {recipients.length === 0 && <p className="text-sm text-slate-400">אין באירוע הזה אנשי צוות לשלוח להם (חוץ מהעורך).</p>}
            <div className="space-y-1.5">
              {recipients.map((r) => (
                <label
                  key={r.staffId || r.name}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${r.staffId === shownId ? "border-violet-500/60 bg-violet-500/10" : "border-slate-700 bg-slate-800/40"} ${r.problem ? "opacity-60" : "cursor-pointer"}`}
                  onClick={() => r.staffId && !r.problem && setShownId(r.staffId)}
                >
                  <input
                    type="checkbox"
                    disabled={!!r.problem}
                    checked={!!(r.staffId && picked[r.staffId])}
                    onChange={(e) => setPicked((p) => ({ ...p, [r.staffId]: e.target.checked }))}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 accent-violet-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-slate-400"> · {r.slots.join(" + ")}</span>
                    {r.problem && <span className="block text-[11px] text-red-300">{r.problem} — לא יישלח</span>}
                    {r.sentTodayAt && <span className="block text-[11px] text-amber-300">כבר קיבל היום ב-{timeOf(r.sentTodayAt)}</span>}
                  </span>
                  {r.phone && <span className="text-xs text-slate-400" dir="ltr">{r.phone}</span>}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">העורך לא מקבל — כמו בתזכורת האוטומטית.</p>

            {shown && (
              <div>
                <div className="mb-1 text-xs text-slate-400">ההודעה ל{shown.name} · אפשר לערוך</div>
                <textarea
                  value={texts[shown.staffId] ?? ""}
                  onChange={(e) => setTexts((t) => ({ ...t, [shown.staffId]: e.target.value }))}
                  rows={12}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/60 p-2 text-sm text-white"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={send} disabled={sending || chosen.length === 0 || preview.testMode} className="flex-1 gap-2 bg-violet-600 text-white hover:bg-violet-700">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? "שולח…" : `שלח ל-${chosen.length}`}
              </Button>
              <Button variant="outline" onClick={onClose} disabled={sending} className="border-slate-700 bg-slate-800 text-slate-200">ביטול</Button>
            </div>
          </div>
        )}

        {results && (
          <div className="space-y-2">
            {results.map((r, i) => (
              <div key={r.staffId || i} className="flex justify-between rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm">
                <span>{r.name || "—"}</span>
                <span className={r.status === "sent" ? "text-green-400" : "text-red-300"}>
                  {r.status === "sent" ? "✓ נשלח" : `לא נשלח${r.error ? ` — ${r.error}` : ""}`}
                </span>
              </div>
            ))}
            <Button onClick={onClose} className="w-full bg-slate-700 text-white hover:bg-slate-600">סגור</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
