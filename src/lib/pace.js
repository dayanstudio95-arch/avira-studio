// AUTO-12 (audit 2026-10-05): screens that send to several people in one click (follow-up
// dialogs, staff availability) wait 1.2–2.0s between messages, like the server does
// (supabase/functions/_shared/whatsapp.ts paceSend) — a burst from the studio's single
// WhatsApp number looks like spam and risks the number.
export function pauseBetweenSends() {
  return new Promise((resolve) => setTimeout(resolve, 1200 + Math.floor(Math.random() * 800)));
}
