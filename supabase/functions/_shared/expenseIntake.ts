// "מרכז הוצאות", step 1 (Avira, 2026-11-23; 0117) — the impure side: documents taken in, read by AI, sorted, matched to
// Morning, and answered in the group. The decisions are in expenses.ts (pure, tested).
//   - the "קבלות" group: whatsapp-webhook hands every new message of the chosen group here (takeGroupMessage) — taken
//     in, read and answered at once; the screen's refresh and the hourly automation-engine tick catch up on anything
//     missed (collectGroup);
//   - the two mailboxes: expenses-mail (a Google Apps Script in each) reports a mail, gets upload addresses for its
//     files (mailStart), uploads, and says it is done (mailDone) — then the files are read;
//   - the screen: a dropped file is uploaded by the browser and read here (processPending).
// Morning is only READ: both accounts' expenses are copied to morning_expenses (syncMorning) to mark "כבר במורנינג".
import {
  CONFIRM_WITHIN_MS, EXPENSES_BUCKET, EXPENSES_TRACK_SINCE, GROUP_CONFIRM_KEY, GROUP_KEY, MAX_EXPENSE_BYTES, MAX_READ_TRIES,
  MORNING_SYNCED_KEY, amountOf, confirmText, dateOf, expenseWarnings, extOfMime, findDuplicate, findStaffDuplicate, groupDocOf,
  groupSenderName, isExpenseEntity, mailPlan, mailPrefix, matchMorning, morningRowOf, sameMailTwin, sortExpense,
  type ExpenseEntity, type ExpenseReading, type GroupMessage, type MailReport, type MorningRow,
} from './expenses.ts';
import { STAFF_PAYERS_KEY, type Payers } from './staffInvoices.ts';
import { linkPdf } from './staffInvoicesScan.ts';
import { readExpenseDoc } from './expenseDocReader.ts';
import { sendWhatsApp } from './whatsapp.ts';
import { fetchMorningToken } from './morningAuth.ts';
import { MORNING_API, MORNING_SETTINGS_KEYS } from './morningClient.ts';

/** Morning's expenses are copied from here (two months before the collection starts: an October receipt sent in November). */
export const MORNING_FROM = '2026-09-01';
/** How often the refresh copies Morning again (the screen's "עדכון מהמורנינג" does it at once). */
export const MORNING_EVERY_MS = 6 * 3600_000;
/** A mail part the script never finished uploading is given up after this long. */
const UPLOAD_GRACE_MS = 24 * 3600_000;
const MSG_COLS = 'id, direction, type_message, body_text, media_url, media_path, media_mime, sender_name, created_at';
const DOC_COLS = 'id, tenant_id, source, source_ref, file_path, file_mime, link_url, provider, read_status, read_tries, received_at';

export interface ExpenseRunResult {
  collected: number;
  read: number;
  remaining: number;
  confirmed: number;
  morning: string | null;
  errors: string[];
}

