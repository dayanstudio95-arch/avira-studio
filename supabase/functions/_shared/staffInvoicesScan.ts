// "חשבוניות מהצוות" (Avira, 2026-11-02, the owner's request; 0106) — the scan. Run by the screen (staff-invoices, a few
// documents a call until done) and by the hourly automation-engine tick (with reminders):
//   1. "שולם" marks on the work → transfers (one staff member, one day = one transfer).
//   2. The staff chats from TRACK_SINCE: the owner's bank screenshots → transfers (AI reads amount, payer, date);
//      the staff members' invoice links → the PDF downloaded and kept (Paperless's through its page's API; an
//      Invoice4U page is kept as PDF by the gallery Worker, hourly; any other page is saved by hand);
//      their PDFs / photos → read by AI, kept when they are invoices. A message is looked at once (staff_doc_scans).
//   3. Documents uploaded on the screen → read.
//   4. Every unmatched document → its transfer(s); the checks; a transfer is "received" once its documents cover it.
//   5. Reminders to the staff member after 3 and 7 days (working hours, quiet hours, opt-out).
// Pure decisions live in staffInvoices.ts.
import {
  groupMarks, invoiceLink, invoiceTextFacts, invoiceWarnings, last9, matchTransfers, paidMarks, paperlessInfoUrl, paperlessPdfUrl, payerOf, reminderDue,
  reminderHours, reminderText, round2, screenshotOf, STAFF_PAYERS_KEY, TRACK_SINCE, israelDay,
  type Entity, type OpenTransfer, type Payers,
} from './staffInvoices.ts';
import { amountOf, canRead, dateOf, MAX_DOC_BYTES, readDoc, type DocReading } from './staffDocReader.ts';
import { sendWhatsApp } from './whatsapp.ts';
import { isInQuietHoursNow, loadQuietHoursSettings } from './automationGuards.ts';
import { isOptedOut, loadOptOutList } from './whatsappOptOut.ts';

const BUCKET = 'staff-invoices';
const REMINDERS_FROM_KEY = 'staff_invoices_reminders_from';
export const REMINDER_TEMPLATE_KEY = 'template_staff_invoice_reminder';
/** A transfer's note that starts so was closed by the owner (src/lib/staffInvoices.js MANUAL_CLOSE): the scan leaves its status. */
export const MANUAL_CLOSE = 'נסגר ידנית';
/** A link whose PDF couldn't be had: the row waits for the owner (the screen's "נסה שוב" clears it). */
const LINK_FAILED = 'הקישור לא החזיר קובץ — לפתוח ולשמור ידנית';

export interface ScanResult {
  transfers: number;
  invoices: number;
  read: number;
  matched: number;
  reminders: number;
  /** Chat messages still to look at (the screen calls again). */
  remaining: number;
  errors: string[];
}

async function setting(supabase: any, tenantId: string, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
  return data?.value ?? null;
}

/** The studio's own Anthropic key first, then the platform's (like whatsapp-ai-assist). */
async function anthropicKey(supabase: any, tenantId: string): Promise<string | null> {
  const { data } = await supabase.from('tenant_secrets').select('value').eq('tenant_id', tenantId).eq('key', 'anthropic_api_key').limit(1);
  return data?.[0]?.value || Deno.env.get('ANTHROPIC_API_KEY') || null;
}

