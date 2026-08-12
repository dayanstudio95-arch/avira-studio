// Ports base44/functions/monthlyCrewSchedule/entry.ts.
// Invoked from TeamAutomationTab.jsx's "לו״ז חודשי" button (base44.functions.invoke
// with a dynamic fnName === "monthlyCrewSchedule", payload {}).
//
// Replaced the original's Make.com webhook send (action_type: 'monthly_crew_schedule')
// with the shared Green API sendWhatsApp() helper, per the site-wide Make.com
// replacement decision — everything else is a straight port.
//
// Role check: original required user.role === 'admin'; 'owner' is treated as
// admin-equivalent here (see assign-studio-ids for the same reasoning).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (!profile || !['owner', 'admin'].includes(profile.role)) {
      return jsonResponse({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStart = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), 1);
    const nextMonthEnd = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);

    const { data: allEvents, error: evErr } = await supabase.from('events').select('date, team, couple_names, venue');
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });

    const nextMonthEvents = (allEvents || []).filter((event) => {
      const eventDate = new Date(event.date);
      return eventDate >= nextMonthStart && eventDate <= nextMonthEnd;
    });

    if (nextMonthEvents.length === 0) {
      return jsonResponse({ success: true, message: 'No events for next month' });
    }

    const { data: staffMembers, error: staffErr } = await supabase.from('staff_members').select('name, phone_number');
    if (staffErr) return jsonResponse({ error: staffErr.message }, { status: 500 });

    const crewSchedules: Record<string, Array<{ date: string; coupleNames: string; venue: string }>> = {};

    for (const event of nextMonthEvents) {
      const team: Array<{ staffMemberName?: string }> = event.team || [];
      if (!team.length) continue;
      for (const member of team) {
        if (!member.staffMemberName) continue;
        if (!crewSchedules[member.staffMemberName]) crewSchedules[member.staffMemberName] = [];
        crewSchedules[member.staffMemberName].push({ date: event.date, coupleNames: event.couple_names, venue: event.venue });
      }
    }

    const results: Array<{ crewName: string; success: boolean; eventsCount?: number; error?: string }> = [];

    for (const [crewName, events] of Object.entries(crewSchedules)) {
      const staff = (staffMembers || []).find((s) => s.name === crewName);
      if (!staff || !staff.phone_number) continue;

      const eventsList = events
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((e) => {
          const dateStr = new Date(e.date).toLocaleDateString('he-IL');
          return `${dateStr} - ${e.coupleNames} - ${e.venue || 'בחזקה'}`;
        })
        .join('\n');

      const messageText = `היי ${crewName}, הנה לו"ז האירועים שלך לחודש הקרוב:\n\n${eventsList}`;

      const result = await sendWhatsApp(supabase, staff.phone_number, messageText);
      results.push({ crewName, success: result.success, eventsCount: events.length, error: result.success ? undefined : result.error });
    }

    return jsonResponse({ success: true, results });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
