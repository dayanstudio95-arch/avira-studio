import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { FileSignature, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { applyLeadTemplateVariables } from "@/lib/leadMessages";

// "שלח חוזה בוואטסאפ" from the chat (2026-10-13, the owner's request): the same message
// as the lead panel's button (template "template_contract"), shown first and editable,
// sent into this chat. Like the lead panel, a lead that is not signed / closed moves to
// "נשלחה הצעה" with contract_sent_at — which also starts the 3-day unsigned reminder.
export const DEFAULT_CONTRACT_MESSAGE = "שלום {{names}},\n\nפה החוזה שלכם:\n{{contract_link}}";
const CLOSED = ["חוזה", "נסגר/חתימה"];

export default function SendContractButton({ leadId, conversation }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [lead, setLead] = useState(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const start = async () => {
    setLoading(true);
    try {
      const [l, settings] = await Promise.all([
        base44.entities.Lead.get(leadId),
        base44.entities.AppSetting.filter({ key: "template_contract" }),
      ]);
      if (!l) throw new Error("הליד לא נמצא");
      const template = settings?.[0]?.value?.trim() || DEFAULT_CONTRACT_MESSAGE;
      setLead(l);
      setText(applyLeadTemplateVariables(template, l, { eventDate: l.eventDate }));
      setOpen(true);
    } catch (e) {
      toast.error("לא הצלחנו להכין את החוזה", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const message = text.trim();
    if (!message || !lead) return;
    const to = conversation?.phone || lead.phoneNumber;
    if (!(await confirmDialog({ title: `לשלוח את החוזה ל${lead.coupleNames || "זוג"}?`, message: `בשיחה הזו${to ? ` (${to})` : ""}`, confirmText: "שלח" }))) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", {
        chatId: conversation?.chatId || null,
        to: to || null,
        message,
      });
      if (res?.data?.error) throw new Error(res.data.error);
      if (!CLOSED.includes(lead.status)) {
        const now = new Date().toISOString();
        await base44.entities.Lead.update(lead.id, {
          status: "נשלחה הצעה",
          contractSent: true,
          contractSentAt: now,
          lastContactDate: now,
        });
      }
      toast.success("החוזה נשלח");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["chatLeads"] });
      qc.invalidateQueries({ queryKey: ["unsignedContracts"] });
      if (conversation?.id) setTimeout(() => qc.invalidateQueries({ queryKey: ["chatMessages", conversation.id] }), 1500);
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={loading}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
        שלח חוזה בוואטסאפ
      </button>

      {/* A portal: the panel is a drawer on narrow screens, and a fixed window inside it
          would be placed inside the drawer instead of over the screen. */}
      {open && createPortal(
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:items-center" onClick={() => !sending && setOpen(false)}>
          <div role="dialog" aria-label="שליחת חוזה" onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[460px] md:rounded-2xl md:border" dir="rtl">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-bold text-white">שליחת חוזה · {lead?.coupleNames || "זוג"}</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <p className="mb-2 text-xs text-gray-400">
              ההודעה מהתבנית "שליחת חוזה". אפשר לערוך לפני השליחה.
              {lead && !CLOSED.includes(lead.status) ? ' אחרי השליחה הליד יעבור ל"נשלחה הצעה".' : ""}
            </p>
            {lead?.signedAt && <p className="mb-2 rounded-lg bg-amber-950/50 px-2 py-1 text-xs text-amber-200">שים לב: הזוג כבר חתם על החוזה.</p>}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              dir="rtl"
              className="w-full resize-y rounded-lg border border-gray-800 bg-gray-900 p-2 text-sm text-gray-100"
            />
            <button type="button" onClick={send} disabled={sending || !text.trim()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח
            </button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
