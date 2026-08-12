import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-app-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { leadId, productionBridePhone, productionGroomPhone, productionBridePrepLocation, productionInstagram, productionSpecialRequests } = body;

    if (!leadId) return Response.json({ error: 'leadId required' }, { status: 400, headers: corsHeaders });

    const now = new Date().toISOString();

    // Fetch lead to get basic info
    const leads = await base44.asServiceRole.entities.Lead.filter({ id: leadId });
    const lead = leads?.[0];
    if (!lead) return Response.json({ error: 'Lead not found' }, { status: 404, headers: corsHeaders });

    // Build final technical summary from questionnaire data
    const finalTechnicalSummary = [
      `📍 מקום התארגנות: ${productionBridePrepLocation || "הזוג טרם מילא את השאלון"}`,
      `📱 נייד כלה: ${productionBridePhone || "הזוג טרם מילא את השאלון"}`,
      `📱 נייד חתן: ${productionGroomPhone || "הזוג טרם מילא את השאלון"}`,
      productionInstagram ? `📸 אינסטגרם: ${productionInstagram}` : null,
      productionSpecialRequests ? `💬 בקשות מיוחדות: ${productionSpecialRequests}` : null,
    ].filter(Boolean).join('\n');

    // Build production brief (for archival/info)
    const productionBrief = [
      `🎉 סיכום הפקה - ${lead.coupleNames}`,
      '',
      '📋 פרטי אירוע:',
      `📅 תאריך: ${lead.eventDate || "—"}`,
      `📍 אולם: ${lead.venueName || "—"}`,
      '',
      '🎀 התארגנות וניידות:',
      finalTechnicalSummary,
    ].filter(Boolean).join('\n');

    // Save production details to lead
    await base44.asServiceRole.entities.Lead.update(leadId, {
      productionBridePhone: productionBridePhone || '',
      productionGroomPhone: productionGroomPhone || '',
      productionBridePrepLocation: productionBridePrepLocation || '',
      productionInstagram: productionInstagram || '',
      productionSpecialRequests: productionSpecialRequests || '',
      productionFormFilledAt: now,
      productionBrief: productionBrief,
      finalTechnicalSummary: finalTechnicalSummary,
    });

    if (lead) {
      try {
        const conn = await base44.asServiceRole.connectors.getConnection('googlecalendar');
        const accessToken = conn.accessToken;

        const settings = await base44.asServiceRole.entities.AppSetting.list();
        const calendarId = settings.find(s => s.key === 'google_calendar_id')?.value?.trim() || 'primary';

        // Build production description block
        const productionBlock = [
          '--- פרטי הפקה (מהשאלון) ---',
          `📍 התארגנות כלה: ${productionBridePrepLocation || '—'}`,
          `📱 נייד כלה: ${productionBridePhone || '—'}`,
          `📱 נייד חתן: ${productionGroomPhone || '—'}`,
          productionInstagram ? `📸 אינסטגרם: ${productionInstagram}` : null,
          productionSpecialRequests ? `💬 בקשות מיוחדות: ${productionSpecialRequests}` : null,
        ].filter(Boolean).join('\n');

        let gcEventId = null;

        // First try: use stored event ID on the lead
        if (lead.googleCalendarEventId) {
          gcEventId = lead.googleCalendarEventId;
        } else {
          // Fallback: search by couple name
          const searchRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?q=${encodeURIComponent(lead.coupleNames)}&maxResults=10`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          const searchData = await searchRes.json();
          const gcEvent = searchData.items?.find(e => e.summary?.includes(lead.coupleNames));
          if (gcEvent) gcEventId = gcEvent.id;
        }

        if (gcEventId) {
          // Fetch existing event to preserve current description
          const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${gcEventId}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          const evData = await evRes.json();

          // Strip old production block if exists, append new one
          let baseDescription = (evData.description || '').replace(/\n*--- פרטי הפקה \(מהשאלון\) ---[\s\S]*/g, '').trimEnd();
          const newDescription = baseDescription ? `${baseDescription}\n\n${productionBlock}` : productionBlock;

          await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${gcEventId}`,
            {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ description: newDescription }),
            }
          );
          console.log('Google Calendar event description updated successfully');
        } else {
          console.log('No matching Google Calendar event found');
        }
      } catch (gcErr) {
        console.warn('Could not update Google Calendar:', gcErr.message);
        // Non-fatal — questionnaire data is already saved
      }
    }

    return Response.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error('submitProductionQuestionnaire error:', error);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});