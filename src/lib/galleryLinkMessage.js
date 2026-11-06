// The galleries' "שלח לזוג" message (template_gallery_link) for the screen — the preview of "המלל לזוג" on the
// galleries page (2026-11-06). Mirrors supabase/functions/_shared/galleryLinkMessage.ts, which renders what is sent
// (the test checks the two give the same text).

export const GALLERY_LINK_TEMPLATE_KEY = "template_gallery_link";

export const DEFAULT_GALLERY_LINK_TEMPLATE = `היי {{names}} 😊
הגלריה מהחתונה שלכם מוכנה! 🎉
לצפייה, הורדה ובחירת תמונות: {{link}}
הגלריה פתוחה עד {{expires}}.
❤ סמנו לב על התמונות לאלבום, וכשסיימתם לחצו "סיימנו לבחור".
👥 לשיתוף עם האורחים — הכפתור "שתפו עם האורחים" בגלריה.
באהבה, אווירה סטודיו`;

// A line whose {{variable}} came out empty is dropped; an empty template falls back to the default.
export function renderGalleryLink(template, vars) {
  const tpl = String(template || "").trim() ? String(template) : DEFAULT_GALLERY_LINK_TEMPLATE;
  return tpl
    .split("\n")
    .filter((line) => [...line.matchAll(/\{\{(\w+)\}\}/g)].every((x) => String(vars[x[1]] ?? "").trim()))
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? "")))
    .join("\n")
    .trim();
}
