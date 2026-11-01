// "שלח לזוג" from the galleries (Avira, 2026-11-02, the owner's request): the couple's gallery link with words of its
// own — the work-status "→ זוג" message (template_final_link) speaks of Pixieset and a final video. Editable in
// Settings ← תבניות הודעות. Pure — send-to-couple sends it.

export const GALLERY_LINK_TEMPLATE_KEY = 'template_gallery_link';

// Mirrored in src/components/settings/MessageTemplatesTab.jsx — keep the two in step.
export const DEFAULT_GALLERY_LINK_TEMPLATE = `היי {{names}} 😊
הגלריה מהחתונה שלכם מוכנה! 🎉
לצפייה, הורדה ובחירת תמונות: {{link}}
הגלריה פתוחה עד {{expires}}.
❤ סמנו לב על התמונות לאלבום, וכשסיימתם לחצו "סיימנו לבחור".
👥 לשיתוף עם האורחים — הכפתור "שתפו עם האורחים" בגלריה.
באהבה, אווירה סטודיו`;

// A line whose {{variable}} came out empty is dropped (no "פתוחה עד" without a date); an empty template falls back
// to the default.
export function renderGalleryLink(template: string | null | undefined, vars: Record<string, string>): string {
  const tpl = String(template || '').trim() ? String(template) : DEFAULT_GALLERY_LINK_TEMPLATE;
  return tpl
    .split('\n')
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? '').trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')))
    .join('\n')
    .trim();
}

/** "2026-12-18T21:59:59.000Z" → "18.12.2026" (Israel's day); '' for anything else. */
export function israelDay(iso: string | null | undefined): string {
  const d = new Date(String(iso || ''));
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}`;
}
