// Lump-sum staff payments — the PREVIEW half (2026-09-20).
//
// The real allocation happens in one database transaction (record_staff_payment,
// migration 0065). This file mirrors its rule exactly so the owner can see, before he
// confirms, which events a payment will close and what stays as credit. If the two
// ever disagree the database wins — and scripts/test-whatsapp-bot.mjs PART 11 exists so
// they don't.
//
// The rule: this person's unpaid rows with a cost, on events whose date has passed,
// oldest first; stop at the first row that does not fit. Never skip ahead to a cheaper,
// newer event — an older event left open under a newer closed one is how a balance
// becomes impossible to follow. Money is counted against team[].cost as stored (ex-VAT),
// the owner's explicit choice.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The period a payment is made ON: the month (or, with "all months", the year) the
// Payments page is showing. { from, to } as YYYY-MM-DD, inclusive.
export function periodRange(year, month) {
  if (month === "all" || month === undefined || month === null) {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  const m = parseInt(month, 10);
  const last = new Date(year, m + 1, 0).getDate();
  const mm = String(m + 1).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

// Every unpaid, costed, already-happened row of `staffName` INSIDE `range` (when given),
// oldest first. The range matters: 0065 closed against all history, and the owner's first
// payment landed on old months while every event of the month he was looking at stayed
// open (fixed in 0066).
export function unpaidRowsForStaff(events, staffName, today = new Date(), range = null) {
  const todayStr = typeof today === "string" ? today : today.toISOString().slice(0, 10);
  const rows = [];
  for (const e of events || []) {
    if (!e?.date) continue;
    const day = String(e.date).slice(0, 10);
    if (day > todayStr) continue;
    if (range && (day < range.from || day > range.to)) continue;
    (e.team || []).forEach((m, index) => {
      const cost = parseFloat(m?.cost) || 0;
      if (m?.staffMemberName !== staffName || m?.isPaid || cost <= 0) return;
      rows.push({
        eventId: e.id,
        coupleNames: e.coupleNames,
        date: day,
        role: m.role,
        index,
        cost,
      });
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.eventId).localeCompare(String(b.eventId)) || a.index - b.index));
  return rows;
}

// { covered: [...rows], applied, creditAfter, firstUncovered }
export function allocatePayment({ amount, creditBefore = 0, rows }) {
  let available = round2(round2(amount) + round2(creditBefore));
  const covered = [];
  let firstUncovered = null;
  for (const row of rows || []) {
    if (row.cost > available) {
      firstUncovered = row;
      break;
    }
    covered.push(row);
    available = round2(available - row.cost);
  }
  const applied = round2(covered.reduce((s, r) => s + r.cost, 0));
  return { covered, applied, creditAfter: available, firstUncovered };
}

const dayOf = (v) => (v ? String(v).slice(0, 10) : null);

// Credit to DISPLAY for a viewed range: a payment counts when its period lies inside the
// viewed range, or when it has no period at all (the rows written before 0066).
// Derived — sum(amount − appliedAmount) — never a stored balance that could drift.
export function creditByStaff(payments, range = null) {
  const out = {};
  for (const p of payments || []) {
    const name = p?.staffMemberName;
    if (!name) continue;
    const from = dayOf(p.periodFrom);
    const to = dayOf(p.periodTo);
    if (range && from && to && (from < range.from || to > range.to)) continue;
    out[name] = round2((out[name] || 0) + (Number(p.amount) || 0) - (Number(p.appliedAmount) || 0));
  }
  return out;
}

// The credit a NEW payment on exactly this period starts from — must match
// record_staff_payment, which sums payments with the identical period.
export function creditForExactPeriod(payments, staffName, range) {
  let total = 0;
  for (const p of payments || []) {
    if (p?.staffMemberName !== staffName) continue;
    if (dayOf(p.periodFrom) !== (range ? range.from : null) || dayOf(p.periodTo) !== (range ? range.to : null)) continue;
    total += (Number(p.amount) || 0) - (Number(p.appliedAmount) || 0);
  }
  return round2(total);
}

// Which payments may be undone: the most recent of each person AND period
// (undo_staff_payment enforces the same). Returns a Set of payment ids.
export function undoablePaymentIds(payments) {
  const latest = new Map();
  for (const p of payments || []) {
    const key = `${p.staffMemberName}|${dayOf(p.periodFrom)}|${dayOf(p.periodTo)}`;
    const cur = latest.get(key);
    const at = (x) => new Date(x.createdAt || x.createdDate || 0).getTime();
    if (!cur || at(p) > at(cur)) latest.set(key, p);
  }
  return new Set([...latest.values()].map((p) => p.id));
}

// Debts left in EARLIER months (2026-10-07, the owner: "we're in October and I still owe
// the crew for September — show me"). Per month before `today`'s month: what is still open
// = for each person, unpaid costed rows of events already held in that month minus their
// credit on that month (creditByStaff, same rule as the page), never below zero.
// → [{ key: "2026-09", year: 2026, month: 8 (0-based), remaining }] newest first, remaining > 0.
export function earlierMonthDebts(events, payments, today = new Date()) {
  const todayStr = typeof today === "string" ? today : today.toISOString().slice(0, 10);
  const thisMonth = todayStr.slice(0, 7);
  const owed = {}; // key -> name -> sum
  for (const e of events || []) {
    const day = String(e?.date || "").slice(0, 10);
    if (!day || day > todayStr) continue;
    const key = day.slice(0, 7);
    if (key >= thisMonth) continue;
    (e.team || []).forEach((m) => {
      const cost = parseFloat(m?.cost) || 0;
      if (!m?.staffMemberName || m.isPaid || cost <= 0) return;
      owed[key] ||= {};
      owed[key][m.staffMemberName] = round2((owed[key][m.staffMemberName] || 0) + cost);
    });
  }
  const out = [];
  for (const key of Object.keys(owed)) {
    const year = Number(key.slice(0, 4));
    const month = Number(key.slice(5, 7)) - 1;
    const credits = creditByStaff(payments, periodRange(year, String(month)));
    let remaining = 0;
    for (const [name, sum] of Object.entries(owed[key])) remaining += Math.max(0, sum - Math.max(0, credits[name] || 0));
    remaining = round2(remaining);
    if (remaining > 0) out.push({ key, year, month, remaining });
  }
  return out.sort((a, b) => (a.key < b.key ? 1 : -1));
}
