// "חשבוניות מהצוות" (Avira, 2026-11-02, the owner's request; 0106) — the pure part: which message is an invoice link,
// which business paid (from the bank screenshot), which open transfer(s) a document closes, what the checks find, and
// when a reminder is due. The scan that reads the chats and writes the rows is staffInvoicesScan.ts. Tested in
// test:whatsapp.

export const ENTITY_KEYS = ['company', 'sole_prop'] as const;
export type Entity = (typeof ENTITY_KEYS)[number];

/** The studio's two businesses as invoices must name them (app_settings STAFF_PAYERS_KEY, set on the screen). */
export interface Payer {
  name: string;
  /** ח.פ. / ע.מ. */
  id: string;
  /** The bank account numbers (digits; a part is enough) the screenshots show for this business. */
  accounts: string[];
}
export type Payers = Partial<Record<Entity, Payer>>;
export const STAFF_PAYERS_KEY = 'staff_invoice_payers';

/** Transfers from this day are tracked (the owner's decision). */
export const TRACK_SINCE = '2026-10-01';
/** Reminders to the staff member, days after the transfer (then only the owner sees it). */
export const REMIND_AFTER_DAYS = [3, 7];
export const VAT_RATE = 0.18;
/** An invoice above this, before VAT, needs an allocation number for its VAT to be deductible (from June 2026). */
export const ALLOCATION_THRESHOLD = 5000;

export const DEFAULT_REMINDER_TEMPLATE =
  'היי {staff_name}, תזכורת קטנה 🙏\nעדיין לא קיבלתי חשבונית / קבלה על ההעברה מ-{date} על סך {amount} ₪.\nאפשר לשלוח לי כאן בוואטסאפ? תודה!';

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
// "בע"מ" = "בעמ": quotes go, other punctuation is a space.
const norm = (s: unknown) => String(s ?? '').replace(/["״׳'`]/g, '').replace(/[.,\-–()]/g, ' ').replace(/\s+/g, ' ').trim();
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const fmtAmount = (n: number) => Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 });

// ---------------------------------------------------------------- invoice links

export interface InvoiceLink {
  url: string;
  provider: string;
  /** The link gives the PDF itself (else it opens a page: the document is saved by hand). */
  direct: boolean;
}

const LINKS: { re: RegExp; provider: string; direct: boolean }[] = [
  { re: /https?:\/\/mrng\.to\/[A-Za-z0-9]+/, provider: 'morning', direct: true },
  { re: /https?:\/\/(?:www\.)?greeninvoice\.co\.il\/api\/v1\/documents\/download\?\S+/, provider: 'morning', direct: true },
  { re: /https?:\/\/(?:www\.)?smartbee\.co\.il\/public\/files\/\S+/, provider: 'smartbee', direct: true },
  { re: /https?:\/\/app\.icount\.co\.il\/\S+/, provider: 'icount', direct: true },
  { re: /https?:\/\/(?:www\.)?paperless\.tax\/invoice\?\S+/, provider: 'paperless', direct: false },
  { re: /https?:\/\/newview\.invoice4u\.co\.il\/\S+/, provider: 'invoice4u', direct: false },
];
// Links that are never invoices (photo deliveries and the like).
const NOT_INVOICE = /mab\.to|myairbridge|wetransfer|we\.tl|drive\.google|dropbox|youtu|instagram|facebook|wa\.me|pixieset/i;
const INVOICE_WORDS = /חשבונית|קבלה|invoice|receipt/i;

/** The invoice link in a staff member's message, or null. A known provider, or any link next to "חשבונית / קבלה". */
export function invoiceLink(text: unknown): InvoiceLink | null {
  const t = String(text ?? '');
  for (const l of LINKS) {
    const m = l.re.exec(t);
    if (m) return { url: m[0].replace(/[).,]+$/, ''), provider: l.provider, direct: l.direct };
  }
  if (!INVOICE_WORDS.test(t)) return null;
  const any = /https?:\/\/\S+/.exec(t)?.[0];
  if (!any || NOT_INVOICE.test(any)) return null;
  return { url: any.replace(/[).,]+$/, ''), provider: 'other', direct: false };
}

