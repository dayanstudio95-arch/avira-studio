// Monthly email backup — the automatic half of the studio's safety net.
//
// REWRITTEN 2026-09-10. It used to email a formatted HTML list of upcoming events and
// nothing else: `select date, couple_names, venue, phone_number, team` filtered
// `.gte('date', today)`. That is a schedule printout, not a backup — no prices, no
// payments, no invoices, no contracts, and nothing at all about the past. If the
// database were lost, it would not have brought the business back.
//
// It now attaches the same complete snapshot the "הורד גיבוי מלא" button produces
// (src/components/settings/DataBackupCard.jsx): leads (with their invoice history,
// signed-contract links, signatures and payment totals), events, staff, packages and
// WhatsApp conversations. The HTML body keeps the upcoming-events table, because that
// is the part worth reading on a phone without opening anything.
//
// Why the user asked for this: the manual button only protects you on the days you
// remember to press it, and the days you don't remember are the busy ones.
//
// ⚠️ Two delivery constraints that are easy to trip over:
//
//   1. The default sender is Resend's sandbox `onboarding@resend.dev`, which will
//      ONLY deliver to the address that owns the Resend account. If
//      `events_backup_email` is set to anything else, Resend accepts the call and the
//      mail never arrives. Set RESEND_FROM_EMAIL to an address on a verified domain to
//      lift that.
//   2. The attachment is gzipped. A raw JSON snapshot of this studio's data runs to
//      several MB and base64 inflates it by a third; gzip takes it to a few hundred KB
//      and keeps the mail deliverable. macOS and Windows both expand a .gz on
//      double-click.
//
// ⚠️ It also no longer lies about succeeding. The old version returned HTTP 200 even
// when the send failed, and pg_net does not retry — so a backup that quietly stopped
// working would look identical to one that never had a problem. Failures now write a
// `notifications` row (visible in the app's bell, where the owner actually looks) and
// the endpoint answers 500.
//
// x-cron-secret auth (MONTHLY_EVENTS_BACKUP_CRON_SECRET), same one-secret-per-trigger
// convention as CONTRACT_NOTIFICATION_CRON_SECRET / CALENDAR_RECONCILE_CRON_SECRET.
// Scheduled `0 6 1 * *` — confirmed active in cron.job on 2026-09-10.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { sendEmail } from '../_shared/email.ts';

const MAX_EVENTS_IN_EMAIL_BODY = 400; // the readable table only; the attachment is complete

// Same set, and the same reasoning, as DataBackupCard.jsx: ordered by what the owner
// said would hurt to lose. whatsapp_messages is excluded — it is the fastest-growing
// table in the database and the conversation rows already carry the extracted details.
const BACKUP_TABLES = ['leads', 'events', 'staff_members', 'packages', 'whatsapp_conversations'];

const PAGE = 1000;

const ROLE_LABELS: Record<string, string> = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'וידאוגרף',
  videographer2: 'וידאוגרף 2',
  editor: 'עורך/ת',
};

function escapeHtml(str: unknown): string {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

// Explicit pagination, for the same reason as the in-app button: PostgREST caps rows
// server-side, so a plain select would quietly return the first page and produce a
// backup that LOOKS complete. A silently truncated backup is worse than none, because
// it gets trusted.
async function fetchAll(supabase: any, table: string, tenantId: string) {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('tenant_id', tenantId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) return rows;
  }
}

async function gzipToBase64(text: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(text)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  // Chunked so a multi-MB snapshot doesn't blow the argument limit of
  // String.fromCharCode(...spread), which is the classic way this breaks at scale.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function buildEmailHtml(events: any[], counts: Record<string, number>, filename: string): string {
  const rows = events.map((e) => {
    const team = (e.team || [])
      .map((m: any) => `${ROLE_LABELS[m.role] || m.role || ''}: ${m.staffMemberName || '—'}`)
      .join('<br>');
    return `<tr>
      <td style="padding:6px;border:1px solid #ddd">${escapeHtml(e.date)}</td>
      <td style="padding:6px;border:1px solid #ddd">${escapeHtml(e.couple_names)}</td>
      <td style="padding:6px;border:1px solid #ddd">${escapeHtml(e.venue)}</td>
      <td style="padding:6px;border:1px solid #ddd">${escapeHtml(e.phone_number)}</td>
      <td style="padding:6px;border:1px solid #ddd">${team || '—'}</td>
    </tr>`;
  }).join('');

  const countRows = Object.entries(counts)
    .map(([t, n]) => `<li>${escapeHtml(t)}: <strong>${n}</strong> רשומות</li>`)
    .join('');

  return `<div dir="rtl" style="font-family:Arial,sans-serif;color:#222">
    <h2>גיבוי חודשי — אווירה סטודיו</h2>
    <p>מצורף קובץ <strong>${escapeHtml(filename)}</strong> ובו עותק מלא של הנתונים:</p>
    <ul>${countRows}</ul>
    <p style="background:#fff8e1;border-right:4px solid #f4b400;padding:10px">
      <strong>שמור את הקובץ מחוץ למייל</strong> — בדרייב או בדיסק חיצוני.
      גיבוי שיושב רק בתיבה שלך לא מגן מפני אובדן גישה לתיבה.
      <br>הקובץ דחוס (<code>.gz</code>) — לחיצה כפולה פותחת אותו.
    </p>
    <h3>אירועים קרובים (${events.length})</h3>
    <table style="border-collapse:collapse;font-size:13px">
      <tr style="background:#f0f0f0">
        <th style="padding:6px;border:1px solid #ddd">תאריך</th>
        <th style="padding:6px;border:1px solid #ddd">זוג</th>
        <th style="padding:6px;border:1px solid #ddd">אולם</th>
        <th style="padding:6px;border:1px solid #ddd">טלפון</th>
        <th style="padding:6px;border:1px solid #ddd">צוות</th>
      </tr>
      ${rows}
    </table>
  </div>`;
}

