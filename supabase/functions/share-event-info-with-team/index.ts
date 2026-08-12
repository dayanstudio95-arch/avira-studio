// Ports base44/functions/shareEventInfoWithTeam/entry.ts.
// Doesn't actually send anything server-side — it builds per-staff wa.me deep links
// (opened manually in the browser) from the event/lead production info, same as the
// original. `event.team` items use `staffMemberName` (string, matched against
// staff_members.name) — NOT an id — confirmed against actual frontend usage
// (NewEvent.jsx, ExpensesStep.jsx), even though the schema comment in
// 0001_init.sql suggested staff_member_id.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const { eventId } = await req.json();
    if (!eventId) return jsonResponse({ error: 'Missing eventId' }, { status: 400 });

    const { data: event, error: evErr } = await supabase.from('events').select('*').eq('id', eventId).maybeSingle();
    if (evErr) return jsonResponse({ error: evErr.message }, { status: 500 });
    if (!event) return jsonResponse({ error: 'Event not found' }, { status: 404 });

    const teamMembers: Array<{ staffMemberName?: string }> = Array.isArray(event.team) ? event.team : [];

    const { data: allStaff, error: staffErr } = await supabase.from('staff_members').select('*');
    if (staffErr) return jsonResponse({ error: staffErr.message }, { status: 500 });

    const staffWithPhone = [];
    for (const member of teamMembers) {
      const staff = allStaff?.find((s) => s.name === member.staffMemberName);
      if (staff && staff.phone_number) {
        staffWithPhone.push({ name: member.staffMemberName, phone: staff.phone_number, id: staff.id });
      }
    }

    if (staffWithPhone.length === 0) {
      return jsonResponse({ success: false, error: 'אין אנשי צוות עם מספרי טלפון' }, { status: 400 });
    }

    let lead: any = null;
    const { data: leads } = await supabase.from('leads').select('*').eq('couple_names', event.couple_names);
    if (leads && leads.length > 0) lead = leads[0];

    let messageText = `🎬 *פרטי אירוע: ${event.couple_names}*\n\n`;
    messageText += `📅 *תאריך:* ${new Date(event.date).toLocaleDateString('he-IL')}\n`;
    messageText += `📍 *אולם:* ${event.venue || 'לא צוין'}\n\n`;

    if (lead?.production_bride_prep_location) {
      messageText += `👰 *התארגנות כלה:* ${lead.production_bride_prep_location}\n`;
    }
    if (lead?.production_special_requests) {
      messageText += `⭐ *בקשות מיוחדות:* ${lead.production_special_requests}\n`;
    }
    if (lead?.production_instagram) {
      messageText += `📱 *Instagram:* ${lead.production_instagram}\n`;
    }

    messageText += `\n⏰ *הזמן להכנה:* 08:00\nתודה רבה! 🙏`;

    const results = [];
    for (const staff of staffWithPhone) {
      try {
        const cleanedPhone = staff.phone.replace(/[-\s()]/g, '');
        const phoneWithCountry = cleanedPhone.startsWith('0') ? '972' + cleanedPhone.substring(1) : cleanedPhone;
        const encodedMessage = encodeURIComponent(messageText);
        const whatsappLink = `https://wa.me/${phoneWithCountry}?text=${encodedMessage}`;

        results.push({ staffName: staff.name, phone: staff.phone, whatsappLink, sent: true });
      } catch (error) {
        results.push({ staffName: staff.name, phone: staff.phone, sent: false, error: error.message });
      }
    }

    return jsonResponse({
      success: true,
      totalSent: results.filter((r) => r.sent).length,
      totalTeamMembers: staffWithPhone.length,
      results,
    });
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
