// "The couple finished choosing their album photos" in the gallery → the album group on WhatsApp (Avira, 2026-10-31,
// the owner's request; 0099). The message's words — editable in Settings ← תבניות הודעות — and the link to the chosen
// photos. Pure — the send itself is in gallery-choice-notify.

export const GALLERY_CHOICE_TEMPLATE_KEY = 'template_gallery_choice_group';
// 'false' = the automatic message (the couple's press) is off; the studio's button still sends.
export const GALLERY_CHOICE_ENABLED_KEY = 'gallery_choice_group_enabled';

// Mirrored in src/components/settings/MessageTemplatesTab.jsx — keep the two in step.
export const DEFAULT_GALLERY_CHOICE_TEMPLATE = `✅ {{names}} סיימו לבחור תמונות לאלבום
📅 חתונה: {{event_date}}
📍 {{venue}}
📞 {{phone}}
🖼️ נבחרו {{count}} תמונות
🔗 להורדה: {{link}}`;

// A line whose {{variable}} came out empty is dropped (no "📍" without a venue); an empty template falls back to the default.
export function renderGalleryChoice(template: string | null | undefined, vars: Record<string, string>): string {
  const tpl = String(template || '').trim() ? String(template) : DEFAULT_GALLERY_CHOICE_TEMPLATE;
  return tpl
    .split('\n')
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? '').trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
    .join('\n')
    .trim();
}

/** The album designer's page: `<gallery site>/choice/<token>`; '' for a token that isn't one. */
export function galleryChoiceLink(base: string, token: string | null | undefined): string {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return '';
  return `${String(base || '').replace(/\/+$/, '')}/choice/${t}`;
}

/** "0501234567" → "050-1234567"; anything else as it is. */
export function phoneForPeople(phone: string | null | undefined): string {
  const p = String(phone || '').trim();
  return /^0\d{9}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}
