import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const settings = await base44.asServiceRole.entities.AppSetting.list();
    console.log('All setting keys:', settings.map(s => s.key));

    const getSetting = (key) => (settings.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting('morning_api_key');
    const apiSecret = getSetting('morning_api_secret');

    console.log('morning_api_key found:', !!apiKey, '| morning_api_secret found:', !!apiSecret);

    if (!apiKey || !apiSecret) {
      return Response.json({ success: false, message: `המפתחות לא נמצאו בהגדרות המערכת. מפתחות קיימים: ${settings.map(s => s.key).join(', ')}` });
    }

    console.log('Checking Morning token with key:', apiKey.substring(0, 6) + '...');

    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    console.log(`Token check response (${tokenRes.status}):`, tokenText);

    if (!tokenRes.ok) {
      return Response.json({
        success: false,
        message: `שגיאת אימות (${tokenRes.status}): ${tokenText}`,
      });
    }

    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch(e) {
      return Response.json({ success: false, message: `תשובת הטוקן אינה JSON תקין: ${tokenText}` });
    }
    console.log('Token data keys:', Object.keys(tokenData));
    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;

    if (!token) {
      return Response.json({
        success: false,
        message: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}. תשובה מלאה: ${tokenText}`,
      });
    }

    return Response.json({ success: true, message: `החיבור הצליח! הטוקן התקבל ✓ (${token.substring(0,12)}...)` });

  } catch (error) {
    console.error('Connection check error:', error.message);
    return Response.json({ success: false, message: `שגיאה: ${error.message}` });
  }
});