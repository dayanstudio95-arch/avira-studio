// ─── Health Score Calculator ──────────────────────────────────────────────────
// Read-only. No side effects. Returns 0-100.

export function calcHealthScore({ events, automations, automationRuns, leads, staffMembers }) {
  let score = 100;
  const penalties = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // ── Automations ──────────────────────────────────────────────────────────────
  const activeAutos = automations.filter(a => a.isActive);
  const inactiveAutos = automations.filter(a => !a.isActive);

  // Failed run in last 3 days
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const recentFailedRuns = automationRuns.filter(
    r => r.status === "error" && r.startedAt > threeDaysAgo
  );
  if (recentFailedRuns.length > 0) {
    const deduct = Math.min(recentFailedRuns.length * 12, 30);
    score -= deduct;
    penalties.push({ label: `${recentFailedRuns.length} אוטומציות נכשלו`, deduct, color: "red" });
  }

  // Inactive automations
  if (inactiveAutos.length > 0) {
    const deduct = Math.min(inactiveAutos.length * 5, 20);
    score -= deduct;
    penalties.push({ label: `${inactiveAutos.length} אוטומציות כבויות`, deduct, color: "orange" });
  }

  // ── Open debts ───────────────────────────────────────────────────────────────
  const unpaidEvents = events.filter(e => {
    const d = new Date(e.date);
    return d < today && e.clientPaymentStatus !== "Paid";
  });

  if (unpaidEvents.length > 0) {
    const totalDebt = unpaidEvents.reduce((s, e) => s + (e.totalAmountGross || 0), 0);
    // Age penalty: events older than 60 days
    const oldDebt = unpaidEvents.filter(e => {
      const days = (today - new Date(e.date)) / 86400000;
      return days > 60;
    });
    const deduct = Math.min(unpaidEvents.length * 4 + oldDebt.length * 3, 25);
    score -= deduct;
    penalties.push({ label: `${unpaidEvents.length} חובות פתוחים (₪${totalDebt.toLocaleString()})`, deduct, color: "red" });
  }

  // ── Missing crew on upcoming events ─────────────────────────────────────────
  const sevenDaysAhead = new Date(today.getTime() + 7 * 86400000);
  const upcomingMissingCrew = events.filter(e => {
    const d = new Date(e.date);
    if (d < today || d > sevenDaysAhead) return false;
    const required = e.requiredCrew || 3;
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    return assigned < required;
  });

  if (upcomingMissingCrew.length > 0) {
    const deduct = Math.min(upcomingMissingCrew.length * 8, 20);
    score -= deduct;
    penalties.push({ label: `${upcomingMissingCrew.length} אירועים קרובים חסרי צוות`, deduct, color: "red" });
  }

  // ── Data anomalies ───────────────────────────────────────────────────────────
  // Use cleaned digits only — same logic as DataAnomaliesCard
  const isValidPhone = (p) => {
    if (!p) return false;
    const c = p.replace(/[^\d]/g, "");
    if (/^05\d{8}$/.test(c)) return true;
    if (/^0[2-9]\d{7,8}$/.test(c)) return true;
    if (/^972\d{9,10}$/.test(c)) return true;
    return false;
  };
  const badPhones = staffMembers.filter(s => s.phoneNumber && !isValidPhone(s.phoneNumber)).length;
  if (badPhones > 0) {
    const deduct = Math.min(badPhones * 2, 5);
    score -= deduct;
    penalties.push({ label: `${badPhones} טלפונים לא תקינים`, deduct, color: "yellow" });
  }

  // Duplicate events (same couple + date)
  const seen = new Set();
  let duplicates = 0;
  events.forEach(e => {
    const key = `${(e.coupleNames || "").toLowerCase()}_${e.date}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  });
  if (duplicates > 0) {
    const deduct = Math.min(duplicates * 3, 6);
    score -= deduct;
    penalties.push({ label: `${duplicates} אירועים כפולים`, deduct, color: "yellow" });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, penalties };
}

// ─── Daily Tip (Rule-Based) ───────────────────────────────────────────────────
export function getDailyTip({ events, automations, automationRuns, leads }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAhead = new Date(today.getTime() + 7 * 86400000);

  // 1. Upcoming events with missing crew
  const missingCrew = events.filter(e => {
    const d = new Date(e.date);
    if (d < today || d > sevenDaysAhead) return false;
    const required = e.requiredCrew || 3;
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    return assigned < required;
  });
  if (missingCrew.length > 0) {
    return `יש ${missingCrew.length} אירוע${missingCrew.length > 1 ? "ים" : ""} ב-7 הימים הקרובים ללא שיבוץ מלא — כדאי לטפל בכך היום.`;
  }

  // 2. Old open debts
  const oldUnpaid = events.filter(e => {
    const d = new Date(e.date);
    const daysDiff = (today - d) / 86400000;
    return d < today && e.clientPaymentStatus !== "Paid" && daysDiff > 30;
  });
  if (oldUnpaid.length > 0) {
    return `יש ${oldUnpaid.length} חוב${oldUnpaid.length > 1 ? "ות" : ""} פתוח${oldUnpaid.length > 1 ? "ים" : ""} מעל 30 יום — שקול פניה ללקוחות.`;
  }

  // 3. Failed automation
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const failedRun = automationRuns.find(r => r.status === "error" && r.startedAt > threeDaysAgo);
  if (failedRun) {
    return `האוטומציה "${failedRun.automationName}" נכשלה לאחרונה — כדאי לבדוק את הגדרות ה-Webhook.`;
  }

  // 4. Inactive automations
  const inactiveCount = automations.filter(a => !a.isActive).length;
  if (inactiveCount > 0) {
    return `יש ${inactiveCount} אוטומציה${inactiveCount > 1 ? "ות" : ""} כבויה — בדוק אם זה בכוונה.`;
  }

  // 5. Leads pending follow-up
  const staleleads = leads.filter(l => {
    if (l.status !== "חדש" && l.status !== "נשלחה הצעה") return false;
    if (!l.lastContactDate) return true;
    const days = (today - new Date(l.lastContactDate)) / 86400000;
    return days > 5;
  });
  if (staleleads.length > 0) {
    return `יש ${staleleads.length} ליד${staleleads.length > 1 ? "ים" : ""} ללא קשר ב-5 הימים האחרונים — שקול לעשות follow-up.`;
  }

  return "המערכת נראית תקינה. יום עבודה טוב! 🌟";
}

// ─── Priority Queue ───────────────────────────────────────────────────────────
export function getPriorityItems({ events, automations, automationRuns, leads }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const sevenDaysAhead = new Date(today.getTime() + 7 * 86400000);
  const items = [];

  // Missing crew on upcoming events (HIGH)
  const upcomingMissing = events.filter(e => {
    const d = new Date(e.date);
    if (d < today || d > sevenDaysAhead) return false;
    const required = e.requiredCrew || 3;
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    return assigned < required;
  });
  upcomingMissing.forEach(e => {
    const assigned = (e.team || []).filter(m => m.staffMemberName).length;
    const required = e.requiredCrew || 3;
    const d = new Date(e.date);
    const daysUntil = Math.round((d - today) / 86400000);
    items.push({
      priority: daysUntil <= 2 ? 1 : 2,
      color: daysUntil <= 2 ? "red" : "orange",
      icon: "👥",
      text: `"${e.coupleNames}" ב-${formatDateShort(e.date)} — חסר ${required - assigned} איש צוות`,
    });
  });

  // Failed automation runs (HIGH)
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
  const failedRuns = automationRuns.filter(r => r.status === "error" && r.startedAt > threeDaysAgo);
  if (failedRuns.length > 0) {
    items.push({
      priority: 2,
      color: "orange",
      icon: "🤖",
      text: `${failedRuns.length} אוטומציה${failedRuns.length > 1 ? "ות" : ""} נכשל${failedRuns.length > 1 ? "ו" : "ה"} לאחרונה`,
    });
  }

  // Old open debts (HIGH)
  const oldUnpaid = events.filter(e => {
    const d = new Date(e.date);
    const daysDiff = (today - d) / 86400000;
    return d < today && e.clientPaymentStatus !== "Paid" && daysDiff > 30;
  });
  if (oldUnpaid.length > 0) {
    const total = oldUnpaid.reduce((s, e) => s + (e.totalAmountGross || 0), 0);
    items.push({
      priority: 2,
      color: "orange",
      icon: "💰",
      text: `${oldUnpaid.length} חובות פתוחים מעל 30 יום — ₪${total.toLocaleString()}`,
    });
  }

  // All open debts (MEDIUM)
  const allUnpaid = events.filter(e => {
    const d = new Date(e.date);
    return d < today && e.clientPaymentStatus !== "Paid";
  });
  if (allUnpaid.length > oldUnpaid.length) {
    const newUnpaid = allUnpaid.length - oldUnpaid.length;
    const total = allUnpaid.filter(e => {
      const days = (today - new Date(e.date)) / 86400000;
      return days <= 30;
    }).reduce((s, e) => s + (e.totalAmountGross || 0), 0);
    if (newUnpaid > 0) {
      items.push({
        priority: 3,
        color: "yellow",
        icon: "💳",
        text: `${newUnpaid} חובות פתוחים חדשים — ₪${total.toLocaleString()}`,
      });
    }
  }

  // Stale leads (LOW)
  const staleLeads = leads.filter(l => {
    if (l.status !== "חדש" && l.status !== "נשלחה הצעה") return false;
    if (!l.lastContactDate) return true;
    const days = (today - new Date(l.lastContactDate)) / 86400000;
    return days > 5;
  });
  if (staleLeads.length > 0) {
    items.push({
      priority: 4,
      color: "yellow",
      icon: "📋",
      text: `${staleLeads.length} לידים ממתינים לפולו-אפ (5+ ימים ללא קשר)`,
    });
  }

  // Sort by priority, keep top 5
  return items.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}