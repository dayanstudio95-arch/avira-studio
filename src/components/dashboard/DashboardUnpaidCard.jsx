import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { CreditCard, MessageCircle } from "lucide-react";
import PaymentStatusSelector from "@/components/common/PaymentStatusSelector";
import PaymentRequestDialog from "@/components/dashboard/PaymentRequestDialog";

export default function DashboardUnpaidCard({ events, onRefresh }) {
  const now = new Date();
  const [paymentRequestEvent, setPaymentRequestEvent] = useState(null);

  const unpaidEvents = events.filter(
    (e) => new Date(e.date) < now && e.clientPaymentStatus === "Unpaid"
  );

  return (
    <Card className="dash-card flex flex-col h-full overflow-hidden">
      <CardHeader className="dash-head pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <CreditCard className="w-5 h-5 text-rose-400" />
          לא משולם
          {unpaidEvents.length > 0 && (
            <span className="e-count e-count-red">
              {unpaidEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="e-scroll px-3 py-1 overflow-y-auto flex-grow min-h-0" >
        {unpaidEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">אין חובות פתוחים ✅</div>
        ) : (
          <div>
            {unpaidEvents.map((event) => (
              // Two rows, not one. This card carries more per item than its siblings —
              // a name, a date, a send button and a status dropdown — and once the
              // dashboard went to five columns they no longer fit side by side: the
              // couple's name collapsed to "א…" while the two controls kept their full
              // width. The name is the only part that identifies the row, so it gets
              // the line to itself and the controls move below.
              <div
                key={event.id}
                className="e-row px-2 py-3 rounded-lg hover:bg-white/[0.03] transition-colors"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-white truncate">{event.coupleNames}</p>
                  <p className="text-xs text-slate-400 flex-shrink-0">
                    {format(new Date(event.date), "d/M/yyyy")}
                  </p>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    onClick={() => setPaymentRequestEvent(event)}
                    className="e-chip e-chip-orange flex-shrink-0 hover:brightness-125 transition"
                    title="שלח דרישת תשלום בוואטסאפ"
                  >
                    <MessageCircle className="w-3 h-3" />
                    דרישת תשלום
                  </button>
                  <PaymentStatusSelector
                    eventId={event.id}
                    currentStatus={event.clientPaymentStatus}
                    onStatusChange={onRefresh}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <PaymentRequestDialog
        event={paymentRequestEvent}
        open={!!paymentRequestEvent}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPaymentRequestEvent(null);
        }}
      />
    </Card>
  );
}