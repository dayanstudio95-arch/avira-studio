import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const { leadId, fileUrl } = await req.json();

    if (!leadId || !fileUrl) {
      return Response.json({ error: 'Missing leadId or fileUrl' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);

    // Update lead with signed contract URL using service role (called from public page)
    await base44.asServiceRole.entities.Lead.update(leadId, {
      signedContractPdfUrl: fileUrl
    });

    return Response.json({ success: true, fileUrl });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});