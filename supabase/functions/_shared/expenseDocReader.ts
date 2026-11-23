// Reads one expense document for "מרכז הוצאות" (Avira, 2026-11-23; 0117): a receipt photo, an invoice PDF, a bill.
// One Messages API call with a JSON-schema output (the same way as staffDocReader.ts, which reads the team's
// invoices): the fields always come back in the same shape, every one a string ('' = not on the document).
import { canRead, MAX_DOC_BYTES } from './staffDocReader.ts';
import { CATEGORIES, type ExpenseReading } from './expenses.ts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';

const FIELDS = [
  'doc_type', 'doc_number', 'issuer', 'issuer_tax_id', 'issued_to', 'issued_to_id', 'date', 'amount', 'vat', 'currency',
  'allocation_number', 'description', 'card_last4',
] as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'category', ...FIELDS],
  properties: {
    kind: { type: 'string', enum: ['purchase', 'payment_proof', 'other'] },
    category: { type: 'string', enum: [...CATEGORIES] },
    ...Object.fromEntries(FIELDS.map((f) => [f, { type: 'string' }])),
  },
};

const SYSTEM = `You read one document for the bookkeeping of an Israeli wedding-photography studio's owner. He has two businesses (a company and a sole proprietorship) and also collects his household bills. Decide what the document is and copy its fields exactly as printed.

kind:
- "purchase": a document from a seller or service provider for something bought or billed — חשבונית מס, חשבונית מס קבלה, קבלה, חשבון עסקה, a periodic bill (חשבון חשמל / מים / ארנונה / גז / טלפון / אינטרנט), a fuel or shop receipt, an online receipt or invoice (also in English), a price quote or an order.
- "payment_proof": only a proof that money was paid — a bank app's transfer confirmation, a credit-card slip with no seller's tax details.
- "other": anything else (photos, chat screenshots, ads, contracts, price lists). Then leave every other field "" and category "other".

Fields (use "" when the document doesn't show it; never guess):
- doc_type: the document's title as printed (e.g. "חשבונית מס קבלה", "קבלה", "חשבון תקופתי", "Invoice", "Receipt").
- doc_number: the document's number.
- issuer: the business that issued it. issuer_tax_id: its ח.פ. / ע.מ. / עוסק מורשה number, digits only.
- issued_to, issued_to_id: the customer it was issued to (לכבוד / שם הלקוח / Bill to) and their ח.פ. / ע.מ. / ת.ז., digits only.
- date: the issue date as YYYY-MM-DD.
- amount: the grand total paid, digits with an optional decimal point, no commas or symbols ("2124" or "2124.50").
- vat: the VAT amount (מע"מ) in the same format; "0" if the document says there is no VAT.
- currency: "ILS" for shekels, else the 3-letter code as shown (e.g. "USD").
- allocation_number: מספר הקצאה, digits only.
- description: a few words on what was bought (e.g. "דלק", "מנוי Adobe", "ביטוח רכב").
- card_last4: the last 4 digits of the payment card if printed.

category (one of the list): "home" for household bills and household purchases (electricity, water, arnona, gas, building committee, groceries, home appliances); "fuel"; "car" (service, parts, car insurance, parking, tolls); "equipment" (cameras, lenses, computers, drives); "software" (subscriptions, apps, cloud); "printing" (albums, prints); "food"; "travel"; "office"; "marketing" (ads, website); "professional" (accountant, lawyer, consultants); "insurance" (business insurance); "communication" (phone, internet); "staff" (a photographer or editor billing for their work); else "other".`;

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const EMPTY: ExpenseReading = { kind: 'other', category: 'other', ...Object.fromEntries(FIELDS.map((f) => [f, ''])) } as ExpenseReading;

/** The reading of the answer's JSON: unknown kinds / categories fall back, every field a trimmed string. */
export function cleanReading(parsed: unknown): ExpenseReading {
  const p = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const r = { ...EMPTY } as Record<string, string>;
  for (const f of FIELDS) r[f] = String(p[f] ?? '').trim().slice(0, 200);
  r.kind = ['purchase', 'payment_proof', 'other'].includes(String(p.kind)) ? String(p.kind) : 'other';
  r.category = (CATEGORIES as readonly string[]).includes(String(p.category)) ? String(p.category) : 'other';
  return r as unknown as ExpenseReading;
}

export async function readExpenseDoc(bytes: Uint8Array, mime: string, apiKey: string): Promise<ExpenseReading> {
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
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      fallbacks: 'default',
      messages: [{ role: 'user', content: [block, { type: 'text', text: 'Read this document.' }] }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const out = await res.json();
  if (out.stop_reason === 'refusal') return { ...EMPTY };
  const text = (out.content ?? []).find((b: { type: string }) => b.type === 'text')?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('תשובת הקריאה לא הייתה תקינה');
  }
  return cleanReading(parsed);
}
