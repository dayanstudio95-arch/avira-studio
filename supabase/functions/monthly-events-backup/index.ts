// Monthly email "safety net" backup of every studio's upcoming events (date,
// couple, venue, phone, and the full assigned team) — sent to the email
// address configured in Settings > התראות (app_settings key:
// events_backup_email). Goal: the studio owner always has an offline-readable,
// recent copy of "what's coming up and who's on each event," even if the live
// system is ever unreachable. This is the *automatic* half of that safety net;
// src/lib/eventsBackupPdf.js (a button in Settings > ייבוא/ייצוא) is the
// on-demand, real-PDF manual half.
//
// Email, not WhatsApp: this replaces an earlier WhatsApp-text version
// (supabase/functions/weekly-events-backup — removed) after the user flagged
// that a large recurring automated message through Green API risks the
// studio's WhatsApp number getting flagged/blocked. Email carries no such
// risk and, unlike the old WhatsApp version, needs no chunking — one message
// can hold the whole list, formatted as real HTML (still no Hebrew-glyph
// problem here, since this is HTML text rendered by the recipient's mail
// client, not jsPDF's canvas-font approach — that limitation is specific to
// generating an actual PDF file, which is why the manual button still does
// its PDF generation client-side in the browser instead).
//
// x-cron-secret auth (own dedicated MONTHLY_EVENTS_BACKUP_CRON_SECRET), same
// one-secret-per-trigger convention as CONTRACT_NOTIFICATION_CRON_SECRET /
// CALENDAR_RECONCILE_CRON_SECRET. Recommended schedule: monthly — see
// DEPLOYMENT.md section 9.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { sendEmail } from '../_shared/email.ts';

const MAX_EVENTS_PER_TENANT = 400; // safety cap, matches the frontend PDF export's cap

const ROLE_LABELS: Record<string, string> = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'וידאוגרף',
  videographer2: 'וידאוגרף 2',
  editor: 'עורך/ת',
};

function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]
  ));
}

function formatDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('he-IL');
  } catch {
    return d;
  }
}

function teamSummary(team: unknown): string {
  if (!Array.isArray(team) || team.length === 0) return 'לא שובץ צוות';
  const names = (team as any[])
    .filter((m) => m && m.staffMemberName)
    .map((m) => `${ROLE_LABELS[m.role] || m.role || 'תפקיד'}: ${escapeHtml(m.staffMemberName)}`);
  return names.length > 0 ? names.join(' · ') : 'לא שובץ צוות';
}

function buildEmailHtml(events: any[]): string {
  const todayLabel = formatDate(new Date().toISOString());
  const rows = events.map((e) => `
    <div style="border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; margin-bottom:10px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <strong style="font-size:14px; color:#111827;">${escapeHtml(e.couple_names || 'ללא שם')}</strong>
        <span style="font-size:13px; color:#111827; background:#fde68a; border-radius:6px; padding:2px 8px;">${escapeHtml(formatDate(e.date))}</span>
      </div>
      <div style="font-size:12px; color:#4b5563;">
        📍 ${escapeHtml(e.venue || '—')} &nbsp;&nbsp; 📱 ${escapeHtml(e.phone_number || '—')}
      </div>
      <div style="font-size:12px; color:#374151; margin-top:6px; border-top:1px dashed #e5e7eb; padding-top:6px;">
        👥 ${teamSummary(e.team)}
      </div>
    </div>
  `).join('');

  return `
    <div dir="rtl" style="font-family: Arial, 'Noto Sans Hebrew', sans-serif; color:#1f2937; max-width:640px; margin:0 auto;">
      <div style="background:#1e1e1e; padding:20px; text-align:center; border-radius:8px 8px 0 0;">
        <div style="color:#ffd700; font-size:20px; font-weight:bold; letter-spacing:1px;">AVIRA STUDIO</div>
        <div style="color:#c8c8c8; font-size:12px; margin-top:4px;">גיבוי חודשי — אירועים עתידיים · עדכני ל-${todayLabel} (${events.length} אירועים)</div>
      </div>
      <div style="padding:20px; background:#ffffff;">
        ${rows}
      </div>
    </div>
  `;
}

async function processTenant(supabase: any, tenantId: string) {
  const { data: emailSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'events_backup_email')
    .maybeSingle();
  const targetEmail = emailSetting?.value?.trim();
  if (!targetEmail) return { tenantId, skipped: 'no events_backup_email configured' };

  const todayStr = new Date().toISOString().split('T')[0];
  const { data: events, error } = await supabase
    .from('events')
    .select('date, couple_names, venue, phone_number, team')
    .eq('tenant_id', tenantId)
    .gte('date', todayStr)
    .order('date', { ascending: true })
    .limit(MAX_EVENTS_PER_TENANT);

  if (error) {
    console.error('[monthly-events-backup] events query failed for tenant', tenantId, error);
    return { tenantId, skipped: 'events query failed' };
  }
  if (!events || events.length === 0) {
    return { tenantId, skipped: 'no upcoming events' };
  }

  const html = buildEmailHtml(events);
  const subject = `גיבוי חודשי — ${events.length} אירועים עתידיים`;
  const result = await sendEmail(targetEmail, subject, html);

  if (!result.success) {
    console.error('[monthly-events-backup] send failed for tenant', tenantId, result.error);
    return { tenantId, eventsCount: events.length, emailSent: false, error: result.error };
  }
  return { tenantId, eventsCount: events.length, emailSent: true };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const cronSecret = Deno.env.get('MONTHLY_EVENTS_BACKUP_CRON_SECRET');
    const providedSecret = req.headers.get('x-cron-secret');
    if (!cronSecret || !providedSecret || providedSecret !== cronSecret) {
      return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const { data: tenants } = await supabase.from('tenants').select('id');

    const results = [];
    for (const t of tenants || []) {
      results.push(await processTenant(supabase, t.id));
    }

    return jsonResponse({ success: true, results });
  } catch (error) {
    console.error('[monthly-events-backup] Error:', error);
    // Always 200 — fire-and-forget cron call, no retry logic on the caller's side.
    return jsonResponse({ success: false, error: error.message }, { status: 200 });
  }
});
