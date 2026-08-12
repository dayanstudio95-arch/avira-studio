import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

// Read-only function - fetches the latest issued document date across the entire Morning account.
// No document creation, no data writes to Base44.

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Load Morning credentials (same as generateMorningInvoice)
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    const getSetting = (key) => (settings.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting('morning_api_key');
    const apiSecret = getSetting('morning_api_secret');

    if (!apiKey || !apiSecret) {
      return Response.json({
        error: `מפתחות Morning לא נמצאו. מפתחות קיימים: ${settings.map(s => s.key).join(', ')}`,
      }, { status: 400 });
    }

    // Step 1: Get token
    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    if (!tokenRes.ok) {
      return Response.json({
        error: `שגיאה בקבלת טוקן (${tokenRes.status}): ${tokenText}`,
      }, { status: 502 });
    }

    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch (e) {
      return Response.json({ error: `תשובת הטוקן אינה JSON תקין: ${tokenText}` }, { status: 502 });
    }

    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;
    if (!token) {
      return Response.json({
        error: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}`,
      }, { status: 502 });
    }

    // Step 2: Fetch only the single latest document (type 320 = חשבונית מס קבלה)
    // POST /documents/search — Morning's search endpoint requires a JSON body (not query params).
    // pageSize=1, sorted descending by date — purely read-only.
    const searchBody = {
      type: [320],
      pageSize: 1,
      page: 1,
      sortBy: 'documentDate',
      sortOrder: 'desc',
    };

    console.log('Fetching latest Morning document, search body:', JSON.stringify(searchBody));

    const docsRes = await fetch(
      'https://api.greeninvoice.co.il/api/v1/documents/search',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(searchBody),
      }
    );

    const docsText = await docsRes.text();
    console.log(`Documents response (${docsRes.status}):`, docsText);

    if (!docsRes.ok) {
      return Response.json({
        error: `שגיאה בשליפת מסמכים (${docsRes.status}): ${docsText}`,
        rawBody: docsText,
      }, { status: 502 });
    }

    let docsData;
    try { docsData = JSON.parse(docsText); } catch (e) {
      return Response.json({ error: `תשובת המסמכים אינה JSON תקין: ${docsText}` }, { status: 502 });
    }

    console.log('Documents response keys:', Object.keys(docsData));

    // Morning API returns either an array or { items: [...], total: N }
    const items = Array.isArray(docsData) ? docsData : (docsData.items || docsData.documents || []);

    if (!items || items.length === 0) {
      return Response.json({
        found: false,
        latestDocumentDate: null,
        documentType: 320,
        message: 'לא נמצאו מסמכים בחשבון Morning',
      });
    }

    const latestDoc = items[0];
    console.log('Latest document raw:', JSON.stringify(latestDoc));

    // Extract date — field may be named 'date', 'documentDate', or 'creationDate'
    const latestDocumentDate =
      latestDoc.date ||
      latestDoc.documentDate ||
      latestDoc.creationDate ||
      null;

    const normalizedDate = latestDocumentDate
      ? String(latestDocumentDate).substring(0, 10)
      : null;

    return Response.json({
      found: true,
      latestDocumentDate: normalizedDate,
      documentType: latestDoc.type || 320,
      documentNumber: latestDoc.number || null,
      rawDateField: latestDocumentDate,
      message: `תאריך המסמך האחרון שהונפק במורנינג: ${normalizedDate}`,
    });

  } catch (error) {
    console.error('FATAL error:', error.message);
    return Response.json({
      error: `שגיאה קריטית: ${error.message}`,
    }, { status: 500 });
  }
});