// חשבונית מס קבלה on an album order (2026-11-12, the owner: "אפשרות להוציא חשבונית מס קבלה על האלבומים מדף
// הזמנת אלבומים"). generate-morning-invoice issues it like any other invoice (type 320) and, with `albumOrderId`,
// saves it on album_orders.invoices_list (0116) — never on leads.invoices_list, whose sum is the couple's
// photography balance (total_paid / remaining_balance); an album is a separate sale. Never linked to the couple's
// work order either (that order is the photography package). Pure — tested in scripts/test-whatsapp-bot.mjs
// ("albums: חשבונית מס קבלה").

export interface AlbumInvoiceEntry {
  id: string | null;
  number: string;
  date: string;
  amount: number;
  url: string | null;
  businessType: string;
  description: string;
  paymentType: number;
  createdAt: string;
}

// The longest line text sent to Morning (the window caps it too).
export const MAX_ALBUM_INVOICE_TEXT = 200;

export function albumInvoiceText(text: unknown): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_ALBUM_INVOICE_TEXT);
}

export function albumInvoiceEntry(input: {
  invoice: { id?: unknown; number?: unknown };
  url: string | null;
  date: string;
  amount: number;
  businessType: string;
  description: string;
  paymentType: number;
  now?: Date;
}): AlbumInvoiceEntry {
  return {
    id: input.invoice?.id != null ? String(input.invoice.id) : null,
    number: String(input.invoice?.number ?? ''),
    date: String(input.date || '').slice(0, 10),
    amount: Math.round(Number(input.amount) * 100) / 100,
    url: input.url || null,
    businessType: input.businessType,
    description: input.description,
    paymentType: Number(input.paymentType) || 4,
    createdAt: (input.now || new Date()).toISOString(),
  };
}

// The album_orders update after an invoice: the entry appended, and — when the owner left "לסמן שולם" ticked —
// the order marked paid exactly like "סמן כשולם" on the order page (payment_status 'paid'; awaiting_payment → paid).
export function albumOrderInvoicePatch(
  order: { invoices_list?: unknown; payment_status?: string; workflow_status?: string },
  entry: AlbumInvoiceEntry,
  markPaid: boolean,
): Record<string, unknown> {
  const list = Array.isArray(order?.invoices_list) ? order.invoices_list : [];
  const patch: Record<string, unknown> = { invoices_list: [...list, entry] };
  if (markPaid && order?.payment_status !== 'paid') {
    patch.payment_status = 'paid';
    if (order?.workflow_status === 'awaiting_payment') patch.workflow_status = 'paid';
  }
  return patch;
}
