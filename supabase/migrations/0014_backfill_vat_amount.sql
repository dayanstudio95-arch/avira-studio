-- Backfill fix for the "Total VAT shows ₪0 on Reports" bug reported 2026-08-13.
-- Root cause: events created via CSV import (src/components/CSVImportDialog.jsx) never
-- computed/persisted vat_amount (unlike AddEventModal.jsx / EditEvent.jsx, which always
-- derive it from total_amount_gross + vat_percent). The frontend fix (self-healing
-- calculateEventFinancials() fallback in Reports.jsx/Dashboard.jsx/ReportsTable.jsx, plus
-- computing vatAmount at CSV-import time going forward) covers new/in-memory reads, but
-- existing rows with a NULL vat_amount still benefit from a one-time backfill so exports,
-- direct queries, etc. are correct too.
update events
set vat_amount = round((total_amount_gross - total_amount_gross / (1 + coalesce(vat_percent, 18) / 100)) * 100) / 100
where vat_amount is null
  and total_amount_gross is not null;

update events
set profit_net = round((
  (total_amount_gross - vat_amount) -
  coalesce((select sum((m->>'cost')::numeric) from jsonb_array_elements(coalesce(team, '[]'::jsonb)) as m), 0)
) * 100) / 100
where profit_net is null
  and total_amount_gross is not null
  and vat_amount is not null;