async function fetchPdf(url: string): Promise<Uint8Array | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (AviraStudio invoice fetch)' } });
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const isPdf = bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
    return isPdf && bytes.length <= MAX_DOC_BYTES ? bytes : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The link's PDF: the file itself, or Paperless's (its page's API names the signed PDF). */
async function linkPdf(link: { url: string; provider: string | null }): Promise<Uint8Array | null> {
  if (link.provider !== 'paperless') return fetchPdf(link.url);
  const info = paperlessInfoUrl(link.url);
  if (!info) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(info, { signal: ctl.signal, headers: { accept: 'application/json', origin: 'https://www.paperless.tax' } });
    const pdf = res.ok ? paperlessPdfUrl(await res.json()) : null;
    return pdf ? await fetchPdf(pdf) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const extOf = (mime: string) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');

export async function runStaffInvoices(supabase: any, tenantId: string, opts: { maxReads?: number; remind?: boolean; now?: Date } = {}): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const result: ScanResult = { transfers: 0, invoices: 0, read: 0, matched: 0, reminders: 0, remaining: 0, errors: [] };
  let budget = opts.maxReads ?? 6;

  let payers: Payers = {};
  try {
    payers = JSON.parse((await setting(supabase, tenantId, STAFF_PAYERS_KEY)) || '{}');
  } catch { /* not set yet: no payer checks */ }
  // The Anthropic key, looked up once and only when something is to be read.
  let keyLookup: Promise<string | null> | null = null;
  const apiKey = () => (keyLookup ??= anthropicKey(supabase, tenantId));
  // Reminders only for transfers from the day the feature first ran (the owner's decision: none for the backlog).
  let remindersFrom = await setting(supabase, tenantId, REMINDERS_FROM_KEY);
  if (!remindersFrom) {
    remindersFrom = israelDay(now.toISOString());
    await supabase.from('app_settings').upsert({ tenant_id: tenantId, key: REMINDERS_FROM_KEY, value: remindersFrom }, { onConflict: 'tenant_id,key' });
  }

  const [{ data: staff }, { data: convs }] = await Promise.all([
    supabase.from('staff_members').select('name, phone_number, extra_phones, invoice_type').eq('tenant_id', tenantId),
    supabase.from('whatsapp_conversations').select('id, phone, chat_id').eq('tenant_id', tenantId).eq('contact_type', 'staff'),
  ]);
  const staffByPhone = new Map<string, { name: string; invoice_type: string | null; phone: string }>();
  // A team member's own number and the others he writes from (a business WhatsApp, 0107).
  for (const s of staff || [])
    for (const ph of [s.phone_number, ...(s.extra_phones || [])])
      if (last9(ph).length === 9) staffByPhone.set(last9(ph), { name: s.name, invoice_type: s.invoice_type, phone: s.phone_number });
  const typeOf = new Map<string, string | null>((staff || []).map((s: any) => [s.name, s.invoice_type]));
  const convStaff = new Map<string, string>();
  for (const c of convs || []) {
    const s = staffByPhone.get(last9(c.phone || c.chat_id));
    if (s) convStaff.set(c.id, s.name);
  }

  // ---- 1. "שולם" marks → transfers
  const { data: transfers0 } = await supabase.from('staff_transfers').select('id, staff_member_name, amount, paid_on, events, message_id, source').eq('tenant_id', tenantId);
  const known = new Set<string>();
  for (const t of transfers0 || []) for (const e of t.events || []) known.add(`${e.eventId}|${e.role}`);
  const { data: events } = await supabase.from('events').select('id, date, venue, team').eq('tenant_id', tenantId).not('team', 'is', null);
  for (const g of groupMarks(paidMarks(events || [], TRACK_SINCE, known))) {
    const evs = g.marks.map((m) => ({ eventId: m.eventId, role: m.role, date: m.date, venue: m.venue, amount: m.amount }));
    // The screenshot of the same payment (cost, or cost + VAT; marked up to 3 weeks apart): the marks join it.
    const twinId = screenshotOf(g, shotsOf(transfers0 || []));
    const twin = twinId ? (transfers0 || []).find((t: any) => t.id === twinId) : null;
    if (twin) {
      twin.events = [...(twin.events || []), ...evs];
      await supabase.from('staff_transfers').update({ events: twin.events, updated_at: now.toISOString() }).eq('id', twin.id);
      continue;
    }
    const { data: row, error } = await supabase.from('staff_transfers').insert({
      tenant_id: tenantId, staff_member_name: g.staff, amount: g.amount, paid_on: g.paidOn, source: 'paid_mark', events: evs,
      reminders_on: g.paidOn >= remindersFrom,
    }).select('id, staff_member_name, amount, paid_on, events, message_id, source').single();
    if (error) result.errors.push(`העברה של ${g.staff}: ${error.message}`);
    else {
      (transfers0 || []).push(row);
      result.transfers++;
    }
  }

  // ---- 2. the staff chats
  const convIds = [...convStaff.keys()];
  if (convIds.length) {
    const [{ data: scanned }, { data: invMsgs }] = await Promise.all([
      supabase.from('staff_doc_scans').select('message_id').eq('tenant_id', tenantId),
      supabase.from('staff_invoices').select('message_id').eq('tenant_id', tenantId).not('message_id', 'is', null),
    ]);
    const seen = new Set<string>([...(scanned || []), ...(invMsgs || []), ...(transfers0 || [])].map((r: any) => r.message_id).filter(Boolean));
    const { data: msgs } = await supabase
      .from('whatsapp_messages')
      .select('id, conversation_id, direction, type_message, body_text, media_path, media_mime, created_at')
      .eq('tenant_id', tenantId)
      .in('conversation_id', convIds)
      .gte('created_at', `${TRACK_SINCE}T00:00:00+03:00`)
      .or('type_message.in.(imageMessage,documentMessage),and(direction.eq.inbound,body_text.ilike.*http*)')
      .order('created_at', { ascending: true })
      .limit(400);
    const todo = (msgs || []).filter((m: any) => !seen.has(m.id));
    const mark = (m: any, kind: string) => supabase.from('staff_doc_scans').upsert({ message_id: m.id, tenant_id: tenantId, kind }, { onConflict: 'message_id' });
    // Messages left for the next call: no reading quota (or no AI key) for them now. Texts go on regardless.
    let later = 0;
    for (const m of todo) {
      const who = convStaff.get(m.conversation_id)!;
      try {
        if (m.type_message !== 'imageMessage' && m.type_message !== 'documentMessage') {
          // A text: an invoice link from the staff member?
          const link = m.direction === 'inbound' ? invoiceLink(m.body_text) : null;
          if (!link) {
            await mark(m, 'other');
            continue;
          }
          if (link.direct && budget <= 0) {
            later++;
            continue;
          }
          const facts = invoiceTextFacts(m.body_text);
          const { data: inv, error } = await supabase.from('staff_invoices').insert({
            tenant_id: tenantId, staff_member_name: who, source: 'whatsapp_link', message_id: m.id, link_url: link.url.slice(0, 2000), provider: link.provider,
            read_status: link.direct ? 'pending' : 'manual', doc_type: facts.docType ?? null, doc_number: facts.docNumber ?? null,
            amount: facts.amount ?? null, allocation_number: facts.allocation ?? null, issued_on: israelDay(m.created_at),
          }).select('id').single();
          if (error) throw error;
          result.invoices++;
          if (link.direct) {
            const pdf = await linkPdf(link);
            if (!pdf) {
              await supabase.from('staff_invoices').update({ read_status: 'manual', note: LINK_FAILED }).eq('id', inv.id);
            } else {
              const path = `${tenantId}/${inv.id}.pdf`;
              await supabase.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
              await supabase.from('staff_invoices').update({ file_path: path, file_mime: 'application/pdf' }).eq('id', inv.id);
              const key = await apiKey();
              if (key) {
                budget--;
                result.read++;
                await applyReading(supabase, inv.id, await readDoc(pdf, 'application/pdf', key), facts);
              }
            }
          }
          continue;
        }
        // A photo or a file.
        const mime = String(m.media_mime || '').split(';')[0].trim().toLowerCase();
        if (!m.media_path || !canRead(mime)) {
          await mark(m, 'other');
          continue;
        }
        const key = budget > 0 ? await apiKey() : null;
        if (!key) {
          later++;
          continue;
        }
        const { data: blob, error: dlErr } = await supabase.storage.from('whatsapp-media').download(m.media_path);
        if (dlErr || !blob) {
          await mark(m, 'failed');
          continue;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        budget--;
        result.read++;
        const r = await readDoc(bytes, mime, key);
        const outbound = m.direction !== 'inbound';
        if (r.kind === 'bank_transfer' && outbound && amountOf(r.amount)) {
          const paidOn = dateOf(r.date) || israelDay(m.created_at);
          const amount = amountOf(r.amount)!;
          const entity = payerOf({ account: r.from_account, name: r.from_name }, payers);
          const fields = { message_id: m.id, entity, bank_reference: r.reference.slice(0, 60) || null, description: r.description.slice(0, 200) || null, updated_at: now.toISOString() };
          // "שולם" marks of the same payment made before it are joined to it below (reconcileMarks).
          const { data: row, error } = await supabase.from('staff_transfers').insert({
            tenant_id: tenantId, staff_member_name: who, amount, paid_on: paidOn, source: 'screenshot', reminders_on: paidOn >= remindersFrom, ...fields,
          }).select('id, staff_member_name, amount, paid_on, events, message_id, source').single();
          if (error) throw error;
          (transfers0 || []).push(row);
          result.transfers++;
          await mark(m, 'transfer');
        } else if (r.kind === 'invoice' && !outbound) {
          const { data: inv, error } = await supabase.from('staff_invoices').insert({
            tenant_id: tenantId, staff_member_name: who, source: 'whatsapp_file', message_id: m.id, file_mime: mime, read_status: 'pending',
          }).select('id').single();
          if (error) throw error;
          const path = `${tenantId}/${inv.id}.${extOf(mime)}`;
          await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
          await supabase.from('staff_invoices').update({ file_path: path }).eq('id', inv.id);
          await applyReading(supabase, inv.id, r, {}, m.created_at);
          result.invoices++;
          await mark(m, 'invoice');
        } else {
          await mark(m, 'other');
        }
      } catch (e) {
        result.errors.push(`הודעה מ${who}: ${(e as Error).message}`.slice(0, 300));
        await mark(m, 'failed');
      }
    }
    result.remaining = later;
  }

  // ---- 2b. Paperless links that came before the scan could fetch them (2026-11-02), or that the owner asked to try
  // again: the PDF kept, the row to "pending" (read just below). One that fails gets the note and waits for the owner.
  const { data: retry } = await supabase.from('staff_invoices').select('id, link_url, provider').eq('tenant_id', tenantId).eq('provider', 'paperless')
    .eq('read_status', 'manual').is('file_path', null).is('note', null).not('link_url', 'is', null).limit(5);
  for (const inv of retry || []) {
    const pdf = await linkPdf({ url: inv.link_url, provider: inv.provider });
    if (!pdf) {
      await supabase.from('staff_invoices').update({ note: LINK_FAILED, updated_at: now.toISOString() }).eq('id', inv.id);
      continue;
    }
    const path = `${tenantId}/${inv.id}.pdf`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true });
    if (error) {
      result.errors.push(error.message.slice(0, 200));
      continue;
    }
    await supabase.from('staff_invoices').update({ file_path: path, file_mime: 'application/pdf', read_status: 'pending', updated_at: now.toISOString() }).eq('id', inv.id);
  }

  // ---- 3. documents uploaded on the screen (or a link's PDF saved by hand, or kept by the gallery Worker)
  const { data: pending } = await supabase.from('staff_invoices').select('id, file_path, file_mime').eq('tenant_id', tenantId).eq('read_status', 'pending').not('file_path', 'is', null).limit(20);
  if ((pending || []).length && budget > 0) {
    const key = await apiKey();
    for (const p of pending || []) {
      if (budget <= 0 || !key) {
        result.remaining++;
        continue;
      }
      try {
        const { data: blob } = await supabase.storage.from(BUCKET).download(p.file_path);
        if (!blob) continue;
        budget--;
        result.read++;
        await applyReading(supabase, p.id, await readDoc(new Uint8Array(await blob.arrayBuffer()), p.file_mime || 'application/pdf', key), {});
      } catch (e) {
        result.errors.push((e as Error).message.slice(0, 200));
        await supabase.from('staff_invoices').update({ read_status: 'failed' }).eq('id', p.id);
      }
    }
  }

  // ---- 4. marks joined to their screenshot (either order; also rows from before this rule), then match, check, close
  await reconcileMarks(supabase, tenantId, now);
  result.matched = await matchAll(supabase, tenantId, payers, typeOf, now);

  // ---- 5. reminders
  if (opts.remind && reminderHours(now)) result.reminders = await sendReminders(supabase, tenantId, staff || [], now);
  return result;
}

