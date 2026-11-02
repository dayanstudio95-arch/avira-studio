-- "שילמתי" on the payments page, and an invoice asked for before paying (Avira, 2026-11-02, the owner's request).
--
-- The owner pays a team member in the bank's app, comes back to "תשלומים לצוות", ticks the events, and confirms with
-- the bank screenshot and the business the money left from. The transfer is recorded as he said it (source
-- 'confirmed' — no guessing the business from the account number, no joining "שולם" marks to a screenshot later), and
-- the team member gets the events, the screenshot and the invoice details on WhatsApp.
--
-- "שלח פירוט" may also ask for the invoice BEFORE paying (team members who are slow with invoices): that opens a row
-- (source 'request', status 'requested') that waits for the invoice and for the payment; no reminders while it waits.
--
--   proof_path     the screenshot the owner uploaded (bucket staff-invoices, <tenant>/transfers/<uuid>.<ext>).
--   wa_id_message  WhatsApp's id of the screenshot sent to the team member: the scan finds that message in the chat
--                  and joins it to this row instead of reading it as a new transfer.
--
-- No new table (0103's grants rule: nothing to grant). Rollback: audit-reports/rollback/0108_rollback.sql.

alter table public.staff_transfers drop constraint if exists staff_transfers_source_check;
alter table public.staff_transfers add constraint staff_transfers_source_check
  check (source in ('screenshot', 'paid_mark', 'manual', 'confirmed', 'request'));

alter table public.staff_transfers drop constraint if exists staff_transfers_status_check;
alter table public.staff_transfers add constraint staff_transfers_status_check
  check (status in ('waiting', 'received', 'not_needed', 'requested'));

alter table public.staff_transfers
  add column if not exists proof_path text check (proof_path is null or char_length(proof_path) <= 300),
  add column if not exists wa_id_message text check (wa_id_message is null or char_length(wa_id_message) <= 120);
