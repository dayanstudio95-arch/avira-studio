import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { missingSummary } from "@/lib/staffInvoices";

// "חשבוניות מהצוות" on the dashboard (2026-11-02, the owner's request; 0106): one slim line, only while transfers to
// the team still wait for their invoice — the dashboard's own layout stays as the owner set it. Owner / admin / studio
// manager only (the tables' RLS: anyone else reads nothing, and the line doesn't show).
export default function StaffInvoicesBanner() {
  const { data } = useQuery({
    queryKey: ["staffInvoicesBanner"],
    queryFn: async () => {
      const [t, s] = await Promise.all([
        supabase.from("staff_transfers").select("staff_member_name, amount, status").eq("status", "waiting"),
        supabase.from("staff_members").select("name, invoice_type"),
      ]);
      if (t.error) return null;
      return missingSummary(t.data || [], Object.fromEntries((s.data || []).map((m) => [m.name, m.invoice_type])));
    },
    staleTime: 60_000,
  });
  if (!data?.count) return null;
  return (
    <Link to="/StaffInvoices" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-100 hover:border-amber-500" data-testid="staff-invoices-banner">
      <Receipt className="h-4 w-4 text-amber-300" />
      <span className="font-semibold">{data.count === 1 ? "העברה אחת לצוות ממתינה לחשבונית" : `${data.count} העברות לצוות ממתינות לחשבונית`}</span>
      <span className="text-amber-200/80">{Number(data.sum).toLocaleString("he-IL")} ₪{data.vat ? ` · מע״מ שעוד לא חוזר: ${data.vat.toLocaleString("he-IL")} ₪` : ""}</span>
      <span className="mr-auto text-amber-300 underline">לרשימה</span>
    </Link>
  );
}
