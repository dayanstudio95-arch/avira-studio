-- Two businesses (2026-10-14, the owner's request): the studio is both an עוסק מורשה and a
-- חברה בע״מ, and each couple pays one of them. The lead remembers which one:
--   payment_entity          — the couple's business (the default the next time). Set by a
--                             payment request, by the first invoice, or by hand.
--   payment_request_entity  — which business the last payment request was sent from.
--   payment_request_sent_at — when.
-- The invoice window opens on that business and warns before issuing from the other one.
alter table leads add column if not exists payment_entity text
  check (payment_entity in ('sole_prop', 'company'));
alter table leads add column if not exists payment_request_entity text
  check (payment_request_entity in ('sole_prop', 'company'));
alter table leads add column if not exists payment_request_sent_at timestamptz;

-- Couples who already got an invoice: their business is the one on their latest invoice
-- (invoices_list rows carry businessType since 2026-09). Fills empty values only.
update leads l
   set payment_entity = x.bt
  from (
    select id,
           (select inv->>'businessType'
              from jsonb_array_elements(case when jsonb_typeof(invoices_list) = 'array' then invoices_list else '[]'::jsonb end) inv
             where inv->>'businessType' in ('sole_prop', 'company')
             order by coalesce(inv->>'date', inv->>'createdAt', '') desc
             limit 1) as bt
      from leads
  ) x
 where x.id = l.id and x.bt is not null and l.payment_entity is null;
