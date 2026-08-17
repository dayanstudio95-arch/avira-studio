-- =========================================================
-- Add 'custom_staff_message' as a valid automations.type value.
--
-- New feature: studio owner writes free-text WhatsApp content, picks a
-- target staff role (photographer / videographer / editor / graphic
-- designer / all), previews the matching recipients with per-person
-- checkboxes, and sends to just the checked ones. See
-- supabase/functions/automation-engine/index.ts (runCustomStaffMessage)
-- and src/components/automations/CustomStaffMessageModal.jsx.
-- =========================================================

alter table automations
  drop constraint automations_type_check;

alter table automations
  add constraint automations_type_check
  check (type in (
    'monthly_staff_summary',
    'daily_event_brief',
    'questionnaire_reminder',
    'album_reminder',
    'payment_reminder',
    'questionnaire_send',
    'custom_staff_message',
    'custom'
  ));
