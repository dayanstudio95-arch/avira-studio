// "הזמנת עבודה" — Morning document type 100 ("הזמנה"), the studio's order book (2026-10-21).
// Pure — tested in scripts/test-whatsapp-bot.mjs PART 63. Field names per the official
// OpenAPI spec (CreateDocumentRequest / IncomeRowRequest, read 2026-10-21):
//   type 100 · lang he · currency ILS · document vatType 0 (default) · each row vatType 1
//   (VAT included in the price) · client { name, add } · remarks (printed on the document).
// Linking a חשבונית מס קבלה (320) to it: linkedDocumentIds:[<order id>] + linkType:'link'.
// Morning does not print the order's number on the invoice by itself, so the invoice's
// description says "בהתאם להזמנת עבודה מס' N מיום …".

export const ORDER_DOC_TYPE = 100;
export const MAX_ORDER_LINES = 20;
export const MAX_REMARKS = 2000;

export interface OrderLine { description: string; price: number }

// "2026-10-21" → "21/10/2026"
export function fmtDate(d: string | null | undefined): string {
  const s = String(d || '').slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
}

// Cleans the rows typed in the window: trimmed descriptions, prices > 0 (rounded to agorot).
// Returns { lines } or { error } (Hebrew, for the screen).
export function validateOrderLines(input: unknown): { lines: OrderLine[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0) return { error: 'צריך לפחות שורה אחת בהזמנה' };
  if (input.length > MAX_ORDER_LINES) return { error: `עד ${MAX_ORDER_LINES} שורות בהזמנה` };
  const lines: OrderLine[] = [];
  for (const row of input) {
    const description = String((row as any)?.description ?? '').trim();
    const price = Math.round(Number((row as any)?.price) * 100) / 100;
    if (!description) return { error: 'לכל שורה צריך תיאור' };
    if (!Number.isFinite(price) || price <= 0) return { error: `סכום לא תקין בשורה "${description}"` };
    lines.push({ description: description.slice(0, 200), price });
  }
  return { lines };
}

export function linesTotal(lines: OrderLine[]): number {
  return Math.round(lines.reduce((s, l) => s + l.price, 0) * 100) / 100;
}

// The business's own default remark for this document type first (Morning may replace it
// with ours otherwise), then ours — without repeating it if ours already contains it.
export function mergeRemarks(defaultRemark: string | null | undefined, ours: string | null | undefined): string {
  const d = String(defaultRemark || '').trim();
  const o = String(ours || '').trim();
  if (!d) return o;
  if (!o) return d;
  if (o.includes(d)) return o;
  return `${d}\n${o}`;
}

export function orderDescription(eventDate: string | null | undefined): string {
  return `הזמנת עבודה — צילום אירוע${eventDate ? ` · תאריך האירוע ${fmtDate(eventDate)}` : ''}`;
}

// Remarks are length-checked by the caller (after merging with the business's default) and
// sent as they are — never cut here, so what is stored is exactly what Morning prints.
// clientId: the Morning client of the order being replaced, so the couple stays one client.
// date: the document date (YYYY-MM-DD); omitted → Morning's default, today.
export function buildOrderPayload(
  { coupleNames, eventDate, lines, remarks, clientId, date }:
  { coupleNames: string; eventDate?: string | null; lines: OrderLine[]; remarks?: string | null; clientId?: string | null; date?: string | null },
) {
  const name = String(coupleNames).trim().slice(0, 200);
  return {
    type: ORDER_DOC_TYPE,
    lang: 'he',
    currency: 'ILS',
    vatType: 0,
    ...(date ? { date } : {}),
    description: orderDescription(eventDate),
    // No emails on purpose: the order stays internal (the owner's choice) — Morning sends the
    // document to client.emails. `add` keeps the couple as a client so every invoice links to
    // the same client.
    client: clientId ? { id: clientId, name } : { name, add: true },
    income: lines.map((l) => ({ description: l.description, quantity: 1, price: l.price, currency: 'ILS', vatType: 1 })),
    ...(remarks && remarks.trim() ? { remarks: remarks.trim() } : {}),
  };
}

