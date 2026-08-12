-- Adds the throttle column that supabase/functions/automation-engine/index.ts's
-- runQuestionnaireReminder() needs.
--
-- The original Base44 app's runQuestionnaireReminder guarded on
-- lead.questionnaireCompleted / lead.questionnaireFilled / lead.questionnaire_reminder_sent_at
-- but NONE of those fields ever existed in base44/entities/Lead.jsonc — they were
-- permanently-dead no-op checks in the original. When porting the automation we fixed
-- this by using the real completion signal (leads.production_form_filled_at, which
-- runQuestionnaireSend already treats as canonical) plus a real throttle column so the
-- reminder automation doesn't re-nag every run. This migration adds that column.
alter table leads
  add column if not exists questionnaire_reminder_sent_at timestamptz;
