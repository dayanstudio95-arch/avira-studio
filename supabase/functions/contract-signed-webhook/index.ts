// Webhook target for the Postgres trigger defined in
// supabase/migrations/0026_notifications_trigger.sql — fires whenever a lead's
// signed_at is newly set, regardless of which of the two signing flows did it
// (public link: sign-lead-public/index.ts, or the internal manual dialog:
// LeadContractDialog.jsx, which writes leads directly with no edge function at
// all). This is what makes the WhatsApp notification automatic and future-proof
// instead of requiring every signing path to remember to send it itself — same
// reasoning as calendar-sync-webhook (0017_calendar_sync_trigger.sql).
//
// The trigger already inserts the in-app `notifications` row itself (service
// definer, no round-trip needed) — this function's only job is the WhatsApp
// side, sent to a single fixed number configured in Settings > התראות
// (app_settings key: notification_phone_number), not to any particular user's
// own profile phone (per explicit user choice).
//
// Deliberately NOT reusing an authenticated function: a DB trigger cannot supply
// a user JWT, and embedding the service-role key inside a Postgres function body
// would be far more dangerous than a narrowly-scoped shared secret. Unauthenticated
// at the JWT layer (verify_jwt=false, see config.toml) — authenticates instead via
// x-cron-secret, checked in the function body, own dedicated secret
// (CONTRACT_NOTIFICATION_CRON_SECRET) per the one-secret-per-trigger convention
// already established for CALENDAR_RECONCILE_CRON_SECRET / AUTOMATION_ENGINE_CRON_SECRET.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const cronSecret = Deno.env.get('CONTRACT_NOTIFICATION_CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || !providedSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tenantId, leadId } = await req.json();
    if (!tenantId || !leadId) {
      return jsonResponse({ error: 'tenantId and leadId required' }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('couple_names, event_date, venue_name, final_price')
      .eq('id', leadId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (leadError || !lead) {
      console.error('[contract-signed-webhook] Lead not found:', leadError);
      return jsonResponse({ success: false, error: 'Lead not found' }, { status: 200 });
    }

    const { data: phoneSetting } = await supabase
      .from('app_settings')
      .select('value')
      .eq('tenant_id', tenantId)
      .eq('key', 'notification_phone_number')
      .maybeSingle();
    const targetPhone = phoneSetting?.value?.trim();

    if (!targetPhone) {
      // No number configured yet (Settings > התראות) — the in-app notification row
      // already exists regardless (inserted directly by the DB trigger), this just
      // means there's nothing to WhatsApp yet. Not an error.
      return jsonResponse({ success: true, skipped: 'no notification_phone_number configured' });
    }

    const dateStr = lead.event_date
      ? new Date(lead.event_date).toLocaleDateString('he-IL')
      : null;
    const lines = [
      `✅ חוזה נחתם!`,
      lead.couple_names ? `זוג: ${lead.couple_names}` : null,
      lead.venue_name ? `מקום: ${lead.venue_name}` : null,
      dateStr ? `תאריך: ${dateStr}` : null,
      lead.final_price ? `מחיר סופי: ${lead.final_price} ₪` : null,
    ].filter(Boolean);

    const result = await sendWhatsApp(supabase, targetPhone, lines.join('\n'), tenantId);
    if (!result.success) {
      console.error('[contract-signed-webhook] WhatsApp send failed:', result.error);
    }

    return jsonResponse({ success: true, whatsapp: result.success, error: result.error });
  } catch (error) {
    console.error('[contract-signed-webhook] Error:', error);
    // Always 200 — fire-and-forget pg_net call, no retry logic on the Postgres side.
    return jsonResponse({ success: false, error: error.message }, { status: 200 });
  }
});
