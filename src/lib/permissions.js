// Centralized role-permission constants + a usePermission() hook — replaces 8+
// previously scattered, inconsistent `profiles.role` checks across the frontend
// (src/App.jsx, WorkspaceTab.jsx, UsersTab.jsx, PageNotFound.jsx — found during the
// 2026-08-17 security audit). Hand-mirrored in
// supabase/functions/_shared/permissions.ts for the equivalent 7 backend edge-function
// checks — Deno/React can't share a module across that boundary, same limitation
// already documented for src/lib/staffRoles.js / staffRoles.ts.
//
// profiles.role enum (supabase/migrations/0001_init.sql): owner | admin |
// studio_manager | photographer | editor | album_manager.
//
// Per explicit product decision (2026-08-17 security audit, question 1): studio_manager
// is treated as FULLY EQUIVALENT to admin everywhere in this app — there is no
// capability an admin has that a studio_manager should be denied. Previously this drifted:
// App.jsx's panel gate and list-tenant-users included studio_manager, but
// WorkspaceTab/UsersTab/invite-user/update-tenant-user/monthly-crew-schedule/
// send-questionnaire-reminders/assign-studio-ids did not — an inconsistent, almost
// certainly unintentional gap, now resolved by using ADMIN_ROLES everywhere instead of
// hand-writing ['owner','admin'] (which silently excludes studio_manager) at each site.
//
// 'owner' remains a separate, strictly higher tier for the one deliberately more
// sensitive action in the app today — creating a brand-new, separate tenant
// (create-tenant edge function) — see OWNER_ONLY_ROLES.

import { useAuth } from "@/lib/SupabaseAuthContext";

export const OWNER_ONLY_ROLES = ["owner"];

// "Admin-equivalent" — owner, admin, and studio_manager all get identical treatment.
// Use this (or the isAdmin() helper below) instead of writing out ['owner','admin'].
export const ADMIN_ROLES = ["owner", "admin", "studio_manager"];

export function isOwner(user) {
  return !!user && OWNER_ONLY_ROLES.includes(user.role);
}

export function isAdmin(user) {
  return !!user && ADMIN_ROLES.includes(user.role);
}

// Generic helper for any custom role set a future feature might need, so ad-hoc checks
// still go through one function instead of a fresh `.includes()` each time.
export function hasRole(user, allowedRoles) {
  return !!user && allowedRoles.includes(user.role);
}

// React hook wrapping useAuth() (src/lib/SupabaseAuthContext.jsx) so consuming
// components don't need to pull `user` out themselves and re-derive role booleans
// by hand at each call site — the actual replacement for the 8+ scattered checks
// this module's header comment refers to. Must be called from inside <AuthProvider>,
// same requirement as useAuth() itself.
export function usePermission() {
  const { user } = useAuth();
  return {
    role: user?.role ?? null,
    isOwner: isOwner(user),
    isAdmin: isAdmin(user),
    hasRole: (allowedRoles) => hasRole(user, allowedRoles),
  };
}
