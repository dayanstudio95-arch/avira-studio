// Israeli phone normalization for Edge Functions.
//
// This is a deliberate, line-for-line port of normalizeIsraeliPhone() from
// src/lib/whatsappLeadParser.js (lines 110-119 there). It cannot be imported: that
// file lives in the Vite frontend bundle, and Deno Edge Functions have no access to
// src/. Copying follows this codebase's existing "kept in sync manually" convention
// for small, stable, self-contained logic — see the same note in
// _shared/automationGuards.ts (Jerusalem wall-clock math duplicated from
// automation-engine) and in googleCalendarSync.ts.
//
// If you change the rules here, change them in whatsappLeadParser.js too.
//
// Why this matters for the WhatsApp bot specifically: the DB stores phones in local
// form ('0501234567'), while Green API delivers chat ids as '972501234567@c.us'.
// Without normalizing BOTH sides before comparing, no existing client, lead or staff
// member ever matches — and the bot would treat the entire studio as strangers and
// price-list them. That comparison is the module's whole safety boundary.

// Directional/invisible characters WhatsApp and iOS wrap phone numbers in.
const BIDI_AND_INVISIBLES = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');

// Returns the local normalized form ('0501234567') or null if it isn't a plausible
// Israeli number.
export function normalizeIsraeliPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(BIDI_AND_INVISIBLES, '').replace(/\D/g, '');
  if (d.startsWith('00972')) d = '0' + d.slice(5);
  else if (d.startsWith('972')) d = '0' + d.slice(3);
  // Mobile number sent without the leading zero: 547391810 -> 0547391810
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  if ((d.length === 9 || d.length === 10) && d.startsWith('0')) return d;
  return null;
}

// Green API chat id -> local normalized phone.
// '972501234567@c.us' -> '0501234567'. Group chats ('...@g.us') have no single owning
// phone number, so they return null by design — callers must treat that as "not a
// person" rather than "unknown person".
export function chatIdToLocalPhone(chatId: string | null | undefined): string | null {
  if (!chatId) return null;
  if (chatId.endsWith('@g.us')) return null;
  return normalizeIsraeliPhone(chatId.split('@')[0]);
}

export function isGroupChatId(chatId: string | null | undefined): boolean {
  return !!chatId && chatId.endsWith('@g.us');
}
