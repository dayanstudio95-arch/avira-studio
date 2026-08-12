// Ports base44/functions/getLeadPublic/entry.ts.
// Public, unauthenticated endpoint (contract page, questionnaire page) — no logged-in
// user, so it uses the service-role client and relies on leadId being an unguessable
// UUID for security, exactly like the Base44 original's asServiceRole pattern.
// Returns a whitelisted, camelCase field set (no internal notes) at the JSON boundary,
// matching the exact contract the frontend already expects.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const { leadId } = await req.json();
    if (!leadId) return jsonResponse({ error: 'leadId is required' }, { status: 400 });

    const supabase = createServiceRoleClient();
    const { data: lead, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();

    if (error) return jsonResponse({ error: error.message }, { status: 500 });
    if (!lead) return jsonResponse({ error: 'Lead not found' }, { status: 404 });

    return jsonResponse({
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
