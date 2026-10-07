-- "הסר מפולו-אפ" in the chat (2026-10-07). A conversation enters the follow-up queue either
-- because the bot sent the price list and nobody replied, or because the owner flagged it.
-- Until now only the hand flag could be undone. followup_dismissed_at takes it out — the bot
-- path for good, a hand flag until the owner flags it again (src/lib/followUpQueue.js).
-- Also the "אלבומים" label the owner asked for (pink), once per studio, only if missing.
-- Additive only. Rollback: audit-reports/rollback/0075_rollback.sql. Re-runnable.

alter table whatsapp_conversations add column if not exists followup_dismissed_at timestamptz;

insert into whatsapp_labels (tenant_id, name, color, sort_order)
select t.id, 'אלבומים', '#D6409F', 40
from tenants t
where not exists (select 1 from whatsapp_labels l where l.tenant_id = t.id and l.name = 'אלבומים');
