// "מרכז הוצאות" — the Gmail script's address (Avira, 2026-11-23; 0117). A small Google Apps Script in each of the
// studio's mailboxes (made on the "הוצאות" screen) looks every 10 minutes for mails with an invoice or receipt from the
// day the collection starts, and for each one:
//   start  reports the mail (sender, subject, date, its text, its PDF / image attachments) → the rows, and an upload
//          address for each file (Storage's signed upload, so the file never passes through here);
//   done   the files are up → they are read by AI (after this answers).
// Only mails with an invoice or receipt leave the mailbox; the system has no access to it.
//
// verify_jwt = false (a Google script has no Supabase session). The credential is the x-avira-token header: a random
// token made on the screen, stored only as its SHA-256 (expense_mailboxes.token_hash) — looking it up is also how the
// studio and the mailbox are found; nothing in the body is trusted for that.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimitForKey } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';
import { EXPENSES_TRACK_SINCE, parseMailReport } from '../_shared/expenses.ts';
import { mailDone, mailStart, processPending } from '../_shared/expenseIntake.ts';

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 });

  const token = req.headers.get('x-avira-token') || '';
  if (token.length < 20) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const hash = await hashToken(token);
  // Per script, not per IP: Apps Script calls come from Google's shared addresses.
  const rl = await checkRateLimitForKey(`expenses-mail:${hash.slice(0, 16)}`, { maxHits: 400, windowSeconds: 600 });
  if (!rl.allowed) return jsonResponse({ error: 'too many requests' }, { status: 429 });

  const supabase = createServiceRoleClient();
  const { data: box } = await supabase.from('expense_mailboxes').select('id, tenant_id').eq('token_hash', hash).is('revoked_at', null).maybeSingle();
  if (!box?.tenant_id) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const tenantId = box.tenant_id as string;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, { status: 400 });
  }
  try {
    const action = String(body?.action || '');
    if (action === 'ping') {
      await supabase.from('expense_mailboxes').update({ last_seen_at: new Date().toISOString() }).eq('id', box.id);
      return jsonResponse({ ok: true, since: EXPENSES_TRACK_SINCE });
    }
    if (action === 'start') {
      const report = parseMailReport(body);
      if (!report) return jsonResponse({ error: 'bad mail' }, { status: 400 });
      const res = await mailStart(supabase, tenantId, box.id, report);
      // Sent with every upload (Storage's gateway takes the public key; the signed address is the permission).
      return jsonResponse({ ok: true, ...res, headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY') || '', 'x-upsert': 'true' } });
    }
    if (action === 'done') {
      const gmailId = String(body?.id || '');
      if (!/^[\w-]{6,100}$/.test(gmailId)) return jsonResponse({ error: 'bad mail' }, { status: 400 });
      const ids = await mailDone(supabase, tenantId, box.id, gmailId);
      if (ids.length) EdgeRuntime.waitUntil(processPending(supabase, tenantId, { ids, maxReads: ids.length }).catch((e) => console.error('[expenses-mail] read', e?.message || e)));
      return jsonResponse({ ok: true, taken: ids.length });
    }
    return jsonResponse({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    console.error('[expenses-mail]', (e as Error)?.message || e);
    return jsonResponse({ error: 'server error' }, { status: 500 });
  }
});
