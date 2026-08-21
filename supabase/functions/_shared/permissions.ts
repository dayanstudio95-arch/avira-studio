// Hand-mirrored Deno copy of src/lib/permissions.js's OWNER_ONLY_ROLES / ADMIN_ROLES /
// isOwner / isAdmin / hasRole. Frontend and edge-function code can't share a module
// across that boundary, so this is kept in sync by hand — same limitation/pattern
// already documented for src/lib/staffRoles.js / staffRoles.ts and
// productionQuestionnaireFields.js / googleCalendarSync.ts.
//
// profiles.role enum (supabase/migrations/0001_init.sql, extended by
// 0029_scoped_roles.sql): owner | admin | studio_manager | photographer | editor |
// album_manager | lead_coordinator.
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
// lead_coordinator (added 2026-08-20): a narrow role that can only create leads and share
// the contract link — reaches the app exclusively through the coordinator-leads edge
// function (never the general-purpose leads/events edge functions or direct table access
// from an admin route). See LEAD_COORDINATOR_ROLE.
//
// If you change these role sets, mirror the change in src/lib/permissions.js too.

export const OWNER_ONLY_ROLES = ['owner'];
export const ADMIN_ROLES = ['owner', 'admin', 'studio_manager'];
export const LEAD_COORDINATOR_ROLE = 'lead_coordinator';
export const PHOTOGRAPHER_ROLE = 'photographer';
export const EDITOR_ROLE = 'editor';
export const ALBUM_MANAGER_ROLE = 'album_manager';

// "Crew" scoped roles (2026-08-21, mirrors src/lib/permissions.js's CREW_ROLES): the two
// non-admin roles that share the "האירועים שלי" mobile schedule view, gated by crew-name
// matching (team[].staffMemberName === staff_members.name via staff_members.profile_id)
// rather than anything role-specific. There is deliberately no separate "videographer"
// role in the profiles.role enum — a videographer already gets full access today by
// logging in with the photographer role, since crew matching is by staff name, not by
// the literal team[].role string.
export const CREW_ROLES = [PHOTOGRAPHER_ROLE, EDITOR_ROLE];
// Catalog/print-link writes in the Wedding Albums module are gated to admin-equivalent
// roles plus album_manager — see supabase/migrations/0031_wedding_albums.sql's RLS.
export const ALBUM_MANAGER_ROLES = [...ADMIN_ROLES, ALBUM_MANAGER_ROLE];

export function isOwner(role: string | null | undefined): boolean {
  return !!role && OWNER_ONLY_ROLES.includes(role);
}

export function isAdmin(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

export function isLeadCoordinator(role: string | null | undefined): boolean {
  return role === LEAD_COORDINATOR_ROLE;
}

export function isPhotographer(role: string | null | undefined): boolean {
  return role === PHOTOGRAPHER_ROLE;
}

export function isEditor(role: string | null | undefined): boolean {
  return role === EDITOR_ROLE;
}

// True for any "crew" scoped role (photographer or editor) — see CREW_ROLES above.
export function isCrewRole(role: string | null | undefined): boolean {
  return !!role && CREW_ROLES.includes(role);
}

export function isAlbumManager(role: string | null | undefined): boolean {
  return role === ALBUM_MANAGER_ROLE;
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
