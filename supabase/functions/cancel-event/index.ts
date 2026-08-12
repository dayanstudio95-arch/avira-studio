// Ports base44/functions/cancelEvent/entry.ts.
// Called from UnifiedSidePanel.jsx ({ eventId }). Deletes the event and, if it was
// linked to a lead, flips the lead back to 'לא רלוונטי' and appends a cancellation
// note — never leaves a dangling linked_event_id pointing at a deleted row.
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

    const linkedLeadId = event.source_lead_id || event.lead_id || null;

    const { error: delErr } = await supabase.from('events').delete().eq('id', eventId);
    if (delErr) return jsonResponse({ error: delErr.message }, { status: 500 });
    console.log(`[cancelEvent] Event ${eventId} deleted`);

    if (linkedLeadId) {
      const { data: lead } = await supabase.from('leads').select('id, notes').eq('id', linkedLeadId).maybeSingle();
      if (lead) {
        const updatedNotes = lead.notes ? `${lead.notes}\n\nהאירוע בוטל` : 'האירוע בוטל';
        await supabase
          .from('leads')
          .update({ status: 'לא רלוונטי', linked_event_id: null, notes: updatedNotes })
          .eq('id', linkedLeadId);
        console.log(`[cancelEvent] Lead ${linkedLeadId} updated: status=לא רלוונטי, notes appended`);
      }
    }

    return jsonResponse({ success: true, message: 'Event cancelled successfully', eventId, linkedLeadId });
  } catch (error) {
    console.error('[cancelEvent] Error:', error);
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
