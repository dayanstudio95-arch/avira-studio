-- Backfill for the "WhatsApp automations always say Avira Studio" issue reported
-- 2026-08-18. Root cause: automation-engine/index.ts's DEFAULT_TEMPLATE consts and
-- AutomationsDashboard.jsx's DEFAULTS array both had "Avira Studio" / "אווירה צלמים"
-- hardcoded directly into the message text (fixed in this same change to use a new
-- {studioName} merge token, resolved server-side per-tenant from
-- tenants.display_name_to_clients / tenants.name — see automation-engine's new
-- getStudioName() helper). But every tenant that had already opened the Automations
-- page before this fix already has a DB row in `automations` with the old literal
-- text baked into `message_template` — editing the JS/TS constants alone has zero
-- effect on rows that already exist, since the app only falls back to
-- DEFAULT_TEMPLATE/DEFAULTS when no row exists yet for that automation type.
--
-- This is a one-time, best-effort text substitution: replace the exact literal
-- strings the old templates used with the new {studioName} token, only where the
-- token isn't already present (idempotent — safe to re-run, and skips any row a
-- studio has since hand-edited to remove the brand text some other way, since the
-- match is on the exact original phrase, not a generic word-level find/replace).
update automations
set message_template = replace(message_template, 'Avira Studio', '{studioName}')
where message_template like '%Avira Studio%'
  and message_template not like '%{studioName}%';

update automations
set message_template = replace(message_template, 'אווירה צלמים', '{studioName}')
where message_template like '%אווירה צלמים%'
  and message_template not like '%{studioName}%';
