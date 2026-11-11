import { getEventVatAmount, getEventTeamCost } from "./financialCalculations";
import { calculateNetProfit } from "./profitCalculations";

// "אני מול הצוות" on the Reports page (2026-11-11, the owner: "כמה אני אישית הרווחתי וכמה הצוות"): the events of a
// period split by whether the owner worked them. The owner is on the staff list as "אני (דניאל)" with cost 0
// (verified on the real data: 133 events in 2026, every one at 0), so an event he worked keeps his pay inside its
// profit, and its expenses are only the rest of that team. Every number comes from the same helpers as the
// "סיכום פיננסי" card, so me + team = that card's total, to the agora. Pure — tested in
// scripts/test-whatsapp-bot.mjs ("reports: אני מול הצוות").

// "אני (דניאל)", "אני" — never "אין וידאו" (a different word: א-י-ן).
export const isMeName = (name) => /^אני(\s|\(|$)/.test(String(name || "").trim());

export const meOnEvent = (event) => (event?.team || []).some((m) => m && isMeName(m.staffMemberName));

// The owner's own name on the staff list ("אני (דניאל)"), or null when there is none.
export const meStaffName = (staffMembers) => (staffMembers || []).find((s) => isMeName(s?.name))?.name || null;

const r2 = (n) => Math.round(n * 100) / 100;

export function sumEvents(events) {
  const t = (events || []).reduce(
    (acc, e) => ({
      count: acc.count + 1,
      gross: acc.gross + (Number(e?.totalAmountGross) || 0),
      vat: acc.vat + getEventVatAmount(e),
      cost: acc.cost + getEventTeamCost(e),
      profit: acc.profit + calculateNetProfit(e),
    }),
    { count: 0, gross: 0, vat: 0, cost: 0, profit: 0 },
  );
  return { count: t.count, gross: r2(t.gross), vat: r2(t.vat), cost: r2(t.cost), profit: r2(t.profit) };
}

// { me, team, meShare } — meShare is the owner's part of the period's net profit in whole percent, or null when it
// can't be shown honestly (no profit at all, or a loss on either side).
export function splitMeTeam(events) {
  const mine = [];
  const theirs = [];
  for (const e of events || []) (meOnEvent(e) ? mine : theirs).push(e);
  const me = sumEvents(mine);
  const team = sumEvents(theirs);
  const all = me.profit + team.profit;
  const meShare = me.profit >= 0 && team.profit >= 0 && all > 0 ? Math.round((me.profit / all) * 100) : null;
  return { me, team, meShare };
}

// The annual table: one row per month of `year` (0–11), by the event's calendar date.
export function meVsTeamByMonth(events, year) {
  const rows = Array.from({ length: 12 }, (_, month) => ({ month, events: [] }));
  const y = String(year);
  for (const e of events || []) {
    const d = String(e?.date || "").slice(0, 10);
    if (d.slice(0, 4) !== y) continue;
    const m = Number(d.slice(5, 7)) - 1;
    if (m >= 0 && m < 12) rows[m].events.push(e);
  }
  return rows.map(({ month, events: list }) => ({ month, ...splitMeTeam(list) }));
}
