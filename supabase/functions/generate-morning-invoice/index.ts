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

    const clientEmail = body.clientEmail || 'avira.media1@gmail.com';
    const paymentType = Number(paymentMethodType) || 4;
    const incomeDescription = String(itemDescription || 'שירותי צילום - Avira Media');

    const eventDateStr = body.eventDate ? String(body.eventDate).substring(0, 10) : '';
    const docDescParts = [clientName, eventDateStr, itemNotes || itemDescription].filter(Boolean);
    const documentDescription = docDescParts.join(' | ');

    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return jsonResponse({
        error: `שגיאה בקבלת טוקן ממורנינג (${tokenRes.status}): ${tokenText}`,
        rawBody: tokenText,
      });
    }

    let tokenData: any;
    try { tokenData = JSON.parse(tokenText); } catch {
      return jsonResponse({ error: `תשובת הטוקן אינה JSON תקין: ${tokenText}`, rawBody: tokenText });
    }
    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;
    if (!token) {
      return jsonResponse({
        error: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}`,
        rawBody: tokenText,
      });
    }

    invoicePayload = {
      type: 320,
      lang: 'he',
      currency: 'ILS',
      date: normalizedDate,
      description: documentDescription,
      client: { name: String(clientName), email: clientEmail },
      income: [{ description: incomeDescription, quantity: 1, price: exactAmount, vatType: 1 }],
      payment: [{ type: paymentType, amount: exactAmount, date: normalizedDate, price: exactAmount }],
    };

    const invoiceRes = await fetch('https://api.greeninvoice.co.il/api/v1/documents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(invoicePayload),
    });

    const invoiceText = await invoiceRes.text();
    if (!invoiceRes.ok) {
      return jsonResponse({
        error: `טוקן תקין, שגיאה בהפקת מסמך (${invoiceRes.status}): ${invoiceText}`,
        rawBody: invoiceText,
        debugPayload: invoicePayload,
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
          description: itemDescription || 'שירותי צילום - Avira Media',
          amount: exactAmount,
          url: invoiceUrl,
          businessType,
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
