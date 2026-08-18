// Hand-mirrored Deno copy of src/lib/permissions.js's OWNER_ONLY_ROLES / ADMIN_ROLES /
// isOwner / isAdmin / hasRole. Frontend and edge-function code can't share a module
// across that boundary, so this is kept in sync by hand — same limitation/pattern
// already documented for src/lib/staffRoles.js / staffRoles.ts and
// productionQuestionnaireFields.js / googleCalendarSync.ts.
//
// profiles.role enum (supabase/migrations/0001_init.sql): owner | admin |
// studio_manager | photographer | editor | album_manager.
//
// Per explicit product decision (2026-08-17 security audit, question 1): studio_manager
// is treated as FULLY EQUIVALENT to admin everywhere in this app — there is no
// capability an admin has that a studio_manager should be denied. This replaces the
// hand-written ['owner','admin'] arrays previously duplicated (and inconsistently
// applied — some functions silently excluded studio_manager) across invite-user,
// update-tenant-user, list-tenant-users, monthly-crew-schedule,
// send-questionnaire-reminders, and assign-studio-ids.
//
// 'owner' remains a separate, strictly higher tier only for create-tenant (creating a
// brand-new, separate tenant) — see OWNER_ONLY_ROLES.
//
// If you change these role sets, mirror the change in src/lib/permissions.js too.

export const OWNER_ONLY_ROLES = ['owner'];
export const ADMIN_ROLES = ['owner', 'admin', 'studio_manager'];

export function isOwner(role: string | null | undefined): boolean {
  return !!role && OWNER_ONLY_ROLES.includes(role);
}

export function isAdmin(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

export function hasRole(role: string | null | undefined, allowedRoles: string[]): boolean {
  return !!role && allowedRoles.includes(role);
}

// Shared boilerplate: every role-gated edge function does the identical
// createUserClient(req) -> .from('profiles').select(...).eq('id', user.id).maybeSingle()
// lookup before its role check. This centralizes just the lookup; callers still do
// their own `if (!profile || !isAdmin(profile.role))` check so each function's
// specific Forbidden message (Hebrew wording differs per function) stays under its
// own control.
export async function getCallerProfile(
  supabase: any,
  userId: string,
  select = 'role, tenant_id'
): Promise<{ role: string; tenant_id?: string } | null> {
  const { data } = await supabase.from('profiles').select(select).eq('id', userId).maybeSingle();
  return data ?? null;
}
