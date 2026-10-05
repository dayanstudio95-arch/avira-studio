// Which notification a device gets (stage 1ב, 2026-10-05). Pure — tested in
// scripts/test-whatsapp-bot.mjs PART 17. The same defaults are mirrored for the screen in
// src/lib/push.js; if the two ever disagree the server wins (it decides what is sent).

export type PushCategory = 'lead' | 'hot' | 'client' | 'staff' | 'group' | 'other' | 'delivery';

export interface PushPrefs {
  lead: boolean;      // a lead or an unknown number wrote
  hot: boolean;       // the reply to the price list was rated hot
  client: boolean;    // a client / past client wrote
  staff: boolean;     // a team member wrote
  group: boolean;     // a group message — off by default, groups flood
  other: boolean;     // a vendor or a chat marked irrelevant
  delivery: boolean;  // a message was not delivered (failed / stuck on one tick)
  muteUntil: string | null;
  night: { enabled: boolean; start: string; end: string };
}

export const DEFAULT_PREFS: PushPrefs = {
  lead: true, hot: true, client: true, staff: true, group: false, other: false, delivery: true,
  muteUntil: null,
  night: { enabled: true, start: '22:00', end: '07:00' },
};

export function mergePrefs(raw: unknown): PushPrefs {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const night = (p.night && typeof p.night === 'object' ? p.night : {}) as Record<string, unknown>;
  const bool = (k: keyof PushPrefs) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : (DEFAULT_PREFS[k] as boolean));
  const hhmm = (v: unknown, d: string) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? v : d);
  return {
    lead: bool('lead'), hot: bool('hot'), client: bool('client'), staff: bool('staff'),
    group: bool('group'), other: bool('other'), delivery: bool('delivery'),
    muteUntil: typeof p.muteUntil === 'string' ? p.muteUntil : null,
    night: {
      enabled: typeof night.enabled === 'boolean' ? night.enabled : DEFAULT_PREFS.night.enabled,
      start: hhmm(night.start, DEFAULT_PREFS.night.start),
      end: hhmm(night.end, DEFAULT_PREFS.night.end),
    },
  };
}

export function categoryForContactType(type: string | null | undefined): PushCategory {
  switch (type) {
    case 'client': case 'past_client': return 'client';
    case 'staff': return 'staff';
    case 'group': return 'group';
    case 'vendor': case 'irrelevant': return 'other';
    default: return 'lead'; // unknown, lead
  }
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// A window that crosses midnight (22:00–07:00) included.
export function inWindow(nowHHMM: string, start: string, end: string): boolean {
  const n = minutes(nowHHMM), s = minutes(start), e = minutes(end);
  if (s === e) return false;
  return s < e ? n >= s && n < e : n >= s || n < e;
}

// `nowHHMM` is Jerusalem wall time; `nowMs` the instant.
export function shouldNotify(rawPrefs: unknown, category: PushCategory, nowHHMM: string, nowMs = Date.now()): boolean {
  const p = mergePrefs(rawPrefs);
  if (p.muteUntil) {
    const until = new Date(p.muteUntil).getTime();
    if (Number.isFinite(until) && until > nowMs) return false;
  }
  if (p.night.enabled && inWindow(nowHHMM, p.night.start, p.night.end)) return false;
  return !!p[category];
}
