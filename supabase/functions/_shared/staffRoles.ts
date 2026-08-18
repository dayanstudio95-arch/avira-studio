// Hand-mirrored Deno copy of src/lib/staffRoles.js's EVENT_TEAM_ROLES / PHOTOGRAPHER_TEAM_ROLES.
// Frontend and edge-function code can't share a module across that boundary, so this is
// kept in sync by hand — same limitation/pattern already documented for
// googleCalendarSync.ts vs src/lib/productionQuestionnaireFields.js. If you change the
// role list or labels in src/lib/staffRoles.js, mirror the change here too.
//
// Only the event-team-assignment concept (events.team[].role) is mirrored here — no
// edge function currently needs the staff_members.role (STAFF_JOB_ROLES) list.

export const EVENT_TEAM_ROLE_LABELS: Record<string, string> = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'צלם וידאו',
  videographer2: 'צלם וידאו 2',
  editor: 'עורך',
};

export const PHOTOGRAPHER_TEAM_ROLES = ['photographer1', 'photographer2'];
