import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SUPPLIER_VAT_RATE } from "@/lib/financialCalculations";
import { ENTITIES } from "@/lib/paymentEntity";
import { todayInIsrael } from "@/lib/localDate";
import { DEFAULT_INVOICE_BEFORE, INVOICE_BEFORE_KEY, addsVat, invoiceRequest, paymentTotals, requestFor, transferEvents } from "@/lib/staffPaymentMessages";

// "שלח פירוט" (gold button) on the Payments page — lets the studio send a staff
// member a WhatsApp breakdown of exactly what's owed to them: one line per event
// (date, venue, amount), plus the total, built straight from the same
// paymentsOwed data already shown on-screen (so the numbers can never drift from
// what the studio itself sees). Same template-lookup + send pattern as
// PaymentRequestDialog.jsx (AppSetting key lookup, {{var}} substitution,
// sendWhatsAppMessage Edge Function), just with a staff-specific template key
// and variable set.
//
// "לבקש חשבונית לפני התשלום" (2026-11-02, the owner's request; 0108): for team members who are slow with invoices,
// the details the invoice must carry are added below the breakdown ("נא להוציא חשבונית מס כדי שנעביר לך את
// התשלום…"), and a row waits for that invoice (status 'requested', no reminders) — the payments page shows when it
// came, and "שילמתי" turns that row into the payment. An exempt dealer is asked for a receipt and gets no VAT.
export default function StaffPaymentDetailDialog({ open, onOpenChange, staffName, phoneNumber, events, total, staffType, payers, requests, tenantId, onRequested }) {
  const [base, setBase] = useState("");
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [askInvoice, setAskInvoice] = useState(false);
  const [entity, setEntity] = useState("");
  const [beforeTemplate, setBeforeTemplate] = useState("");
  const open0 = requestFor(requests, staffName, events);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAskInvoice(false);
    setEntity(open0?.entity || "");

    const buildEventsList = () =>
      (events || [])
        .map((e) => `• ${format(new Date(e.date), "d/M/yy")} - ${e.venue || "ללא מיקום"} - ₪${(e.cost || 0).toLocaleString()}`)
        .join("\n");

    const vat = addsVat(staffType);
    const totalWithVat = vat ? Math.round((total || 0) * SUPPLIER_VAT_RATE) : total || 0;

    const buildFallback = () =>
      `היי ${staffName} 😊\nהנה פירוט התשלום שלך:\n${buildEventsList()}\nסה"כ לתשלום: ₪${(total || 0).toLocaleString()}${vat ? ` (כולל מע"מ: ₪${totalWithVat.toLocaleString()})` : ""}`;

    const show = (msg) => {
      setBase(msg);
      setMessageText(msg);
    };

    const loadMessage = async () => {
      try {
        const settings = await base44.entities.AppSetting.list();
        const tpl = settings.find((s) => s.key === "template_staff_payment_detail")?.value;
        if (cancelled) return;
        setBeforeTemplate(settings.find((s) => s.key === INVOICE_BEFORE_KEY)?.value || "");
        if (tpl) {
          const msg = tpl
            .replace(/\{\{name\}\}/g, staffName || "")
            .replace(/\{\{events_list\}\}/g, buildEventsList())
            .replace(/\{\{total_with_vat\}\}/g, totalWithVat.toLocaleString())
            .replace(/\{\{total\}\}/g, (total || 0).toLocaleString());
          show(msg);
        } else {
          show(buildFallback());
        }
      } catch {
        if (!cancelled) show(buildFallback());
      }
    };

    loadMessage();
    return () => {
      cancelled = true;
    };
  }, [open, staffName]);

  // The breakdown, and below it the invoice request for the business chosen (rebuilt when either changes).
  useEffect(() => {
    if (!open) return;
    if (!askInvoice || !entity) return setMessageText(base);
    const request = invoiceRequest(beforeTemplate.trim() || DEFAULT_INVOICE_BEFORE, { type: staffType, payer: payers?.[entity], net: total || 0 });
    setMessageText(request ? `${base}\n\n${request}` : base);
  }, [askInvoice, entity, base, beforeTemplate]);

  // The row that waits for the invoice: the team member's open request for these works, updated; else a new one.
  const keepRequest = async () => {
    const totals = paymentTotals(events, staffType);
    const fields = { amount: totals.gross, entity, events: transferEvents(events), paid_on: todayInIsrael(), updated_at: new Date().toISOString() };
    const { error } = open0
      ? await supabase.from("staff_transfers").update(fields).eq("id", open0.id)
      : await supabase.from("staff_transfers").insert({ ...fields, tenant_id: tenantId, staff_member_name: staffName, source: "request", status: "requested", reminders_on: false });
    if (error) toast.warning("ההודעה נשלחה, אבל הבקשה לא נשמרה במעקב: " + error.message);
    onRequested?.();
  };

  const handleSend = async () => {
    if (!phoneNumber) {
      toast.error("אין מספר טלפון לאיש הצוות הזה");
      return;
    }
    if (askInvoice && !entity) {
      toast.error("בוחרים על שם איזה עסק החשבונית");
      return;
    }
    setIsSending(true);
    try {
      const result = await base44.functions.invoke("sendWhatsAppMessage", {
        to: phoneNumber,
        message: messageText,
      });
      if (result.data?.error) {
        throw new Error(result.data.error);
      }
      toast.success("הפירוט נשלח בהצלחה! ✓");
      if (askInvoice && staffType !== "none") await keepRequest();
      onOpenChange(false);
    } catch (error) {
      toast.error("שגיאה בשליחה: " + (error?.message || ""));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md max-h-[92vh] overflow-y-auto" dir="rtl" data-testid="payment-detail">
        <DialogHeader>
          <DialogTitle className="text-white">שליחת פירוט תשלום — {staffName}</DialogTitle>
        </DialogHeader>
        {!phoneNumber && (
          <p className="text-red-400 text-xs">
            לא נמצא מספר טלפון עבור איש/אשת הצוות הזה במערכת — לא ניתן לשלוח.
          </p>
        )}
        {staffType !== "none" && (
          <div className="space-y-2 rounded-lg border border-gray-800 p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={askInvoice} onCheckedChange={(v) => setAskInvoice(!!v)} className="border-gray-600" data-testid="detail-ask-invoice" />
              לבקש {staffType === "exempt" ? "קבלה" : "חשבונית"} לפני התשלום
            </label>
            {askInvoice && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-gray-400">על שם:</span>
                {["company", "sole_prop"].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setEntity(k)}
                    className={`rounded-md border px-2.5 py-1 ${entity === k ? "border-brand-400 bg-brand-400/15 ring-1 ring-brand-400 text-white" : "border-gray-700 text-gray-300 hover:border-gray-500"}`}
                    aria-pressed={entity === k}
                    data-testid={`detail-entity-${k}`}
                  >
                    {entity === k ? "✓ " : ""}
                    {ENTITIES[k].label}
                  </button>
                ))}
                {entity && !payers?.[entity]?.id && <p className="w-full text-xs text-amber-300">חסרים הפרטים של {ENTITIES[entity].label} — ממלאים ב"חשבוניות מהצוות" ← עוד ← פרטי שני העסקים.</p>}
              </div>
            )}
            {open0 && <p className="text-xs text-gray-500">כבר ביקשת ממנו חשבונית על חלק מהאירועים האלה{open0.arrived ? " — והיא הגיעה" : ""}.</p>}
          </div>
        )}
        <textarea
          className="w-full bg-gray-950 text-white text-sm border border-gray-700 rounded-lg p-3 resize-y focus:outline-none focus:border-amber-500"
          rows={askInvoice ? 14 : 8}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          dir="rtl"
          data-testid="detail-message"
        />
        <Button
          onClick={handleSend}
          disabled={isSending || !messageText.trim() || !phoneNumber}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-800 text-gray-900 font-semibold py-2 rounded-lg gap-2"
          data-testid="detail-send"
        >
          {isSending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              שולח...
            </>
          ) : (
            <>
              <MessageCircle className="w-4 h-4 mr-2" />
              אשר ושלח
            </>
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
