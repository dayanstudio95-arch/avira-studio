import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    console.log(`\n\n🔵🔵🔵 testWebhook START 🔵🔵🔵`);
    
    // Get webhook URL from env
    const webhookUrl = Deno.env.get("MAKE_WEBHOOK_URL");
    console.log(`[1] WEBHOOK_URL from env: "${webhookUrl}"`);
    
    if (!webhookUrl) {
      console.log(`[ERROR] MAKE_WEBHOOK_URL is not set!`);
      return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });
    }
    
    // Simple payload
    const payload = {
      action_type: "test_ping",
      message_text: "hello from base",
      timestamp: new Date().toISOString()
    };
    
    console.log(`[2] PAYLOAD:`, JSON.stringify(payload));
    
    console.log(`[3] SENDING REQUEST...`);
    console.log(`    URL: ${webhookUrl}`);
    console.log(`    METHOD: POST`);
    console.log(`    Content-Type: application/json`);
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log(`[4] RESPONSE RECEIVED`);
    console.log(`    Status: ${response.status}`);
    console.log(`    Status Text: ${response.statusText}`);
    console.log(`    Headers:`, {
      'Content-Type': response.headers.get('Content-Type'),
      'Content-Length': response.headers.get('Content-Length')
    });
    
    const responseBody = await response.text();
    console.log(`    Body: "${responseBody}"`);
    
    if (response.ok) {
      console.log(`[✅ SUCCESS] Webhook delivered successfully`);
      return Response.json({ 
        success: true, 
        webhook_url: webhookUrl,
        status: response.status,
        response_body: responseBody
      });
    } else {
      console.log(`[❌ ERROR] Webhook returned error status`);
      return Response.json({ 
        success: false,
        error: `HTTP ${response.status}: ${responseBody}`,
        webhook_url: webhookUrl,
        status: response.status,
        response_body: responseBody
      }, { status: response.status });
    }
    
  } catch (error) {
    console.log(`[❌ CATCH ERROR]`);
    console.log(`    Message: ${error.message}`);
    console.log(`    Stack: ${error.stack}`);
    
    return Response.json({ 
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  } finally {
    console.log(`🔵🔵🔵 testWebhook END 🔵🔵🔵\n\n`);
  }
});