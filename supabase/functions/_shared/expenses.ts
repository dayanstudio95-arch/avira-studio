// "מרכז הוצאות", step 1 (Avira, 2026-11-23, the owner approved the plan; 0117) — the pure part:
//   - which WhatsApp message in the "קבלות" group is a document, and what a Gmail script's report holds;
//   - which business a document belongs to (the owner's decisions of 2026-11-23):
//       issued to the company (its ח.פ. or name) → the company, always;
//       the owner's rule for this supplier → that business;
//       else nothing yet: the AI suggests (home bills → home, the rest → עוסק) and the owner confirms ONCE for the
//       supplier — the עוסק's number is the owner's ID number, the same one home bills carry, so "לכבוד" alone
//       can't tell them apart. What his wife sends is sorted the same way;
//   - what is wrong with it (no amount, not a tax document, a foreign currency, no allocation number);
//   - the same document twice, and the expense already in Morning;
//   - the short answer in the group ("✅ נקלט: דלק ₪412 · עוסק").
// The impure side (downloads, AI, Morning, the group answer) is expenseIntake.ts. Tested in test:whatsapp ("expenses").
import { ALLOCATION_THRESHOLD, VAT_RATE, fmtAmount, invoiceLink, round2, sameName, type InvoiceLink, type Payers } from './staffInvoices.ts';

export const EXPENSE_ENTITIES = ['company', 'sole_prop', 'home'] as const;
export type ExpenseEntity = (typeof EXPENSE_ENTITIES)[number];
export const ENTITY_SHORT: Record<ExpenseEntity, string> = { company: 'חברה', sole_prop: 'עוסק', home: 'בית' };
export const isExpenseEntity = (v: unknown): v is ExpenseEntity => EXPENSE_ENTITIES.includes(v as ExpenseEntity);

/** Documents from this day are collected (the owner's decision, 2026-11-23). */
export const EXPENSES_TRACK_SINCE = '2026-11-01';
export const EXPENSES_BUCKET = 'expense-docs';
/** The studio's "קבלות" group (its chat id), chosen on the screen. */
export const GROUP_KEY = 'expenses_group_chat_id';
/** 'off' = no "✅ נקלט" answer in the group; anything else = answer. */
export const GROUP_CONFIRM_KEY = 'expenses_group_confirm';
export const MORNING_SYNCED_KEY = 'expenses_morning_synced_at';
/** A document whose reading failed this many times waits for the owner ("נסה שוב"). */
export const MAX_READ_TRIES = 3;
/** The group's answer only for documents that came in the last day (a late catch-up never answers old messages). */
export const CONFIRM_WITHIN_MS = 24 * 3600_000;
/** Files above this are not read (the AI reader's limit, like the staff invoices). */
export const MAX_EXPENSE_BYTES = 10 * 1024 * 1024;

