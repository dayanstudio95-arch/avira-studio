// Ports base44/functions/submitProductionQuestionnaire/entry.ts.
// Public, unauthenticated — service-role client, leadId is the unguessable-UUID
// security boundary. Saves the questionnaire answers onto the Lead, then makes a
// best-effort (non-fatal) attempt to push the updated description to the
// matching Google Calendar event(s).
//
// The calendar update reuses the shared syncEventToAllAccounts helper (same one
// used everywhere else events get pushed to Google) instead of a bespoke PATCH:
// this resolves the linked event via events.source_lead_id/lead_id, then lets
// buildEventPayload build the full description (including this questionnaire's
// answers, since it re-reads the lead row live) and push it to BOTH connected
// accounts (primary + backup), not just primary. Previously this function did
// its own primary-only PATCH keyed off leads.google_calendar_event_id — a
// column that's never actually written anywhere in the codebase, so that
// lookup always fell through to an unreliable Google full-text search by
// couple name.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { syncEventToAllAccounts } from '../_shared/googleCalendarSync.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const supabase = createServiceRoleClient();
    const body = await req.json();
    const {
      leadId,
      productionBridePhone,
      productionGroomPhone,
      productionBridePrepLocation,
      productionInstagram,
      productionSpecialRequests,
      // Added for the full Base44-parity questionnaire (migration 0009_questionnaire_fields.sql).
      productionCompanionName,
      productionCompanionPhone,
      productionCheckinTime,
      productionChuppahTime,
      productionBrideInstagram,
      productionGroomInstagram,
      productionHasSocialCreator,
      productionSocialCreatorName,
      productionSocialCreatorPhone,
      productionHasExternalPlanner,
      productionExternalPlannerName,
      productionExternalPlannerPhone,
      productionFamilyBride,
      productionFamilyGroom,
      productionImportantPeople,
      productionFamilySensitivities,
      productionPlannedSurprises,
    } = body;

    if (!leadId) return jsonResponse({ error: 'leadId required' }, { status: 400 });

    const now = new Date().toISOString();

    const { data: leads, error: leadErr } = await supabase.from('leads').select('*').eq('id', leadId).limit(1);
    if (leadErr) return jsonResponse({ error: leadErr.message }, { status: 500 });
    const lead = leads?.[0];
    if (!lead) return jsonResponse({ error: 'Lead not found' }, { status: 404 });

    const finalTechnicalSummary = [
      `📍 מקום התארגנות: ${productionBridePrepLocation || 'הזוג טרם מילא את השאלון'}`,
      `📱 נייד כלה: ${productionBridePhone || 'הזוג טרם מילא את השאלון'}`,
      `📱 נייד חתן: ${productionGroomPhone || 'הזוג טרם מילא את השאלון'}`,
      productionCompanionName || productionCompanionPhone
        ? `🧑‍🤝‍🧑 מלווה: ${productionCompanionName || '—'}${productionCompanionPhone ? ` (${productionCompanionPhone})` : ''}`
        : null,
      productionCheckinTime ? `🕐 שעת הגעה/קבלת פנים: ${productionCheckinTime}` : null,
      productionChuppahTime ? `💍 שעת חופה משוערת: ${productionChuppahTime}` : null,
      productionBrideInstagram ? `📸 אינסטגרם כלה: ${productionBrideInstagram}` : null,
      productionGroomInstagram ? `📸 אינסטגרם חתן: ${productionGroomInstagram}` : null,
      productionHasSocialCreator
        ? `🎥 סושיאל קריאייטור/צלם/ת סושיאל: ${productionSocialCreatorName || '—'}${productionSocialCreatorPhone ? ` (${productionSocialCreatorPhone})` : ''}`
        : null,
      productionHasExternalPlanner
        ? `📋 מנהל/ת אירוע חיצוני/ת: ${productionExternalPlannerName || '—'}${productionExternalPlannerPhone ? ` (${productionExternalPlannerPhone})` : ''}`
        : null,
      productionFamilyBride ? `👪 משפחת הכלה: ${productionFamilyBride}` : null,
      productionFamilyGroom ? `👪 משפחת החתן: ${productionFamilyGroom}` : null,
      productionImportantPeople ? `⭐ אנשים חשובים לצלם: ${productionImportantPeople}` : null,
      productionFamilySensitivities ? `⚠️ רגישויות משפחתיות: ${productionFamilySensitivities}` : null,
      productionPlannedSurprises ? `🎁 הפתעות מתוכננות: ${productionPlannedSurprises}` : null,
      productionInstagram ? `📸 אינסטגרם: ${productionInstagram}` : null,
      productionSpecialRequests ? `💬 בקשות מיוחדות: ${productionSpecialRequests}` : null,
    ].filter(Boolean).join('\n');

    const productionBrief = [
      `🎉 סיכום הפקה - ${lead.couple_names}`,
      '',
      '📋 פרטי אירוע:',
      `📅 תאריך: ${lead.event_date || '—'}`,
      `📍 אולם: ${lead.venue_name || '—'}`,
      '',
      '🎀 התארגנות וניידות:',
      finalTechnicalSummary,
    ].filter(Boolean).join('\n');

    const { error: updateErr } = await supabase
      .from('leads')
      .update({
        production_bride_phone: productionBridePhone || '',
        production_groom_phone: productionGroomPhone || '',
        production_bride_prep_location: productionBridePrepLocation || '',
        production_instagram: productionInstagram || '',
        production_special_requests: productionSpecialRequests || '',
        production_form_filled_at: now,
        production_brief: productionBrief,
        final_technical_summary: finalTechnicalSummary,
        // Added for the full Base44-parity questionnaire (migration 0009_questionnaire_fields.sql).
        production_companion_name: productionCompanionName || '',
        production_companion_phone: productionCompanionPhone || '',
        production_checkin_time: productionCheckinTime || '',
        production_chuppah_time: productionChuppahTime || '',
        production_bride_instagram: productionBrideInstagram || '',
        production_groom_instagram: productionGroomInstagram || '',
        production_has_social_creator: !!productionHasSocialCreator,
        production_social_creator_name: productionSocialCreatorName || '',
        production_social_creator_phone: productionSocialCreatorPhone || '',
        production_has_external_planner: !!productionHasExternalPlanner,
        production_external_planner_name: productionExternalPlannerName || '',
        production_external_planner_phone: productionExternalPlannerPhone || '',
        production_family_bride: productionFamilyBride || '',
        production_family_groom: productionFamilyGroom || '',
        production_important_people: productionImportantPeople || '',
        production_family_sensitivities: productionFamilySensitivities || '',
        production_planned_surprises: productionPlannedSurprises || '',
      })
      .eq('id', leadId);

    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    // Best-effort Google Calendar sync — never fails the request.
    try {
      const { data: linkedEvent } = await supabase
        .from('events')
        .select('id')
        .eq('source_lead_id', leadId)
        .maybeSingle();
      const eventId = linkedEvent?.id || (await supabase.from('events').select('id').eq('lead_id', leadId).maybeSingle()).data?.id;

      if (!eventId) {
        console.log('No linked event found for this lead — skipping calendar update');
      } else {
        const { anyConnected, results } = await syncEventToAllAccounts(supabase, lead.tenant_id, eventId);
        if (!anyConnected) {
          console.log('Google Calendar not connected for this tenant — skipping calendar update');
        } else {
          console.log('Google Calendar sync after questionnaire submission:', JSON.stringify(results));
        }
      }
    } catch (gcErr) {
      console.warn('Could not update Google Calendar:', gcErr.message);
      // Non-fatal — questionnaire data is already saved.
    }

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('submitProductionQuestionnaire error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
