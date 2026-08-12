-- Extends the production questionnaire (EventQuestionnaire.jsx / submit-production-questionnaire /
-- get-lead-public) to match the full Base44 version, which asks the couple for many more
-- details than the 5 fields currently captured (bride/groom phone, prep location, one shared
-- instagram field, special requests).
--
-- New fields, grouped to match the Base44 form's sections:
--   Companion (מלווה) on the wedding day:
--     production_companion_name, production_companion_phone
--   Event-day logistics:
--     production_checkin_time      - שעת הגעה/קבלת פנים (kept as free text, matches how the
--                                     couple types it in Base44 rather than a strict time type)
--     production_chuppah_time      - שעת חופה משוערת
--   Instagram, split per person (previously one shared production_instagram column):
--     production_bride_instagram, production_groom_instagram
--   Social-media creator / external event manager at the event:
--     production_has_social_creator   boolean
--     production_has_external_planner boolean
--     production_external_planner_name, production_external_planner_phone
--   Family & important people:
--     production_family_bride       - משפחת הכלה
--     production_family_groom       - משפחת החתן
--     production_important_people   - אנשים חשובים לצלם
--     production_family_sensitivities - רגישויות משפחתיות (אנשים שלא לצלם ביחד)
--   Team:
--     production_planned_surprises  - הפתעות מתוכננות באירוע
--
-- production_special_requests (existing) stays as-is ("בקשות מיוחדות מהצוות").
--
-- Backfill: copy the old shared production_instagram value into production_bride_instagram
-- so studios don't lose already-collected answers when the form switches to per-person fields.
-- The old production_instagram column is left in place (not dropped) to avoid breaking any
-- other code path that might still read it; it's just no longer written to by the new form.

alter table public.leads
  add column if not exists production_companion_name text,
  add column if not exists production_companion_phone text,
  add column if not exists production_checkin_time text,
  add column if not exists production_chuppah_time text,
  add column if not exists production_bride_instagram text,
  add column if not exists production_groom_instagram text,
  add column if not exists production_has_social_creator boolean default false,
  add column if not exists production_has_external_planner boolean default false,
  add column if not exists production_external_planner_name text,
  add column if not exists production_external_planner_phone text,
  add column if not exists production_family_bride text,
  add column if not exists production_family_groom text,
  add column if not exists production_important_people text,
  add column if not exists production_family_sensitivities text,
  add column if not exists production_planned_surprises text;

update public.leads
set production_bride_instagram = production_instagram
where production_instagram is not null
  and production_bride_instagram is null;
