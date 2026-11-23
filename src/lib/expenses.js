// "מרכז הוצאות" (2026-11-23, the owner approved the mockup and the plan; 0117) — the screen's pure parts: which tab a
// document is in, what its chip says, where it came from, the month's ZIP for Morning and its summary. The server's
// decisions are supabase/functions/_shared/expenses.ts. Tested in scripts/test-whatsapp-bot.mjs ("expenses").

export const EXPENSES_BUCKET = "expense-docs";
export const EXPENSES_TRACK_SINCE = "2026-11-01";
export const GROUP_KEY = "expenses_group_chat_id";
export const GROUP_CONFIRM_KEY = "expenses_group_confirm";
export const MORNING_SYNCED_KEY = "expenses_morning_synced_at";

export const ENTITY_INFO = {
  company: { key: "company", label: "החברה", short: "חברה", tone: "purple" },
  sole_prop: { key: "sole_prop", label: "עוסק מורשה", short: "עוסק", tone: "emerald" },
  home: { key: "home", label: "בית", short: "בית", tone: "amber" },
};
export const ENTITY_ORDER = ["company", "sole_prop", "home"];

export const TABS = [
  { key: "all", label: "הכל" },
  { key: "company", label: "החברה" },
  { key: "sole_prop", label: "עוסק" },
  { key: "home", label: "בית" },
  { key: "decide", label: "צריך החלטה" },
  { key: "skip", label: "לא הוצאה" },
];

/** The month a document belongs to: its date, else the day it came. "2026-11". */
export const docMonth = (d) => String(d?.doc_date || d?.received_at || d?.created_at || "").slice(0, 7);

const WAITING = ["waiting_upload", "pending"];

/** The tab a document is in (besides "הכל"): skip — not an expense / a duplicate; decide — the owner's turn; else its business. */
export function tabOf(d) {
  if (d.read_status === "not_expense" || d.read_status === "duplicate") return "skip";
  if (WAITING.includes(d.read_status)) return "reading";
  if (d.read_status !== "done" || !ENTITY_INFO[d.entity]) return "decide";
  return d.entity;
}

/** The month's documents in a tab. "הכל" leaves out what is not an expense. */
export function inTab(docs, tab) {
  return docs.filter((d) => {
    const t = tabOf(d);
    if (tab === "all") return t !== "skip";
    return t === tab;
  });
}

export function tabCounts(docs) {
  const out = Object.fromEntries(TABS.map((t) => [t.key, 0]));
  for (const d of docs) {
    const t = tabOf(d);
    if (t !== "skip") out.all++;
    if (out[t] !== undefined) out[t]++;
  }
  return out;
}

/** The chip at the end of a row: what is left to do with it, in the owner's words. { text, tone } */
export function chipOf(d) {
  if (WAITING.includes(d.read_status)) return { text: "בקריאה…", tone: "sky" };
  if (d.read_status === "duplicate") return { text: d.staff_invoice_id ? "כבר בחשבוניות מהצוות" : "כפילות", tone: "gray" };
  if (d.read_status === "not_expense") return { text: "לא הוצאה", tone: "gray" };
  if (d.read_status === "manual") return { text: "קישור — לשמור ידנית", tone: "orange" };
  if (d.read_status === "failed") return { text: "לא נקרא", tone: "orange" };
  if (!ENTITY_INFO[d.entity]) return { text: "צריך החלטה שלך", tone: "orange" };
  const who = ENTITY_INFO[d.entity].short;
  if (d.entity === "home") return { text: `${who} · לרואה החשבון`, tone: "amber" };
  return d.morning_expense_id ? { text: `${who} · כבר במורנינג ✓`, tone: ENTITY_INFO[d.entity].tone } : { text: `${who} · עוד לא במורנינג`, tone: ENTITY_INFO[d.entity].tone };
}

/** "avira.media1" for avira.media1@gmail.com */
export const mailboxShort = (label) => String(label ?? "").split("@")[0].trim();

/** Where it came from, for the row's second line. */
export function sourceText(d, mailboxes = []) {
  if (d.source === "whatsapp") return `מהקבוצה${d.sender_name ? ` (${d.sender_name})` : ""}`;
  if (d.source === "email") {
    const box = mailboxes.find((b) => b.id === d.mailbox_id);
    return `מהמייל${box ? ` ${mailboxShort(box.label)}` : ""}`;
  }
  return "הועלה במסך";
}

/** Why the document is in its business (the expanded row). */
export function reasonText(d) {
  if (d.entity_by === "issued_to") return `הונפק ל"${d.issued_to || "החברה"}"${d.issued_to_id ? `, ${d.issued_to_id}` : ""}`;
  if (d.entity_by === "supplier") return "לפי מה שבחרת לספק הזה";
  if (d.entity_by === "morning") return "נמצא במורנינג של העסק הזה";
  if (d.entity_by === "manual") return "בחרת לבד";
  if (d.read_status === "done" && d.suggested_entity) return `הצעה: ${ENTITY_INFO[d.suggested_entity]?.label || ""} — בחירה אחת לספק, ואחר כך זה לבד`;
  return "";
}

const fmtNum = (n) => Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });
export const fmtMoney = (n) => (n === null || n === undefined || n === "" ? "—" : `₪${fmtNum(n)}`);

/** The documents of a month and business that go into the ZIP: read, with a file; by default only what Morning lacks. */
export function zipList(docs, month, entity, { onlyMissing = true } = {}) {
  return docs.filter(
    (d) =>
      d.read_status === "done" &&
      d.file_path &&
      d.entity === entity &&
      docMonth(d) === month &&
      (!onlyMissing || !d.morning_expense_id),
  );
}

/** "2026-11-16 הראל ביטוח חשבונית מס 88123 ₪3,860.pdf" — safe for every file system. */
export function docFileName(d) {
  const ext = d.file_mime === "application/pdf" ? "pdf" : d.file_mime === "image/png" ? "png" : d.file_mime === "image/webp" ? "webp" : "jpg";
  const parts = [d.doc_date || String(d.received_at || "").slice(0, 10), d.issuer, d.doc_type, d.doc_number, d.amount !== null && d.amount !== undefined ? `${fmtNum(d.amount)}₪` : "", String(d.id).slice(0, 6)];
  return `${parts.filter(Boolean).join(" ").replace(/[\\/:*?"<>|]/g, "-").slice(0, 180)}.${ext}`;
}

const csvCell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The ZIP's summary (opens in Excel with Hebrew: a BOM first). */
export function summaryCsv(list) {
  const rows = [["תאריך", "ספק", "סוג מסמך", "מספר", "סכום", "מע״מ", "קובץ"]];
  for (const d of list) rows.push([d.doc_date || "", d.issuer || "", d.doc_type || "", d.doc_number || "", d.amount ?? "", d.vat ?? "", docFileName(d)]);
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** "הוצאות 2026-11 חברה.zip" */
export const zipName = (month, entity) => `הוצאות ${month} ${ENTITY_INFO[entity]?.short || ""}.zip`.replace(/\s+\.zip$/, ".zip");

/** The months to choose from: from the start of the collection to this month, newest first. */
export function monthsSince(start, today = new Date()) {
  const out = [];
  let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const end = today.getFullYear() * 12 + today.getMonth() + 1;
  while (y * 12 + m <= end) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) [y, m] = [y + 1, 1];
  }
  return out.reverse();
}

/** A dropped file's path in the bucket: <tenant>/<doc id>.<ext> (the same as the server's). */
export function uploadPath(tenantId, id, mime) {
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${tenantId}/${id}.${ext}`;
}

export const READABLE = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
