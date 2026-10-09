-- Personal chat preferences (2026-10-09): the owner arranges the boxes of "אווירה צ'אט"
-- (order, and which sit on top vs under "עוד") once, and the same order shows on his
-- computer and his iPhone; each user keeps their own (Sabina, the lead coordinator).
--
-- On profiles because a user can already update their own row (profiles_self_update,
-- 0072) — app_settings is tenant-wide and writable by admins only, which would block the
-- lead coordinator. 0072's trigger still refuses self changes to role / tenant / is_active;
-- this column is not one of them.
--   { "boxOrder": { "primary": ["hot", "needs", …], "more": ["client", …] } }
alter table profiles add column if not exists chat_prefs jsonb not null default '{}'::jsonb;
