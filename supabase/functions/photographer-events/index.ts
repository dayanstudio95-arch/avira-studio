// Backs the "photographer" role's first-ever real access into the app (2026-08-20
// product decision): a strictly READ-ONLY view of only the events this photographer is
// personally assigned to as crew — couple name, date, venue, other crew members — and
// explicitly NEVER any financial/pricing field. Called exclusively from
// src/pages/MyEvents.jsx — the ONE page this role can reach (see src/App.jsx's
// restructured gate).
//
// 2026-08-21: extended to also serve the "editor" role (isCrewRole/CREW_ROLES in
// _shared/permissions.ts) — same page, same query, same sanitization. There is
// deliberately no separate "videographer" role in the profiles.role enum; a
// videographer already gets full access today by logging in with the photographer
// role, since crew matching below is by staff name, not by the literal team[].role
// string. Function name/route kept as "photographer-events" for both roles to avoid
// churn on every existing caller/deploy reference.
//
// Uses the service-role client (bypasses RLS) so it can pick exactly which columns to
// return, rather than relying on RLS alone to hide the financial columns on `events`
// (Postgres RLS is row-level only — it cannot mask individual columns). The RLS policy
// added in 0029_scoped_roles.sql (`events_select`) is still real and matters — it's the
// backstop that keeps a photographer's own direct Supabase calls (bypassing this
// function entirely, e.g. via devtools) scoped to only their own events — but this
// function is the sanctioned path and additionally strips financial sub-fields out of
// `team` before ever leaving the server, which RLS alone cannot do.
//
// Crew matching is by name string (`team[].staffMemberName === staff_members.name`) —
// there is no other linkage in this schema (confirmed: `team` entries never carry a real
// staff_member_id despite the column comment in 0001_init.sql). The NEW linkage this
// feature depends on is `staff_members.profile_id` (added in 0029_scoped_roles.sql),
// which an admin sets once per photographer via src/components/settings/UsersTab.jsx.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isCrewRole } from '../_shared/permissions.ts';

// Whatever `team[]` entries carry for operational (non-financial) purposes — cost/isPaid
// are deliberately dropped before this ever reaches the response.
function sanitizeTeamMember(member: any) {
  if (!member || typeof member !== 'object') return null;
  return {
    role: member.role ?? null,
    staffMemberName: member.staffMemberName ?? null,
    progressStatus: member.progressStatus ?? null,
  };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    if (!callerProfile || !isCrewRole(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — עמוד זה מיועד לצוות ההפקה בלבד' }, { status: 403 });
    }

    const serviceClient = createServiceRoleClient();

    const { data: staffRow, error: staffError } = await serviceClient
      .from('staff_members')
      .select('id, name')
      .eq('tenant_id', callerProfile.tenant_id)
      .eq('profile_id', user.id)
      .maybeSingle();

    if (staffError) return jsonResponse({ error: staffError.message }, { status: 500 });

    if (!staffRow) {
      // Not yet linked to a staff_members roster row — nothing to show. The frontend
      // shows a clear "פנה למנהל המערכת לקישור החשבון" message for this case.
      return jsonResponse({ events: [], linked: false });
    }

    // Small-studio-scale table; filtering the crew match in JS after a single tenant-wide
    // fetch is simpler and safer than a raw jsonb-containment query, and mirrors the same
    // approach already used by src/pages/ProgressStatus.jsx client-side for the identical
    // staffMemberName match. Bounded to a reasonable window so this never grows unbounded.
    const { data: events, error: eventsError } = await serviceClient
      .from('events')
      .select('id, date, couple_names, venue, team, source_lead_id')
      .eq('tenant_id', callerProfile.tenant_id)
      .order('date', { ascending: true });

    if (eventsError) return jsonResponse({ error: eventsError.message }, { status: 500 });

    const myEvents = (events || []).filter((ev) =>
      Array.isArray(ev.team) && ev.team.some((m: any) => m?.staffMemberName === staffRow.name)
    );

    // Best-effort enrichment: ceremony/check-in times live on the linked lead's
    // production_* questionnaire columns, not on `events` itself (confirmed: events has
    // no time column at all). Never fails the whole request if this lookup has issues.
    const leadIds = myEvents.map((ev) => ev.source_lead_id).filter(Boolean);
    let timesByLeadId = new Map<string, { checkinTime: string | null; chuppahTime: string | null }>();
    if (leadIds.length > 0) {
      const { data: leadsData } = await serviceClient
        .from('leads')
        .select('id, production_checkin_time, production_chuppah_time')
        .in('id', leadIds);
      timesByLeadId = new Map(
        (leadsData || []).map((l: any) => [
          l.id,
          { checkinTime: l.production_checkin_time ?? null, chuppahTime: l.production_chuppah_time ?? null },
        ])
      );
    }

    const result = myEvents.map((ev) => {
      const times = ev.source_lead_id ? timesByLeadId.get(ev.source_lead_id) : null;
      return {
        id: ev.id,
        date: ev.date,
        coupleNames: ev.couple_names,
        venue: ev.venue,
        checkinTime: times?.checkinTime ?? null,
        chuppahTime: times?.chuppahTime ?? null,
        team: (ev.team || []).map(sanitizeTeamMember).filter(Boolean),
      };
    });

    return jsonResponse({ events: result, linked: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
