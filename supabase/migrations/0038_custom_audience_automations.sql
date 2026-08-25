-- Wires up the already-existing 'custom' automations.type value (added but
-- never implemented in 0015_custom_staff_message_automation_type.sql) as a
-- generic, admin-authorable "custom audience message" automation, driven
-- entirely by audience_config below -- no new backend deploy needed per
-- instance created through the UI.
--
-- Does NOT touch: the 7 existing fixed types and their handlers,
-- event_automations (stays unwired, out of scope), or automations' RLS/role
-- model (already correctly role-gated by 0018_admin_role_gated_writes.sql --
-- verified, unchanged; policies are row-level so the new columns are
-- automatically covered).

alter table automations
  add column if not exists audience_type text
    check (audience_type in ('staff_role', 'leads_events')),
  add column if not exists audience_config jsonb not null default '{}'::jsonb;

comment on column automations.audience_type is
  'Only meaningful when type = ''custom''. Selects which audience_config shape applies.
   NULL for all 7 pre-existing fixed automation types.';

comment on column automations.audience_config is
  'JSONB config for type=''custom'' automations:
   staff_role   -> { "role": "photographer" | "videographer" | "editor" | "graphic_designer" | "all" }
   leads_events -> { "conditions": [ { "field": "client_payment_status" | "album_status" | "event_date_relative",
                                        "op": "eq" | "neq" | "before_today" | "after_today",
                                        "value": <string|null> } ] }';
