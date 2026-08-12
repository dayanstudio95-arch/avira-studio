import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

/**
 * onLeadStatusChange
 * NOTE: Event creation when lead is signed is handled by the
 * "Lead Signed Forever" automation (onLeadSignedForever).
 * This function is kept for future use but does NOT create events.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data, old_data } = payload;

    if (event?.type !== 'update') {
      return Response.json({ message: 'Not an update event' });
    }

    const newStatus = data?.status;
    const oldStatus = old_data?.status;

    if (newStatus !== 'נסגר/חתימה' || oldStatus === 'נסגר/חתימה') {
      return Response.json({ message: 'Status change not relevant' });
    }

    // Event creation is handled by onLeadSignedForever automation.
    // Do NOT create events here to prevent duplicates.
    console.log(`[onLeadStatusChange] Lead ${data?.id} signed — event creation delegated to onLeadSignedForever`);
    return Response.json({ success: true, message: 'delegated to onLeadSignedForever' });

  } catch (error) {
    console.error('[onLeadStatusChange] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});