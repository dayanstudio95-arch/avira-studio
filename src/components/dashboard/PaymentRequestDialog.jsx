import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";

// Reuses the exact same message-building + send logic as
// UnifiedSidePanel.jsx's "שלח דרישת תשלום בוואטסאפ" flow (buildPaymentMessage /
// handleOpenPaymentSection / handleSendPaymentRequest / sendViaWebhook) —
// same template lookup (AppSetting key 'template_payment_request'), same
// {{names}}/{{balance}}/{{payment_link}} substitution, same fallback message,
// same send call (sendWhatsAppMessage Edge Function). Packaged here as a
// standalone Dialog (rather than the inline expanding panel used inside the
// lead side panel) so it can be triggered from the Financial Dashboard's "לא
// משולם" list too, where there's no lead/event side panel already open.
//
// IMPORTANT: the `events` table has NO final_price/total_paid columns at all
// (see supabase/migrations/0001_init.sql — those live only on `leads`, via
// `event.sourceLeadId`). UnifiedSidePanel's real balance math always reads
// from the resolved `lead`, never from `event` — so this dialog does the same:
// it takes `event` just to know which couple/phone/lead to act on, then loads
// the matching `leads` row itself to get the real finalPrice/totalPaid.
export default function PaymentRequestDialog({ event, open, onOpenChange }) {
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [lead, setLead] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    if (!open || !event) return;
    let cancelled = false;

    const buildFallback = (resolvedLead) => {
      const balance = (resolvedLead?.finalPrice || 0) - (resolvedLead?.totalPaid || 0);
      const names = resolvedLead?.coupleNames || event?.coupleNames || '';
      return `היי ${names}, מזל טוב! 🎉\nנשארה יתרה לתשלום על סך ${balance.toLocaleString('he-IL')} ש"ח.\nניתן לשלם כאן: [לינק לתשלום]`;
    };

    const loadMessage = async () => {
      // Resolve the real lead (source of truth for finalPrice/totalPaid) —
      // fall back to the event's own fields (couple name / phone) if no
      // linked lead is found, so the dialog still opens usably either way.
      let resolvedLead = null;
      try {
        if (event?.sourceLeadId) {
          const matches = await base44.entities.Lead.filter({ id: event.sourceLeadId });
          resolvedLead = matches?.[0] || null;
        }
      } catch {
        resolvedLead = null;
      }
      if (cancelled) return;
      setLead(resolvedLead);
      setPhoneNumber(resolvedLead?.phoneNumber || event?.phoneNumber || '');

      const balance = (resolvedLead?.finalPrice || 0) - (resolvedLead?.totalPaid || 0);
      const names = resolvedLead?.coupleNames || event?.coupleNames || '';
      try {
        const settings = await base44.entities.AppSetting.list();
        const tpl = settings.find((s) => s.key === 'template_payment_request')?.value;
        if (cancelled) return;
        if (tpl) {
          const msg = tpl
            .replace(/\{\{names\}\}/g, names)
            .replace(/\{\{balance\}\}/g, balance.toLocaleString('he-IL'))
            .replace(/\{\{payment_link\}\}/g, '[לינק לתשלום]');
          setMessageText(msg);
        } else {
          setMessageText(buildFallback(resolvedLead));
        }
      } catch {
        if (!cancelled) setMessageText(buildFallback(resolvedLead));
      }
    };

    loadMessage();
    return () => {
      cancelled = true;
    };
  }, [open, event]);

  const handleSend = async () => {
    if (!phoneNumber) {
      toast.error('אין מספר טלפון לאירוע הזה');
      return;
    }
    setIsSending(true);
    try {
      const result = await base44.functions.invoke('sendWhatsAppMessage', {
        to: phoneNumber,
        message: messageText,
      });
      if (result.data?.error) {
        throw new Error(result.data.error);
      }
      toast.success('דרישת התשלום נשלחה בהצלחה! ✓');
      onOpenChange(false);
    } catch (error) {
      toast.error('שגיאה בשליחה: ' + (error?.message || ''));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white">
            דרישת תשלום — {event?.coupleNames}
          </DialogTitle>
        </DialogHeader>
        <textarea
          className="w-full bg-gray-950 text-white text-sm border border-gray-700 rounded-lg p-3 resize-none focus:outline-none focus:border-orange-500"
          rows={6}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          dir="rtl"
        />
        <Button
          onClick={handleSend}
          disabled={isSending || !messageText.trim()}
          className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-semibold py-2 rounded-lg gap-2"
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
