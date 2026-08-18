// Ports base44/functions/getLatestMorningDocumentDate/entry.ts.
// Extended for two business entities — accepts `businessType: 'sole_prop' | 'company'`
// and looks up the latest document date in the matching Morning account. Read-only.
//
// CHANGED (2026-08-17 security audit, Step 4): these keys moved out of app_settings into
// the dedicated tenant_secrets table (migration 0019_tenant_secrets.sql, admin-only RLS).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';

const SETTINGS_KEYS: Record<string, { key: string; secret: string }> = {
  sole_prop: { key: 'morning_api_key_sole_prop', secret: 'morning_api_secret_sole_prop' },
  company: { key: 'morning_api_key_company', secret: 'morning_api_secret_company' },
};

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json().catch(() => ({}));
    const businessType = SETTINGS_KEYS[body.businessType] ? body.businessType : 'sole_prop';
    const settingKeys = SETTINGS_KEYS[businessType];

    const { data: settings } = await supabase
      .from('tenant_secrets')
      .select('key, value')
      .in('key', [settingKeys.key, settingKeys.secret]);

    const getSetting = (key: string) => (settings?.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting(settingKeys.key);
    const apiSecret = getSetting(settingKeys.secret);

    if (!apiKey || !apiSecret) {
      const businessLabel = businessType === 'company' ? 'חברה בע״מ' : 'עוסק מורשה';
      return jsonResponse({ error: `מפתחות Morning עבור ה${businessLabel} לא הוגדרו בהגדרות → אינטגרציות.` }, { status: 400 });
    }

    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return jsonResponse({ error: `שגיאה בקבלת טוקן (${tokenRes.status}): ${tokenText}` }, { status: 502 });
    }

    let tokenData: any;
    try { tokenData = JSON.parse(tokenText); } catch {
      return jsonResponse({ error: `תשובת הטוקן אינה JSON תקין: ${tokenText}` }, { status: 502 });
    }

    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;
    if (!token) {
      return jsonResponse({ error: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}` }, { status: 502 });
    }

    const searchBody = { type: [320], pageSize: 1, page: 1, sortBy: 'documentDate', sortOrder: 'desc' };

    const docsRes = await fetch('https://api.greeninvoice.co.il/api/v1/documents/search', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody),
    });

    const docsText = await docsRes.text();
    if (!docsRes.ok) {
      return jsonResponse({ error: `שגיאה בשליפת מסמכים (${docsRes.status}): ${docsText}`, rawBody: docsText }, { status: 502 });
    }

    let docsData: any;
    try { docsData = JSON.parse(docsText); } catch {
      return jsonResponse({ error: `תשובת המסמכים אינה JSON תקין: ${docsText}` }, { status: 502 });
    }

    const items = Array.isArray(docsData) ? docsData : (docsData.items || docsData.documents || []);

    if (!items || items.length === 0) {
      return jsonResponse({ found: false, latestDocumentDate: null, documentType: 320, message: 'לא נמצאו מסמכים בחשבון Morning' });
    }

    const latestDoc = items[0];
    const latestDocumentDate = latestDoc.date || latestDoc.documentDate || latestDoc.creationDate || null;
    const normalizedDate = latestDocumentDate ? String(latestDocumentDate).substring(0, 10) : null;

    return jsonResponse({
      found: true,
      latestDocumentDate: normalizedDate,
      documentType: latestDoc.type || 320,
      documentNumber: latestDoc.number || null,
      message: `תאריך המסמך האחרון שהונפק במורנינג: ${normalizedDate}`,
    });
  } catch (error) {
    return jsonResponse({ error: `שגיאה קריטית: ${(error as Error).message}` }, { status: 500 });
  }
});
