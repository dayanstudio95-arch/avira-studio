-- Supports the lead-status-automation feature requested 2026-08-13:
--   1. Sending the contract via WhatsApp now stamps contract_sent_at (in addition to
--      the existing contract_sent boolean) so we know exactly when the 48h clock starts.
--   2. A new Edge Function (sync-lead-followups) reads this column to auto-flip leads
--      stuck in "נשלחה הצעה" (contract sent, not yet signed) to "פולו-אפ" after 48h.
alter table leads add column if not exists contract_sent_at timestamptz;