export const READABLE_MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const isReadableMime = (m: unknown) => READABLE_MIMES.includes(String(m || '').toLowerCase());
export const extOfMime = (mime: string) => (mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg');

/** What AI reads from one document (expenseDocReader.ts). Every field is a string; '' = not on the document. */
export interface ExpenseReading {
  /** purchase: an invoice / receipt / bill for something bought; payment_proof: a transfer screenshot or card slip;
   *  other: anything else (a photo, a chat screenshot, an ad). */
  kind: 'purchase' | 'payment_proof' | 'other';
  doc_type: string;
  doc_number: string;
  issuer: string;
  issuer_tax_id: string;
  issued_to: string;
  issued_to_id: string;
  date: string;
  amount: string;
  vat: string;
  currency: string;
  allocation_number: string;
  description: string;
  category: string;
  card_last4: string;
}

/** The categories the reader picks from; 'home' is a household bill (the suggestion for "בית"). */
export const CATEGORIES = [
  'home', 'fuel', 'car', 'equipment', 'software', 'printing', 'food', 'travel', 'office', 'marketing', 'professional',
  'insurance', 'communication', 'staff', 'other',
] as const;

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** "2,124.00 ₪" → 2124; '' / junk → null. */
export function amountOf(s: unknown): number | null {
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

/** A real YYYY-MM-DD date, or null. */
export function dateOf(s: unknown): string | null {
  const t = String(s ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? null : t;
}

// ---------------------------------------------------------------- the supplier

// \b is ASCII-only, so the suffixes are cut by spaces ("בע"מ" is "בעמ" once the quotes are gone).
const SUFFIXES = /(^|\s)(?:בעמ|בע מ|ltd|inc|llc|limited)(?=\s|$)/gi;
const normName = (s: unknown) =>
  String(s ?? '')
    .replace(/["״׳'`]/g, '')
    .replace(/[.,\-–()/\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(SUFFIXES, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** The supplier as the rules know it: its tax id (8–9 digits), else its normalised name; null when there is neither. */
export function supplierKey(issuer: unknown, issuerTaxId: unknown): string | null {
  const id = digits(issuerTaxId);
  if (id.length >= 8 && id.length <= 9) return `id:${id.padStart(9, '0')}`;
  const name = normName(issuer);
  return name.length >= 2 ? `name:${name.slice(0, 190)}` : null;
}

const sameId = (a: unknown, b: unknown) => {
  const [x, y] = [digits(a), digits(b)];
  return x.length >= 8 && y.length >= 8 && x.padStart(9, '0') === y.padStart(9, '0');
};

/** The same business by name — only for names of two words or more ("צילום" alone is some other business). */
const sameFullName = (a: unknown, b: unknown) => normName(a).split(' ').filter((w) => w.length >= 2).length >= 2 && sameName(a, b);

/** One of the studio's own businesses issued it (an invoice to a client: income, not an expense). */
export function isOwnBusiness(name: unknown, taxId: unknown, payers: Payers): boolean {
  return Object.values(payers || {}).some((p) => p && (sameId(taxId, p.id) || sameFullName(name, p.name)));
}

/** Issued to the company: its ח.פ., or its name. */
export function issuedToCompany(r: Pick<ExpenseReading, 'issued_to' | 'issued_to_id'>, payers: Payers): boolean {
  const c = payers?.company;
  if (!c) return false;
  return sameId(r.issued_to_id, c.id) || sameFullName(r.issued_to, c.name);
}

/** The AI's suggestion when nothing decides it: a household bill → home, anything else → the עוסק. */
export const suggestEntity = (category: unknown): ExpenseEntity => (category === 'home' ? 'home' : 'sole_prop');

const NOT_TAX_DOC = /הצעת מחיר|הזמנת|הזמנה|חשבון עסקה|חשבונית עסקה|פרופורמה|proforma|quote|quotation/i;
const TAX_INVOICE = /חשבונית מס|tax invoice/i;

/** What the owner should know about the document, in the screen's words. */
export function expenseWarnings(r: ExpenseReading, entity: ExpenseEntity | null, payers: Payers): string[] {
  const out: string[] = [];
  const amount = amountOf(r.amount);
  if (amount === null) out.push('לא נמצא סכום — לבדוק במסמך');
  if (NOT_TAX_DOC.test(r.doc_type)) out.push(`"${r.doc_type}" הוא לא מסמך מס — צריך את החשבונית / הקבלה עצמה`);
  const cur = String(r.currency ?? '').trim();
  if (cur && !/^(ils|nis|₪|ש"ח|שח|שקל|שקלים)$/i.test(cur)) out.push(`סכום במטבע ${cur}`);
  if (entity === 'company' && String(r.issued_to ?? '').trim() && !issuedToCompany(r, payers)) {
    out.push(`הונפק ל"${r.issued_to}" ולא לחברה — המע״מ לא יוכר בחברה`);
  }
  if ((entity === 'company' || entity === 'sole_prop') && amount !== null && TAX_INVOICE.test(r.doc_type) && !digits(r.allocation_number)) {
    const vat = amountOf(r.vat);
    const net = vat !== null ? amount - vat : amount / (1 + VAT_RATE);
    if (net > ALLOCATION_THRESHOLD) out.push(`חשבונית מעל ₪${fmtAmount(ALLOCATION_THRESHOLD)} לפני מע״מ בלי מספר הקצאה — המע״מ לא יוכר`);
  }
  return out.slice(0, 10);
}

export interface Sorting {
  status: 'done' | 'not_expense';
  entity: ExpenseEntity | null;
  entityBy: 'issued_to' | 'supplier' | null;
  suggested: ExpenseEntity | null;
  supplierKey: string | null;
  warnings: string[];
  /** Why it isn't an expense (shown on the row). */
  note: string | null;
}

/** Where a read document goes (the owner's rules, 2026-11-23). `rules`: supplier key → business. */
export function sortExpense(r: ExpenseReading, payers: Payers, rules: Record<string, ExpenseEntity>): Sorting {
  const key = supplierKey(r.issuer, r.issuer_tax_id);
  const base = { entity: null, entityBy: null, suggested: null, supplierKey: key, warnings: [] as string[] };
  if (r.kind === 'payment_proof') return { ...base, status: 'not_expense', note: 'אישור תשלום, לא חשבונית — החשבונית עצמה צריכה להגיע בנפרד' };
  if (r.kind !== 'purchase') return { ...base, status: 'not_expense', note: 'לא נראה כמו מסמך הוצאה' };
  if (isOwnBusiness(r.issuer, r.issuer_tax_id, payers)) {
    return { ...base, status: 'not_expense', note: 'מסמך שהעסק שלך הוציא — הכנסה, לא הוצאה' };
  }
  let entity: ExpenseEntity | null = null;
  let entityBy: Sorting['entityBy'] = null;
  if (issuedToCompany(r, payers)) [entity, entityBy] = ['company', 'issued_to'];
  else if (key && isExpenseEntity(rules[key])) [entity, entityBy] = [rules[key], 'supplier'];
  return {
    status: 'done',
    entity,
    entityBy,
    suggested: entity ? null : suggestEntity(r.category),
    supplierKey: key,
    warnings: expenseWarnings(r, entity, payers),
    note: null,
  };
}

// ---------------------------------------------------------------- the same document twice

export interface DocLike {
  id?: string;
  content_hash?: string | null;
  supplier_key?: string | null;
  issuer?: string | null;
  doc_number?: string | null;
  amount?: number | string | null;
  doc_date?: string | null;
  entity?: ExpenseEntity | null;
}

const near = (a: unknown, b: unknown, tol = 1) => {
  const [x, y] = [Number(a), Number(b)];
  return a !== null && b !== null && a !== undefined && b !== undefined && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) <= tol;
};
const sameNumber = (a: unknown, b: unknown) => digits(a) !== '' && digits(a) === digits(b);

/** An earlier row that is this same document: the same file, or the same supplier + number + amount. */
export function findDuplicate(doc: DocLike, others: DocLike[]): string | null {
  for (const o of others) {
    if (!o.id || o.id === doc.id) continue;
    if (doc.content_hash && o.content_hash === doc.content_hash) return o.id;
    if (doc.supplier_key && o.supplier_key === doc.supplier_key && sameNumber(doc.doc_number, o.doc_number) && near(doc.amount, o.amount)) return o.id;
  }
  return null;
}

/** The same document already in "חשבוניות מהצוות" (a team member's invoice that also came by mail). */
export function findStaffDuplicate(doc: DocLike, staff: { id: string; issuer?: string | null; doc_number?: string | null; amount?: number | string | null }[]): string | null {
  for (const s of staff) {
    if (sameNumber(doc.doc_number, s.doc_number) && near(doc.amount, s.amount) && (!s.issuer || !doc.issuer || sameName(doc.issuer, s.issuer))) return s.id;
  }
  return null;
}

// ---------------------------------------------------------------- already in Morning

export interface MorningRow {
  account: 'company' | 'sole_prop';
  morning_id: string;
  number?: string | null;
  amount?: number | string | null;
  doc_date?: string | null;
  supplier_name?: string | null;
}

const dayDiff = (a: unknown, b: unknown) => {
  const [x, y] = [Date.parse(`${a}T00:00:00Z`), Date.parse(`${b}T00:00:00Z`)];
  return Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) / 86400000 : Infinity;
};

/**
 * The Morning expense that is this document: in the business it was sorted to (either one while it is not sorted;
 * none for home) — the same number and amount, else the same supplier, amount and a date within a week. A document
 * not sorted yet that is found in BOTH businesses is not matched (the owner decides).
 */
export function matchMorning(doc: DocLike, rows: MorningRow[]): MorningRow | null {
  if (doc.entity === 'home') return null;
  const accounts = doc.entity === 'company' || doc.entity === 'sole_prop' ? [doc.entity] : ['company', 'sole_prop'];
  const pool = rows.filter((r) => accounts.includes(r.account) && near(r.amount, doc.amount));
  const exact = pool.filter((r) => sameNumber(r.number, doc.doc_number));
  const loose = exact.length ? exact : pool.filter((r) => doc.issuer && r.supplier_name && sameName(doc.issuer, r.supplier_name) && dayDiff(r.doc_date, doc.doc_date) <= 7);
  if (!loose.length) return null;
  if (!doc.entity && new Set(loose.map((r) => r.account)).size > 1) return null;
  return loose[0];
}

/** One expense from Morning's /expenses/search answer → a row (null when it has no id). */
export function morningRowOf(item: any, account: 'company' | 'sole_prop'): MorningRow & { vat: number | null; document_type: number | null; status: number | null } | null {
  const id = item?.id;
  if (id === undefined || id === null || String(id).trim() === '') return null;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : round2(Number(v)));
  const int = (v: unknown) => (Number.isInteger(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  return {
    account,
    morning_id: String(id).slice(0, 80),
    doc_date: dateOf(String(item?.date ?? '').slice(0, 10)),
    number: item?.number === undefined || item?.number === null ? null : String(item.number).slice(0, 60),
    amount: num(item?.amount),
    vat: num(item?.vat),
    supplier_name: item?.supplier?.name ? String(item.supplier.name).slice(0, 200) : null,
    document_type: int(item?.documentType),
    status: int(item?.status),
  };
}

// ---------------------------------------------------------------- where documents come from

export interface GroupMessage {
  id: string;
  direction?: string | null;
  type_message?: string | null;
  body_text?: string | null;
  media_url?: string | null;
  media_path?: string | null;
  media_mime?: string | null;
  sender_name?: string | null;
  created_at?: string | null;
}

/** What a message in the "קבלות" group carries: a readable file (a photo / PDF), an invoice link, or nothing. */
export function groupDocOf(m: GroupMessage): { kind: 'file'; mime: string } | { kind: 'link'; link: InvoiceLink } | null {
  const mime = String(m.media_mime || '').toLowerCase().split(';')[0].trim();
  if (mime && isReadableMime(mime)) return { kind: 'file', mime };
  // A photo whose copy is not in yet: Green API sends images as JPEG.
  if (!mime && m.type_message === 'imageMessage' && (m.media_path || m.media_url)) return { kind: 'file', mime: 'image/jpeg' };
  const link = invoiceLink(m.body_text);
  return link ? { kind: 'link', link } : null;
}

/** Who posted it, for the row: the name WhatsApp gave, else the studio's own number. */
export const groupSenderName = (m: GroupMessage) => String(m.sender_name || '').trim().slice(0, 120) || (m.direction === 'inbound' ? '' : 'מספר הסטודיו');

export interface MailPart {
  n: number;
  name: string;
  mime: string;
  size: number;
}

export interface MailReport {
  id: string;
  from: string;
  subject: string;
  date: string | null;
  text: string;
  parts: MailPart[];
  /** The mail's body can be sent as a PDF (Apps Script converts it). */
  html: boolean;
}

const RECEIPT_SUBJECT = /חשבונית|קבלה|invoice|receipt|payment|תשלום|חיוב/i;

/** A Gmail script's report of one mail, checked: what the server takes (readable files up to the limit). */
export function parseMailReport(body: any): MailReport | null {
  const m = body?.mail;
  const id = String(m?.id ?? '').trim();
  if (!/^[\w-]{6,100}$/.test(id)) return null;
  const parts: MailPart[] = (Array.isArray(m?.parts) ? m.parts : [])
    .slice(0, 10)
    .map((p: any) => ({ n: Number(p?.n), name: String(p?.name ?? '').slice(0, 200), mime: String(p?.mime ?? '').toLowerCase(), size: Number(p?.size) || 0 }))
    .filter((p: MailPart) => Number.isInteger(p.n) && p.n >= 0 && p.n < 50 && isReadableMime(p.mime) && p.size > 0 && p.size <= MAX_EXPENSE_BYTES);
  const date = String(m?.date ?? '');
  return {
    id,
    from: String(m?.from ?? '').slice(0, 300),
    subject: String(m?.subject ?? '').slice(0, 300),
    date: Number.isNaN(Date.parse(date)) ? null : new Date(date).toISOString(),
    text: String(m?.text ?? '').slice(0, 8000),
    parts,
    html: m?.html === true,
  };
}

/**
 * What to take from a mail: its readable attachments; else an invoice link in its text; else, when the subject says
 * it is a receipt / invoice, the mail itself as a PDF (online receipts come as the mail's body).
 * Any other link counts only when the SUBJECT says invoice / receipt (2026-11-23, the first run on the owner's
 * mailbox: a newsletter that mentions "invoice" next to a link came in as a document); Morning / Paperless / SmartBee /
 * iCount / Invoice4U links always count.
 */
export function mailPlan(r: MailReport): { parts: MailPart[]; link: InvoiceLink | null; body: boolean } {
  if (r.parts.length) return { parts: r.parts, link: null, body: false };
  const subjectSays = RECEIPT_SUBJECT.test(r.subject);
  const link = invoiceLink(`${r.subject}\n${r.text}`);
  if (link && (link.provider !== 'other' || subjectSays)) return { parts: [], link, body: false };
  return { parts: [], link: null, body: r.html && subjectSays };
}

/** "mail:<mailbox>:<gmail id>:" — the parts of one mail share it; null for a document that did not come by mail. */
export function mailPrefix(sourceRef: unknown): string | null {
  const m = /^(mail:[^:]+:[^:]+:)/.exec(String(sourceRef ?? ''));
  return m ? m[1] : null;
}

/**
 * The same purchase twice in one mail: an invoice and a receipt for it (Stripe-style mails attach both) — the same
 * supplier and the same amount. The earlier one stays; this one is a duplicate. Documents without an amount (a
 * ticket per passenger) are never twins.
 */
export function sameMailTwin(doc: DocLike, others: DocLike[]): string | null {
  if (!doc.supplier_key || doc.amount === null || doc.amount === undefined) return null;
  for (const o of others) {
    if (o.id && o.id !== doc.id && o.supplier_key === doc.supplier_key && near(o.amount, doc.amount)) return o.id;
  }
  return null;
}

/** The mailbox's label on the screen and in the row: "avira.media1" for avira.media1@gmail.com. */
export const mailboxShort = (label: unknown) => String(label ?? '').split('@')[0].trim().slice(0, 60);

// ---------------------------------------------------------------- the group's answer

export interface ConfirmDoc {
  read_status: string;
  issuer?: string | null;
  doc_type?: string | null;
  amount?: number | string | null;
  entity?: ExpenseEntity | null;
  suggested_entity?: ExpenseEntity | null;
  note?: string | null;
}

/** "✅ נקלט: דלק ₪412 · עוסק" — the short answer in the group after a document is read. */
export function confirmText(d: ConfirmDoc): string {
  const what = String(d.issuer || d.doc_type || 'מסמך').trim().slice(0, 60);
  const amount = amountOf(d.amount);
  const sum = amount !== null ? ` ₪${fmtAmount(amount)}` : '';
  if (d.read_status === 'duplicate') return `🔁 כבר קיים במערכת: ${what}${sum}`;
  if (d.read_status === 'not_expense') return `⚪ לא נקלט כהוצאה: ${d.note || 'לא נראה כמו חשבונית או קבלה'}`;
  if (d.read_status === 'failed' || d.read_status === 'manual') return '⚠️ לא הצלחתי לקרוא את המסמך — אפשר לבדוק במסך "הוצאות"';
  if (d.entity) return `✅ נקלט: ${what}${sum} · ${ENTITY_SHORT[d.entity]}`;
  return `✅ נקלט: ${what}${sum} · לבחור עסק במסך "הוצאות"`;
}
