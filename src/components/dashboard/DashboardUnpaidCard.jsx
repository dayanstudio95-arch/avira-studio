import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/api/supabaseClient";
import { ENTITIES } from "@/lib/paymentEntity";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { CreditCard, MessageCircle } from "lucide-react";
import PaymentStatusSelector from "@/components/common/PaymentStatusSelector";
import PaymentRequestDialog from "@/components/dashboard/PaymentRequestDialog";
import DashTitleLink from "./DashTitleLink";

export default function DashboardUnpaidCard({ events, onRefresh }) {
  const now = new Date();
  const [paymentRequestEvent, setPaymentRequestEvent] = useState(null);

  const allUnpaid = events.filter(
    (e) => new Date(e.date) < now && e.clientPaymentStatus === "Unpaid"
  );

  // Which business each couple pays (2026-10-14) — a tag per row and a filter, so the
  // invoices can be issued from the right business.
  const [entityFilter, setEntityFilter] = useState("all");
  const leadIds = useMemo(() => [...new Set(allUnpaid.map((e) => e.sourceLeadId).filter(Boolean))].sort(), [allUnpaid]);
  const entityQ = useQuery({
    queryKey: ["unpaidEntities", leadIds.join(",")],
    enabled: leadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, payment_entity, payment_request_entity, payment_request_sent_at")
        .in("id", leadIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((l) => [l.id, l]));
    },
  });
  const entityOf = (e) => entityQ.data?.[e.sourceLeadId]?.payment_entity || entityQ.data?.[e.sourceLeadId]?.payment_request_entity || null;
  const unpaidEvents = allUnpaid.filter((e) => entityFilter === "all" || (entityOf(e) || "none") === entityFilter);
  const filters = [
    { key: "all", label: "הכל" },
    { key: "sole_prop", label: "מורשה" },
    { key: "company", label: "חברה" },
    { key: "none", label: "לא נקבע" },
  ];

  return (
    <Card className="dash-card flex flex-col h-full overflow-hidden">
      <CardHeader className="dash-head pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold"><DashTitleLink to="/Events">
          <CreditCard className="w-5 h-5 text-rose-400" />
          לא משולם
          {unpaidEvents.length > 0 && (
            <span className="e-count e-count-red">
              {unpaidEvents.length}
            </span>
          )}
        </DashTitleLink></CardTitle>
      </CardHeader>
      <CardContent className="e-scroll px-3 py-1 overflow-y-auto flex-grow min-h-0" >
        {allUnpaid.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1 px-1 pt-1">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setEntityFilter(f.key)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] ${entityFilter === f.key ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-slate-700 text-slate-400 hover:text-white"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
        {unpaidEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">{allUnpaid.length === 0 ? "אין חובות פתוחים ✅" : "אין אירועים בסינון הזה"}</div>
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
                  <p className="text-sm font-medium text-white truncate">
                    {event.coupleNames}
                    {entityOf(event) && (
                      <span className={`ms-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${entityOf(event) === "company" ? "bg-purple-500/20 text-purple-200" : "bg-emerald-500/20 text-emerald-200"}`}>
                        {ENTITIES[entityOf(event)].short}
                      </span>
                    )}
                  </p>
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
        onSent={() => entityQ.refetch()}
      />
    </Card>
  );
}