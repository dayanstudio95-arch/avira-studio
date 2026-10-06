// "Please stop messaging me" — recognised from the customer's own words (2026-10-05).
//
// A person who asks to be removed must never again receive a bulk message or a bot
// message. This is deliberately NARROW: a false positive costs a real lead (they are
// silently left out of follow-ups), so only unambiguous requests count —
//   * the whole message is one short removal word ("הסר", "הסירו", "stop"…), or
//   * it contains an explicit removal phrase ("תסירו אותי", "תפסיקו לשלוח"…).
// "לא מעוניינים" is NOT an opt-out (it is a lost lead, not a request to stop messaging),
// and a question like "איך מסירים את הכתם מהשמלה?" must not match.
// The flag is reversible by hand in the contact panel.
import { normalizeIsraeliPhone } from './phone.ts';

const EXACT = ['הסר', 'הסירו', 'הסירי', 'הסרה', 'להסיר', 'תסירו', 'stop', 'unsubscribe', 'remove'];
const PHRASES = [
  'תסירו אותי', 'הסירו אותי', 'להסיר אותי', 'תסיר אותי', 'תסירי אותי',
  'תורידו אותי מהרשימה', 'להוריד אותי מהרשימה', 'הוציאו אותי מהרשימה',
  'תפסיקו לשלוח', 'תפסיק לשלוח', 'אל תשלחו לי', 'לא לשלוח לי יותר', 'stop sending',
];

function normalize(text: string): string {
  return String(text)
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/[֑-ׇ]/g, '')
    .toLowerCase()
    .replace(/[.!?,"'׳״()\-–—:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectOptOut(text: string | null | undefined): boolean {
  if (!text || typeof text !== 'string') return false;
  const t = normalize(text);
  if (!t) return false;
  if (EXACT.includes(t)) return true;
  return PHRASES.some((p) => t.includes(normalize(p)));
}

// ── Respecting it everywhere (AUTO-07, audit 2026-10-05) ───────────────────────────────
// Every AUTOMATED or BULK send to customers (automations, the approval queue, questionnaire
// sends, follow-up dialogs) checks this list. A message the owner types by hand to one
// person is NOT blocked — that is an explicit human decision.
//
// Loaded once per run with a service-role client. A failed lookup THROWS: the caller must
// then send nothing (fail closed) — a skipped reminder costs little, a message to someone
// who asked us to stop costs trust and risks the WhatsApp number.
export interface OptOutList {
  phones: Set<string>;   // local form, e.g. "0501234567"
  chatIds: Set<string>;  // e.g. "972501234567@c.us" (catches non-Israeli numbers too)
}

export async function loadOptOutList(supabase: any, tenantId: string): Promise<OptOutList> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('phone, chat_id')
    .eq('tenant_id', tenantId)
    .not('opted_out_at', 'is', null);
  if (error) throw new Error(`opt-out list: ${error.message}`);
  return buildOptOutList(data || []);
}

export function buildOptOutList(rows: { phone?: string | null; chat_id?: string | null }[]): OptOutList {
  const phones = new Set<string>();
  const chatIds = new Set<string>();
  for (const r of rows) {
    const local = normalizeIsraeliPhone(r.phone || '') || (r.chat_id ? normalizeIsraeliPhone(r.chat_id.split('@')[0]) : null);
    if (local) phones.add(local);
    if (r.chat_id) chatIds.add(r.chat_id);
  }
  return { phones, chatIds };
}

export function isOptedOut(list: OptOutList | null | undefined, rawPhoneOrChatId: string | null | undefined): boolean {
  if (!list || !rawPhoneOrChatId) return false;
  const raw = String(rawPhoneOrChatId).trim();
  if (list.chatIds.has(raw)) return true;
  const local = normalizeIsraeliPhone(raw.includes('@') ? raw.split('@')[0] : raw);
  if (local && list.phones.has(local)) return true;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  return !!digits && list.chatIds.has(`${digits}@c.us`);
}

export const OPTED_OUT_REASON = 'ביקש/ה הסרה ("הסר")';
