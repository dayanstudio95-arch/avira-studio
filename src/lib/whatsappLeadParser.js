/**
 * whatsappLeadParser.js — זיהוי פרטי ליד מהודעת וואטסאפ אחת.
 *
 * הרעיון (§46 בתוכנית): הזוג שולח הודעה אחת בפורמט שהסטודיו מכתיב —
 *   דניאל וסבינה
 *   16/9/27
 *   עדיה
 *   0547391810
 * והמערכת ממלאת את ארבעת השדות במקום הקלדה ידנית.
 *
 * ‼️ שני כללים קריטיים בקובץ הזה:
 *
 * 1. לעולם לא להשתמש ב-toISOString() לבניית תאריך.
 *    ב-TZ=Asia/Jerusalem הביטוי new Date(2027, 8, 16).toISOString().split("T")[0]
 *    מחזיר "2027-09-15" — יום אחד לפני, על כל חתונה. התאריך נבנה כאן בשרשור
 *    מחרוזות בלבד (toIso), ותמיד עובר אימות הלוך-ושוב (isRealDate), כי
 *    new Date(2027, 1, 31) הופך בשקט ל-3 במרץ.
 *
 * 2. אימייל לעולם לא נכנס לשדה האימייל של הליד. leads.email הוא נמען החשבונית
 *    (Leads.jsx:822 → InvoiceDialog.jsx:124), וברירת המחדל avira.media1@gmail.com
 *    מכוונת כדי שחשבוניות יחזרו לסטודיו. אימייל שמזוהה כאן עובר להערות בלבד.
 *
 * ההפרדה שמונעת בלבול בין תאריך לטלפון היא ספירת ספרות: תאריך מלא מגיע ל-8 ספרות
 * לכל היותר, וטלפון ישראלי הוא 9-10 ספרות. שתי המחלקות לא יכולות להתנגש.
 *
 * הקובץ טהור וללא תלויות בכוונה. הוא יושב ב-src/lib/ ולכן לא נכלל ב-eslint.config.js
 * ולא ב-jsconfig.json — ההוכחה היחידה לנכונותו היא ה-Node harness.
 */

// כל הביטויים הרגולריים שמכילים תווים בלתי-נראים נבנים דרך new RegExp עם מחרוזת
// escape מפורשת, ולא כליטרל. זו החלטה מכוונת: תו בלתי-נראה שמוטבע ישירות במחלקת
// תווים אינו ניתן לביקורת בקוד — אי אפשר להבחין בעין בין גרסה נכונה לגרסה שבה התו
// אבד בהעתקה. בצורה הזו הקובץ קריא ובר-אימות.

// תווי כיווניות ותווים בלתי-נראים ש-WhatsApp ו-iOS עוטפים בהם מספרי טלפון.
// בלי הניקוי הזה הם נשמרים לתוך עמודות טקסט ב-DB.
const BIDI_AND_INVISIBLES = new RegExp('[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2069\\uFEFF]', 'g');
// כל מקפי היוניקוד (מקף עברי, en/em dash, מינוס) → מקף ASCII רגיל
const UNICODE_DASHES = new RegExp('[\\u2010-\\u2015\\u2212\\u05BE]', 'g');
// רווחים לא-רגילים (NBSP, narrow NBSP) → רווח רגיל
const NBSP = new RegExp('[\\u00A0\\u202F]', 'g');
// טווח האותיות העבריות, לשימוש בבניית ביטויים דרך new RegExp
const HEB = '\\u0590-\\u05FF';

// תאריך עם שם חודש עברי, למשל "16 בספטמבר 2027"
const HEB_MONTH_DATE_RE = new RegExp('^(\\d{1,2})\\s*(?:ב)?[-\\s]?([' + HEB + ']+)\\.?(?:\\s+(\\d{2,4}))?$');
// סימן לשמות זוג: מילה שנייה ואילך שמתחילה ב-ו׳
const COUPLE_VAV_RE = new RegExp('\\s+ו[' + HEB + ']');

