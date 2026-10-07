// "16/9/26" in a search box → the ISO dates to look up (2026-10-07: Cmd+K and the Leads page
// found nothing for a date — dates are stored as YYYY-MM-DD and were never searched).
// A full date → that day; a day/month without a year → that day in each of the years
// around now (events in the past are searched too). Pure — tested in PART 33.
import { parseIsraeliDate } from "@/lib/whatsappLeadParser";

const pad = (n) => String(n).padStart(2, "0");

export function searchDates(q, now = new Date()) {
  const s = String(q || "").trim();
  if (!/\d/.test(s)) return null;
  const dm = s.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (dm) {
    const d = Number(dm[1]), m = Number(dm[2]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const y = now.getFullYear();
    return [y - 2, y - 1, y, y + 1, y + 2].map((yy) => `${yy}-${pad(m)}-${pad(d)}`);
  }
  const full = parseIsraeliDate(s, now);
  return full ? [full.iso] : null;
}

// Does a stored date ("2026-09-16" or an ISO timestamp) match the search text?
export function dateMatches(stored, q, now = new Date()) {
  const dates = searchDates(q, now);
  return !!dates && !!stored && dates.includes(String(stored).slice(0, 10));
}
