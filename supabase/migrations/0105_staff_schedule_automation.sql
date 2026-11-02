-- "לוח עבודות לאנשי צוות" (Avira, 2026-11-02, the owner's request): a manual automation that sends chosen team members
-- every date they work from today on (automation-engine runStaffSchedule, _shared/staffSchedule.ts). Only widens the
-- allowed types; the automations page adds the row itself (its DEFAULTS), as it did for the others.
alter table public.automations drop constraint if exists automations_type_check;
alter table public.automations
  add constraint automations_type_check
  check (type in (
    'monthly_staff_summary',
    'daily_event_brief',
    'questionnaire_reminder',
    'album_reminder',
    'payment_reminder',
    'questionnaire_send',
    'custom_staff_message',
    'custom',
    'staff_schedule'
  ));
