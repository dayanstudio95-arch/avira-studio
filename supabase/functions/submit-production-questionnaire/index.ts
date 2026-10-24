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
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { loadQuestionnaireConfig, mergeExtraAnswers, extraAnswerLines, BUILTIN_COLUMNS } from '../_shared/questionnaireExtras.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  // Fully public/unauthenticated endpoint -- rate-limited per caller IP since leadId
  // (an unguessable UUID) is the only real security boundary here. See
  // _shared/rateLimit.ts / migration 0023 for why this exists.
  const rateLimit = await checkRateLimit(req, 'submit-production-questionnaire');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

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
      // The studio's own questions (2026-10-24): { [questionId]: text | boolean }.
      extraAnswers,
    } = body;

    if (!leadId) return jsonResponse({ error: 'leadId required' }, { status: 400 });

    const now = new Date().toISOString();

    const { data: leads, error: leadErr } = await supabase.from('leads').select('*').eq('id', leadId).limit(1);
    if (leadErr) return jsonResponse({ error: leadErr.message }, { status: 500 });
    const lead = leads?.[0];
    if (!lead) return jsonResponse({ error: 'Lead not found' }, { status: 404 });

    // The studio's questionnaire (Settings → שאלון הפקה, 2026-10-24). A built-in question the
    // studio hid is not on the form, so it is not written here: the answer it has stays.
    const config = await loadQuestionnaireConfig(supabase, lead.tenant_id);
    const hiddenColumns = new Set(
      Object.entries(config.builtins).filter(([, o]) => o.hidden).flatMap(([key]) => BUILTIN_COLUMNS[key] || [])
    );
    // What the summaries below should say for a hidden question: what the lead already has.
    const kept = (column: string, sent: unknown) => (hiddenColumns.has(column) ? lead[column] : sent);
    const extra = mergeExtraAnswers(lead.production_extra_answers, config, extraAnswers);
    const extraLines = extraAnswerLines({ production_extra_answers: extra });

    // The values as they will stand after this save (a hidden question keeps its answer).
    const v_productionBridePrepLocation = kept('production_bride_prep_location', productionBridePrepLocation);
    const v_productionBridePhone = kept('production_bride_phone', productionBridePhone);
    const v_productionGroomPhone = kept('production_groom_phone', productionGroomPhone);
    const v_productionCompanionName = kept('production_companion_name', productionCompanionName);
    const v_productionCompanionPhone = kept('production_companion_phone', productionCompanionPhone);
    const v_productionCheckinTime = kept('production_checkin_time', productionCheckinTime);
    const v_productionChuppahTime = kept('production_chuppah_time', productionChuppahTime);
    const v_productionBrideInstagram = kept('production_bride_instagram', productionBrideInstagram);
    const v_productionGroomInstagram = kept('production_groom_instagram', productionGroomInstagram);
    const v_productionHasSocialCreator = kept('production_has_social_creator', productionHasSocialCreator);
    const v_productionSocialCreatorName = kept('production_social_creator_name', productionSocialCreatorName);
    const v_productionSocialCreatorPhone = kept('production_social_creator_phone', productionSocialCreatorPhone);
    const v_productionHasExternalPlanner = kept('production_has_external_planner', productionHasExternalPlanner);
    const v_productionExternalPlannerName = kept('production_external_planner_name', productionExternalPlannerName);
    const v_productionExternalPlannerPhone = kept('production_external_planner_phone', productionExternalPlannerPhone);
    const v_productionFamilyBride = kept('production_family_bride', productionFamilyBride);
    const v_productionFamilyGroom = kept('production_family_groom', productionFamilyGroom);
    const v_productionImportantPeople = kept('production_important_people', productionImportantPeople);
    const v_productionFamilySensitivities = kept('production_family_sensitivities', productionFamilySensitivities);
    const v_productionPlannedSurprises = kept('production_planned_surprises', productionPlannedSurprises);
    const v_productionSpecialRequests = kept('production_special_requests', productionSpecialRequests);

    const finalTechnicalSummary = [
      `📍 מקום התארגנות: ${v_productionBridePrepLocation || 'הזוג טרם מילא את השאלון'}`,
      `📱 נייד כלה: ${v_productionBridePhone || 'הזוג טרם מילא את השאלון'}`,
      `📱 נייד חתן: ${v_productionGroomPhone || 'הזוג טרם מילא את השאלון'}`,
      v_productionCompanionName || v_productionCompanionPhone
        ? `🧑‍🤝‍🧑 מלווה: ${v_productionCompanionName || '—'}${v_productionCompanionPhone ? ` (${v_productionCompanionPhone})` : ''}`
        : null,
      v_productionCheckinTime ? `🕐 שעת הגעה/קבלת פנים: ${v_productionCheckinTime}` : null,
      v_productionChuppahTime ? `💍 שעת חופה משוערת: ${v_productionChuppahTime}` : null,
      v_productionBrideInstagram ? `📸 אינסטגרם כלה: ${v_productionBrideInstagram}` : null,
      v_productionGroomInstagram ? `📸 אינסטגרם חתן: ${v_productionGroomInstagram}` : null,
      v_productionHasSocialCreator
        ? `🎥 סושיאל קריאייטור/צלם/ת סושיאל: ${v_productionSocialCreatorName || '—'}${v_productionSocialCreatorPhone ? ` (${v_productionSocialCreatorPhone})` : ''}`
        : null,
      v_productionHasExternalPlanner
        ? `📋 מנהל/ת אירוע חיצוני/ת: ${v_productionExternalPlannerName || '—'}${v_productionExternalPlannerPhone ? ` (${v_productionExternalPlannerPhone})` : ''}`
        : null,
      v_productionFamilyBride ? `👪 משפחת הכלה: ${v_productionFamilyBride}` : null,
      v_productionFamilyGroom ? `👪 משפחת החתן: ${v_productionFamilyGroom}` : null,
      v_productionImportantPeople ? `⭐ אנשים חשובים לצלם: ${v_productionImportantPeople}` : null,
      v_productionFamilySensitivities ? `⚠️ רגישויות משפחתיות: ${v_productionFamilySensitivities}` : null,
      v_productionPlannedSurprises ? `🎁 הפתעות מתוכננות: ${v_productionPlannedSurprises}` : null,
      productionInstagram ? `📸 אינסטגרם: ${productionInstagram}` : null,
      v_productionSpecialRequests ? `💬 בקשות מיוחדות: ${v_productionSpecialRequests}` : null,
      ...extraLines,
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

    const update: Record<string, unknown> = {
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
        production_extra_answers: extra,
      };
    for (const column of hiddenColumns) delete update[column];

    let { error: updateErr } = await supabase
      .from('leads')
      .update(update)
      .eq('id', leadId);
    // Deployed before migration 0093? Save the built-in answers rather than nothing.
    if (updateErr && /production_extra_answers/.test(updateErr.message || '')) {
      console.error('submit-production-questionnaire: production_extra_answers missing — run migration 0093');
      delete update.production_extra_answers;
      ({ error: updateErr } = await supabase.from('leads').update(update).eq('id', leadId));
    }

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
