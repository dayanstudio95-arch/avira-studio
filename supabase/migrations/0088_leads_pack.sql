-- Four owner requests (2026-10-13). Additive only — nothing is dropped or rewritten.
--
-- 1. "מי פתח את החוזה": when the couple first / last opened their contract link and how
--    many times. Written by get-lead-public (service role) when the public contract page
--    loads for someone who is not signed in to the studio, and only before signing.
alter table leads add column if not exists contract_viewed_first_at timestamptz;
alter table leads add column if not exists contract_viewed_at timestamptz;
alter table leads add column if not exists contract_view_count integer not null default 0;

-- 2. "תזכורת לחוזה שלא נחתם": the reminder is a ready message in the chat that the owner
--    sends with one click. Set when it was sent or skipped, so the lead leaves the list.
alter table leads add column if not exists contract_reminder_done_at timestamptz;

-- 3. "מקור הליד": where the couple came from (אינסטגרם / מודעה בפייסבוק / גוגל / המלצה ...).
--    Free text on purpose: the list in the form is the defaults plus whatever was used.
alter table leads add column if not exists source text;

-- Leads made from a chat that arrived through a Facebook/Instagram ad (0060) — the only
-- source the system already knew. Fills empty values only.
update leads l
   set source = 'מודעה בפייסבוק'
  from whatsapp_conversations c
 where c.matched_lead_id = l.id
   and c.tenant_id = l.tenant_id
   and c.source = 'facebook_ad'
   and l.source is null;

-- 4. "שיחה שלא נענתה": a WhatsApp call nobody answered (Green API incomingCall,
--    hungUp / declined). The reply ("ראינו שהתקשרתם") goes out once; the hourly
--    housekeeping sends it after the quiet hours when the call came at night.
alter table whatsapp_conversations add column if not exists missed_call_at timestamptz;
alter table whatsapp_conversations add column if not exists missed_call_reply_at timestamptz;
-- The id of the last call that WAS answered, so a stray 'hungUp' for the same call is
-- never taken for a missed one.
alter table whatsapp_conversations add column if not exists last_answered_call_id text;
create index if not exists whatsapp_conversations_missed_call_idx
  on whatsapp_conversations(tenant_id, missed_call_at)
  where missed_call_at is not null and missed_call_reply_at is null;