export interface TextFacts {
  docType?: string;
  docNumber?: string;
  amount?: number;
  allocation?: string;
}

/** What the message itself says ("חשבונית מס קבלה מס' 500284 על סך 2,124.00₪", "מספר הקצאה …"). */
export function invoiceTextFacts(text: unknown): TextFacts {
  // Morning writes "חש׳ מס/קבלה" for short.
  const t = String(text ?? '').replace(/\s+/g, ' ').replace(/חש['׳]\s*מס/g, 'חשבונית מס');
  const out: TextFacts = {};
  const type = /(חשבונית מס\s*\/?\s*קבלה|חשבונית מס|חשבונית עסקה|קבלה)/.exec(t);
  if (type) out.docType = type[1].replace(/\s*\/\s*/, ' ').replace(/\s+/g, ' ');
  const num = /(?:חשבונית מס\s*\/?\s*קבלה|חשבונית מס|חשבונית עסקה|קבלה)\s*(?:מס['׳]?|מספר)?\s*(\d{2,12})/.exec(t);
  if (num) out.docNumber = num[1];
  const amount = /(?:על סך|סך|סכום)\s*:?\s*₪?\s*([\d,]+(?:\.\d{1,2})?)\s*₪?/.exec(t);
  if (amount) out.amount = Number(amount[1].replace(/,/g, ''));
  const alloc = /מספר הקצאה\s*:?\s*(\d[\d ]{7,40}\d)/.exec(t);
  if (alloc) out.allocation = alloc[1].replace(/\s/g, '');
  return out;
}

// ---------------------------------------------------------------- the paying business

/** Hebrew spelling varies ("אוירה" / "אווירה", "צלמים"): words compared without ו and י. */
const words = (s: unknown) => norm(s).replace(/[וי]/g, '').split(' ').filter((w) => w.length >= 2);

/** The same business name: every word of the shorter one in the other ("דיין דניאל-אווירה צלמים" has "דניאל דיין"). */
export function sameName(a: unknown, b: unknown): boolean {
  const [x, y] = [words(a), words(b)];
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.includes(w));
}

/** Which business a transfer came from, by the account or the name the bank screenshot shows. */
export function payerOf(from: { account?: string; name?: string }, payers: Payers): Entity | null {
  const acc = digits(from.account);
  const name = norm(from.name);
  for (const key of ENTITY_KEYS) {
    const p = payers[key];
    if (!p) continue;
    if (acc && p.accounts.some((a) => digits(a).length >= 4 && acc.includes(digits(a)))) return key;
  }
  for (const key of ENTITY_KEYS) {
    const p = payers[key];
    if (p && name && sameName(p.name, name)) return key;
  }
  return null;
}

// ---------------------------------------------------------------- matching

export interface OpenTransfer {
  id: string;
  amount: number;
  /** What its documents so far don't cover. */
  remaining: number;
  paid_on: string;
  /** From "שולם" marks only: the cost before VAT, so its invoice may be that plus VAT. */
  beforeVat?: boolean;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1;
const dayGap = (a: string, b?: string | null) => (b ? Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000 : 0);

/**
 * The open transfer(s) of this staff member a document of `amount` closes: one whose remainder it is, else two or
 * three together (a transfer and its VAT top-up), else one it partly covers (one transfer, two invoices); nearest in
 * date wins a tie. A document without an amount closes the only open transfer. [] = the owner chooses.
 */
export function matchTransfers(amount: number | null | undefined, issuedOn: string | null | undefined, open: OpenTransfer[]): string[] {
  const live = open.filter((t) => t.remaining > 0.5);
  if (!live.length) return [];
  if (amount === null || amount === undefined || !(amount > 0)) return live.length === 1 ? [live[0].id] : [];
  const byDate = (xs: OpenTransfer[]) => [...xs].sort((a, b) => dayGap(a.paid_on, issuedOn) - dayGap(b.paid_on, issuedOn));
  const single = byDate(live.filter((t) => close(t.remaining, amount) || (t.beforeVat && close(round2(t.remaining * (1 + VAT_RATE)), amount))));
  if (single.length) return [single[0].id];
  const n = Math.min(live.length, 12);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (close(live[i].remaining + live[j].remaining, amount)) return [live[i].id, live[j].id];
      for (let k = j + 1; k < n; k++) if (close(live[i].remaining + live[j].remaining + live[k].remaining, amount)) return [live[i].id, live[j].id, live[k].id];
    }
  const partial = byDate(live.filter((t) => t.remaining > amount + 1));
  return partial.length === 1 ? [partial[0].id] : [];
}

// ---------------------------------------------------------------- checks

export interface InvoiceFacts {
  docType?: string | null;
  amount?: number | null;
  vat?: number | null;
  allocation?: string | null;
  issuedTo?: string | null;
  issuedToId?: string | null;
}

/** What the screen warns about a document: amount, the business it was issued to, allocation number, a receipt only. */
export function invoiceWarnings(
  inv: InvoiceFacts,
  linked: { amount: number; entity?: string | null; beforeVat?: boolean }[],
  payers: Payers,
  staffType: string | null | undefined,
): string[] {
  const out: string[] = [];
  const type = String(inv.docType ?? '');
  const isTaxInvoice = /חשבונית/.test(type);
  const total = linked.reduce((s, t) => s + (t.beforeVat ? round2(t.amount * (1 + VAT_RATE)) : t.amount), 0);
  if (inv.amount && linked.length && !close(inv.amount, total) && inv.amount > total + 1)
    out.push(`הסכום במסמך (${fmtAmount(inv.amount)} ₪) גדול מההעברה (${fmtAmount(total)} ₪)`);
  const entity = linked.find((t) => t.entity)?.entity as Entity | undefined;
  const payer = entity ? payers[entity] : undefined;
  if (payer && (inv.issuedToId || inv.issuedTo)) {
    const idOk = inv.issuedToId ? digits(inv.issuedToId) === digits(payer.id) : null;
    const nameOk = inv.issuedTo ? sameName(inv.issuedTo, payer.name) : null;
    if (idOk === false || (idOk === null && nameOk === false)) out.push(`המסמך יצא על שם "${inv.issuedTo || inv.issuedToId}" — ההעברה יצאה מ${payer.name} (${payer.id})`);
  }
  if (staffType !== 'exempt' && isTaxInvoice && inv.amount) {
    const net = inv.vat ? inv.amount - inv.vat : inv.amount / (1 + VAT_RATE);
    if (net > ALLOCATION_THRESHOLD && !digits(inv.allocation)) out.push(`חסר מספר הקצאה — חובה מעל ${fmtAmount(ALLOCATION_THRESHOLD)} ₪ לפני מע״מ, ובלעדיו המע״מ לא יקוזז`);
  }
  if (staffType === 'authorized' && type && !isTaxInvoice) out.push('התקבלה קבלה בלבד — מעוסק מורשה צריך חשבונית מס (או חשבונית מס קבלה)');
  if (staffType === 'authorized' && isTaxInvoice && inv.vat === 0) out.push('אין מע״מ בחשבונית — מעוסק מורשה צריך חשבונית עם מע״מ');
  return out;
}

/** The VAT inside a gross amount (what can't be deducted while the invoice is missing). */
export const vatInside = (gross: number) => round2((gross * VAT_RATE) / (1 + VAT_RATE));

// ---------------------------------------------------------------- "שולם" marks → transfers

export interface PaidMark {
  staff: string;
  eventId: string;
  role: string;
  date: string;
  venue: string;
  amount: number;
  paidOn: string;
}

interface EventRow {
  id: string;
  date?: string | null;
  venue?: string | null;
  team?: unknown;
}

/** Israel's calendar day of an instant ("2026-10-28T22:30Z" → "2026-10-29"). */
export function israelDay(iso: string | null | undefined): string {
  const d = new Date(String(iso ?? ''));
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Every paid work from `since` on (a role with a cost marked "שולם"), not yet in a transfer (`known`: "eventId|role"). */
export function paidMarks(events: EventRow[], since: string, known: Set<string>): PaidMark[] {
  const out: PaidMark[] = [];
  for (const e of events) {
    for (const t of Array.isArray(e.team) ? e.team : []) {
      const m = t as { staffMemberName?: string; role?: string; isPaid?: boolean; paidAt?: string; cost?: number };
      const amount = Number(m.cost) || 0;
      const paidOn = israelDay(m.paidAt);
      if (!m.isPaid || amount <= 0 || !m.staffMemberName || !paidOn || paidOn < since) continue;
      if (known.has(`${e.id}|${m.role}`)) continue;
      out.push({ staff: m.staffMemberName.trim(), eventId: e.id, role: String(m.role ?? ''), date: String(e.date ?? '').slice(0, 10), venue: String(e.venue ?? ''), amount, paidOn });
    }
  }
  return out;
}

/** Marks of one staff member on one day are one transfer. */
export function groupMarks(marks: PaidMark[]): { staff: string; paidOn: string; amount: number; marks: PaidMark[] }[] {
  const groups = new Map<string, { staff: string; paidOn: string; amount: number; marks: PaidMark[] }>();
  for (const m of marks) {
    const key = `${m.staff}|${m.paidOn}`;
    const g = groups.get(key) ?? { staff: m.staff, paidOn: m.paidOn, amount: 0, marks: [] };
    g.amount = round2(g.amount + m.amount);
    g.marks.push(m);
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** How far apart a "שולם" mark and the bank transfer can be (the owner sometimes marks days later). */
export const MARK_WINDOW_DAYS = 21;

/**
 * The screenshot transfer that "שולם" marks belong to: the same staff member's, nearest in date, whose amount is the
 * marks' cost — or that plus VAT (an authorized dealer is paid cost + 18%) — within MARK_WINDOW_DAYS; else one made
 * within 3 days of the marks. null = the marks are a payment of their own (no screenshot of it).
 */
export function screenshotOf(
  marks: { staff: string; amount: number; paidOn: string },
  shots: { id: string; staff: string; amount: number; paidOn: string }[],
): string | null {
  const mine = shots.filter((s) => norm(s.staff) === norm(marks.staff)).sort((a, b) => dayGap(a.paidOn, marks.paidOn) - dayGap(b.paidOn, marks.paidOn));
  const byAmount = mine.find((s) => dayGap(s.paidOn, marks.paidOn) <= MARK_WINDOW_DAYS && (close(s.amount, marks.amount) || close(s.amount, round2(marks.amount * (1 + VAT_RATE)))));
  if (byAmount) return byAmount.id;
  return mine.find((s) => dayGap(s.paidOn, marks.paidOn) <= 3)?.id ?? null;
}

// ---------------------------------------------------------------- reminders

export interface ReminderState {
  status: string;
  reminders_on: boolean;
  reminders_sent: number;
  last_reminder_at?: string | null;
  paid_on: string;
}

/** A reminder is due: still waiting, reminders on, the next step's days have passed, and none in the last 2 days. */
export function reminderDue(t: ReminderState, now: Date): boolean {
  if (t.status !== 'waiting' || !t.reminders_on || t.reminders_sent >= REMIND_AFTER_DAYS.length) return false;
  const age = (now.getTime() - Date.parse(`${t.paid_on}T09:00:00+03:00`)) / 86_400_000;
  if (age < REMIND_AFTER_DAYS[t.reminders_sent]) return false;
  return !t.last_reminder_at || now.getTime() - Date.parse(t.last_reminder_at) > 2 * 86_400_000;
}

/** Reminders go out on working hours only: Sunday–Thursday, 10:00–18:00 Israel time. */
export function reminderHours(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  const day = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? -1) % 24;
  return !['Fri', 'Sat'].includes(day) && hour >= 10 && hour < 18;
}

/** "2026-10-28" → "28/10". */
export const shortDay = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

export function reminderText(template: string | null | undefined, v: { name: string; amount: number; paidOn: string }): string {
  return (template?.trim() ? template : DEFAULT_REMINDER_TEMPLATE)
    .replace(/\{staff_name\}|\{\{staff_name\}\}/g, v.name)
    .replace(/\{amount\}|\{\{amount\}\}/g, fmtAmount(v.amount))
    .replace(/\{date\}|\{\{date\}\}/g, shortDay(v.paidOn));
}

/** "0501234567" / "972501234567@c.us" → "501234567" (how a chat and a team member are the same person). */
export const last9 = (phone: unknown) => digits(String(phone ?? '').split('@')[0]).slice(-9);
