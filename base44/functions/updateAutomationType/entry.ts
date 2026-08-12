import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { automation_id } = await req.json();

    if (!automation_id) {
      return Response.json({ error: 'automation_id required' }, { status: 400 });
    }

    await base44.asServiceRole.entities.Automation.update(automation_id, {
      type: 'questionnaire_send'
    });

    return Response.json({ success: true, message: `עודכנה אוטומציה ${automation_id} ל-questionnaire_send` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});