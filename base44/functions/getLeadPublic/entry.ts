import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-app-id',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { leadId } = await req.json();

    if (!leadId) {
      return Response.json({ error: 'leadId is required' }, { status: 400, headers: corsHeaders });
    }

    const base44 = createClientFromRequest(req);

    // Use service role to read the lead without user auth
    const lead = await base44.asServiceRole.entities.Lead.get(leadId);

    if (!lead) {
      return Response.json({ error: 'Lead not found' }, { status: 404, headers: corsHeaders });
    }

    // Return only the fields needed for the contract page and questionnaire (no sensitive internal notes)
    return Response.json({
      id: lead.id,
      coupleNames: lead.coupleNames,
      eventDate: lead.eventDate,
      phoneNumber: lead.phoneNumber,
      email: lead.email,
      venueName: lead.venueName,
      packageChoice: lead.packageChoice,
      packageDetails: lead.packageDetails,
      basePrice: lead.basePrice,
      discount: lead.discount,
      finalPrice: lead.finalPrice,
      status: lead.status,
      contractTerms: lead.contractTerms,
      signedAt: lead.signedAt,
      idNumber: lead.idNumber,
      productionBridePhone: lead.productionBridePhone,
      productionGroomPhone: lead.productionGroomPhone,
      productionBridePrepLocation: lead.productionBridePrepLocation,
      productionInstagram: lead.productionInstagram,
      productionSpecialRequests: lead.productionSpecialRequests,
      productionFormFilledAt: lead.productionFormFilledAt,
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});