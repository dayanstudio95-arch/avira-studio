// "מי פתח את החוזה" (2026-10-13, the owner's request) — the line shown next to a lead
// whose contract was sent and not signed yet. Pure — PART 57.
// The server side is get-lead-public (supabase/functions/_shared/contractViews.ts).

const israelDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
const israelTime = (d) =>
  new Date(d).toLocaleTimeString("he-IL", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", hour12: false });

// "היום 21:40" / "אתמול 21:40" / "12.10 21:40"
export function whenLabel(iso, now = new Date()) {
  if (!iso) return "";
  const day = israelDay(iso);
  if (day === israelDay(now)) return `היום ${israelTime(iso)}`;
  if (day === israelDay(now.getTime() - 86400000)) return `אתמול ${israelTime(iso)}`;
  const [, m, d] = day.split("-");
  return `${Number(d)}.${Number(m)} ${israelTime(iso)}`;
}

// null → nothing to say (no contract sent, or already signed).
// { opened, text } otherwise.
export function contractViewInfo(lead, now = new Date()) {
  if (!lead || lead.signedAt || !lead.contractSent) return null;
  const count = Number(lead.contractViewCount) || 0;
  if (!lead.contractViewedAt || count === 0) return { opened: false, text: "📭 עוד לא פתחו את החוזה" };
  const times = count === 1 ? "פעם אחת" : `${count} פעמים`;
  return { opened: true, text: `👁 פתחו את החוזה ${times} · אחרונה ${whenLabel(lead.contractViewedAt, now)}` };
}
