// Ports base44/functions/checkMorningConnection/entry.ts.
// Extended for two business entities (see generate-morning-invoice/index.ts for the
// full rationale) — accepts `businessType: 'sole_prop' | 'company'` and checks the
// matching Morning API key/secret pair. Read-only: requests a token and reports success,
// no document is created.
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
      .from('app_settings')
      .select('key, value')
      .in('key', [settingKeys.key, settingKeys.secret]);

    const getSetting = (key: string) => (settings?.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting(settingKeys.key);
    const apiSecret = getSetting(settingKeys.secret);

    if (!apiKey || !apiSecret) {
      const businessLabel = businessType === 'company' ? 'חברה בע״מ' : 'עוסק מורשה';
      return jsonResponse({ success: false, message: `מפתחות Morning עבור ה${businessLabel} לא הוגדרו בהגדרות → אינטגרציות.` });
    }

    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return jsonResponse({ success: false, message: `שגיאת אימות (${tokenRes.status}): ${tokenText}` });
    }

    let tokenData: any;
    try { tokenData = JSON.parse(tokenText); } catch {
      return jsonResponse({ success: false, message: `תשובת הטוקן אינה JSON תקין: ${tokenText}` });
    }
    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;

    if (!token) {
      return jsonResponse({ success: false, message: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}` });
    }

    return jsonResponse({ success: true, message: `החיבור הצליח! הטוקן התקבל ✓ (${token.substring(0, 12)}...)` });
  } catch (error) {
    return jsonResponse({ success: false, message: `שגיאה: ${(error as Error).message}` });
  }
});
