// Ports base44/functions/dailyEventBrief/entry.ts.
// Invoked from TeamAutomationTab.jsx's "סיכום יומי" button (dynamic fnName ===
// "dailyEventBrief", payload {}). Sends each photographer on tomorrow's events a
// WhatsApp brief (pulled from the synced Google Calendar description when
// available, else a fallback summary built from the lead's questionnaire answers).
//
// The original had NO auth check at all (called base44.entities.* directly with no
// base44.auth.me() call) — hardened here to require a logged-in user, consistent
// with every other ported function; no role/admin gate though, matching the
// original's permissiveness beyond that.
//
// Google Calendar description fetch is best-effort/non-fatal (same gap documented
// in sync-event-to-calendar) — falls through to the manual summary if no token is
// configured in app_settings, exactly like the original's try/catch around the
// connectors call.
//
// Make.com webhook send replaced with the shared Green API sendWhatsApp() helper
// per the site-wide Make.com replacement decision.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { getValidAccessToken } from '../_shared/googleCalendarAuth.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);

    // Best-effort Google Calendar access via the real OAuth flow (primary
    // account only — the description lives on the main/legacy calendar event).
    let googleAccessToken: string | null = null;
    let calendarId = 'primary';
    try {
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).maybeSingle();
      if (profile) {
        const token = await getValidAccessToken(supabase, profile.tenant_id, 'primary');
        if (token) {
          googleAccessToken = token.accessToken;
          calendarId = token.calendarId;
        }
      }
    } catch {
      console.log('Google Calendar not available, proceeding without it');
    }

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const { data: allEvents, error: evErr } = await supabase.from('events').select('*');
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
    const tomorrowEvents = (allEvents || []).filter((event) => event.date === tomorrowStr);

    if (tomorrowEvents.length === 0) {
      return jsonResponse({ success: true, message: 'No events tomorrow' });
    }

    const [{ data: staffMembers, error: staffErr }, { data: leads, error: leadsErr }] = await Promise.all([
      supabase.from('staff_members').select('name, phone_number'),
      supabase.from('leads').select('id, phone_number, final_technical_summary'),
    ]);
    if (staffErr) return jsonResponse({ error: staffErr.message }, { status: 500 });
    if (leadsErr) return jsonResponse({ error: leadsErr.message }, { status: 500 });

    const results: Array<{ eventName: string; crewMember: string; success: boolean; error?: string }> = [];
    const photographerRoles = ['photographer1', 'photographer2'];

    for (const event of tomorrowEvents) {
      const team: Array<{ role?: string; staffMemberName?: string }> = event.team || [];
      if (!team.length) continue;

      const leadRef = event.source_lead_id || event.lead_id;
      const lead = (leads || []).find((l) => l.id === leadRef);

      let eventSummary = '';
      if (googleAccessToken && event.google_calendar_event_id) {
        try {
          const gcResponse = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${event.google_calendar_event_id}`,
            { headers: { Authorization: `Bearer ${googleAccessToken}` } }
          );
          const gcEvent = await gcResponse.json();
          const description = gcEvent.description || '';
          if (description && description.trim()) eventSummary = description.trim();
        } catch (gcErr) {
          console.warn('Could not fetch Google Calendar event:', gcErr.message);
        }
      }

      if (!eventSummary) {
        const technicalSummary = lead?.final_technical_summary || '⚠️ הזוג טרם מילא את השאלון - אין מידע זמין';
        eventSummary = `
🎬 סיכום אירוע - ${new Date(event.date).toLocaleDateString('he-IL')}

👫 הזוג: ${event.couple_names}
📞 טלפון ראשי: ${lead?.phone_number || '—'}
📍 אולם: ${event.venue || '—'}

📋 פרטים טכניים:
${technicalSummary}

👥 צוות הצילום:
${team.map((m) => `• ${m.staffMemberName} (${m.role})`).join('\n')}
        `.trim();
      }

      for (const member of team) {
        if (!member.staffMemberName) continue;
        if (!photographerRoles.includes(member.role || '')) continue;

        const staff = (staffMembers || []).find((s) => s.name === member.staffMemberName);
        if (!staff || !staff.phone_number) continue;

        const personalMessage = `היי ${member.staffMemberName},\n\nלהלן פרטי האירוע שלך מחר:\n\n${eventSummary}`;
        const result = await sendWhatsApp(supabase, staff.phone_number, personalMessage);
        results.push({
          eventName: event.couple_names,
          crewMember: member.staffMemberName,
          success: result.success,
          error: result.success ? undefined : result.error,
        });
      }
    }

    return jsonResponse({ success: true, eventsProcessed: tomorrowEvents.length, results });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
