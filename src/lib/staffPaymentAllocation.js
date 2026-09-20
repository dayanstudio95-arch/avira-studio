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

// Every unpaid, costed, already-happened row of `staffName` across ALL events — not
// just the month the page is filtered to. Oldest first.
export function unpaidRowsForStaff(events, staffName, today = new Date()) {
  const todayStr = typeof today === "string" ? today : today.toISOString().slice(0, 10);
  const rows = [];
  for (const e of events || []) {
    if (!e?.date || String(e.date).slice(0, 10) > todayStr) continue;
    (e.team || []).forEach((m, index) => {
      const cost = parseFloat(m?.cost) || 0;
      if (m?.staffMemberName !== staffName || m?.isPaid || cost <= 0) return;
      rows.push({
        eventId: e.id,
        coupleNames: e.coupleNames,
        date: String(e.date).slice(0, 10),
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

// Running credit per staff name: sum(amount − appliedAmount). Derived, never stored.
export function creditByStaff(payments) {
  const out = {};
  for (const p of payments || []) {
    const name = p?.staffMemberName;
    if (!name) continue;
    out[name] = round2((out[name] || 0) + (Number(p.amount) || 0) - (Number(p.appliedAmount) || 0));
  }
  return out;
}

// Only a person's most recent payment may be undone (see undo_staff_payment).
export function latestPaymentIdByStaff(payments) {
  const latest = {};
  for (const p of payments || []) {
    const cur = latest[p.staffMemberName];
    if (!cur || new Date(p.createdAt || p.createdDate || 0) > new Date(cur.createdAt || cur.createdDate || 0)) {
      latest[p.staffMemberName] = p;
    }
  }
  return Object.fromEntries(Object.entries(latest).map(([k, v]) => [k, v.id]));
}
