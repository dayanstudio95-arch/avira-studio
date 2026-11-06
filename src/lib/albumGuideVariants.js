// The album guide in two versions (2026-11-06, the owner's request): Pixieset couples choose there (Favorites → Share →
// Send To Photographer), couples with the studio's own gallery press ❤ and "סיימנו לבחור". Only "איך בוחרים" and
// "סיימתם לבחור" differ; "מה קורה לאחר ההזמנה" and the rest of the page are one. /album-guide/<tenant>?v=gallery is
// the gallery version (the galleries' "שלח לזוג" links to it). Pure — tested in scripts/test-whatsapp-bot.mjs.

export const GALLERY_VARIANT = "gallery";

// What the gallery version says until the studio writes its own (Settings ← מדריך אלבום ← "הגלריה שלנו").
export const DEFAULT_GALLERY_INTRO = `1- נכנסים לקישור של הגלריה שלכם ולוחצים ❤️ על כל תמונה שאתם רוצים לאלבום
2- בפעם הראשונה הגלריה שואלת "מי בוחר?" (למשל הכלה, החתן או אמא) — כל הלבבות של כולם נכנסים לאלבום
3- יש לסמן בלב ❤️ עד 150 תמונות. למעלה בגלריה רואים כמה בחרתם (אנחנו ממליצים עד 50 תמונות מהתארגנות והצילומי חוץ + 100 מהאירוע עצמו)`;

export const DEFAULT_GALLERY_SUBMISSION = `4- לאחר שסיימתם לבחור - לוחצים על "סיימנו לבחור" ומאשרים. הבחירה מגיעה אלינו ישירות, בלי מייל ובלי פרטים
5- אחרי השליחה הבחירה ננעלת. רוצים לשנות משהו? כתבו לנו בוואטסאפ ונפתח אותה מחדש`;

/** "?v=gallery" → 'gallery'; anything else is the Pixieset version. */
export const guideVariant = (search) => (new URLSearchParams(String(search || "")).get("v") === GALLERY_VARIANT ? GALLERY_VARIANT : "pixieset");

const text = (v) => String(v || "").trim();

/** The two sections of the guide for a version, and the shared "after the order" text. */
export function guideTexts(guide, variant) {
  const g = guide || {};
  const gallery = variant === GALLERY_VARIANT;
  return {
    intro: gallery ? text(g.photoSelectionIntroGallery) || DEFAULT_GALLERY_INTRO : text(g.photoSelectionIntro),
    submission: gallery ? text(g.submissionInstructionsGallery) || DEFAULT_GALLERY_SUBMISSION : text(g.submissionInstructions),
    afterOrder: text(g.afterOrderText),
  };
}
