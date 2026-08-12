// Ports base44/functions/submitProductionQuestionnaire/entry.ts.
// Public, unauthenticated — service-role client, leadId is the unguessable-UUID
// security boundary. Saves the questionnaire answers onto the Lead, then makes a
// best-effort (non-fatal) attempt to append a production summary block onto the
// matching Google Calendar event's description.
//
// NOTE (known gap, not yet resolved): the original Base44 function obtained a Google
// Calendar access token via Base44's built-in "connectors" abstraction
// (asServiceRole.connectors.getConnection('googlecalendar')). That abstraction has no
// Supabase equivalent yet — the native integrations Settings UI (Phase 4) that will
// let studios connect Google Calendar and store a token hasn't been built. Until then
// this reads `google_calendar_access_token` / `google_calendar_id` from app_settings
// (tenant-scoped) and, if missing or expired, just skips the calendar update —
// exactly as non-fatal as the original's try/catch. The questionnaire data itself
// always saves regardless.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';

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

    // Best-effort Google Calendar description update — never fails the request.
    try {
      const { data: settings } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('tenant_id', lead.tenant_id)
        .in('key', ['google_calendar_access_token', 'google_calendar_id']);

      const accessToken = settings?.find((s) => s.key === 'google_calendar_access_token')?.value;
      const calendarId = settings?.find((s) => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

      if (!accessToken) {
        console.log('Google Calendar not connected for this tenant — skipping calendar update');
      } else {
        const productionBlock = [
          '--- פרטי הפקה (מהשאלון) ---',
          `📍 התארגנות כלה: ${productionBridePrepLocation || '—'}`,
          `📱 נייד כלה: ${productionBridePhone || '—'}`,
          `📱 נייד חתן: ${productionGroomPhone || '—'}`,
          productionInstagram ? `📸 אינסטגרם: ${productionInstagram}` : null,
          productionSpecialRequests ? `💬 בקשות מיוחדות: ${productionSpecialRequests}` : null,
        ].filter(Boolean).join('\n');

        let gcEventId: string | null = null;

        if (lead.google_calendar_event_id) {
          gcEventId = lead.google_calendar_event_id;
        } else {
          const searchRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(lead.couple_names)}&maxResults=10`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const searchData = await searchRes.json();
          const gcEvent = searchData.items?.find((e: any) => e.summary?.includes(lead.couple_names));
          if (gcEvent) gcEventId = gcEvent.id;
        }

        if (gcEventId) {
          const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${gcEventId}`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const evData = await evRes.json();

          const baseDescription = (evData.description || '')
            .replace(/\n*--- פרטי הפקה \(מהשאלון\) ---[\s\S]*/g, '')
            .trimEnd();
          const newDescription = baseDescription ? `${baseDescription}\n\n${productionBlock}` : productionBlock;

          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${gcEventId}`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ description: newDescription }),
            }
          );
          console.log('Google Calendar event description updated successfully');
        } else {
          console.log('No matching Google Calendar event found');
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
