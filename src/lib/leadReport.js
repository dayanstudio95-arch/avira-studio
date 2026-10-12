// "דוח חודשי" (2026-10-13, the owner's request: inside the system, no WhatsApp): how many
// leads came in, how many signed, at what price, and from where — against the month
// before. Pure — PART 57.
//
// Months are Israel months. "Signed" = signed_at (the couple signed the contract online),
// which the import from the old system kept. created_at did NOT survive that import: every
// lead from before it carries the import day, so "new leads" is only real from the month
// after IMPORT_MONTH.
export const IMPORT_MONTH = "2026-08";
const LOST = "לא רלוונטי";
export const NO_SOURCE = "לא צוין";

export const israelMonth = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }).slice(0, 7) : null;

export function monthKey(year, monthIndex0) {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}
export function prevMonthKey(key) {
  const [y, m] = key.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

// leads: [{ createdAt, signedAt, status, finalPrice, source }]
// conversations: [{ createdAt, contactType }]
export function monthStats(leads, conversations, key) {
  const created = (leads || []).filter((l) => israelMonth(l.createdAt) === key);
  const signed = (leads || []).filter((l) => israelMonth(l.signedAt) === key);
  const prices = signed.map((l) => Number(l.finalPrice) || 0).filter((p) => p > 0);
  const total = prices.reduce((a, b) => a + b, 0);
  const cohortSigned = created.filter((l) => l.signedAt).length;
  const inquiries = (conversations || []).filter(
    (c) => israelMonth(c.createdAt) === key && ["unknown", "lead"].includes(c.contactType || "unknown")
  ).length;

  const bySourceMap = {};
  for (const l of created) {
    const s = String(l.source || "").trim() || NO_SOURCE;
    const row = (bySourceMap[s] ||= { source: s, leads: 0, signed: 0 });
    row.leads++;
    if (l.signedAt) row.signed++;
  }
  const bySource = Object.values(bySourceMap).sort((a, b) => b.leads - a.leads || b.signed - a.signed);

  return {
    key,
    inquiries,
    newLeads: created.length,
    lost: created.filter((l) => l.status === LOST).length,
    signed: signed.length,
    signedTotal: total,
    avgPrice: prices.length ? Math.round(total / prices.length) : 0,
    // Of the leads that came in this month, how many signed (by now).
    cohortSigned,
    conversion: created.length ? Math.round((cohortSigned / created.length) * 100) : null,
    bySource,
    newLeadsReliable: key > IMPORT_MONTH,
  };
}

// "+3" / "−2" / "0" against the month before; null when there is nothing to compare.
export function delta(cur, prev) {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return null;
  const d = cur - prev;
  return d > 0 ? `+${d.toLocaleString("he-IL")}` : d < 0 ? `−${Math.abs(d).toLocaleString("he-IL")}` : "0";
}

// The last `n` months up to `key`, oldest first — for the small table under the cards.
export function lastMonths(key, n = 6) {
  const out = [key];
  while (out.length < n) out.unshift(prevMonthKey(out[0]));
  return out;
}
