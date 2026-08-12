import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * morningWebhook
 * Receives payment/document webhooks from Morning API.
 * Register this URL in Morning: Settings → Webhooks
 * Expected payload: { event, document: { id, url, sum, client: { name, emails } } }
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();

    console.log('Morning webhook received:', JSON.stringify(body, null, 2));

    const event = body?.event || body?.type;
    const document = body?.document || body?.data;

    if (!document) {
      return Response.json({ ok: true, msg: 'no document data' });
    }

    // Only handle payment confirmed events
    if (event && !['documentCreated', 'payment', 'paymentConfirmed', 'document.created'].includes(event)) {
      return Response.json({ ok: true, msg: `event ${event} ignored` });
    }

    const amount = parseFloat(document.sum || document.price || document.amount || 0);
    const clientEmails = document.client?.emails || [];
    const invoiceUrl = document.url || document.viewUrl || '';

    if (!amount || amount <= 0) {
      return Response.json({ ok: true, msg: 'no valid amount' });
    }

    // Find matching lead by email
    let matchedLead = null;

    if (clientEmails.length > 0) {
      const leads = await base44.asServiceRole.entities.Lead.list();
      for (const email of clientEmails) {
        const found = leads.find(l => l.email && l.email.toLowerCase() === email.toLowerCase());
        if (found) { matchedLead = found; break; }
      }
    }

    if (!matchedLead) {
      console.log('No matching lead found for emails:', clientEmails);
      return Response.json({ ok: true, msg: 'no matching lead found' });
    }

    // Update lead: add to totalPaid and save invoice URL
    const newTotal = (matchedLead.totalPaid || 0) + amount;
    const updateData = { totalPaid: newTotal };
    if (invoiceUrl) updateData.lastInvoiceUrl = invoiceUrl;

    await base44.asServiceRole.entities.Lead.update(matchedLead.id, updateData);

    console.log(`Lead ${matchedLead.coupleNames} updated: totalPaid = ${newTotal}`);

    return Response.json({ ok: true, leadId: matchedLead.id, newTotal });

  } catch (error) {
    console.error('morningWebhook error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});