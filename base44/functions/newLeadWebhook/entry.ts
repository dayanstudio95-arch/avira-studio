import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

function cleanPhone(raw) {
  if (!raw) return '';
  // Remove @c.us and any non-digit chars, then normalize to Israeli format (0...)
  const digits = raw.replace(/@c\.us$/i, '').replace(/\D/g, '');
  // 972XXXXXXXXX → 0XXXXXXXXX
  if (digits.startsWith('972')) return '0' + digits.slice(3);
  return digits;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Validate secret token
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || req.headers.get('x-webhook-token');
    const expectedToken = Deno.env.get('WEBHOOK_SECRET');
    if (expectedToken && token !== expectedToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const base44 = createClientFromRequest(req);

    const phoneNumber = cleanPhone(body.phoneNumber || body.phone || '');
    const coupleNames = body.coupleNames || body.couple_names || '';
    const newNote = body.notes || body.message || '';

    // Upsert: check if lead with same phone already exists
    const allLeads = await base44.asServiceRole.entities.Lead.list();

    const existing = phoneNumber
      ? allLeads.find(l => cleanPhone(l.phoneNumber) === phoneNumber)
      : null;

    if (existing) {
      // Update existing lead — append new note
      const updatedNotes = existing.notes
        ? `${existing.notes}\n---\n${newNote}`
        : newNote;
      const updated = await base44.asServiceRole.entities.Lead.update(existing.id, {
        notes: updatedNotes || existing.notes,
        last_contact_date: new Date().toISOString(),
      });
      return Response.json({ success: true, action: 'updated', lead: updated });
    }

    // Create new lead with next studio_id
    const maxId = allLeads.reduce((max, l) => Math.max(max, l.studio_id || 0), 0);
    const nextId = maxId + 1;

    const newLead = await base44.asServiceRole.entities.Lead.create({
      studio_id: nextId,
      coupleNames: coupleNames || 'ליד חדש',
      phoneNumber,
      email: body.email || '',
      eventDate: body.eventDate || body.event_date || null,
      venueName: body.venueName || body.venue || '',
      notes: newNote,
      status: 'חדש',
      last_contact_date: new Date().toISOString(),
    });

    return Response.json({ success: true, action: 'created', lead: newLead, studio_id: nextId });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});