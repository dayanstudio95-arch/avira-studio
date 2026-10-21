import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/api/supabaseClient";

// A couple's work orders (newest first). RLS: owner/admin/studio_manager only — anyone else
// simply gets none.
export async function fetchWorkOrders(leadId) {
  if (!leadId) return [];
  const { data, error } = await supabase
    .from("work_orders")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Anything that issues an order or an invoice says so here, so every card / wizard / invoice
// window showing that couple reloads (they are separate components on the same screen).
const CHANGED_EVENT = "avira:work-orders-changed";
export function notifyWorkOrdersChanged(leadId) {
  if (leadId) window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: { leadId } }));
}

// { orders, invoices, loading, error, reload } — invoices: the couple's invoices_list read
// fresh with the orders (the lead object a screen holds may be older than the last invoice).
export function useWorkOrders(leadId, enabled = true) {
  const [orders, setOrders] = useState([]);
  const [invoices, setInvoices] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const reload = useCallback(async () => {
    if (!leadId || !enabled) { setOrders([]); setInvoices(null); setError(null); return; }
    setLoading(true);
    try {
      const [list, leadRes] = await Promise.all([
        fetchWorkOrders(leadId),
        supabase.from("leads").select("invoices_list").eq("id", leadId).maybeSingle(),
      ]);
      setOrders(list);
      setInvoices(Array.isArray(leadRes?.data?.invoices_list) ? leadRes.data.invoices_list : null);
      setError(null);
    } catch (e) {
      setError(e?.message || "טעינת הזמנות העבודה נכשלה");
    } finally {
      setLoading(false);
    }
  }, [leadId, enabled]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    const onChanged = (e) => { if (e.detail?.leadId === leadId) reload(); };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, [leadId, reload]);
  return { orders, invoices, loading, error, reload };
}
