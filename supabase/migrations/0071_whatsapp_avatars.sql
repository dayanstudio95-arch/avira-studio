-- Profile pictures in "אווירה צ'אט" (2026-10-05). Additive, re-runnable.
-- The picture itself is a file in the private whatsapp-media bucket
-- (<tenant>/avatars/<conversation>.jpg), read through signed URLs like all customer media.
-- avatar_checked_at: when Green API was last asked (refreshed every 14 days; a hidden or
-- missing picture is remembered as checked so it is not asked for every hour).
alter table whatsapp_conversations
  add column if not exists avatar_path text,
  add column if not exists avatar_checked_at timestamptz;
