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
