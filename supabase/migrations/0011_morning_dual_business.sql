-- Splits the single Morning/Green Invoice integration into two separate business
-- entities, per studio owner's real-world setup: one עוסק מורשה (sole proprietor,
-- issues the informally-named "חשבונית ירוקה") and one חברה בע"מ (Ltd company, issues
-- "חשבונית מס קבלה"), each with its own Morning account (API key + secret).
--
-- app_settings is a plain tenant-scoped key/value table (see 0001_init.sql), so no DDL
-- is needed here — just renaming the existing keys to make room for a second pair:
--   morning_api_key    -> morning_api_key_sole_prop
--   morning_api_secret -> morning_api_secret_sole_prop
-- The new company pair (morning_api_key_company / morning_api_secret_company) doesn't
-- need a row created here — it simply won't exist until the studio owner fills it in via
-- Settings → Integrations, exactly like every other app_settings key.
--
-- This only touches rows that already exist (i.e. only tenants who previously configured
-- Morning); tenants with no Morning settings yet are unaffected.

update public.app_settings
set key = 'morning_api_key_sole_prop'
where key = 'morning_api_key';

update public.app_settings
set key = 'morning_api_secret_sole_prop'
where key = 'morning_api_secret';
