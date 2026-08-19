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
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm flex flex-col h-full">
      <CardHeader className="border-b border-gray-800 pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-sm font-semibold">
          <CreditCard className="w-4 h-4 text-red-400" />
          לא משולם
          {unpaidEvents.length > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unpaidEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-grow" style={{ maxHeight: "260px" }}>
        {unpaidEvents.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">אין חובות פתוחים ✅</div>
        ) : (
          <div className="divide-y divide-gray-800/60">
            {unpaidEvents.map((event) => (
              <div
                key={event.id}
                className="flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-800/40 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{event.coupleNames}</p>
                  <p className="text-xs text-gray-400">{format(new Date(event.date), "d/M/yyyy")}</p>
                </div>
                <button
                  onClick={() => setPaymentRequestEvent(event)}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap border bg-orange-600/20 text-orange-300 border-orange-500/40 hover:bg-orange-600/30 transition-colors flex-shrink-0"
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