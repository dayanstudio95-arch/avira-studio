import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { SUPPLIER_VAT_RATE } from "@/lib/financialCalculations";

// "שלח פירוט" (gold button) on the Payments page — lets the studio send a staff
// member a WhatsApp breakdown of exactly what's owed to them: one line per event
// (date, venue, amount), plus the total, built straight from the same
// paymentsOwed data already shown on-screen (so the numbers can never drift from
// what the studio itself sees). Same template-lookup + send pattern as
// PaymentRequestDialog.jsx (AppSetting key lookup, {{var}} substitution,
// sendWhatsAppMessage Edge Function), just with a staff-specific template key
// and variable set.
export default function StaffPaymentDetailDialog({ open, onOpenChange, staffName, phoneNumber, events, total }) {
  const [messageText, setMessageText] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const buildEventsList = () =>
      (events || [])
        .map((e) => `• ${format(new Date(e.date), "d/M/yy")} - ${e.venue || "ללא מיקום"} - ₪${(e.cost || 0).toLocaleString()}`)
        .join("\n");

    const totalWithVat = Math.round((total || 0) * SUPPLIER_VAT_RATE);

    const buildFallback = () =>
      `היי ${staffName} 😊\nהנה פירוט התשלום שלך:\n${buildEventsList()}\nסה"כ לתשלום: ₪${(total || 0).toLocaleString()} (כולל מע"מ: ₪${totalWithVat.toLocaleString()})`;

    const loadMessage = async () => {
      try {
        const settings = await base44.entities.AppSetting.list();
        const tpl = settings.find((s) => s.key === "template_staff_payment_detail")?.value;
        if (cancelled) return;
        if (tpl) {
          const msg = tpl
            .replace(/\{\{name\}\}/g, staffName || "")
            .replace(/\{\{events_list\}\}/g, buildEventsList())
            .replace(/\{\{total_with_vat\}\}/g, totalWithVat.toLocaleString())
            .replace(/\{\{total\}\}/g, (total || 0).toLocaleString());
          setMessageText(msg);
        } else {
          setMessageText(buildFallback());
        }
      } catch {
        if (!cancelled) setMessageText(buildFallback());
      }
    };

    loadMessage();
    return () => {
      cancelled = true;
    };
  }, [open, staffName]);

  const handleSend = async () => {
    if (!phoneNumber) {
      toast.error("אין מספר טלפון לאיש הצוות הזה");
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
      onOpenChange(false);
    } catch (error) {
      toast.error("שגיאה בשליחה: " + (error?.message || ""));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white">שליחת פירוט תשלום — {staffName}</DialogTitle>
        </DialogHeader>
        {!phoneNumber && (
          <p className="text-red-400 text-xs">
            לא נמצא מספר טלפון עבור איש/אשת הצוות הזה במערכת — לא ניתן לשלוח.
          </p>
        )}
        <textarea
          className="w-full bg-gray-950 text-white text-sm border border-gray-700 rounded-lg p-3 resize-none focus:outline-none focus:border-amber-500"
          rows={8}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          dir="rtl"
        />
        <Button
          onClick={handleSend}
          disabled={isSending || !messageText.trim() || !phoneNumber}
          className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-800 text-gray-900 font-semibold py-2 rounded-lg gap-2"
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
