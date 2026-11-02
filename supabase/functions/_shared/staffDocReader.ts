// Reads one document from a staff chat (Avira, 2026-11-02; "חשבוניות מהצוות", 0106): the owner's bank-transfer
// screenshot, or a staff member's invoice / receipt (PDF or photo). One Messages API call with a JSON-schema output, so
// the fields always come back in the same shape; every field is a string ('' = not on the document). Plain fetch, like
// _shared/anthropic.ts (the project's way of calling the API from the Deno runtime).
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
/** A larger file is not sent (the API allows 32MB a request; a phone screenshot or an invoice PDF is far smaller). */
export const MAX_DOC_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export interface DocReading {
  kind: 'bank_transfer' | 'invoice' | 'other';
  amount: string;
  date: string;
  reference: string;
  from_name: string;
  from_account: string;
  to_name: string;
  description: string;
  doc_type: string;
  doc_number: string;
  vat: string;
  allocation_number: string;
  issued_to: string;
  issued_to_id: string;
  issuer: string;
}

const FIELDS = ['amount', 'date', 'reference', 'from_name', 'from_account', 'to_name', 'description', 'doc_type', 'doc_number', 'vat', 'allocation_number', 'issued_to', 'issued_to_id', 'issuer'] as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', ...FIELDS],
  properties: {
    kind: { type: 'string', enum: ['bank_transfer', 'invoice', 'other'] },
    ...Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])),
  },
};

const SYSTEM = `You read one document for an Israeli photography studio's bookkeeping. Decide what it is and copy its fields exactly as printed.

kind:
- "bank_transfer": a bank app's confirmation that money was sent ("הפעולה בוצעה בהצלחה", "ההעברה בוצעה בהצלחה", "העברה לחשבון אחר").
- "invoice": a tax invoice, tax invoice-receipt or receipt issued by a business (חשבונית מס, חשבונית מס קבלה, קבלה, חשבונית עסקה).
- "other": anything else (photos, chat screenshots, price lists, contracts). Then leave every other field "".

Fields (use "" when the document doesn't show it; never guess):
- amount: the total in shekels as digits with an optional decimal point, no commas or symbols ("2124" or "2124.50"). Invoice: the grand total including VAT. Transfer: the amount sent, without fees.
- date: YYYY-MM-DD. Transfer: when it was executed. Invoice: the issue date.
- reference: the transfer's reference number (מס' אסמכתא).
- from_name, from_account: the paying account's holder name and account number as shown (e.g. "615-027088").
- to_name: who received the transfer.
- description: the transfer's description (תיאור העברה), if any.
- doc_type: the document's title in Hebrew as printed (e.g. "חשבונית מס קבלה", "קבלה").
- doc_number: the document's number.
- vat: the VAT amount (מע"מ) in the same number format, "0" if the document says no VAT.
- allocation_number: מספר הקצאה, digits only.
- issued_to, issued_to_id: the customer the document was issued to (לכבוד / שם הלקוח) and their ח.פ. / ע.מ. / ת.ז.
- issuer: the business that issued the document.`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** "application/pdf" → a document block; an image type → an image block; anything else can't be read. */
export function canRead(mime: string): boolean {
  return mime === 'application/pdf' || IMAGE_TYPES.includes(mime);
}

const EMPTY: DocReading = { kind: 'other', ...Object.fromEntries(FIELDS.map((f) => [f, ''])) } as DocReading;

export async function readDoc(bytes: Uint8Array, mime: string, apiKey: string): Promise<DocReading> {
  if (!canRead(mime)) throw new Error(`סוג קובץ שלא נקרא: ${mime}`);
  if (bytes.length > MAX_DOC_BYTES) throw new Error('הקובץ גדול מדי לקריאה');
  const data = toBase64(bytes);
  const block = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data } };
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      // A policy decline goes on to the next model on its own (refusals are unlikely on a receipt, but cost nothing).
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      // A reading task: low effort is enough.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
      messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this document.' }] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${(await res.text().catch(() => '')).slice(0, 300)}`);
  const out = await res.json();
  if (out.stop_reason === 'refusal') return EMPTY;
  const text = (out.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '';
  const parsed = JSON.parse(text) as Partial<DocReading>;
  const reading = { ...EMPTY, ...parsed } as DocReading;
  if (!['bank_transfer', 'invoice', 'other'].includes(reading.kind)) reading.kind = 'other';
  for (const f of FIELDS) reading[f] = String(reading[f] ?? '').trim().slice(0, 200);
  return reading;
}

/** "2,124.00" → 2124; '' / junk → null. */
export function amountOf(s: string): number | null {
  const n = Number(String(s ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

/** A YYYY-MM-DD date the reading gave, or null. */
export function dateOf(s: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '')) ? s : null;
}
