import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

/**
 * signLeadPublic
 * Called from ContractPage when a lead signs the contract.
 * Uses SDK 0.8.21 (matches getLeadPublic) for public/unauthenticated access support.
 * Updates lead status to "נסגר/חתימה" — this triggers the onLeadSignedForever automation
 * which creates the Event AND syncs to Google Calendar.
 */
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
    const body = await req.json();
    const { leadId, idNumber, email, phoneNumber, coupleNotesSigned, coupleNames } = body;

    if (!leadId || !idNumber) {
      return Response.json({ error: 'leadId and idNumber are required' }, { status: 400, headers: corsHeaders });
    }

    const base44 = createClientFromRequest(req);

    console.log('[signLeadPublic] Setting status to חוזה for leadId:', leadId);

    // Fetch existing lead to avoid overwriting data already entered by the studio
    const existingLead = await base44.asServiceRole.entities.Lead.get(leadId);

    const updateData = {
      status: 'חוזה',
      signedAt: new Date().toISOString(),
      coupleNotesSigned: coupleNotesSigned || undefined,
    };

    // Save what the client entered into the dedicated "signed" fields only
    if (idNumber) updateData.signedIdNumber = idNumber;
    if (email) updateData.signedEmail = email;
    if (phoneNumber) updateData.signedPhoneNumber = phoneNumber;
    if (coupleNames) updateData.signedCoupleNames = coupleNames;

    await base44.asServiceRole.entities.Lead.update(leadId, updateData);

    console.log('[signLeadPublic] Update done, returning success');
    return Response.json({ success: true, message: 'Lead signed' }, { headers: corsHeaders });

  } catch (error) {
    console.error('[signLeadPublic] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});