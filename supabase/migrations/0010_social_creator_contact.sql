-- Small follow-up to migration 0009_questionnaire_fields.sql: the "social creator" checkbox
-- (יש סושיאל קריאייטור/צלם/ת סושיאל באירוע) should expand to reveal name+phone fields when
-- checked, mirroring the existing "external event manager" checkbox pattern
-- (production_has_external_planner -> production_external_planner_name/_phone).

alter table public.leads
  add column if not exists production_social_creator_name text,
  add column if not exists production_social_creator_phone text;
