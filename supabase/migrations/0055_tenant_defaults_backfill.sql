-- Fixes "שגיאה בשמירת ההגדרות" when saving a NEW secret in Settings → Integrations,
-- and the same latent failure on 12 other tables.
--
-- What actually broke
-- --------------------------------------------------------------------------------
-- `src/api/entities.js`'s create() never sends tenant_id — by deliberate convention
-- across this entire codebase. What fills it is the BEFORE INSERT trigger
-- `set_tenant_id()` from 0003_tenant_defaults.sql, which was applied to a hard-coded
-- list of the 11 tables that existed at the time. Every table added since needs its
-- own trigger, and this has already been patched piecemeal three times (0032 for the
-- albums module, 0033 for the two engraving catalogs, 0042 for staff availability).
--
-- 0019_tenant_secrets.sql was missed. The bug stayed invisible for three weeks because
-- 0019 moved the 5 pre-existing secret rows across with plain SQL, so the UI only ever
-- took the UPDATE path — which works fine. `whatsapp_webhook_token`
-- (0054_whatsapp_bot.sql) is the first row ever INSERTed into tenant_secrets from the
-- frontend, and it fails twice over: NOT NULL on tenant_id, and the RLS WITH CHECK
-- (tenant_id = current_tenant_id()). IntegrationsTab.jsx's handleSave catches the
-- rejection and shows a generic toast, so the real error never reached anyone.
--
-- Rather than fix only tenant_secrets and leave the same landmine in place for the
-- next feature, this sweeps every remaining tenant-scoped table that 0003/0032/0033/
-- 0042 never covered. Verified by diffing the tables carrying a tenant_id column
-- against the four trigger lists.
--
-- Why this cannot regress anything
-- --------------------------------------------------------------------------------
-- set_tenant_id() only acts `if new.tenant_id is null` — an explicitly supplied value
-- is left untouched, so it is a no-op for the service-role Edge Function writers
-- (album-portal, album-print-access, whatsapp-webhook, the audit/notification
-- triggers), all of which already pass tenant_id. And current_tenant_id() is
-- `select tenant_id from profiles where id = auth.uid()`, which returns null under a
-- service-role connection (no auth.uid()) — so even for a null insert the column stays
-- null and the statement fails exactly as it does today. The trigger can only turn a
-- failing insert into a succeeding one, never the reverse.
--
-- Deliberately NOT included: `profiles` and `tenants`. profiles rows are written on the
-- signup/invite path, where auth.uid() is either absent or belongs to a different user
-- than the row being created; silently deriving a tenant there would be a real
-- behaviour change in the authentication flow, and 0027_profiles_privilege_escalation_
-- guard.sql already governs that table. tenants has no tenant_id of its own.
do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      -- The one that is actually broken right now.
      'tenant_secrets',
      -- Google Calendar (0016) — both written from GoogleCalendarSync.jsx /
      -- GoogleCalendarAccountCard.jsx via entity create() calls.
      'google_calendar_accounts', 'event_calendar_syncs',
      -- AI assistant chat history (0025) — created from the assistant panel.
      'ai_assistant_messages',
      -- Album guide content (0039) — admin-edited from the settings screen.
      'album_guide_content', 'album_guide_faq_items', 'album_guide_sketch_examples',
      'album_guide_sketch_example_images', 'album_guide_cover_previews',
      -- Written only by DB triggers today (which set tenant_id explicitly, so this is
      -- a no-op) — included so a future frontend insert doesn't rediscover this bug.
      'audit_logs', 'notifications',
      -- WhatsApp inbox (0054). The webhook writes as service-role with an explicit
      -- tenant_id; the frontend only ever updates. Included for the same reason.
      'whatsapp_conversations', 'whatsapp_messages'
    ])
  loop
    -- `if not exists` has no trigger form, hence drop-then-create, which also makes
    -- the whole migration re-runnable.
    execute format('drop trigger if exists set_tenant_id on %I;', t);
    execute format('create trigger set_tenant_id before insert on %I for each row execute function set_tenant_id();', t);
  end loop;
end $$;