async function setting(supabase: any, tenantId: string, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function upsertSetting(supabase: any, tenantId: string, key: string, value: string) {
  await supabase.from('app_settings').upsert({ tenant_id: tenantId, key, value }, { onConflict: 'tenant_id,key' });
}

/** The studio's own Anthropic key first, then the platform's (like the staff invoices). */
async function anthropicKey(supabase: any, tenantId: string): Promise<string | null> {
  const { data } = await supabase.from('tenant_secrets').select('value').eq('tenant_id', tenantId).eq('key', 'anthropic_api_key').limit(1);
  return data?.[0]?.value || Deno.env.get('ANTHROPIC_API_KEY') || null;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const nowIso = () => new Date().toISOString();
const digitsOnly = (s: string, max: number) => (s.replace(/\D/g, '').slice(0, max) || null);
const textOrNull = (s: string, max: number) => (s.trim() ? s.trim().slice(0, max) : null);

interface Ctx {
  payers: Payers;
  rules: Record<string, ExpenseEntity>;
  apiKey: () => Promise<string | null>;
}

async function loadCtx(supabase: any, tenantId: string): Promise<Ctx> {
  let payers: Payers = {};
  try {
    payers = JSON.parse((await setting(supabase, tenantId, STAFF_PAYERS_KEY)) || '{}');
  } catch { /* not set: only the supplier rules sort */ }
  const { data: ruleRows } = await supabase.from('expense_supplier_rules').select('supplier_key, entity').eq('tenant_id', tenantId);
  const rules: Record<string, ExpenseEntity> = {};
  for (const r of ruleRows ?? []) if (isExpenseEntity(r.entity)) rules[r.supplier_key] = r.entity;
  let keyLookup: Promise<string | null> | null = null;
  return { payers, rules, apiKey: () => (keyLookup ??= anthropicKey(supabase, tenantId)) };
}

// ---------------------------------------------------------------- the group

/** A group message's file: our copy (whatsapp-media), else Green API's link while it still works. */
async function groupMediaBytes(supabase: any, m: GroupMessage): Promise<Uint8Array | null> {
  try {
    if (m.media_path) {
      const { data, error } = await supabase.storage.from('whatsapp-media').download(m.media_path);
      if (!error && data) return new Uint8Array(await data.arrayBuffer());
    }
    if (m.media_url) {
      const res = await fetch(m.media_url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    }
  } catch { /* falls through */ }
  return null;
}

/** One message of the group → its row (once per message), the file kept in expense-docs. The row's id, or null. */
export async function intakeGroupMessage(supabase: any, tenantId: string, m: GroupMessage): Promise<string | null> {
  const what = groupDocOf(m);
  if (!what) return null;
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    source: 'whatsapp',
    source_ref: `wa:${m.id}`,
    message_id: m.id,
    sender_name: groupSenderName(m) || null,
    received_at: m.created_at || nowIso(),
    read_status: 'pending',
    ...(what.kind === 'link' ? { link_url: what.link.url, provider: what.link.provider } : { file_mime: what.mime }),
  };
  const { data, error } = await supabase.from('expense_docs').upsert(row, { onConflict: 'tenant_id,source_ref', ignoreDuplicates: true }).select('id');
  if (error) throw new Error(`expense_docs: ${error.message}`);
  const id = data?.[0]?.id as string | undefined;
  if (!id) return null; // taken before
  if (what.kind === 'file') {
    const bytes = await groupMediaBytes(supabase, m);
    if (!bytes || bytes.length > MAX_EXPENSE_BYTES) {
      await supabase.from('expense_docs').update({
        read_status: 'failed', read_tries: MAX_READ_TRIES, updated_at: nowIso(),
        read_error: bytes ? 'הקובץ גדול מדי לקריאה' : 'הקובץ לא הגיע מוואטסאפ — לשלוח שוב או לגרור למסך',
      }).eq('id', id);
      return id;
    }
    const path = `${tenantId}/${id}.${extOfMime(what.mime)}`;
    const { error: upErr } = await supabase.storage.from(EXPENSES_BUCKET).upload(path, bytes, { contentType: what.mime, upsert: true });
    if (upErr) throw new Error(`expense-docs upload: ${upErr.message}`);
    await supabase.from('expense_docs').update({ file_path: path, file_size: bytes.length, updated_at: nowIso() }).eq('id', id);
  }
  return id;
}

async function groupConversationId(supabase: any, tenantId: string, chatId: string): Promise<string | null> {
  const { data } = await supabase.from('whatsapp_conversations').select('id').eq('tenant_id', tenantId).eq('chat_id', chatId).limit(1);
  return data?.[0]?.id ?? null;
}

/** The group's documents not taken in yet (a message the webhook missed), from the day the collection starts. */
export async function collectGroup(supabase: any, tenantId: string, limit = 20): Promise<number> {
  const group = await setting(supabase, tenantId, GROUP_KEY);
  if (!group) return 0;
  const convId = await groupConversationId(supabase, tenantId, group);
  if (!convId) return 0;
  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select(MSG_COLS)
    .eq('tenant_id', tenantId)
    .eq('conversation_id', convId)
    .gte('created_at', `${EXPENSES_TRACK_SINCE}T00:00:00+02:00`)
    .order('created_at', { ascending: true })
    .limit(500);
  const docs = (msgs ?? []).filter((m: GroupMessage) => groupDocOf(m));
  if (!docs.length) return 0;
  const refs = docs.map((m: GroupMessage) => `wa:${m.id}`);
  const { data: have } = await supabase.from('expense_docs').select('source_ref').eq('tenant_id', tenantId).in('source_ref', refs);
  const taken = new Set((have ?? []).map((h: { source_ref: string }) => h.source_ref));
  let n = 0;
  for (const m of docs) {
    if (n >= limit || taken.has(`wa:${m.id}`)) continue;
    if (await intakeGroupMessage(supabase, tenantId, m)) n++;
  }
  return n;
}

/**
 * whatsapp-webhook, for a message of a group (after its media is copied): when it is the studio's "קבלות" group, the
 * document is taken in, read and answered at once. Never throws (it runs after the webhook answered).
 */
export async function takeGroupMessage(supabase: any, tenantId: string, chatId: string, idMessage: string, mediaCopy: Promise<unknown> | null): Promise<void> {
  try {
    const group = await setting(supabase, tenantId, GROUP_KEY);
    if (!group || group !== chatId) return;
    if (mediaCopy) await mediaCopy;
    const { data: m } = await supabase.from('whatsapp_messages').select(MSG_COLS).eq('tenant_id', tenantId).eq('id_message', idMessage).maybeSingle();
    if (!m) return;
    const id = await intakeGroupMessage(supabase, tenantId, m);
    if (!id) return;
    await processPending(supabase, tenantId, { ids: [id], maxReads: 1 });
    await confirmGroupDocs(supabase, tenantId, new Date());
  } catch (e) {
    console.error('[expenses] group message', (e as Error)?.message || e);
  }
}

// ---------------------------------------------------------------- reading

async function fail(supabase: any, id: string, tries: number, error: string, status: 'failed' | 'manual' | null = null) {
  await supabase.from('expense_docs').update({
    read_status: status ?? (tries >= MAX_READ_TRIES ? 'failed' : 'pending'),
    read_error: error.slice(0, 300),
    updated_at: nowIso(),
  }).eq('id', id);
}

/** The amount in the reading ("0" VAT is 0, not unknown). */
const vatOf = (s: string) => (s.trim() === '0' ? 0 : amountOf(s));

/** One pending document: its file (a link's PDF downloaded), read by AI, sorted, checked against the rest and Morning. */
async function processDoc(supabase: any, tenantId: string, doc: any, ctx: Ctx): Promise<'read' | 'skipped' | 'failed'> {
  // Claimed by its try count: two runs never read the same document twice.
  const tries = Number(doc.read_tries || 0) + 1;
  const { data: claimed } = await supabase
    .from('expense_docs')
    .update({ read_tries: tries, updated_at: nowIso() })
    .eq('id', doc.id)
    .eq('read_status', 'pending')
    .eq('read_tries', doc.read_tries || 0)
    .select('id');
  if (!claimed?.length) return 'skipped';

  let bytes: Uint8Array | null = null;
  let mime = String(doc.file_mime || '');
  if (!doc.file_path && doc.link_url) {
    bytes = await linkPdf({ url: doc.link_url, provider: doc.provider ?? null });
    if (!bytes) {
      await fail(supabase, doc.id, tries, 'הקישור לא החזיר קובץ — לפתוח ולשמור ידנית', 'manual');
      return 'failed';
    }
    mime = 'application/pdf';
    const path = `${tenantId}/${doc.id}.pdf`;
    const { error } = await supabase.storage.from(EXPENSES_BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
    if (error) {
      await fail(supabase, doc.id, tries, `שמירת הקובץ נכשלה: ${error.message}`);
      return 'failed';
    }
    await supabase.from('expense_docs').update({ file_path: path, file_mime: mime, file_size: bytes.length }).eq('id', doc.id);
  } else if (doc.file_path) {
    const { data, error } = await supabase.storage.from(EXPENSES_BUCKET).download(doc.file_path);
    if (error || !data) {
      await fail(supabase, doc.id, tries, doc.source === 'email' ? 'הקובץ לא הגיע מהמייל' : 'הקובץ לא נמצא');
      return 'failed';
    }
    bytes = new Uint8Array(await data.arrayBuffer());
    mime = mime || data.type || 'application/pdf';
  } else {
    await fail(supabase, doc.id, MAX_READ_TRIES, 'אין קובץ לקריאה', 'failed');
    return 'failed';
  }

  const hash = await sha256Hex(bytes);
  const { data: sameFile } = await supabase.from('expense_docs').select('id').eq('tenant_id', tenantId).eq('content_hash', hash).neq('id', doc.id).limit(1);
  if (sameFile?.length) {
    await supabase.from('expense_docs').update({
      read_status: 'duplicate', dup_of: sameFile[0].id, content_hash: hash, file_size: bytes.length, read_error: null,
      note: 'אותו קובץ כבר נקלט', updated_at: nowIso(),
    }).eq('id', doc.id);
    return 'read';
  }

  const apiKey = await ctx.apiKey();
  if (!apiKey) {
    await fail(supabase, doc.id, MAX_READ_TRIES, 'אין מפתח AI לקריאת מסמכים (הגדרות ← חיבורים)', 'failed');
    return 'failed';
  }
  let r: ExpenseReading;
  try {
    r = await readExpenseDoc(bytes, mime, apiKey);
  } catch (e) {
    await fail(supabase, doc.id, tries, `הקריאה נכשלה: ${(e as Error).message}`);
    return 'failed';
  }

  const s = sortExpense(r, ctx.payers, ctx.rules);
  const update: Record<string, unknown> = {
    content_hash: hash,
    file_size: bytes.length,
    read_status: s.status,
    read_error: null,
    doc_type: textOrNull(r.doc_type, 60),
    doc_number: textOrNull(r.doc_number, 60),
    issuer: textOrNull(r.issuer, 200),
    issuer_tax_id: digitsOnly(r.issuer_tax_id, 20),
    issued_to: textOrNull(r.issued_to, 200),
    issued_to_id: digitsOnly(r.issued_to_id, 20),
    doc_date: dateOf(r.date),
    amount: amountOf(r.amount),
    vat: vatOf(r.vat),
    currency: textOrNull(r.currency, 10),
    allocation_number: digitsOnly(r.allocation_number, 40),
    description: textOrNull(r.description, 300),
    category: textOrNull(r.category, 40),
    supplier_key: s.supplierKey,
    entity: s.entity,
    entity_by: s.entityBy,
    suggested_entity: s.suggested,
    warnings: s.warnings,
    note: s.note,
    updated_at: nowIso(),
  };

  if (s.status === 'done') {
    const me = { id: doc.id, content_hash: hash, supplier_key: s.supplierKey, issuer: update.issuer as string | null, doc_number: update.doc_number as string | null, amount: update.amount as number | null, doc_date: update.doc_date as string | null, entity: s.entity };
    if (s.supplierKey && me.doc_number) {
      const { data: others } = await supabase.from('expense_docs').select('id, content_hash, supplier_key, doc_number, amount').eq('tenant_id', tenantId).eq('supplier_key', s.supplierKey).eq('read_status', 'done').neq('id', doc.id).limit(50);
      const dup = findDuplicate(me, others ?? []);
      if (dup) Object.assign(update, { read_status: 'duplicate', dup_of: dup, note: 'המסמך הזה כבר נקלט' });
    }
    // An invoice and a receipt for the same purchase in one mail: counted once.
    const prefix = mailPrefix(doc.source_ref);
    if (update.read_status === 'done' && prefix && s.supplierKey && me.amount !== null) {
      const { data: sameMail } = await supabase.from('expense_docs').select('id, supplier_key, amount').eq('tenant_id', tenantId).like('source_ref', `${prefix}%`).eq('read_status', 'done').neq('id', doc.id).limit(20);
      const twin = sameMailTwin(me, sameMail ?? []);
      if (twin) Object.assign(update, { read_status: 'duplicate', dup_of: twin, note: 'חשבונית וקבלה על אותה רכישה, באותו מייל — נספר פעם אחת' });
    }
    if (update.read_status === 'done' && me.doc_number) {
      const { data: staff } = await supabase.from('staff_invoices').select('id, issuer, doc_number, amount').eq('tenant_id', tenantId).eq('doc_number', me.doc_number).limit(10);
      const staffDup = findStaffDuplicate(me, staff ?? []);
      if (staffDup) Object.assign(update, { read_status: 'duplicate', staff_invoice_id: staffDup, note: 'כבר במסך "חשבוניות מהצוות"' });
    }
    if (update.read_status === 'done' && me.amount !== null && s.entity !== 'home') {
      const { data: rows } = await supabase.from('morning_expenses').select('account, morning_id, number, amount, doc_date, supplier_name').eq('tenant_id', tenantId).gte('amount', me.amount - 1).lte('amount', me.amount + 1).limit(50);
      const m = matchMorning(me, (rows ?? []) as MorningRow[]);
      if (m) {
        Object.assign(update, { morning_account: m.account, morning_expense_id: m.morning_id });
        if (!s.entity) Object.assign(update, { entity: m.account, entity_by: 'morning', suggested_entity: null });
      }
    }
  }
  await supabase.from('expense_docs').update(update).eq('id', doc.id);
  return 'read';
}

/** Pending documents read, up to `maxReads` (each is one AI call); `ids` limits it to those. */
export async function processPending(supabase: any, tenantId: string, opts: { ids?: string[]; maxReads?: number } = {}): Promise<{ read: number; remaining: number; errors: string[] }> {
  const max = opts.maxReads ?? 4;
  let q = supabase.from('expense_docs').select(DOC_COLS).eq('tenant_id', tenantId).eq('read_status', 'pending').lt('read_tries', MAX_READ_TRIES);
  if (opts.ids?.length) q = q.in('id', opts.ids);
  const { data: docs } = await q.order('created_at', { ascending: true }).limit(max);
  const errors: string[] = [];
  let read = 0;
  if (docs?.length) {
    const ctx = await loadCtx(supabase, tenantId);
    for (const d of docs) {
      try {
        if ((await processDoc(supabase, tenantId, d, ctx)) === 'read') read++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
  }
  let rq = supabase.from('expense_docs').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('read_status', 'pending').lt('read_tries', MAX_READ_TRIES);
  if (opts.ids?.length) rq = rq.in('id', opts.ids);
  const { count } = await rq;
  return { read, remaining: count ?? 0, errors };
}

/** A mail part the script never finished uploading, a day on: given up (shown as failed). */
async function expireUploads(supabase: any, tenantId: string, now: Date) {
  await supabase.from('expense_docs').update({ read_status: 'failed', read_tries: MAX_READ_TRIES, read_error: 'הקובץ לא הגיע מהמייל', updated_at: now.toISOString() })
    .eq('tenant_id', tenantId).eq('read_status', 'waiting_upload').lt('created_at', new Date(now.getTime() - UPLOAD_GRACE_MS).toISOString());
}

// ---------------------------------------------------------------- the group's answer

/** "✅ נקלט: …" in the group for each document of the last day that was read (once each, claimed before sending). */
export async function confirmGroupDocs(supabase: any, tenantId: string, now: Date): Promise<number> {
  const group = await setting(supabase, tenantId, GROUP_KEY);
  if (!group) return 0;
  const off = (await setting(supabase, tenantId, GROUP_CONFIRM_KEY)) === 'off';
  const { data: docs } = await supabase
    .from('expense_docs')
    .select('id, read_status, issuer, doc_type, amount, entity, suggested_entity, note')
    .eq('tenant_id', tenantId)
    .eq('source', 'whatsapp')
    .is('confirmed_at', null)
    .in('read_status', ['done', 'not_expense', 'duplicate', 'failed', 'manual'])
    .gte('received_at', new Date(now.getTime() - CONFIRM_WITHIN_MS).toISOString())
    .order('received_at', { ascending: true })
    .limit(10);
  let sent = 0;
  for (const d of docs ?? []) {
    const { data: claimed } = await supabase.from('expense_docs').update({ confirmed_at: now.toISOString() }).eq('id', d.id).is('confirmed_at', null).select('id');
    if (!claimed?.length || off) continue;
    const res = await sendWhatsApp(supabase, group, confirmText(d), tenantId, { linkPreview: false });
    if (res.success) sent++;
    else console.error('[expenses] group answer', res.error);
  }
  return sent;
}

// ---------------------------------------------------------------- the mailboxes

/**
 * A mail the script reports: its rows (once per part) and an upload address for each file still to come. A link is
 * downloaded when the mail is done; the mail's own body comes as a PDF the script makes.
 */
export async function mailStart(supabase: any, tenantId: string, mailboxId: string, r: MailReport): Promise<{ skip: boolean; uploads: { n: number | 'body'; url: string; mime: string }[] }> {
  if (r.date && r.date.slice(0, 10) < EXPENSES_TRACK_SINCE) return { skip: true, uploads: [] };
  const plan = mailPlan(r);
  const base = { tenant_id: tenantId, source: 'email', mailbox_id: mailboxId, mail_from: r.from || null, mail_subject: r.subject || null, received_at: r.date || nowIso() };
  const uploads: { n: number | 'body'; url: string; mime: string }[] = [];
  const files: { n: number | 'body'; mime: string }[] = [...plan.parts.map((p) => ({ n: p.n, mime: p.mime })), ...(plan.body ? [{ n: 'body' as const, mime: 'application/pdf' }] : [])];
  for (const f of files) {
    const ref = `mail:${mailboxId}:${r.id}:${f.n}`;
    await supabase.from('expense_docs').upsert({ ...base, source_ref: ref, file_mime: f.mime, read_status: 'waiting_upload' }, { onConflict: 'tenant_id,source_ref', ignoreDuplicates: true });
    const { data: row } = await supabase.from('expense_docs').select('id, read_status, file_path').eq('tenant_id', tenantId).eq('source_ref', ref).maybeSingle();
    if (!row || row.read_status !== 'waiting_upload') continue; // already here
    const path = row.file_path || `${tenantId}/${row.id}.${extOfMime(f.mime)}`;
    if (!row.file_path) await supabase.from('expense_docs').update({ file_path: path }).eq('id', row.id);
    const { data: signed, error } = await supabase.storage.from(EXPENSES_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (error || !signed?.signedUrl) throw new Error(`upload address: ${error?.message || 'none'}`);
    uploads.push({ n: f.n, url: signed.signedUrl, mime: f.mime });
  }
  if (plan.link) {
    await supabase.from('expense_docs').upsert(
      { ...base, source_ref: `mail:${mailboxId}:${r.id}:link`, link_url: plan.link.url, provider: plan.link.provider, read_status: 'pending' },
      { onConflict: 'tenant_id,source_ref', ignoreDuplicates: true },
    );
  }
  return { skip: false, uploads };
}

/** The script uploaded a mail's files: they are read now. The rows to read. */
export async function mailDone(supabase: any, tenantId: string, mailboxId: string, gmailId: string): Promise<string[]> {
  const prefix = `mail:${mailboxId}:${gmailId}:`;
  await supabase.from('expense_docs').update({ read_status: 'pending', updated_at: nowIso() })
    .eq('tenant_id', tenantId).like('source_ref', `${prefix}%`).eq('read_status', 'waiting_upload');
  await supabase.from('expense_mailboxes').update({ last_seen_at: nowIso() }).eq('id', mailboxId);
  const { data } = await supabase.from('expense_docs').select('id').eq('tenant_id', tenantId).like('source_ref', `${prefix}%`).eq('read_status', 'pending');
  return (data ?? []).map((d: { id: string }) => d.id);
}

// ---------------------------------------------------------------- Morning (read only)

const MORNING_TIMEOUT_MS = 20_000;

async function morningSearch(token: string, body: unknown): Promise<any | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MORNING_TIMEOUT_MS);
  try {
    const res = await fetch(`${MORNING_API}/expenses/search`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Both businesses' expenses in Morning (read only) → morning_expenses; then the documents are matched again. */
export async function syncMorning(supabase: any, tenantId: string, now = new Date()): Promise<string> {
  const toDate = now.toISOString().slice(0, 10);
  const names = Object.values(MORNING_SETTINGS_KEYS).flatMap((k) => [k.key, k.secret]);
  const { data: secrets } = await supabase.from('tenant_secrets').select('key, value').eq('tenant_id', tenantId).in('key', names);
  const get = (key: string) => String(secrets?.find((s: { key: string }) => s.key === key)?.value || '').trim();
  const said: string[] = [];
  for (const account of ['company', 'sole_prop'] as const) {
    const k = MORNING_SETTINGS_KEYS[account];
    if (!get(k.key) || !get(k.secret)) {
      said.push(`${account}: לא מחובר`);
      continue;
    }
    const login = await fetchMorningToken(get(k.key), get(k.secret));
    if (!login.ok) {
      said.push(`${account}: ההתחברות נכשלה`);
      continue;
    }
    let count = 0;
    for (let page = 1; page <= 20; page++) {
      const answer = await morningSearch(login.token, { page, pageSize: 25, fromDate: MORNING_FROM, toDate });
      if (!answer) {
        said.push(`${account}: החיפוש נכשל בעמוד ${page}`);
        break;
      }
      const items: any[] = Array.isArray(answer?.items) ? answer.items : [];
      const rows = items.map((i) => morningRowOf(i, account)).filter(Boolean).map((r) => ({ tenant_id: tenantId, ...r, synced_at: now.toISOString() }));
      if (rows.length) {
        const { error } = await supabase.from('morning_expenses').upsert(rows, { onConflict: 'tenant_id,account,morning_id' });
        if (error) throw new Error(`morning_expenses: ${error.message}`);
      }
      count += rows.length;
      if (items.length < 25 || page >= Number(answer?.pages || 1)) break;
    }
    said.push(`${account}: ${count}`);
  }
  await upsertSetting(supabase, tenantId, MORNING_SYNCED_KEY, now.toISOString());
  await rematchMorning(supabase, tenantId);
  return said.join(' · ');
}

/** Read documents not matched to Morning yet, matched again (after a copy, or after a business was chosen). */
export async function rematchMorning(supabase: any, tenantId: string): Promise<number> {
  const { data: docs } = await supabase
    .from('expense_docs')
    .select('id, issuer, doc_number, amount, doc_date, entity')
    .eq('tenant_id', tenantId)
    .eq('read_status', 'done')
    .is('morning_expense_id', null)
    .not('amount', 'is', null)
    .limit(500);
  const open = (docs ?? []).filter((d: any) => d.entity !== 'home');
  if (!open.length) return 0;
  const { data: rows } = await supabase.from('morning_expenses').select('account, morning_id, number, amount, doc_date, supplier_name').eq('tenant_id', tenantId).gte('doc_date', MORNING_FROM).limit(5000);
  let n = 0;
  for (const d of open) {
    const m = matchMorning(d, (rows ?? []) as MorningRow[]);
    if (!m) continue;
    const patch: Record<string, unknown> = { morning_account: m.account, morning_expense_id: m.morning_id, updated_at: nowIso() };
    if (!d.entity) Object.assign(patch, { entity: m.account, entity_by: 'morning', suggested_entity: null });
    await supabase.from('expense_docs').update(patch).eq('id', d.id);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- the owner's choice

/** The owner chose the business for a document; `remember` = from now on for this supplier (and the others waiting). */
export async function setEntity(supabase: any, tenantId: string, id: string, entity: ExpenseEntity, remember: boolean): Promise<number> {
  const { data: doc } = await supabase.from('expense_docs').select('*').eq('tenant_id', tenantId).eq('id', id).maybeSingle();
  if (!doc) throw new Error('המסמך לא נמצא');
  const ctx = await loadCtx(supabase, tenantId);
  const patchFor = (d: any, by: 'manual' | 'supplier') => {
    const reading = {
      kind: 'purchase', doc_type: d.doc_type ?? '', doc_number: d.doc_number ?? '', issuer: d.issuer ?? '', issuer_tax_id: d.issuer_tax_id ?? '',
      issued_to: d.issued_to ?? '', issued_to_id: d.issued_to_id ?? '', date: d.doc_date ?? '', amount: d.amount === null ? '' : String(d.amount),
      vat: d.vat === null ? '' : String(d.vat), currency: d.currency ?? '', allocation_number: d.allocation_number ?? '', description: d.description ?? '',
      category: d.category ?? '', card_last4: '',
    } as ExpenseReading;
    const patch: Record<string, unknown> = { entity, entity_by: by, suggested_entity: null, warnings: expenseWarnings(reading, entity, ctx.payers), updated_at: nowIso() };
    // Matched in the other business's Morning: no longer this one.
    if (d.morning_account && d.morning_account !== entity) Object.assign(patch, { morning_account: null, morning_expense_id: null });
    return patch;
  };
  await supabase.from('expense_docs').update(patchFor(doc, 'manual')).eq('id', id);
  let n = 1;
  if (remember && doc.supplier_key) {
    await supabase.from('expense_supplier_rules').upsert(
      { tenant_id: tenantId, supplier_key: doc.supplier_key, supplier_name: doc.issuer, entity, updated_at: nowIso() },
      { onConflict: 'tenant_id,supplier_key' },
    );
    const { data: same } = await supabase.from('expense_docs').select('*').eq('tenant_id', tenantId).eq('supplier_key', doc.supplier_key).eq('read_status', 'done').is('entity', null).neq('id', id).limit(200);
    for (const d of same ?? []) {
      await supabase.from('expense_docs').update(patchFor(d, 'supplier')).eq('id', d.id);
      n++;
    }
  }
  await rematchMorning(supabase, tenantId);
  return n;
}

// ---------------------------------------------------------------- one run

/** The screen's refresh and the hourly tick: the group caught up, documents read, answers sent, Morning copied. */
export async function runExpenses(supabase: any, tenantId: string, opts: { maxReads?: number; now?: Date; morning?: 'auto' | 'force' | 'skip' } = {}): Promise<ExpenseRunResult> {
  const now = opts.now ?? new Date();
  const out: ExpenseRunResult = { collected: 0, read: 0, remaining: 0, confirmed: 0, morning: null, errors: [] };
  try {
    out.collected = await collectGroup(supabase, tenantId);
  } catch (e) {
    out.errors.push(`group: ${(e as Error).message}`);
  }
  await expireUploads(supabase, tenantId, now);
  const read = await processPending(supabase, tenantId, { maxReads: opts.maxReads ?? 4 });
  out.read = read.read;
  out.remaining = read.remaining;
  out.errors.push(...read.errors);
  try {
    out.confirmed = await confirmGroupDocs(supabase, tenantId, now);
  } catch (e) {
    out.errors.push(`answer: ${(e as Error).message}`);
  }
  const mode = opts.morning ?? 'auto';
  if (mode !== 'skip') {
    const last = Date.parse((await setting(supabase, tenantId, MORNING_SYNCED_KEY)) || '') || 0;
    if (mode === 'force' || now.getTime() - last > MORNING_EVERY_MS) {
      try {
        out.morning = await syncMorning(supabase, tenantId, now);
      } catch (e) {
        out.errors.push(`morning: ${(e as Error).message}`);
      }
    } else if (out.read) {
      await rematchMorning(supabase, tenantId);
    }
  }
  return out;
}
