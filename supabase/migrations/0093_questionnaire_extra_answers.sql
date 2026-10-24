-- 0093 (2026-10-24): the studio's own questions in the production questionnaire.
--
-- The questionnaire's wording / required / shown is app_settings.questionnaire_config (no
-- schema). The answers to questions the studio added go here — one jsonb array per lead:
--   [{ "id": "q1", "label": "🎵 שיר כניסה לחופה", "type": "short|long|yesno",
--      "section": "contact|logistics|family|team", "value": "…" | true | false }]
-- The label is kept as it was when answered, so a renamed or deleted question still shows what
-- the couple wrote. Written only by submit-production-questionnaire (service role). The built-in
-- questions keep their own production_* columns, untouched.
--
-- Additive only; rollback: audit-reports/rollback/0093_rollback.sql (drops the column).

alter table public.leads add column if not exists production_extra_answers jsonb;

comment on column public.leads.production_extra_answers is
  'Answers to the studio''s own questionnaire questions: [{id,label,type,section,value}] (0093)';
