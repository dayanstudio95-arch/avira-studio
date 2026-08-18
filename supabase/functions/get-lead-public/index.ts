// Ports base44/functions/getLeadPublic/entry.ts.
// Public, unauthenticated endpoint (contract page, questionnaire page) — no logged-in
// user, so it uses the service-role client and relies on leadId being an unguessable
// UUID for security, exactly like the Base44 original's asServiceRole pattern.
// Returns a whitelisted, camelCase field set (no internal notes) at the JSON boundary,
// matching the exact contract the frontend already expects.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  // Fully public/unauthenticated endpoint (see supabaseClients.ts) -- rate-limited per
  // caller IP since leadId (an unguessable UUID) is the only real security boundary
  // here. See _shared/rateLimit.ts / migration 0023 for why this exists.
  const rateLimit = await checkRateLimit(req, 'get-lead-public');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const { leadId } = await req.json();
    if (!leadId) return jsonResponse({ error: 'leadId is required' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();

    if (error) return jsonResponse({ error: error.message }, { status: 500 });
    if (!lead) return jsonResponse({ error: 'Lead not found' }, { status: 404 });

    // Added (2026-08-13) so the public contract page can stamp the studio's own saved
    // signature (Settings -> חוזה -> חתימת הסטודיו) onto the signed PDF next to the
    // client's signature. Best-effort: a missing signature setting must never break
    // loading the contract itself, so failures here are swallowed.
    let studioSignature: string | null = null;
    try {
      const { data: sigRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('tenant_id', lead.tenant_id)
        .eq('key', 'studio_signature')
        .maybeSingle();
      studioSignature = sigRow?.value || null;
    } catch (sigErr) {
      console.error('[getLeadPublic] Failed to load studio_signature:', sigErr);
    }

    // Added (2026-08-18) so the public contract page can show the studio's own
    // branding (Settings -> פרטי הסטודיו) instead of the hardcoded "Avira Studio"
    // text. Same best-effort pattern as studioSignature above — a missing/unset
    // tenant row must never break loading the contract itself.
    // Fallback order matters for multi-tenant use: `display_name_to_clients` (if
    // the studio explicitly set a client-facing name) -> `tenants.name` (always
    // set at tenant creation, so this is never another studio's brand name) ->
    // the literal "Avira Studio" only as a last-resort default if the tenant
    // lookup itself fails.
    let studioDisplayName = 'Avira Studio';
    let studioAutoSignature: string | null = null;
    let studioLogoUrl: string | null = null;
    try {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('name, display_name_to_clients, auto_signature_text, logo_url')
        .eq('id', lead.tenant_id)
        .maybeSingle();
      studioDisplayName = tenantRow?.display_name_to_clients || tenantRow?.name || 'Avira Studio';
      studioAutoSignature = tenantRow?.auto_signature_text || null;
      studioLogoUrl = tenantRow?.logo_url || null;
    } catch (tenantErr) {
      console.error('[getLeadPublic] Failed to load studio details:', tenantErr);
    }

    return jsonResponse({
      studioSignature,
      studioDisplayName,
      studioAutoSignature,
      studioLogoUrl,
      id: lead.id,
      coupleNames: lead.couple_names,
      eventDate: lead.event_date,
      phoneNumber: lead.phone_number,
      email: lead.email,
      venueName: lead.venue_name,
      packageChoice: lead.package_choice,
      packageDetails: lead.package_details,
      basePrice: lead.base_price,
      discount: lead.discount,
      finalPrice: lead.final_price,
      status: lead.status,
      contractTerms: lead.contract_terms,
      signedAt: lead.signed_at,
      idNumber: lead.id_number,
      // Added so the couple's own contract page can show/download their signed PDF
      // after signing (see save-signed-contract + migration 0006 for the upload side).
      signedContractPdfUrl: lead.signed_contract_pdf_url,
      productionBridePhone: lead.production_bride_phone,
      productionGroomPhone: lead.production_groom_phone,
      productionBridePrepLocation: lead.production_bride_prep_location,
      productionInstagram: lead.production_instagram,
      productionSpecialRequests: lead.production_special_requests,
      productionFormFilledAt: lead.production_form_filled_at,
      // Added for the full Base44-parity questionnaire (migration 0009_questionnaire_fields.sql).
      productionCompanionName: lead.production_companion_name,
      productionCompanionPhone: lead.production_companion_phone,
      productionCheckinTime: lead.production_checkin_time,
      productionChuppahTime: lead.production_chuppah_time,
      productionBrideInstagram: lead.production_bride_instagram,
      productionGroomInstagram: lead.production_groom_instagram,
      productionHasSocialCreator: lead.production_has_social_creator,
      productionSocialCreatorName: lead.production_social_creator_name,
      productionSocialCreatorPhone: lead.production_social_creator_phone,
      productionHasExternalPlanner: lead.production_has_external_planner,
      productionExternalPlannerName: lead.production_external_planner_name,
      productionExternalPlannerPhone: lead.production_external_planner_phone,
      productionFamilyBride: lead.production_family_bride,
      productionFamilyGroom: lead.production_family_groom,
      productionImportantPeople: lead.production_important_people,
      productionFamilySensitivities: lead.production_family_sensitivities,
      productionPlannedSurprises: lead.production_planned_surprises,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
