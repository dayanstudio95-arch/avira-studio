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

// A Green API request URL carries the instance token in its path
// (…/waInstance<id>/<method>/<token>). Deno puts that URL into network-error messages, and
// several functions pass such messages straight back — so every functions.invoke() response
// and error goes through this (2026-10-27, the owner's request): any string holding such a
// URL becomes the Hebrew message instead. Anything else (the bare api URL in the settings
// screen, ordinary errors) is left as it is.
const GATEWAY_URL_WITH_TOKEN = /waInstance\d+\/\w+\/[A-Za-z0-9_-]{8,}/;

export function redactGatewaySecrets(value) {
  if (typeof value === "string") return GATEWAY_URL_WITH_TOKEN.test(value) ? friendlySendError(value) : value;
  if (Array.isArray(value)) return value.map(redactGatewaySecrets);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactGatewaySecrets(v)]));
  }
  return value;
}