// "YYYY-MM-DD" or null — dates from the client are checked before anything is issued.
export function dateOrNull(v: unknown): string | null {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : null;
}

// After an interrupted issue (POST /documents/search results, type 100):
//   candidates — every order document created since the attempt (10 minutes of clock margin)
//                that the order book does not hold yet. Lenient on purpose: an order is
//                released only when there is NO candidate at all.
//   exact      — the candidates that are this order: same description and total (agorot), and
//                the same client (by Morning client id for a replacement, else by name).
export function classifyIssuedOrders(
  items: any[],
  { coupleNames, clientId, total, eventDate, sinceMs, knownIds }:
  { coupleNames: string; clientId?: string | null; total: number; eventDate?: string | null; sinceMs: number; knownIds: Set<string> },
): { candidates: any[]; exact: any[] } {
  const agorot = (n: unknown) => Math.round((Number(n) || 0) * 100);
  const desc = orderDescription(eventDate);
  const name = String(coupleNames).trim();
  const candidates = (Array.isArray(items) ? items : []).filter((d) => {
    if (Number(d?.type) !== ORDER_DOC_TYPE) return false;
    if (knownIds.has(String(d?.id))) return false;
    // creationDate: Unix seconds (SearchDocument in the spec)
    const createdSec = Number(d?.creationDate);
    return !Number.isFinite(createdSec) || createdSec * 1000 >= sinceMs - 10 * 60 * 1000;
  });
  const exact = candidates.filter((d) =>
    String(d?.description || '').trim() === desc
    && agorot(d?.amount) === agorot(total)
    && (clientId ? String(d?.client?.id || '') === clientId : String(d?.client?.name || '').trim() === name));
  return { candidates, exact };
}

// The line an invoice carries about its order.
export function orderReferenceText(number: number | string | null | undefined, documentDate: string | null | undefined): string {
  return `בהתאם להזמנת עבודה מס' ${number ?? '—'} מיום ${fmtDate(documentDate)}`;
}

// What to add to an invoice linked to an order. linkMode 'link' links in Morning and names
// the order; 'text' only names it (the fallback when Morning refused the link).
export function invoiceOrderFields(
  order: { morning_id: string; morning_number: number | null; document_date: string; morning_client_id?: string | null },
  linkMode: 'link' | 'text' = 'link',
) {
  return {
    reference: orderReferenceText(order.morning_number, order.document_date),
    link: linkMode === 'link' ? { linkedDocumentIds: [order.morning_id], linkType: 'link' } : null,
    clientId: order.morning_client_id || null,
  };
}

// Morning refused the link itself (linked document not found / bad link type) — the caller
// can retry with the number in the text only.
export function isLinkRefusal(errorCode: number | null | undefined): boolean {
  return errorCode === 2429 || errorCode === 2404;
}

// The order's date against Morning's window for the type (GET /documents/info?type=100):
// from the business's last order (lastDocumentDate) up to today. Error text or null.
// Kept in step with src/lib/workOrder.js orderDateProblem.
// receivedOn: the contract's signing day — an order is never dated before it was received.
export function orderDateProblem(
  date: string,
  { today, lastDocumentDate, receivedOn }: { today?: string | null; lastDocumentDate?: string | null; receivedOn?: string | null },
): string | null {
  const d = String(date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'בחרו תאריך להזמנה';
  if (today && d > today) return 'אי אפשר להוציא הזמנה בתאריך עתידי';
  if (lastDocumentDate && d < lastDocumentDate) return `Morning מאפשר תאריך מההזמנה האחרונה של העסק (${fmtDate(lastDocumentDate)}) ועד היום`;
  if (receivedOn && d < String(receivedOn).slice(0, 10)) return `תאריך ההזמנה לא יכול להיות לפני חתימת החוזה (${fmtDate(receivedOn)})`;
  return null;
}
