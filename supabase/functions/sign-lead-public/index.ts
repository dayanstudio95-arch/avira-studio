// Ports base44/functions/signLeadPublic/entry.ts.
// Called from ContractPage when a lead signs the contract. Public/unauthenticated —
// service-role client, leadId is the unguessable-UUID security boundary.
// Sets status to "חוזה" (contract) — NOT the eligible-for-event status
// ("נסגר/חתימה"); that transition happens separately once the studio confirms.
// Saves whatever the client entered into the dedicated "signed_*" fields only,
// never overwriting the studio's own working fields.
//
// PII-01 (audit 2026-10-05): signing happens once. Before, a second call re-signed an
// already-signed lead — overwriting signed_at and the signer's details, resetting the
// status back to "חוזה", and (via the 0026 trigger on signed_at) firing the
// "contract signed" notification + WhatsApp alert again. The update is now conditional on
// signed_at IS NULL, so it is atomic even if two requests race.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  // Fully public/unauthenticated endpoint -- rate-limited per caller IP since leadId
  // (an unguessable UUID) is the only real security boundary here. See
  // _shared/rateLimit.ts / migration 0023 for why this exists.
  const rateLimit = await checkRateLimit(req, 'sign-lead-public');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { leadId, idNumber, email, phoneNumber, coupleNotesSigned, coupleNames } = body;

    if (!leadId || !idNumber) {
      return jsonResponse({ error: 'leadId and idNumber are required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    console.log('[signLeadPublic] Setting status to חוזה for leadId:', leadId);

    const updateData: Record<string, unknown> = {
      status: 'חוזה',
      signed_at: new Date().toISOString(),
    };
    if (coupleNotesSigned !== undefined) updateData.couple_notes_signed = coupleNotesSigned;
    if (idNumber) updateData.signed_id_number = idNumber;
    if (email) updateData.signed_email = email;
    if (phoneNumber) updateData.signed_phone_number = phoneNumber;
    if (coupleNames) updateData.signed_couple_names = coupleNames;

    const { data: updated, error } = await supabase
      .from('leads')
      .update(updateData)
      .eq('id', leadId)
      .is('signed_at', null)
      .select('id');
    if (error) {
      console.error('[signLeadPublic] Error:', error.message);
      return jsonResponse({ error: error.message }, { status: 500 });
    }
    if (!updated || updated.length === 0) {
      const { data: existing } = await supabase.from('leads').select('id').eq('id', leadId).maybeSingle();
      return existing
        ? jsonResponse({ error: 'החוזה כבר נחתם' }, { status: 409 })
        : jsonResponse({ error: 'החוזה לא נמצא' }, { status: 404 });
    }

    console.log('[signLeadPublic] Update done, returning success');
    return jsonResponse({ success: true, message: 'Lead signed' });
  } catch (error) {
    console.error('[signLeadPublic] Error:', error.message);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