const MAX_LINES = 30;
const MAX_CHARS = 2000;
const MAX_COUPLE_NAME_LEN = 60;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

// שורה שהיא "צורת טלפון": ספרות ומפרידים בלבד. הבדיקה הזו מונעת מ-"עדיה 12345678901"
// להיחשב טלפון.
const PHONE_SHAPE_RE = /^[\d\s()+\-.]+$/;

const HEBREW_MONTHS = {
  'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
  'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
};

// תוויות מפורשות. חלופה ארוכה תמיד לפני הקצרה שמוכלת בה, אחרת "שמות הזוג"
// היה נתפס ע"י "שם". תווית מנצחת כל היוריסטיקה אחרת.
const LABEL_RE = new RegExp(
  '^(שמות הזוג|תאריך האירוע|מקום האירוע|שמות|טלפון|נייד|פלאפון|תאריך|אולם|מקום|אימייל|מייל|הזוג|שם' +
  '|name|date|phone|venue|email)\\s*[:\\-]\\s*(.+)$',
  'i'
);

const LABEL_TO_FIELD = {
  'שמות הזוג': 'coupleNames', 'שמות': 'coupleNames', 'שם': 'coupleNames', 'הזוג': 'coupleNames', 'name': 'coupleNames',
  'תאריך האירוע': 'eventDate', 'תאריך': 'eventDate', 'date': 'eventDate',
  'טלפון': 'phoneNumber', 'נייד': 'phoneNumber', 'פלאפון': 'phoneNumber', 'phone': 'phoneNumber',
  'מקום האירוע': 'venueName', 'אולם': 'venueName', 'מקום': 'venueName', 'venue': 'venueName',
  'אימייל': 'email', 'מייל': 'email', 'email': 'email',
};

