-- One-time correction for events whose vat_amount was written by the buggy save path in
-- src/components/eventDetails/EventExpensesEditor.jsx (fixed in the same commit as this file).
--
-- That screen's "סכום חייב במע״מ" input is VAT-INCLUSIVE — line 25 seeds it from
-- totalAmountGross, which is the gross deal price. Its display (line 102) and net-profit
-- (line 106) both extract VAT correctly, but handleSave persisted the ADD-ON form
-- (amount * p / 100), so the screen showed one number and the DB stored a larger one.
-- Every other writer already used the extract form: AddEventModal.jsx:67,
-- EventQuickEditModal.jsx:49, EditEvent.jsx:115 (via calculateEventFinancials), and
-- 0014_backfill_vat_amount.sql:10. This aligns the stored rows with those five.
--
-- Census on 2026-08-26 (production): 45 rows, all at vat_percent = 18, overstating stored
-- VAT by ₪14,117.27 in total. Those rows inflate the VAT figure on Dashboard.jsx:66,
-- Reports.jsx:88 and ReportsTable.jsx:15, which all prefer the stored value when non-null.
--
-- profit_net is deliberately NOT touched: EventExpensesEditor never wrote it, so it was
-- never corrupted by this bug.
--
-- The WHERE clause is intentionally narrow — it matches only rows whose stored value sits
-- on the add-on formula AND off the extract formula, so a row that already holds the
-- correct value (or any unrelated value) is left alone. Re-running is a no-op.
update events
set vat_amount = round(vatable_amount * vat_percent / (100 + vat_percent), 2)
where vatable_amount is not null
  and vat_amount     is not null
  and vat_percent > 0
  and abs(vat_amount - vatable_amount * vat_percent / 100) < 0.51
  and abs(vat_amount - vatable_amount * vat_percent / (100 + vat_percent)) >= 0.51;