// A failed backup has to reach a human. The bell in the app is where the owner
// actually looks; function logs are not.
async function notifyFailure(supabase: any, tenantId: string, reason: string) {
  try {
    await supabase.from('notifications').insert({
      tenant_id: tenantId,
      type: 'monthly_backup_failed',
      title: 'הגיבוי החודשי נכשל',
      body: `הגיבוי האוטומטי לא נשלח: ${reason}. אפשר להוריד גיבוי ידני בהגדרות ← ייבוא/ייצוא.`,
    });
  } catch (e) {
    console.error('[monthly-events-backup] notification insert failed:', e);
  }
}

async function processTenant(supabase: any, tenantId: string) {
  const { data: emailSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', 'events_backup_email')
    .maybeSingle();
  const targetEmail = emailSetting?.value?.trim();
  if (!targetEmail) {
    // Not a failure — a studio that never configured an address hasn't asked for this.
    return { tenantId, skipped: 'no events_backup_email configured' };
  }

  let payload: Record<string, unknown>;
  const counts: Record<string, number> = {};
  try {
    const data: Record<string, unknown> = {};
    for (const table of BACKUP_TABLES) {
      const rows = await fetchAll(supabase, table, tenantId);
      data[table] = rows;
      counts[table] = rows.length;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) {
      await notifyFailure(supabase, tenantId, 'הגיבוי חזר ריק');
      return { tenantId, emailSent: false, error: 'backup came back empty' };
    }
    payload = {
      _meta: {
        created_at: new Date().toISOString(),
        app: 'AVIRA Studio',
        format: 'full-json-v1',
        source: 'monthly-events-backup',
        counts,
      },
      ...data,
    };
  } catch (e: any) {
    const reason = e?.message || 'שגיאה לא ידועה';
    console.error('[monthly-events-backup] snapshot failed for tenant', tenantId, reason);
    await notifyFailure(supabase, tenantId, reason);
    return { tenantId, emailSent: false, error: reason };
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const filename = `avira-backup-${todayStr}.json.gz`;

  let attachmentB64: string;
  try {
    attachmentB64 = await gzipToBase64(JSON.stringify(payload));
  } catch (e: any) {
    const reason = `compression failed: ${e?.message || e}`;
    console.error('[monthly-events-backup]', reason);
    await notifyFailure(supabase, tenantId, reason);
    return { tenantId, emailSent: false, error: reason };
  }

  // Upcoming events for the readable table in the body. Failing to build this must not
  // cost the attachment, which is the part that actually matters.
  const { data: upcoming } = await supabase
    .from('events')
    .select('date, couple_names, venue, phone_number, team')
    .eq('tenant_id', tenantId)
    .gte('date', todayStr)
    .order('date', { ascending: true })
    .limit(MAX_EVENTS_IN_EMAIL_BODY);

  const html = buildEmailHtml(upcoming || [], counts, filename);
  const totalRows = Object.values(counts).reduce((a, b) => a + b, 0);
  const subject = `גיבוי חודשי — ${totalRows} רשומות`;

  const result = await sendEmail(targetEmail, subject, html, [
    { filename, content: attachmentB64 },
  ]);

  if (!result.success) {
    console.error('[monthly-events-backup] send failed for tenant', tenantId, result.error);
    await notifyFailure(supabase, tenantId, result.error || 'שליחת המייל נכשלה');
    return { tenantId, emailSent: false, error: result.error };
  }
  return { tenantId, emailSent: true, counts, attachmentBytes: attachmentB64.length };
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

    // ⚠️ Answer non-200 when any tenant failed. The old version always returned 200
    // "because the cron caller doesn't retry" — but the caller isn't the audience. A
    // backup that stops working and still reports success is indistinguishable from one
    // that works, which is the worst possible property for a safety net.
    const failed = results.filter((r: any) => r.error);
    return jsonResponse(
      { success: failed.length === 0, results },
      { status: failed.length === 0 ? 200 : 500 }
    );
  } catch (error) {
    console.error('[monthly-events-backup] Error:', error);
    return jsonResponse({ success: false, error: error.message }, { status: 500 });
  }
});