/** בונה תאריך ISO בשרשור מחרוזות. אף פעם לא toISOString — ראה הערת הקובץ. */
function toIso(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** אימות הלוך-ושוב: new Date(2027, 1, 31) הופך בשקט ל-3 במרץ. */
function isRealDate(y, m, d) {
  if (!(y >= 1900 && y <= 2199) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function localTodayIso(today) {
  return toIso(today.getFullYear(), today.getMonth() + 1, today.getDate());
}

function expandYear(raw) {
  const n = Number(raw);
  if (raw.length === 4) return n;
  if (raw.length === 2) return 2000 + n;
  return null;
}

/**
 * ממיר מספר טלפון לפורמט ישראלי מקומי, ספרות בלבד וללא מקפים —
 * בדיוק כמו הקוד שהיה מוטבע ב-LeadFormDialog.jsx:200-207, כדי ש-Leads.jsx:641
 * (בניית קישור wa.me) ו-_shared/whatsapp.ts:90 ימשיכו לעבוד ללא שינוי.
 * @returns {string|null}
 */
export function normalizeIsraeliPhone(raw) {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(BIDI_AND_INVISIBLES, '').replace(/\D/g, '');
  if (d.startsWith('00972')) d = '0' + d.slice(5);
  else if (d.startsWith('972')) d = '0' + d.slice(3);
  // מספר נייד שנשלח בלי האפס המוביל: 547391810 → 0547391810
  if (d.length === 9 && !d.startsWith('0')) d = '0' + d;
  if ((d.length === 9 || d.length === 10) && d.startsWith('0')) return d;
  return null;
}

/**
 * מפרש תאריך ישראלי משורה שלמה.
 * @returns {{iso: string, warnings: string[]}|null}
 */
export function parseIsraeliDate(raw, today = new Date()) {
  if (!raw) return null;
  const line = String(raw).trim();
  const warnings = [];
  let y = null, m = null, d = null;

  let mt;
  if ((mt = line.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    // ISO
    y = Number(mt[1]); m = Number(mt[2]); d = Number(mt[3]);
  } else if ((mt = line.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/))) {
    const a = Number(mt[1]), b = Number(mt[2]);
    y = expandYear(mt[3]);
    if (y === null) return null;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (a <= 12 && b > 12) { d = b; m = a; warnings.push('זוהה פורמט אמריקאי (חודש/יום) — התאריך הוחלף'); }
    else if (a <= 12 && b <= 12) {
      d = a; m = b;
      if (a !== b) warnings.push('תאריך דו-משמעי — פורש כיום/חודש. ודא שהתאריך נכון');
    } else return null; // שני המספרים > 12
  } else if ((mt = line.match(/^(\d{1,2})[./-](\d{1,2})$/))) {
    const a = Number(mt[1]), b = Number(mt[2]);
    if (b > 12) return null;
    d = a; m = b;
    if (a <= 12 && a !== b) warnings.push('תאריך דו-משמעי — פורש כיום/חודש. ודא שהתאריך נכון');
    // ללא שנה: השנה הבאה שבה התאריך עדיין בעתיד
    const cy = today.getFullYear();
    y = isRealDate(cy, m, d) && toIso(cy, m, d) >= localTodayIso(today) ? cy : cy + 1;
    warnings.push('לא צוינה שנה — הושלמה אוטומטית');
  } else if ((mt = line.match(HEB_MONTH_DATE_RE))) {
    const mon = HEBREW_MONTHS[mt[2]];
    if (!mon) return null;
    d = Number(mt[1]); m = mon;
    if (mt[3]) {
      y = expandYear(mt[3]);
      if (y === null) return null;
    } else {
      const cy = today.getFullYear();
      y = isRealDate(cy, m, d) && toIso(cy, m, d) >= localTodayIso(today) ? cy : cy + 1;
      warnings.push('לא צוינה שנה — הושלמה אוטומטית');
    }
  } else {
    return null;
  }

  if (!isRealDate(y, m, d)) return null;

  const iso = toIso(y, m, d);
  if (iso < localTodayIso(today)) warnings.push('התאריך שזוהה כבר עבר — ודא שהוא נכון');
  return { iso, warnings };
}

/** סימן לשמות זוג: מילה שנייה ואילך שמתחילה ב-ו', או &, או +. */
function hasCoupleSignal(line) {
  return COUPLE_VAV_RE.test(line) || /[&+]/.test(line) || /\sו-/.test(line);
}

/**
 * מפרש הודעת וואטסאפ שלמה.
 * @param {string} text
 * @param {Date} [today] — מוזרק כדי שה-harness יוכל לקבע "היום"
 * @returns {{fields: Object, leftovers: string[], warnings: string[]}}
 *   fields מכיל רק מפתחות שזוהו בפועל — coupleNames / eventDate / phoneNumber / venueName.
 *   לעולם לא email (ראה הערת הקובץ).
 */
export function parseWhatsAppLead(text, today = new Date()) {
  const fields = {};
  const leftovers = [];
  const warnings = [];

  if (!text || typeof text !== 'string') return { fields, leftovers, warnings };

  const addLeftover = (line, reason) => {
    leftovers.push(line);
    warnings.push(reason || `לא זוהה — הועבר להערות: ${line}`);
  };

  const setOnce = (key, value, line, dupReason) => {
    if (fields[key] === undefined) { fields[key] = value; return true; }
    addLeftover(line, dupReason);
    return false;
  };

  let clean = text;
  if (clean.length > MAX_CHARS) {
    clean = clean.slice(0, MAX_CHARS);
    warnings.push(`ההודעה ארוכה מדי — נקלטו ${MAX_CHARS} התווים הראשונים בלבד`);
  }
  clean = clean
    .replace(BIDI_AND_INVISIBLES, '')
    .replace(NBSP, ' ')
    .replace(UNICODE_DASHES, '-');

  let lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_LINES) {
    warnings.push(`ההודעה מכילה יותר מ-${MAX_LINES} שורות — נקלטו ${MAX_LINES} הראשונות בלבד`);
    lines = lines.slice(0, MAX_LINES);
  }

  const pool = [];

  for (const line of lines) {
    // 1. תווית מפורשת — הקצאה קשיחה שגוברת על כל יוריסטיקה
    const labelMatch = line.match(LABEL_RE);
    if (labelMatch) {
      const key = LABEL_TO_FIELD[labelMatch[1].toLowerCase()] || LABEL_TO_FIELD[labelMatch[1]];
      const value = labelMatch[2].trim();
      if (key === 'email') { addLeftover(line, `אימייל לא נכנס לשדה האימייל (נמען החשבונית) — הועבר להערות: ${value}`); continue; }
      if (key === 'phoneNumber') {
        const p = normalizeIsraeliPhone(value);
        if (p) setOnce('phoneNumber', p, line, `נמצא יותר ממספר טלפון אחד — השני הועבר להערות: ${value}`);
        else addLeftover(line, `מספר הטלפון לא זוהה — הועבר להערות: ${value}`);
        continue;
      }
      if (key === 'eventDate') {
        const dt = parseIsraeliDate(value, today);
        if (dt) { if (setOnce('eventDate', dt.iso, line, `נמצא יותר מתאריך אחד — השני הועבר להערות: ${value}`)) warnings.push(...dt.warnings); }
        else addLeftover(line, `התאריך לא זוהה — הועבר להערות: ${value}`);
        continue;
      }
      if (key === 'coupleNames' || key === 'venueName') {
        setOnce(key, value, line, `נמצאה יותר משורה אחת מסוג זה — הועברה להערות: ${value}`);
        continue;
      }
    }

    // 2. אימייל ללא תווית — להערות, אף פעם לא לשדה האימייל
    if (EMAIL_RE.test(line)) {
      addLeftover(line, `אימייל לא נכנס לשדה האימייל (נמען החשבונית) — הועבר להערות: ${line}`);
      continue;
    }

    // 3. תאריך לפני טלפון: תאריך מלא הוא עד 8 ספרות, טלפון הוא 9-10 — אין התנגשות
    const dt = parseIsraeliDate(line, today);
    if (dt) {
      if (setOnce('eventDate', dt.iso, line, `נמצא יותר מתאריך אחד — השני הועבר להערות: ${line}`)) warnings.push(...dt.warnings);
      continue;
    }

    // 4. טלפון
    if (PHONE_SHAPE_RE.test(line)) {
      const p = normalizeIsraeliPhone(line);
      if (p) {
        setOnce('phoneNumber', p, line, `נמצא יותר ממספר טלפון אחד — השני הועבר להערות: ${line}`);
        continue;
      }
    }

    // 5. טקסט חופשי — נכנס לבריכה לפי סדר
    pool.push(line);
  }

  // הקצאת הבריכה לפי סדר ההודעה: השורה הראשונה היא שמות הזוג, הבאה היא האולם.
  // מכוון: הפורמט מוכתב ע"י הסטודיו, ולכן סדר עדיף על ניחוש. שורה ארוכה מ-60 תווים
  // לא יכולה להיות שמות זוג.
  const rest = pool.slice();
  if (fields.coupleNames === undefined) {
    const idx = rest.findIndex((l) => l.length <= MAX_COUPLE_NAME_LEN);
    if (idx !== -1) {
      const chosen = rest[idx];
      fields.coupleNames = chosen;
      // אזהרה רק כשיש חשד ממשי לסדר הפוך: השורה שנבחרה ללא סימן זוג, ושורה מאוחרת יותר עם סימן.
      if (!hasCoupleSignal(chosen) && rest.slice(idx + 1).some(hasCoupleSignal)) {
        warnings.push('ייתכן שהשורות בסדר שונה — ודא ששמות הזוג נקלטו נכון');
      }
      rest.splice(idx, 1);
    }
  }
  if (fields.venueName === undefined && rest.length > 0) {
    fields.venueName = rest.shift();
  }
  for (const line of rest) addLeftover(line);

  return { fields, leftovers, warnings };
}
