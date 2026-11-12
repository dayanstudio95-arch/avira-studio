-- Album invoices (2026-11-12, the owner: "אפשרות להוציא חשבונית מס קבלה על האלבומים מדף הזמנת אלבומים") — additive:
--  * album_orders.invoices_list: the חשבונית מס קבלה documents issued from the album screens, oldest first —
--    [{ id, number, date, amount, url, businessType, description, paymentType, createdAt }], written by
--    generate-morning-invoice (albumOrderId; supabase/functions/_shared/albumInvoice.ts).
--    Kept on the album order, never on leads.invoices_list: the lead's list sums to the couple's photography
--    balance (total_paid / remaining_balance), and an album is a separate sale.
-- No new table, so no new grants; the album portal returns named fields only, so the couple never sees it.
-- Rollback: alter table public.album_orders drop column if exists invoices_list;
alter table public.album_orders
  add column if not exists invoices_list jsonb not null default '[]'::jsonb;

alter table public.album_orders drop constraint if exists album_orders_invoices_list_array;
alter table public.album_orders
  add constraint album_orders_invoices_list_array check (jsonb_typeof(invoices_list) = 'array');
