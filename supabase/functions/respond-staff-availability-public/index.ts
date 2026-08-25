// Public, unauthenticated Edge Function backing the staff availability-response page
// (/staff-availability/:token — see App.jsx). No Supabase session ever exists here,
// exactly like album-portal / album-print-access — the raw token from the URL is the
// staff member's only credential. It is hashed (see _shared/albumTokens.ts) and looked
// up directly against staff_availability_requests.token_hash on EVERY request (never
// trusted from a prior call), and revoked_at is checked every time too, not just once
// at link-creation time.
//
// Single action-dispatch endpoint (POST { token, action, ...params }), mirroring
// album-portal's pattern. 'respond' is idempotent: once a request's status has moved
// off 'pending', re-submitting a response just returns the already-recorded state
// instead of erroring or overwriting it (staff members re-opening the same WhatsApp
// link later should see "you already answered", not be able to flip their answer).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';

const ROLE_LABELS: Record<string, string> = {
  photographer: 'צלם/ת',
  videographer: 'צלם/ת וידאו',
};

async function resolveRequestByToken(supabase: any, token: string) {
  if (!token || typeof token !== 'string') return { error: 'טוקן חסר', status: 400 };
  const tokenHash = await hashToken(token);
  const { data: request, error } = await supabase
    .from('staff_availability_requests')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!request) return { error: 'קישור לא תקין', status: 404 };
  if (request.revoked_at) return { error: 'הקישור בוטל', status: 403 };
  return { request };
}

function toContext(request: any) {
  return {
    staffName: request.staff_name_snapshot,
    roleLabel: ROLE_LABELS[request.role] || request.role,
    eventDate: request.event_date_snapshot,
    venue: request.venue_snapshot,
    coupleNames: request.couple_names_snapshot,
    status: request.status,
    respondedAt: request.responded_at,
  };
}

async function insertNotification(supabase: any, request: any, response: string) {
  try {
    const roleLabel = ROLE_LABELS[request.role] || request.role;
    const statusLabel = response === 'available' ? 'פנוי/ה' : 'לא פנוי/ה';
    const dateLabel = request.event_date_snapshot
      ? new Date(request.event_date_snapshot).toLocaleDateString('he-IL')
      : '';
    await supabase.from('notifications').insert({
      tenant_id: request.tenant_id,
      type: 'staff_availability_response',
      title: `${request.staff_name_snapshot} ${statusLabel} — ${request.couple_names_snapshot || ''}`.trim(),
      body: [roleLabel, request.venue_snapshot, dateLabel].filter(Boolean).join(' · '),
      related_lead_id: request.lead_id,
    });
  } catch (e) {
    // Best-effort — a notification failure must never block the staff member's response.
    console.error('[respond-staff-availability-public] notification insert failed:', e?.message || e);
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const rateLimit = await checkRateLimit(req, 'respond-staff-availability-public');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { token, action, response } = body ?? {};
    const supabase = createServiceRoleClient();

    const resolved = await resolveRequestByToken(supabase, token);
    if (resolved.error) return jsonResponse({ error: resolved.error }, { status: resolved.status });
    const request = resolved.request;

    if (action === 'validate') {
      return jsonResponse(toContext(request));
    }

    if (action === 'respond') {
      if (response !== 'available' && response !== 'declined') {
        return jsonResponse({ error: 'תגובה לא תקינה' }, { status: 400 });
      }

      // Idempotent: already answered -> return the recorded state, don't overwrite it.
      if (request.status !== 'pending') {
        return jsonResponse(toContext(request));
      }

      const respondedAt = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase
        .from('staff_availability_requests')
        .update({ status: response, responded_at: respondedAt })
        .eq('id', request.id)
        .select()
        .single();
      if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });

      await insertNotification(supabase, updated, response);

      return jsonResponse(toContext(updated));
    }

    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
