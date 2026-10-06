// "שלח לזוג" next to "צפה בחוזה החתום (PDF)" in UnifiedSidePanel (2026-10-07).
// Sends the couple their own signed contract as a PDF attachment on WhatsApp.
//
// The PDF holds the couple's ID number and signature, and the bucket is private (PII-02),
// so the browser never gets a long-lived link: this function signs a 10-minute URL
// server-side and hands it straight to Green API, which downloads the file at once.
// Admin roles only — the same people who can open the signed PDF in the panel.
//
// Caption: app_settings.template_signed_contract (Settings → תבניות הודעה), variables
// {{names}} / {{event_date}}; a built-in default when the studio has not set one.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import { sendWhatsAppFileByUrl } from '../_shared/whatsapp.ts';
import { signedContractUrl } from '../_shared/signedContract.ts';

const DEFAULT_CAPTION = 'שלום {{names}} 😊\nמצורף החוזה החתום שלכם.\nתודה שבחרתם בנו!';

// "2026-07-12" → "12/7/2026", the same d/M/yyyy the panel's applyVariables produces.
function formatEventDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : '';
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const profile = await getCallerProfile(createUserClient(req), user.id, 'role, tenant_id');
    if (!profile || !isAdmin(profile.role) || !profile.tenant_id) {
      return jsonResponse({ error: 'אין הרשאה לשלוח חוזה חתום' }, { status: 403 });
    }

    const { leadId } = await req.json().catch(() => ({}));
    if (!leadId || typeof leadId !== 'string') {
      return jsonResponse({ error: 'leadId is required' }, { status: 400 });
    }

    const service = createServiceRoleClient();
    const { data: lead } = await service
      .from('leads')
      .select('id, tenant_id, couple_names, event_date, phone_number, signed_contract_pdf_url')
      .eq('id', leadId)
      .maybeSingle();
    // Another studio's lead looks exactly like a missing one.
    if (!lead || lead.tenant_id !== profile.tenant_id) {
      return jsonResponse({ error: 'הליד לא נמצא' }, { status: 404 });
    }
    if (!lead.signed_contract_pdf_url) {
      return jsonResponse({ error: 'אין לליד הזה חוזה חתום' }, { status: 400 });
    }
    if (!lead.phone_number) {
      return jsonResponse({ error: 'אין מספר טלפון לליד' }, { status: 400 });
    }

    const fileUrl = await signedContractUrl(service, lead.signed_contract_pdf_url, 600);
    if (!fileUrl) return jsonResponse({ error: 'לא ניתן להכין קישור לקובץ החוזה' }, { status: 500 });

    let eventDate = lead.event_date;
    if (!eventDate) {
      const { data: ev } = await service
        .from('events')
        .select('date')
        .eq('tenant_id', lead.tenant_id)
        .eq('source_lead_id', lead.id)
        .limit(1)
        .maybeSingle();
      eventDate = ev?.date ?? null;
    }

    const { data: tpl } = await service
      .from('app_settings')
      .select('value')
      .eq('tenant_id', lead.tenant_id)
      .eq('key', 'template_signed_contract')
      .maybeSingle();
    const template = typeof tpl?.value === 'string' && tpl.value.trim() ? tpl.value : DEFAULT_CAPTION;
    const caption = template
      .replace(/\{\{names\}\}/g, lead.couple_names || '')
      .replace(/\{\{event_date\}\}/g, formatEventDate(eventDate));

    const result = await sendWhatsAppFileByUrl(
      service, lead.phone_number, fileUrl, 'חוזה-חתום.pdf', caption, lead.tenant_id,
    );
    if (!result.success) return jsonResponse({ error: result.error || 'השליחה נכשלה' }, { status: 502 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: (error as Error).message }, { status: 500 });
  }
});
