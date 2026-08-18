// Single frontend source of truth for the two DIFFERENT "role" concepts in this app —
// previously duplicated (with real drift/bugs) across 8+ files. Do not conflate them:
//
// 1. EVENT_TEAM_ROLES — which crew slot a staff member fills on ONE SPECIFIC EVENT,
//    stored per-assignment in `events.team[].role` (a jsonb array column, no DB-level
//    constraint on the value). This is what "צלם 1 / צלם 2 / צלם וידאו / עורך" means on
//    the Events/Progress pages.
//
// 2. STAFF_JOB_ROLES — a staff member's own general job category, stored once per staff
//    member in `staff_members.role` (DB-constrained — see the `check (role in (...))`
//    on that column in supabase/migrations/0001_init.sql). This is what a "add staff
//    member" form or a "send to all photographers" broadcast filters by.
//
// Previously found duplicated/divergent across: StaffRatesEditor.jsx,
// AIAssistantStructuredAnswer.jsx, SendStaffScheduleModal.jsx,
// ProgressEventMobileCard.jsx (was missing videographer2 entirely — real bug, now
// fixed by importing this list), MissingCrewCard.jsx, Settings.jsx, TeamMembers.jsx,
// StaffImportDialog.jsx, TeamAutomationTab.jsx (was offering an invalid "lighting"
// value that violates the staff_members DB check constraint — real bug, now fixed),
// plus a backend-only definition in supabase/functions/automation-engine/index.ts.
//
// Keep in sync with the hand-mirrored Deno copy in
// supabase/functions/_shared/staffRoles.ts (frontend/edge-function code can't share a
// module across that boundary — same limitation documented in
// src/lib/productionQuestionnaireFields.js for the Google Calendar sync fields).

// ─── 1. Event-specific crew assignment roles (events.team[].role) ─────────────────
export const EVENT_TEAM_ROLES = [
  { value: "photographer1", label: "צלם 1", icon: "📷", doneField: "photographer1Done" },
  { value: "photographer2", label: "צלם 2", icon: "📷", doneField: "photographer2Done" },
  { value: "videographer", label: "צלם וידאו", icon: "🎥", doneField: "video1Done" },
  // NOTE: there is no distinct `video2_done` column on `events` yet — every existing
  // consumer of this role (DashboardWorkStatusCard.jsx, EventsTable.jsx) already
  // aliases videographer2 onto the same `video1Done` flag as the primary videographer.
  // Preserved here for consistency rather than inventing a new schema column as part
  // of this consolidation; giving videographer2 its own independent completion flag
  // would need a migration and is a separate, larger follow-up if ever needed.
  { value: "videographer2", label: "צלם וידאו 2", icon: "🎥", doneField: "video1Done" },
  { value: "editor", label: "עורך", icon: "✂️", doneField: "editorDone" },
];

export const EVENT_TEAM_ROLE_LABELS = Object.fromEntries(
  EVENT_TEAM_ROLES.map(({ value, label }) => [value, label])
);

export function eventTeamRoleLabel(role) {
  return EVENT_TEAM_ROLE_LABELS[role] || role;
}

// Subset used by features that intentionally only ever target photographers (e.g. the
// daily event brief) — kept as a derived constant so it can't silently drift from the
// full list above.
export const PHOTOGRAPHER_TEAM_ROLES = EVENT_TEAM_ROLES
  .filter(({ value }) => value.startsWith("photographer"))
  .map(({ value }) => value);

// ─── 2. Staff member's own general job category (staff_members.role) ──────────────
// Must exactly match the CHECK constraint in supabase/migrations/0001_init.sql:74.
export const STAFF_JOB_ROLES = [
  { value: "photographer", label: "צלם" },
  { value: "videographer", label: "צלם וידאו" },
  { value: "editor", label: "עורך" },
  { value: "graphic_designer", label: "מעצב/ת גרפי/ת" },
];

export const STAFF_JOB_ROLE_LABELS = Object.fromEntries(
  STAFF_JOB_ROLES.map(({ value, label }) => [value, label])
);

export function staffJobRoleLabel(role) {
  return STAFF_JOB_ROLE_LABELS[role] || role;
}