/** The transfers read from bank screenshots (a "שולם" transfer joined to one carries its message too). */
const shotsOf = (rows: any[]) => rows.filter((t) => t.message_id).map((t) => ({ id: t.id, staff: t.staff_member_name, amount: Number(t.amount), paidOn: t.paid_on }));

/**
 * "שולם" transfers that are a screenshot's payment (screenshotOf): their works join the screenshot transfer, their
 * documents move to it, and they go — so a payment is counted once whichever came first.
 */
async function reconcileMarks(supabase: any, tenantId: string, now: Date) {
  const { data: trs } = await supabase.from('staff_transfers').select('id, staff_member_name, amount, paid_on, source, message_id, events').eq('tenant_id', tenantId);
  const shots = shotsOf(trs || []);
  for (const mark of (trs || []).filter((t: any) => t.source === 'paid_mark' && !t.message_id)) {
    const twinId = screenshotOf({ staff: mark.staff_member_name, amount: Number(mark.amount), paidOn: mark.paid_on }, shots);
    const twin = twinId ? (trs || []).find((t: any) => t.id === twinId) : null;
    if (!twin) continue;
    const have = new Set((twin.events || []).map((e: any) => `${e.eventId}|${e.role}`));
    twin.events = [...(twin.events || []), ...(mark.events || []).filter((e: any) => !have.has(`${e.eventId}|${e.role}`))];
    await supabase.from('staff_transfers').update({ events: twin.events, updated_at: now.toISOString() }).eq('id', twin.id);
    const { data: links } = await supabase.from('staff_invoice_transfers').select('invoice_id').eq('transfer_id', mark.id);
    for (const l of links || []) {
      await supabase.from('staff_invoice_transfers').upsert({ invoice_id: l.invoice_id, transfer_id: twin.id, tenant_id: tenantId }, { onConflict: 'invoice_id,transfer_id', ignoreDuplicates: true });
    }
    await supabase.from('staff_transfers').delete().eq('id', mark.id);
  }
}

