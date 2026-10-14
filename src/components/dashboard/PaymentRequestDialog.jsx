import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import PaymentRequestComposer from "@/components/payments/PaymentRequestComposer";

// "דרישת תשלום" from the dashboard's "לא משולם" list — the same composer as the lead panel
// (PaymentRequestComposer: first "מאיזה עסק לשלוח?", then that business's template).
//
// IMPORTANT: the `events` table has NO final_price/total_paid columns at all
// (see supabase/migrations/0001_init.sql — those live only on `leads`, via
// `event.sourceLeadId`). So the dialog takes `event` to know which couple/phone/lead to
// act on, then loads the matching `leads` row itself for finalPrice/totalPaid and the
// couple's business.
export default function PaymentRequestDialog({ event, open, onOpenChange, onSent }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !event) return;
    let cancelled = false;
    setLoading(true);
    setLead(null);
    (async () => {
      let resolved = null;
      try {
        if (event?.sourceLeadId) {
          const matches = await base44.entities.Lead.filter({ id: event.sourceLeadId });
          resolved = matches?.[0] || null;
        }
      } catch {
        resolved = null;
      }
      if (!cancelled) {
        setLead(resolved);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, event]);

  const names = lead?.coupleNames || event?.coupleNames || "";
  const balance = (lead?.finalPrice || 0) - (lead?.totalPaid || 0);
  const phone = lead?.phoneNumber || event?.phoneNumber || "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white">דרישת תשלום — {event?.coupleNames}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <PaymentRequestComposer
            key={event?.id}
            lead={lead}
            names={names}
            balance={balance}
            phone={phone}
            onSent={(entity) => {
              onSent?.(entity);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
