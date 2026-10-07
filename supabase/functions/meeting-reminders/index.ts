// Sales-meeting reminders (2026-10-07). Called every minute by the pg_cron job
// `meeting-reminders-1min` with the x-cron-secret header (MEETING_REMINDERS_CRON_SECRET),
// same one-secret-per-trigger convention as monthly-events-backup. verify_jwt = false
// (config.toml) — pg_cron has no user JWT.
//
// Each reminder is CLAIMED with an UPDATE … WHERE <column> IS NULL RETURNING before anything
// is sent, so two overlapping runs can never send it twice. A push ('meeting' category —
// always delivered, see _shared/pushPrefs.ts) plus a bell notification (the fallback when
// no device is registered). Rules: _shared/meetingReminders.ts.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { sendPush } from '../_shared/webPush.ts';
import { isFirstDue, isSecondDue, reminderText, FIRST_BEFORE_MS, STALE_AFTER_MS, type MeetingRow } from '../_shared/meetingReminders.ts';

const COLS = 'id, tenant_id, lead_id, title, phone, kind, starts_at, status, zoom_url, location, reminder_sent_at, second_reminder_sent_at, acknowledged_at';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const cronSecret = Deno.env.get('MEETING_REMINDERS_CRON_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!cronSecret || !provided || provided !== cronSecret) {
    return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const now = Date.now();
  const out = { first: 0, second: 0, errors: 0 };

  try {
    // Only meetings around now: starting within 10 minutes, or started under 30 minutes ago.
    const { data: rows, error } = await supabase
      .from('sales_meetings')
      .select(COLS)
      .eq('status', 'scheduled')
      .lte('starts_at', new Date(now + FIRST_BEFORE_MS).toISOString())
      .gte('starts_at', new Date(now - STALE_AFTER_MS).toISOString())
      .limit(200);
    if (error) throw error;

    for (const m of (rows || []) as (MeetingRow & { tenant_id: string; lead_id: string | null })[]) {
      const which = isFirstDue(m, now) ? 'first' : isSecondDue(m, now) ? 'second' : null;
      if (!which) continue;
      try {
        const col = which === 'first' ? 'reminder_sent_at' : 'second_reminder_sent_at';
        const { data: claimed } = await supabase
          .from('sales_meetings')
          .update({ [col]: new Date(now).toISOString() })
          .eq('id', m.id)
          .is(col, null)
          .select('id')
          .maybeSingle();
        if (!claimed) continue; // another run took it

        const { title, body } = reminderText(m, which, now);
        await sendPush(supabase, m.tenant_id, 'meeting', {
          title, body,
          url: `/chat?meeting=${m.id}`,
          tag: `m-${m.id}`,
          requireInteraction: which === 'second',
        });
        await supabase.from('notifications').insert({
          tenant_id: m.tenant_id,
          type: 'meeting_reminder',
          title,
          body,
          related_lead_id: m.lead_id || null,
        });
        if (which === 'first') out.first++; else out.second++;
      } catch (e) {
        out.errors++;
        console.error('[meeting-reminders] reminder failed:', (e as Error)?.message || e);
      }
    }
    return jsonResponse({ success: true, ...out });
  } catch (e) {
    console.error('[meeting-reminders] failed:', (e as Error)?.message || e);
    return jsonResponse({ error: (e as Error).message, ...out }, { status: 500 });
  }
});
