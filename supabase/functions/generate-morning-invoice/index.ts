// Ports base44/functions/generateMorningInvoice/entry.ts.
//
// Extended to support TWO separate Morning/Green Invoice accounts per tenant — the studio
// owner runs both an עוסק מורשה (sole proprietor) and a חברה בע״מ (Ltd company), each with
// its own Morning API key+secret, stored under different keys:
//   sole_prop: morning_api_key_sole_prop / morning_api_secret_sole_prop
//   company:   morning_api_key_company   / morning_api_secret_company
// The caller (InvoiceDialog.jsx) passes `businessType: 'sole_prop' | 'company'` to pick
// which account issues the document. Defaults to 'sole_prop' if omitted, matching the
// original single-account behavior so existing callers don't break.
//
// CHANGED (2026-08-17 security audit, Step 4): these 4 keys moved out of app_settings
// into the dedicated tenant_secrets table (migration 0019_tenant_secrets.sql), which has
// admin-only RLS covering SELECT too — app_settings' RLS is tenant-only with no role
// check, so any tenant member could previously read these raw credentials directly.
//
// Authenticated (Pattern A, like send-to-couple/index.ts): createUserClient forwards the
// caller's JWT so app_settings/leads queries are automatically scoped by RLS to the
// caller's own tenant — no manual tenant_id filtering needed.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { fetchMorningToken } from '../_shared/morningAuth.ts';
import { invoiceOrderFields, isLinkRefusal } from '../_shared/workOrder.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

