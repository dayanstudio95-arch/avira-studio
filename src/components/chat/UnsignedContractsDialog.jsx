import React, { useEffect, useState } from "react";
import { Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { applyLeadTemplateVariables } from "@/lib/leadMessages";
import { daysSince } from "@/lib/contractReminder";
import { contractViewInfo } from "@/lib/contractViews";

// "📝 חוזים שלא נחתמו" (2026-10-13, the owner's choice): 3 days after the contract went out
// and still unsigned, the couple is here with the reminder text ready. Nothing is sent by
// itself — "שלח" asks first; "דלג" just takes the couple off the list. The text is the
// template "תזכורת פולו-אפ (חוזה לא נחתם)" from הגדרות ← תבניות.
export default function UnsignedContractsDialog({ leads, template, onDone, onClose }) {
  const [texts, setTexts] = useState({});
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    const out = {};
    for (const l of leads) out[l.id] = applyLeadTemplateVariables(template, l, { eventDate: l.eventDate });
    setTexts((prev) => ({ ...out, ...prev }));
  }, [leads, template]);

  // Couples handled in this window disappear at once, before the list reloads.
  const [gone, setGone] = useState(() => new Set());
  const hide = (id) => setGone((g) => new Set(g).add(id));

  // The claim: only the first press (here, or on another phone) gets the row back — so
  // Daniel and Sabina can never both send the same reminder.
  const claim = async (lead) => {
    const { data, error } = await supabase
      .from("leads")
      .update({ contract_reminder_done_at: new Date().toISOString() })
      .eq("id", lead.id)
      .is("contract_reminder_done_at", null)
      .select("id");
    if (error) throw error;
    return (data || []).length > 0;
  };
  const release = (lead) =>
    supabase.from("leads").update({ contract_reminder_done_at: null }).eq("id", lead.id).then(() => {}, () => {});

  const send = async (lead) => {
    const message = (texts[lead.id] || "").trim();
    if (!message) return;
    if (!(await confirmDialog({ title: `לשלוח תזכורת ל${lead.coupleNames || "זוג"}?`, message: `ב-${lead.phoneNumber}`, confirmText: "שלח" }))) return;
    setBusy(lead.id);
    try {
      let claimed;
      try {
        claimed = await claim(lead);
      } catch (e) {
        toast.error("לא נשלח — לא הצלחנו לעדכן את הליד", { description: e?.message });
        return;
      }
      if (!claimed) {
        toast.info("כבר טופל (אולי ממכשיר אחר) — לא נשלח שוב");
        hide(lead.id);
        onDone();
        return;
      }
      try {
        const res = await base44.functions.invoke("sendWhatsAppMessage", { to: lead.phoneNumber, message, respect_opt_out: true });
        if (res?.data?.skipped) toast.error("לא נשלח", { description: "הזוג ביקש לא לקבל הודעות" });
        else toast.success("התזכורת נשלחה");
        hide(lead.id);
        onDone();
      } catch (e) {
        await release(lead); // nothing went out — back on the list
        toast.error("השליחה נכשלה", { description: e?.message });
      }
    } finally {
      setBusy(null);
    }
  };

  const skip = async (lead) => {
    setBusy(lead.id);
    try {
      await claim(lead);
      hide(lead.id);
      toast.success("הוסר מהרשימה");
      onDone();
    } catch (e) {
      toast.error("לא הצלחנו לעדכן", { description: e?.message });
    } finally {
      setBusy(null);
    }
  };
  const shown = leads.filter((l) => !gone.has(l.id));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="חוזים שלא נחתמו" onClick={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full flex-col rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[520px] md:rounded-2xl md:border">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-bold text-white">📝 חוזים שלא נחתמו</span>
          <button type="button" onClick={onClose} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-gray-400">נשלח להם חוזה לפני 3 ימים או יותר ועוד לא חתמו. ההודעה מוכנה — אפשר לערוך לפני השליחה.</p>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {shown.length === 0 && <div className="py-8 text-center text-sm text-gray-500">אין חוזים שמחכים לתזכורת 🎉</div>}
          {shown.map((l) => {
            const view = contractViewInfo(l);
            return (
              <div key={l.id} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-white">{l.coupleNames || "ללא שם"}</span>
                  <span className="shrink-0 text-xs text-gray-400">נשלח לפני {daysSince(l.contractSentAt)} ימים</span>
                </div>
                <div className="text-xs text-gray-400">
                  {l.eventDate ? new Date(l.eventDate).toLocaleDateString("he-IL") : "תאריך לא ידוע"}
                  {l.venueName ? ` · ${l.venueName}` : ""}
                </div>
                {view && <div className={`mt-0.5 text-xs ${view.opened ? "text-amber-300" : "text-gray-500"}`}>{view.text}</div>}
                <textarea
                  value={texts[l.id] || ""}
                  onChange={(e) => setTexts((t) => ({ ...t, [l.id]: e.target.value }))}
                  rows={5}
                  dir="rtl"
                  className="mt-2 w-full resize-y rounded-lg border border-gray-800 bg-gray-950 p-2 text-sm text-gray-100"
                />
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy === l.id} onClick={() => send(l)} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2 text-sm font-semibold text-gray-950 disabled:opacity-50">
                    {busy === l.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח
                  </button>
                  <button type="button" disabled={busy === l.id} onClick={() => skip(l)} className="rounded-xl border border-gray-700 px-4 text-sm text-gray-300 hover:text-white disabled:opacity-50">
                    דלג
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
