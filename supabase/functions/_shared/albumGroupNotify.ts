// The album group on WhatsApp ("אלבומים סבינה אווירה" — the studio's group with the graphic
// designer) hears what the couple did in the album portal (2026-10-30, the owner's request):
// they asked for corrections in the sketch, finished choosing (→ "ממתין לתשלום"), or uploaded
// a bank-transfer proof. The group is the one chosen for Pixieset (Settings ← חיבורים).
// Only the couple's own actions send — a status the studio changes by hand never does.
// Pure — PART 75. The send itself is in album-portal (best-effort, after the response).

export type AlbumGroupKind = 'revision' | 'payment' | 'transfer';

export const ALBUM_GROUP_CHAT_KEY = 'pixieset_notify_group_chat_id';

// 'false' = off; anything else (no row) = on.
export const ALBUM_GROUP_ENABLED_KEYS: Record<AlbumGroupKind, string> = {
  revision: 'album_group_notify_revision',
  payment: 'album_group_notify_payment',
  transfer: 'album_group_notify_transfer',
};

export const ALBUM_GROUP_TEMPLATE_KEYS: Record<AlbumGroupKind, string> = {
  revision: 'template_album_revision_group',
  payment: 'template_album_payment_group',
  transfer: 'template_album_transfer_group',
};

// Mirrored in src/components/settings/MessageTemplatesTab.jsx — keep the two in step.
export const DEFAULT_ALBUM_GROUP_TEMPLATES: Record<AlbumGroupKind, string> = {
  revision: `✏️ {{names}} ביקשו תיקונים בסקיצת האלבום
📅 חתונה: {{event_date}}
🔁 סבב {{round}} · {{count}} כפולות לתיקון: {{spreads}}`,
  payment: `💳 {{names}} סיימו לבחור — ממתין לתשלום
📅 חתונה: {{event_date}}
📖 {{product}} · כריכה: {{cover}}
➕ {{addons}}
💰 סה"כ לתשלום: ₪{{total}}`,
  transfer: `🏦 {{names}} העלו אישור העברה בנקאית
📅 חתונה: {{event_date}}
צריך לבדוק שהכסף נכנס ולסמן "שולם" במערכת`,
};

// A line whose {{variable}} came out empty is dropped (no "📅 חתונה:" without a date, no
// "➕" without add-ons); an empty template falls back to the default.
export function renderAlbumGroupMessage(kind: AlbumGroupKind, template: string | null | undefined, vars: Record<string, string>): string {
  const tpl = String(template || '').trim() ? String(template) : DEFAULT_ALBUM_GROUP_TEMPLATES[kind];
  return tpl
    .split('\n')
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? '').trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
    .join('\n')
    .trim();
}

// "3, 7, 12, 18" — the spread numbers the couple marked, in order, each once.
export function spreadNumbersText(numbers: Array<number | null | undefined>): string {
  return [...new Set(numbers.filter((n): n is number => Number.isFinite(n as number)))]
    .sort((a, b) => a - b)
    .join(', ');
}

// 3450 → "3,450"
export function formatShekels(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '';
}

// "הטבעת שמות, אלבום הורים, עמוד נוסף × 2" — engraving first, then the add-ons as chosen.
export function addonsText(addons: Array<{ name?: string | null; quantity?: number | null }>, hasEngraving: boolean): string {
  const parts = hasEngraving ? ['הטבעת שמות'] : [];
  for (const a of addons || []) {
    const name = String(a?.name || '').trim();
    if (!name) continue;
    const q = Number(a?.quantity) || 1;
    parts.push(q > 1 ? `${name} × ${q}` : name);
  }
  return parts.join(', ');
}