const SETTINGS_KEYS: Record<string, { key: string; secret: string }> = {
  sole_prop: { key: 'morning_api_key_sole_prop', secret: 'morning_api_secret_sole_prop' },
  company: { key: 'morning_api_key_company', secret: 'morning_api_secret_company' },
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  let invoicePayload: unknown = null;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();

    const {
      clientName,
      itemDescription,
      itemNotes,
      amount,
      paymentMethodType,
      documentDate,
      leadId,
    } = body;
    // הזמנת עבודה (2026-10-21): the invoice is linked to the couple's active work order in
    // Morning (linkedDocumentIds + linkType 'link', per the official spec) and its description
    // names the order — Morning does not print the order's number on the invoice by itself.
    // linkMode 'text' names it without the Morning link (fallback when Morning refused the link).
    // preview: the PDF from POST /documents/preview, nothing is created or saved.
    const workOrderId = body.workOrderId ? String(body.workOrderId) : null;
    const linkMode: 'link' | 'text' = body.linkMode === 'text' ? 'text' : 'link';
    const isPreview = body.preview === true;

    const businessType = SETTINGS_KEYS[body.businessType] ? body.businessType : 'sole_prop';
    const settingKeys = SETTINGS_KEYS[businessType];

    if (!clientName || !amount) {
      return jsonResponse({ error: 'חסרים שם לקוח או סכום' }, { status: 400 });
    }

    // Load Morning credentials for the selected business entity (tenant_secrets, not
    // app_settings — see header comment).
    const { data: settings } = await supabase
      .from('tenant_secrets')
      .select('key, value')
      .in('key', [settingKeys.key, settingKeys.secret]);

    const getSetting = (key: string) => (settings?.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting(settingKeys.key);
    const apiSecret = getSetting(settingKeys.secret);

    if (!apiKey || !apiSecret) {
      const businessLabel = businessType === 'company' ? 'חברה בע״מ' : 'עוסק מורשה';
      return jsonResponse({
        error: `מפתחות Morning עבור ה${businessLabel} לא הוגדרו בהגדרות → אינטגרציות.`,
      }, { status: 400 });
    }

    const exactAmount = parseFloat(amount);
    if (!exactAmount || exactAmount <= 0) {
      return jsonResponse({ error: 'סכום לא תקין' }, { status: 400 });
    }

    const normalizedDate = documentDate
      ? String(documentDate).substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    // Studio display name for invoice descriptions -- same fallback chain as
    // automation-engine/index.ts's getStudioName() (display_name_to_clients ->
    // name -> 'Avira Media'), copied inline since this function doesn't import
    // from automation-engine. clientEmail's hardcoded fallback above is left
    // untouched -- that's a functional mailbox address, not display branding.
    const { data: tenantRow } = await supabase
      .from('tenants')
      .select('display_name_to_clients, name')
      .eq('id', user.tenant_id)
      .maybeSingle();
    const studioName = tenantRow?.display_name_to_clients || tenantRow?.name || 'Avira Media';
    const defaultServiceDescription = `שירותי צילום - ${studioName}`;

    const clientEmail = body.clientEmail || 'avira.media1@gmail.com';
    const paymentType = Number(paymentMethodType) || 4;
    const incomeDescription = String(itemDescription || defaultServiceDescription);

    let orderFields: ReturnType<typeof invoiceOrderFields> | null = null;
    let workOrder: any = null;
    if (workOrderId) {
      const { data: wo } = await supabase.from('work_orders').select('*').eq('id', workOrderId).maybeSingle();
      if (!wo) return jsonResponse({ error: 'הזמנת העבודה לא נמצאה' }, { status: 404 });
      // Only the couple's current order — never one that was replaced, closed or is mid-issue
      // (the window may have been open while it changed). orderChanged: the window reloads.
      if (wo.status !== 'active' || !wo.morning_id) {
        return jsonResponse({ error: `הזמנת העבודה מס' ${wo.morning_number ?? '—'} כבר לא פעילה (הוחלפה או בהפקה). טענתי מחדש את ההזמנה — בדקו ונסו שוב.`, orderChanged: true });
      }
      if (wo.business_type !== businessType) {
        const woLabel = wo.business_type === 'company' ? 'חברה בע״מ' : 'עוסק מורשה';
        return jsonResponse({ error: `הזמנת העבודה מס' ${wo.morning_number} היא של ה${woLabel} — החשבונית חייבת לצאת מאותו עסק` }, { status: 400 });
      }
      if (!leadId || wo.lead_id !== leadId) return jsonResponse({ error: 'הזמנת העבודה שייכת לזוג אחר' }, { status: 400 });
      workOrder = wo;
      orderFields = invoiceOrderFields(wo, linkMode);
    } else if (leadId) {
      // The window thought the couple has no order of this business — check, so an invoice is
      // never issued unlinked just because the window had not loaded it (a link can only be
      // set when the invoice is created).
      const { data: open } = await supabase.from('work_orders').select('morning_number, status')
        .eq('lead_id', leadId).eq('business_type', businessType).in('status', ['active', 'issuing', 'replacing']).limit(1);
      if (open?.length) {
        return jsonResponse({
          error: open[0].status === 'active'
            ? `לזוג יש הזמנת עבודה מס' ${open[0].morning_number} — טענתי אותה, והחשבונית תקושר אליה. בדקו ולחצו שוב.`
            : 'לזוג יש הזמנת עבודה שההפקה שלה לא הסתיימה — בדקו אותה בכרטיס הזמנת העבודה לפני חשבונית.',
          orderChanged: true,
        });
      }
    }

    const eventDateStr = body.eventDate ? String(body.eventDate).substring(0, 10) : '';
    const docDescParts = [clientName, eventDateStr, itemNotes || itemDescription, orderFields?.reference].filter(Boolean);
    const documentDescription = docDescParts.join(' | ');

    // Morning's OAuth 2.0 login (2026-10-18) — see _shared/morningAuth.ts.
    const login = await fetchMorningToken(apiKey, apiSecret);
    if (!login.ok) {
      return jsonResponse({ error: login.message, rawBody: login.raw });
    }
    const token = login.token;

    invoicePayload = {
      type: 320,
      lang: 'he',
      currency: 'ILS',
      date: normalizedDate,
      description: documentDescription,
      client: {
        // the order's Morning client, so the invoice and its order belong to the same client
        ...(orderFields?.clientId ? { id: orderFields.clientId } : {}),
        name: String(clientName), email: clientEmail,
      },
      income: [{ description: incomeDescription, quantity: 1, price: exactAmount, vatType: 1 }],
      payment: [{ type: paymentType, amount: exactAmount, date: normalizedDate, price: exactAmount }],
      ...(orderFields?.link || {}),
    };

    if (isPreview) {
      const prevRes = await fetch('https://api.greeninvoice.co.il/api/v1/documents/preview', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(invoicePayload),
      });
      const prevText = await prevRes.text();
      let prevData: any = null;
      try { prevData = JSON.parse(prevText); } catch { /* not JSON */ }
      if (!prevRes.ok || !prevData?.file) {
        const code = typeof prevData?.errorCode === 'number' ? prevData.errorCode : null;
        return jsonResponse({
          error: `תצוגה מקדימה נכשלה ב-Morning (${code ?? prevRes.status}): ${prevData?.errorMessage || prevText.slice(0, 300)}`,
          linkFailed: !!workOrder && linkMode === 'link' && isLinkRefusal(code),
        });
      }
      return jsonResponse({ success: true, preview: true, file: prevData.file });
    }

    const invoiceRes = await fetch('https://api.greeninvoice.co.il/api/v1/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload),
    });

    const invoiceText = await invoiceRes.text();
    if (!invoiceRes.ok) {
      let errCode: number | null = null;
      try { const j = JSON.parse(invoiceText); errCode = typeof j?.errorCode === 'number' ? j.errorCode : null; } catch { /* not JSON */ }
      return jsonResponse({
        error: `טוקן תקין, שגיאה בהפקת מסמך (${invoiceRes.status}): ${invoiceText}`,
        rawBody: invoiceText,
        debugPayload: invoicePayload,
        linkFailed: !!workOrder && linkMode === 'link' && isLinkRefusal(errCode),
      });
    }

    const invoice = JSON.parse(invoiceText);

    let invoiceUrl = invoice.url;
    if (invoiceUrl && typeof invoiceUrl === 'object') {
      invoiceUrl = invoiceUrl.origin || invoiceUrl.he || Object.values(invoiceUrl)[0] || null;
    }

    // Save invoice onto the Lead's invoices_list — best-effort, mirrors the original's
    // non-fatal behavior (the document is already issued in Morning either way).
    if (leadId) {
      try {
        const { data: leadRows } = await supabase.from('leads').select('*').eq('id', leadId).limit(1);
        const lead = leadRows?.[0];
        if (!lead) throw new Error('Lead not found');

        const existingInvoices = Array.isArray(lead.invoices_list) ? lead.invoices_list : [];
        const newInvoice = {
          id: invoice.id,
          number: String(invoice.number),
          date: normalizedDate,
          description: itemDescription || defaultServiceDescription,
          amount: exactAmount,
          url: invoiceUrl,
          businessType,
          ...(workOrder ? {
            workOrderId: workOrder.id,
            workOrderNumber: workOrder.morning_number,
            linkedInMorning: linkMode === 'link',
          } : {}),
        };
        const updatedInvoices = [...existingInvoices, newInvoice];

        const totalPaid = updatedInvoices.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
        const finalPrice = lead.final_price || 0;
        const remainingBalance = finalPrice - totalPaid;

        const { error: updateErr } = await supabase
          .from('leads')
          .update({
            invoices_list: updatedInvoices,
            total_paid: totalPaid,
            remaining_balance: remainingBalance > 0 ? remainingBalance : 0,
            last_invoice_url: invoiceUrl,
            deposit_invoice_issued: true,
          })
          .eq('id', leadId);

        if (updateErr) throw new Error(updateErr.message);
      } catch (dbError) {
        return jsonResponse({
          success: false,
          warning: 'החשבונית נוצרה במורנינג אך לא נשמרה במערכת. נא לעדכן ידנית',
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          invoiceUrl,
          invoiceDate: normalizedDate,
          amount: exactAmount,
          errorDetails: (dbError as Error).message,
        }, { status: 201 });
      }
    }

    return jsonResponse({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      invoiceUrl,
      invoiceDate: normalizedDate,
      amount: exactAmount,
      description: itemDescription,
      businessType,
    });
  } catch (error) {
    return jsonResponse({
      error: `שגיאה קריטית: ${(error as Error).message}`,
      debugPayload: invoicePayload,
    }, { status: 500 });
  }
});
