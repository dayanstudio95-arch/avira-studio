// Backs the new, narrowly-scoped "lead_coordinator" role (2026-08-20 product decision:
// a role that can ONLY create new leads and share the contract link — nothing else).
// Called exclusively from src/pages/LeadsCoordinator.jsx — the ONE page this role can
// reach (see src/App.jsx's restructured gate).
//
// Uses the service-role client throughout rather than the caller's own RLS-scoped
// client, for two reasons:
//   1. `list` needs to return only this coordinator's OWN leads — enforced here via an
//      explicit `.eq('created_by_profile_id', user.id)` filter, matching the RLS policy
//      added in 0029_scoped_roles.sql (belt-and-suspenders: the RLS policy is the real
//      backstop if this filter is ever dropped by mistake, but the two must agree).
//   2. `create` must insert a brand-new lead row while carefully controlling exactly
//      which columns are writable — every financial column (base_price/discount/
//      final_price/etc.) is deliberately never set here, left at its table default
//      (matches the existing 0020 financial trigger's intent, just enforced at the
//      field-allowlist level here since this insert goes through service-role and
//      therefore bypasses that trigger's auth.uid()-based check entirely).
//
// Action-based single endpoint (`{ action: 'list' | 'create', ... }`) rather than two
// separate functions, since both share the same auth+role-check boilerplate and this is
// a small, single-purpose feature.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isLeadCoordinator } from '../_shared/permissions.ts';

// Only the fields a lead coordinator legitimately needs to capture up front — no price,
// no discount, no payment fields. Everything else on `leads` stays at its column default.
const SAFE_LIST_COLUMNS =
  'id, couple_names, phone_number, email, event_date, venue_name, status, notes, contract_sent, signed_at, created_at';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const callerProfile = await getCallerProfile(supabase, user.id);

    if (!callerProfile || !isLeadCoordinator(callerProfile.role)) {
      return jsonResponse({ error: 'Forbidden — פעולה זו מיועדת לרכזי לידים בלבד' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;
    const serviceClient = createServiceRoleClient();

    if (action === 'list') {
      const { data, error } = await serviceClient
        .from('leads')
        .select(SAFE_LIST_COLUMNS)
        .eq('tenant_id', callerProfile.tenant_id)
        .eq('created_by_profile_id', user.id)
        .order('created_at', { ascending: false });

      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ leads: data || [] });
    }

    if (action === 'create') {
      const { coupleNames, phone, email, eventDate, venueName, notes } = body || {};
      if (!coupleNames || typeof coupleNames !== 'string' || !coupleNames.trim()) {
        return jsonResponse({ error: 'יש להזין שם זוג' }, { status: 400 });
      }

      const { data, error } = await serviceClient
        .from('leads')
        .insert({
          tenant_id: callerProfile.tenant_id,
          created_by_profile_id: user.id,
          couple_names: coupleNames.trim(),
          phone_number: phone || null,
          email: email || null,
          event_date: eventDate || null,
          venue_name: venueName || null,
          notes: notes || null,
        })
        .select(SAFE_LIST_COLUMNS)
        .single();

      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ success: true, lead: data });
    }

    return jsonResponse({ error: 'פעולה לא ידועה' }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
