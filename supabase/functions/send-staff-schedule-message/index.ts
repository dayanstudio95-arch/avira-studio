// Ports base44/functions/sendStaffScheduleMessage/entry.ts.
// Isolated function — sends a pre-built WhatsApp schedule message to a staff member.
// Payload: { staffId: string, message: string }.
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
    const { staffId, message } = await req.json();

    if (!staffId || typeof staffId !== 'string') {
      return jsonResponse({ error: 'staffId חסר או לא תקין' }, { status: 400 });
    }
    if (!message || !message.trim()) {
      return jsonResponse({ error: 'ההודעה ריקה' }, { status: 400 });
    }

    const { data: staff, error: staffErr } = await supabase
      .from('staff_members')
      .select('*')
      .eq('id', staffId)
      .maybeSingle();

    if (staffErr) return jsonResponse({ error: staffErr.message }, { status: 500 });
    if (!staff) return jsonResponse({ error: `איש צוות עם מזהה ${staffId} לא נמצא` }, { status: 404 });
    if (!staff.phone_number || !staff.phone_number.trim()) {
      return jsonResponse({ error: `לא נמצא מספר טלפון עבור ${staff.name}` }, { status: 400 });
    }

    const result = await sendWhatsApp(supabase, staff.phone_number.trim(), message.trim());
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    return jsonResponse({ success: true, sentTo: staff.phone_number, staffName: staff.name });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
