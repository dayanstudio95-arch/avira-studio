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
