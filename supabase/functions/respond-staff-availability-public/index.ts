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

// One link for several events (2026-10-09, migration 0082): staff_availability_batches.
// The batch token is the only credential, hashed and looked up on every call, revoked_at
// checked every time; a request can be answered only through the batch it belongs to.
const SLOT_LABELS: Record<string, string> = {
  photographer1: 'צלם ראשי (צלם 1)',
  photographer2: 'צלם ערב (צלם 2)',
  videographer: 'צלם וידאו יום מלא (וידאו 1)',
  videographer2: 'צלם וידאו ערב (וידאו 2)',
};

async function resolveBatchByToken(supabase: any, token: string) {
  if (!token || typeof token !== 'string') return { error: 'טוקן חסר', status: 400 };
  const tokenHash = await hashToken(token);
  const { data: batch, error } = await supabase
    .from('staff_availability_batches')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!batch) return { error: 'קישור לא תקין', status: 404 };
  if (batch.revoked_at) return { error: 'הקישור בוטל', status: 403 };
  return { batch };
}

async function batchContext(supabase: any, batch: any) {
  const { data: rows, error } = await supabase
    .from('staff_availability_requests')
    .select('id, staff_name_snapshot, role, team_role, event_date_snapshot, venue_snapshot, couple_names_snapshot, status, responded_at')
    .eq('batch_id', batch.id)
    .is('revoked_at', null)
    .order('event_date_snapshot', { ascending: true });
  if (error) throw new Error(error.message);
  return {
    staffName: rows?.[0]?.staff_name_snapshot || '',
    roleLabel: SLOT_LABELS[batch.team_role] || ROLE_LABELS[rows?.[0]?.role] || '',
    items: (rows || []).map((r: any) => ({
      id: r.id,
      eventDate: r.event_date_snapshot,
      venue: r.venue_snapshot,
      coupleNames: r.couple_names_snapshot,
      status: r.status,
    })),
  };
}

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
    const { token, action, response, batchToken, requestId } = body ?? {};
    const supabase = createServiceRoleClient();

    if (action === 'validateBatch' || action === 'respondBatch') {
      const rb = await resolveBatchByToken(supabase, batchToken);
      if (rb.error) return jsonResponse({ error: rb.error }, { status: rb.status });
      const batch = rb.batch;
      if (action === 'validateBatch') return jsonResponse(await batchContext(supabase, batch));

      if (response !== 'available' && response !== 'declined') {
        return jsonResponse({ error: 'תגובה לא תקינה' }, { status: 400 });
      }
      const { data: request, error: reqErr } = await supabase
        .from('staff_availability_requests')
        .select('*')
        .eq('id', requestId)
        .eq('batch_id', batch.id)
        .is('revoked_at', null)
        .maybeSingle();
      if (reqErr) return jsonResponse({ error: reqErr.message }, { status: 500 });
      if (!request) return jsonResponse({ error: 'האירוע לא נמצא בקישור הזה' }, { status: 404 });
      // Idempotent per event, like the single link: an answer is never overwritten.
      if (request.status === 'pending') {
        const { data: updated, error: updateError } = await supabase
          .from('staff_availability_requests')
          .update({ status: response, responded_at: new Date().toISOString() })
          .eq('id', request.id)
          .eq('status', 'pending')
          .select()
          .maybeSingle();
        if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });
        if (updated) await insertNotification(supabase, updated, response);
      }
      return jsonResponse(await batchContext(supabase, batch));
    }

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
