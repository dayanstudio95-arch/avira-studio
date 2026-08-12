import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const offset = body.offset || 0;

  const allLeads = await base44.asServiceRole.entities.Lead.list('created_date', 30, offset);
  const signedLeads = allLeads.filter(l => l.status === 'נסגר/חתימה');

  let updated = 0;
  for (const lead of signedLeads) {
    const finalPrice = lead.finalPrice || 0;
    const totalPaid = 500;
    const remainingBalance = Math.max(0, finalPrice - totalPaid);
    await base44.asServiceRole.entities.Lead.update(lead.id, { totalPaid, remainingBalance });
    updated++;
    await sleep(200); // delay to avoid rate limit
  }

  return Response.json({ 
    success: true, 
    updated, 
    fetched: allLeads.length,
    hasMore: allLeads.length === 30, 
    nextOffset: offset + 30
  });
});