/** What AI read, into the invoice row (the message's own text fills what the document didn't show). */
async function applyReading(supabase: any, id: string, r: DocReading, facts: { docType?: string; docNumber?: string; amount?: number; allocation?: string }, sentAt?: string) {
  if (r.kind !== 'invoice') {
    await supabase.from('staff_invoices').update({ read_status: facts.docNumber ? 'done' : 'not_invoice', updated_at: new Date().toISOString() }).eq('id', id);
    return;
  }
  await supabase.from('staff_invoices').update({
    read_status: 'done',
    doc_type: r.doc_type || facts.docType || null,
    doc_number: r.doc_number || facts.docNumber || null,
    amount: amountOf(r.amount) ?? facts.amount ?? null,
    vat: r.vat === '' ? null : (amountOf(r.vat) ?? (r.vat.trim() === '0' ? 0 : null)),
    allocation_number: r.allocation_number.replace(/\D/g, '') || facts.allocation || null,
    issued_to: r.issued_to || null,
    issued_to_id: r.issued_to_id.replace(/\D/g, '').slice(0, 20) || null,
    issuer: r.issuer || null,
    issued_on: dateOf(r.date) || (sentAt ? israelDay(sentAt) : null),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
}

/** Every document without a transfer → its transfer(s); every linked document's checks; transfers' statuses. */
async function matchAll(supabase: any, tenantId: string, payers: Payers, typeOf: Map<string, string | null>, now: Date): Promise<number> {
  const [{ data: trs }, { data: invs }, { data: links }] = await Promise.all([
    supabase.from('staff_transfers').select('id, staff_member_name, amount, paid_on, entity, status, source, message_id, note').eq('tenant_id', tenantId),
    // A "pending" document (its PDF just arrived, not read yet) still covers the transfer it was linked to.
    supabase.from('staff_invoices').select('id, staff_member_name, read_status, doc_type, amount, vat, allocation_number, issued_to, issued_to_id, issued_on, warnings, created_at').eq('tenant_id', tenantId).in('read_status', ['done', 'manual', 'pending']),
    supabase.from('staff_invoice_transfers').select('invoice_id, transfer_id').eq('tenant_id', tenantId),
  ]);
  const linkRows: { invoice_id: string; transfer_id: string }[] = [...(links || [])];
  const covered = (tid: string) => {
    const docs = linkRows.filter((l) => l.transfer_id === tid).map((l) => (invs || []).find((i: any) => i.id === l.invoice_id)).filter(Boolean);
    return docs.some((d: any) => d.amount === null) ? Infinity : docs.reduce((s: number, d: any) => s + Number(d.amount), 0);
  };
  let matched = 0;
  for (const inv of (invs || []).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (inv.read_status === 'pending' || linkRows.some((l) => l.invoice_id === inv.id)) continue;
    const open: OpenTransfer[] = (trs || [])
      .filter((t: any) => t.staff_member_name === inv.staff_member_name && t.status !== 'not_needed')
      .map((t: any) => ({ id: t.id, amount: Number(t.amount), remaining: round2(Number(t.amount) - Math.min(covered(t.id), Number(t.amount))), paid_on: t.paid_on, beforeVat: t.source === 'paid_mark' && !t.message_id }));
    const ids = matchTransfers(inv.amount === null ? null : Number(inv.amount), inv.issued_on, open);
    if (!ids.length) continue;
    const rows = ids.map((tid) => ({ invoice_id: inv.id, transfer_id: tid, tenant_id: tenantId }));
    const { error } = await supabase.from('staff_invoice_transfers').insert(rows);
    if (!error) {
      linkRows.push(...rows);
      matched++;
    }
  }
  // The checks of every linked document.
  for (const inv of invs || []) {
    if (inv.read_status === 'pending') continue;
    const mine = linkRows.filter((l) => l.invoice_id === inv.id).map((l) => (trs || []).find((t: any) => t.id === l.transfer_id)).filter(Boolean);
    if (!mine.length) continue;
    const warnings = invoiceWarnings(
      { docType: inv.doc_type, amount: inv.amount === null ? null : Number(inv.amount), vat: inv.vat === null ? null : Number(inv.vat), allocation: inv.allocation_number, issuedTo: inv.issued_to, issuedToId: inv.issued_to_id },
      mine.map((t: any) => ({ amount: Number(t.amount), entity: t.entity as Entity | null, beforeVat: t.source === 'paid_mark' && !t.message_id })),
      payers,
      typeOf.get(inv.staff_member_name),
    );
    if (JSON.stringify(warnings) !== JSON.stringify(inv.warnings || [])) await supabase.from('staff_invoices').update({ warnings, updated_at: now.toISOString() }).eq('id', inv.id);
  }
  // Statuses: covered → received; a staff member who issues nothing (by agreement) → not needed.
  for (const t of trs || []) {
    // Closed by the owner (documents short of the amount, and he decided it's fine): stays as he set it.
    if (String(t.note || '').startsWith(MANUAL_CLOSE)) continue;
    let status = t.status;
    if (typeOf.get(t.staff_member_name) === 'none') status = status === 'received' ? status : 'not_needed';
    else if (status !== 'not_needed') status = covered(t.id) >= Number(t.amount) - 1 ? 'received' : 'waiting';
    if (status !== t.status) await supabase.from('staff_transfers').update({ status, updated_at: now.toISOString() }).eq('id', t.id);
  }
  return matched;
}

async function sendReminders(supabase: any, tenantId: string, staff: any[], now: Date): Promise<number> {
  const { data: waiting } = await supabase.from('staff_transfers').select('id, staff_member_name, amount, paid_on, status, reminders_on, reminders_sent, last_reminder_at').eq('tenant_id', tenantId).eq('status', 'waiting').eq('reminders_on', true);
  const due = (waiting || []).filter((t: any) => reminderDue(t, now));
  if (!due.length) return 0;
  const quiet = await loadQuietHoursSettings(supabase, tenantId);
  if (isInQuietHoursNow(quiet)) return 0;
  const optOut = await loadOptOutList(supabase, tenantId);
  const { data: tpl } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', REMINDER_TEMPLATE_KEY).maybeSingle();
  let sent = 0;
  for (const t of due) {
    const member = staff.find((s) => s.name === t.staff_member_name);
    if (!member?.phone_number || member.invoice_type === 'none' || isOptedOut(optOut, member.phone_number)) continue;
    const text = reminderText(tpl?.value, { name: String(member.name).split(' ')[0], amount: Number(t.amount), paidOn: t.paid_on });
    const res = await sendWhatsApp(supabase, member.phone_number, text, tenantId);
    if (!res?.success) continue;
    await supabase.from('staff_transfers').update({ reminders_sent: t.reminders_sent + 1, last_reminder_at: now.toISOString() }).eq('id', t.id);
    sent++;
  }
  return sent;
}
