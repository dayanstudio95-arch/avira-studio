import { createClientFromRequest } from 'npm:@base44/sdk@0.8.21';

Deno.serve(async (req) => {
  let invoicePayload = null;

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    console.log('STEP 0 - Request body received:', JSON.stringify(body));

    const { clientName, itemDescription, itemNotes, amount, paymentMethodType, documentDate } = body;

    if (!clientName || !amount) {
      return Response.json({ error: 'חסרים שם לקוח או סכום' }, { status: 400 });
    }

    // Load Morning credentials
    const settings = await base44.asServiceRole.entities.AppSetting.list();
    console.log('All setting keys:', settings.map(s => s.key));

    const getSetting = (key) => (settings.find((s) => s.key === key)?.value || '').trim();
    const apiKey = getSetting('morning_api_key');
    const apiSecret = getSetting('morning_api_secret');

    console.log('morning_api_key found:', !!apiKey, '| morning_api_secret found:', !!apiSecret);

    if (!apiKey || !apiSecret) {
      return Response.json({
        error: `המפתחות לא נמצאו בהגדרות המערכת. מפתחות קיימים: ${settings.map(s => s.key).join(', ')}`,
        rawBody: '',
      }, { status: 400 });
    }

    const exactAmount = parseFloat(amount);
    if (!exactAmount || exactAmount <= 0) {
      return Response.json({ error: 'סכום לא תקין' }, { status: 400 });
    }

    // Normalize date to YYYY-MM-DD
    const normalizedDate = documentDate
      ? String(documentDate).substring(0, 10)
      : new Date().toISOString().substring(0, 10);

    const clientEmail = body.clientEmail || 'avira.media1@gmail.com';
    const paymentType = Number(paymentMethodType) || 4;

    // Income item description = the free-text from the form (e.g. "מקדמה" / "יתרה")
    const incomeDescription = String(itemDescription || 'שירותי צילום - Avira Media');

    // Document-level description = client name | event date | form details
    const eventDateStr = body.eventDate ? String(body.eventDate).substring(0, 10) : '';
    const docDescParts = [clientName, eventDateStr, itemNotes || itemDescription].filter(Boolean);
    const documentDescription = docDescParts.join(' | ');

    console.log(`STEP 1 - Requesting Morning token... (key: ${apiKey.substring(0, 6)}...)`);

    const tokenRes = await fetch('https://api.greeninvoice.co.il/api/v1/account/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: apiKey, secret: apiSecret }),
    });

    const tokenText = await tokenRes.text();
    console.log(`STEP 1 - Token response (${tokenRes.status}):`, tokenText);

    if (!tokenRes.ok) {
      return Response.json({
        error: `שגיאה בקבלת טוקן (${tokenRes.status}): ${tokenText}`,
        rawBody: tokenText,
        debugPayload: { tokenRequest: { id: apiKey.substring(0, 6) + '...', secret: '***' } },
      });
    }

    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch(e) {
      return Response.json({ error: `תשובת הטוקן אינה JSON תקין: ${tokenText}`, rawBody: tokenText });
    }
    console.log('STEP 1 - Token data keys:', Object.keys(tokenData));
    const token = tokenData.token || tokenData.access_token || tokenData.jwt || tokenData.id_token || tokenData.data?.token;
    if (!token) {
      return Response.json({
        error: `לא התקבל טוקן. שדות זמינים: ${Object.keys(tokenData).join(', ')}. תשובה מלאה: ${tokenText}`,
        rawBody: tokenText,
      });
    }
    console.log('STEP 1 - Token extracted, length:', token.length);

    console.log('STEP 2 - Token OK. Building invoice payload...');

    invoicePayload = {
      type: 320,
      lang: 'he',
      currency: 'ILS',
      date: normalizedDate,
      description: documentDescription,
      client: {
        name: String(clientName),
        email: clientEmail,
      },
      income: [{
        description: incomeDescription,
        quantity: 1,
        price: exactAmount,
        vatType: 1,
      }],
      payment: [{
        type: paymentType,
        amount: exactAmount,
        date: normalizedDate,
        price: exactAmount,
      }],
    };

    console.log('STEP 2 - Invoice payload:', JSON.stringify(invoicePayload));

    console.log('STEP 3 - Sending document to Morning...');

    const invoiceRes = await fetch('https://api.greeninvoice.co.il/api/v1/documents', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(invoicePayload),
    });

    const invoiceText = await invoiceRes.text();
    console.log(`STEP 3 - Document response (${invoiceRes.status}):`, invoiceText);

    if (!invoiceRes.ok) {
      return Response.json({
        error: `טוקן תקין, שגיאה בהפקת מסמך (${invoiceRes.status}): ${invoiceText}`,
        rawBody: invoiceText,
        debugPayload: invoicePayload,
      });
    }

    const invoice = JSON.parse(invoiceText);
    console.log('STEP 3 - Invoice created:', invoice.id, invoice.number, 'url:', JSON.stringify(invoice.url));

    // invoice.url can be an object like {origin, he} — extract the string
    let invoiceUrl = invoice.url;
    if (invoiceUrl && typeof invoiceUrl === 'object') {
      invoiceUrl = invoiceUrl.origin || invoiceUrl.he || Object.values(invoiceUrl)[0] || null;
    }

    // STEP 4 - Save invoice to Lead's invoices array
    console.log('STEP 4 - Saving invoice to Lead...');
    const leadId = body.leadId;
    if (leadId) {
      try {
        const lead = await base44.entities.Lead.get(leadId);
        const existingInvoices = lead.invoicesList || [];
        
        const newInvoice = {
          id: invoice.id,
          number: String(invoice.number),
          date: normalizedDate,
          description: itemDescription || 'שירותי צילום - Avira Media',
          amount: exactAmount,
          url: invoiceUrl,
        };
        
        const updatedInvoices = [...existingInvoices, newInvoice];
        
        // Calculate new total paid and remaining balance
        const totalPaid = updatedInvoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
        const finalPrice = lead.finalPrice || 0;
        const remainingBalance = finalPrice - totalPaid;
        
        await base44.entities.Lead.update(leadId, {
          invoicesList: updatedInvoices,
          totalPaid: totalPaid,
          remainingBalance: remainingBalance > 0 ? remainingBalance : 0,
        });
        
        console.log('STEP 4 - Invoice saved successfully. Total paid updated to:', totalPaid);
      } catch (dbError) {
        console.error('STEP 4 - ERROR saving to CRM:', dbError.message);
        return Response.json({
          success: false,
          warning: 'החשבונית נוצרה במורנינג אך לא נשמרה במערכת. נא לעדכן ידנית',
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          invoiceUrl: invoiceUrl,
          invoiceDate: normalizedDate,
          amount: exactAmount,
          errorDetails: dbError.message,
        }, { status: 201 });
      }
    }

    return Response.json({
      success: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      invoiceUrl: invoiceUrl,
      invoiceDate: normalizedDate,
      amount: exactAmount,
      description: itemDescription,
    });

  } catch (error) {
    console.error('FATAL error:', error.message);
    return Response.json({
      error: `שגיאה קריטית: ${error.message}`,
      rawBody: error.message,
      debugPayload: invoicePayload,
    }, { status: 500 });
  }
});