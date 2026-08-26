-- Defence-in-depth for the two tenant-level financial defaults. Before this migration `tenants` carried
-- no CHECK constraints at all (verified against pg_constraint on 2026-08-26).
--
-- default_vat_percent is stamped onto events.vat_percent at creation by all six writers
-- (DetailsStep.jsx, CSVImportDialog.jsx x2, AddEventModal.jsx, EventQuickEditModal.jsx,
-- sync-lead-to-event/index.ts), so a bad value here silently propagates into every new event's VAT and
-- every invoice issued from it. FinancialDefaultsCard.jsx's handleSave already validates the same two
-- ranges in the browser; this is the DB-side backstop for any other write path.
--
-- Current production values (single tenant): default_vat_percent = 18, default_deposit_amount = 500 --
-- both already satisfy these predicates, so validation is instant and cannot fail. Both columns are
-- also nullable-safe: a NULL makes the predicate NULL, which a CHECK accepts.
alter table tenants add constraint tenants_default_vat_percent_check
  check (default_vat_percent between 0 and 100);

alter table tenants add constraint tenants_default_deposit_amount_check
  check (default_deposit_amount >= 0);
