// What the person sees when a WhatsApp send fails — never the raw gateway error, which
// carries the Green API URL with the token in it. Mirrors send-event-crew-brief's mapping.
// Moved here from crewMove.js (2026-10-27) — the schedule window uses it too.
export function friendlySendError(raw) {
  const t = String(raw || "");
  if (/network error|dns|connect|timed? ?out/i.test(t)) return "אין חיבור לשירות הוואטסאפ — נסו שוב בעוד רגע";
  if (/required|settings/i.test(t)) return "הוואטסאפ לא מחובר בהגדרות";
  if (/https?:|waInstance|api\.green-api/i.test(t) || !t) return "שליחת הוואטסאפ נכשלה";
  return t;
}
