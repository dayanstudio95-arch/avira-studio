import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

function isValidPhone(phone) {
  if (!phone) return false;
  const clean = phone.trim();
  return clean.length > 3 && clean !== '0';
}

function renderTemplate(template, vars) {
  let result = template || '';
  for (const [key, value] of Object.entries(vars)) {
    result = result.split('{' + key + '}').join(String(value ?? ''));
  }
  return result;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const webhookUrl = Deno.env.get('MAKE_WEBHOOK_URL');
    if (!webhookUrl) return Response.json({ error: 'MAKE_WEBHOOK_URL not configured' }, { status: 500 });

    const body = await req.json().catch(() => ({}));

    // Load album_reminder automation settings
    const allAutomations = await base44.asServiceRole.entities.Automation.list();
    const automation = allAutomations.find(a => a.type === 'album_reminder');
    if (!automation) {
      return Response.json({ error: 'לא נמצאה אוטומציה מסוג album_reminder' }, { status: 404 });
    }

    // body.test_mode/test_phone can override automation settings
    const isTestMode = body.test_mode === true || !!automation.test_mode;
    const testPhone = (body.test_phone?.trim()) || automation.test_phone?.trim() || '';

    const messageTemplate = automation.messageTemplate || '';
    const mediaUrl = automation.mediaFileUrl || null;

    if (isTestMode && !testPhone) {
      return Response.json({ error: 'test_mode פעיל אבל test_phone ריק — הגדר test_phone באוטומציה' }, { status: 400 });
    }

    // Calculate cutoff: 30 days ago
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    const allEvents = await base44.asServiceRole.entities.Event.list('-date');

    // In test mode: skip date/status filters — just send one test message
    const eligible = isTestMode
      // In test mode: skip 30-day filter, find real pending events to send to test_phone
      ? allEvents.filter(ev => {
          if (ev.albumStatus === 'sent') return false;
          if (ev.album_reminder_sent === true) return false;
          if (!isValidPhone(ev.phoneNumber)) return false;
          return true;
        }).slice(0, 1) // send only one in test mode
      : allEvents.filter(ev => {
          if (!ev.date || ev.date > cutoffStr) return false;
          if (ev.albumStatus === 'sent') return false;
          if (ev.album_reminder_sent === true) return false;
          if (!isValidPhone(ev.phoneNumber)) return false;
          return true;
        });

    console.log(`[albumReminder] isTestMode=${isTestMode}, eligible=${eligible.length}`);

    const results = [];

    for (const ev of eligible) {
      const phone = isTestMode ? testPhone : ev.phoneNumber;

      const message = renderTemplate(messageTemplate, {
        coupleNames: ev.coupleNames || '',
        eventDate: ev.date || '',
        venue: ev.venue || '',
      });

      const payload = {
        action_type: 'album_reminder',
        phone,
        message,
        test_mode: isTestMode,
        ...(mediaUrl ? { media_url: mediaUrl } : {}),
      };

      try {
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`Webhook ${res.status}: ${txt}`);
        }

        // Only mark as sent in real mode
        if (!isTestMode && ev.id) {
          await base44.asServiceRole.entities.Event.update(ev.id, {
            album_reminder_sent: true,
            album_reminder_sent_at: new Date().toISOString(),
          });
        }

        results.push({ coupleNames: ev.coupleNames, phone, success: true, test: isTestMode });
        console.log(`[albumReminder] ✅ ${ev.coupleNames} → ${phone}${isTestMode ? ' (test)' : ''}`);
      } catch (err) {
        results.push({ coupleNames: ev.coupleNames, phone, success: false, error: err.message });
        console.error(`[albumReminder] ❌ ${ev.coupleNames}: ${err.message}`);
      }

      // In test mode: send only once
      if (isTestMode) break;
    }

    return Response.json({
      success: true,
      test_mode: isTestMode,
      total: isTestMode ? 1 : eligible.length,
      sent: results.filter(r => r.success).length,
      results,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});