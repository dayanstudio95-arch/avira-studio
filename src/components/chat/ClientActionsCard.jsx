import React, { useEffect, useState } from "react";
import { CalendarClock, FileCheck, FileDown, Loader2, Receipt, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import InvoiceDialog from "@/components/invoice/InvoiceDialog";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { openSignedContract } from "@/lib/signedContract";
import { SCHEDULE_OPTIONS, applyLeadTemplateVariables, loadScheduleTemplates } from "@/lib/leadMessages";

// "פעולות ללקוח" in the chat's contact panel (2026-10-09, the owner's request): the same
// three actions as the lead pop-up (UnifiedSidePanel), behaving exactly the same — schedule
// sent on click from the saved template, signed contract after a confirmation, the same
// invoice window. Shown for "לקוח" chats; the lead is the linked one, else found by phone.
const SCHEDULE_CLS = {
  summer: "bg-amber-600 hover:bg-amber-700 disabled:bg-amber-800",
  winter: "bg-sky-600 hover:bg-sky-700 disabled:bg-sky-800",
  friday: "bg-violet-600 hover:bg-violet-700 disabled:bg-violet-800",
};

async function findLead(conversation) {
  if (conversation.matchedLeadId) {
    const lead = await base44.entities.Lead.get(conversation.matchedLeadId).catch(() => null);
    if (lead) return lead;
  }
  const last9 = String(conversation.phone || "").replace(/\D/g, "").slice(-9);
  if (last9.length !== 9) return null;
  const { data } = await supabase
    .from("leads")
    .select("id")
    .or(`phone_number.ilike.%${last9},signed_phone_number.ilike.%${last9}`)
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1);
  return data?.[0]?.id ? base44.entities.Lead.get(data[0].id).catch(() => null) : null;
}

export default function ClientActionsCard({ conversation }) {
  const [state, setState] = useState({ loading: true, lead: null, event: null });
  const [templates, setTemplates] = useState({});
  const [sending, setSending] = useState(null); // 'summer' | 'winter' | 'friday' | 'contract'
  const [invoiceType, setInvoiceType] = useState(null); // 'sole_prop' | 'company'

  const load = async () => {
    try {
      const lead = await findLead(conversation);
      const events = lead ? await base44.entities.Event.filter({ sourceLeadId: lead.id }).catch(() => []) : [];
      setState({ loading: false, lead, event: events?.[0] || null });
    } catch {
      setState({ loading: false, lead: null, event: null });
    }
  };

  useEffect(() => {
    setState({ loading: true, lead: null, event: null });
    load();
    loadScheduleTemplates().then(setTemplates).catch(() => setTemplates({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id, conversation.matchedLeadId]);

  const { lead, event } = state;
  if (state.loading) {
    return <div className="flex justify-center rounded-xl border border-gray-800 bg-gray-900 p-4"><Loader2 className="h-4 w-4 animate-spin text-gray-500" /></div>;
  }
  if (!lead) {
    return <p className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-500">לא נמצא ליד לשיחה הזו — אין לוז, חוזה או חשבונית לשלוח מכאן.</p>;
  }

  const eventDate = event?.date || lead.eventDate;
  const venue = event?.venue || lead.venueName || "";
  const coupleNames = event?.coupleNames || lead.coupleNames || "";
  const invoices = lead.invoicesList || [];
  const paidFromInvoices = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const balance = (lead.finalPrice || 0) - (paidFromInvoices > 0 ? paidFromInvoices : lead.totalPaid || 0);

  const sendSchedule = async (opt) => {
    if (!lead.phoneNumber) {
      toast.error("אין מספר טלפון");
      return;
    }
    const raw = templates[opt.key];
    if (!raw?.trim()) {
      toast.error(`יש להגדיר קודם את תבנית "${opt.label}" בהגדרות → תבניות הודעה`);
      return;
    }
    setSending(opt.key);
    try {
      const message = applyLeadTemplateVariables(raw, lead, { eventDate, venue: event?.venue });
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: lead.phoneNumber, message });
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`${opt.label} נשלח בהצלחה`);
    } catch {
      toast.error("שגיאה בשליחה");
    }
    setSending(null);
  };

  const sendContract = async () => {
    if (!lead.phoneNumber) {
      toast.error("אין מספר טלפון");
      return;
    }
    if (!await confirmDialog(`לשלוח את החוזה החתום ל-${lead.coupleNames || "הזוג"} ב-${lead.phoneNumber}?`)) return;
    setSending("contract");
    try {
      await base44.functions.invoke("sendSignedContract", { leadId: lead.id });
      toast.success("החוזה החתום נשלח לזוג");
    } catch (e) {
      toast.error("שליחת החוזה נכשלה", { description: e?.message });
    }
    setSending(null);
  };

  const btn = "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-60";

  return (
    <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-3 text-sm">
      <h3 className="text-xs font-semibold text-gray-500">פעולות ללקוח</h3>

      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] text-gray-500"><CalendarClock className="h-3.5 w-3.5" /> שלח לוז</div>
        <div className="grid grid-cols-3 gap-1.5">
          {SCHEDULE_OPTIONS.map((opt) => (
            <button key={opt.key} type="button" onClick={() => sendSchedule(opt)} disabled={sending === opt.key} className={`${btn} ${SCHEDULE_CLS[opt.key]}`}>
              {sending === opt.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {lead.signedContractPdfUrl && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1 text-[11px] text-gray-500"><FileCheck className="h-3.5 w-3.5" /> חוזה חתום</div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => openSignedContract(lead.signedContractPdfUrl).catch((e) => toast.error("פתיחת החוזה החתום נכשלה", { description: e?.message }))}
              className={`${btn} bg-green-700 hover:bg-green-600`}
            >
              <FileDown className="h-4 w-4" /> צפה בחוזה
            </button>
            <button type="button" onClick={sendContract} disabled={sending === "contract"} title="שולח לזוג את החוזה החתום כקובץ PDF בוואטסאפ" className={`${btn} bg-teal-600 hover:bg-teal-700`}>
              {sending === "contract" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending === "contract" ? "שולח..." : "שלח לזוג"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1 text-[11px] text-gray-500"><Receipt className="h-3.5 w-3.5" /> חשבונית</div>
        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => setInvoiceType("sole_prop")} className={`${btn} bg-emerald-600 hover:bg-emerald-700`}>חשבונית מס קבלה</button>
          <button type="button" onClick={() => setInvoiceType("company")} className={`${btn} bg-purple-600 hover:bg-purple-700`}>חשבונית חברה בע״מ</button>
        </div>
      </div>

      <InvoiceDialog
        isOpen={invoiceType !== null}
        onClose={() => setInvoiceType(null)}
        businessType={invoiceType || "sole_prop"}
        coupleNames={coupleNames}
        eventDate={eventDate}
        venueName={venue}
        clientEmail={lead.email}
        clientPhone={lead.phoneNumber}
        leadId={lead.id}
        remainingBalance={balance}
        eventId={event?.id || lead.linkedEventId}
        onInvoiceCreated={load}
      />
    </section>
  );
}
