import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { applyAccent } from './lib/accent';

interface Contact {
  studioName: string;
  accentColor?: string;
  contactLine?: string;
  instagram?: string;
  phone?: string;
}

/**
 * הצהרת נגישות (Israeli accessibility regulations ask every business site for one): what was
 * done, what's known to be missing, and how to reach the studio. Opened from a gallery
 * (?g=<gallery id>) or a studio page (?s=<slug>) to show that studio's own details; never
 * the platform's name. Avira (2026-10-30): photo galleries only, so the photo parts of the original films app's statement
 * are back (Studio Plan kept only the films parts).
 */
export function Accessibility() {
  const [c, setC] = useState<Contact | null>(null);
  useEffect(() => {
    document.title = 'הצהרת נגישות';
    const q = new URLSearchParams(window.location.search);
    const g = q.get('g');
    const s = q.get('s');
    const load = g && /^[a-f0-9]{16}$/.test(g) ? api<Contact>('GET', `/api/watch/${g}`) : s && /^[a-z0-9-]+$/.test(s) ? api<Contact>('GET', `/api/studio/${s}`) : null;
    load
      ?.then((d) => {
        applyAccent(d.accentColor ?? '');
        setC(d);
      })
      .catch(() => setC(null));
  }, []);
  return (
    <main className="a11y-page" data-testid="accessibility">
      <h1>הצהרת נגישות</h1>
      <p>
        {c?.studioName || 'הסטודיו'} רואה חשיבות בכך שכל אחד, כולל אנשים עם מוגבלות, יוכל לצפות בתמונות ולהוריד אותן, לבחור תמונות לאלבום ולעצב אותו. האתר הותאם לפי
        התקן הישראלי ת"י 5568 (המבוסס על WCAG 2.0) ברמה AA, ככל שהדבר אפשרי.
      </p>
      <h2>מה עשינו</h2>
      <ul>
        <li>אפשר לעבור בין כל הכפתורים והתמונות במקלדת (Tab, Enter, חיצים ו-Esc), וכל פריט שנבחר מסומן במסגרת.</li>
        <li>לכל תמונה יש תיאור לקוראי מסך: מספר התמונה, כמה יש בסך הכל, והסט שאליו היא שייכת.</li>
        <li>חלונות (תמונה בגדול, תקנון) נסגרים ב-Esc, והמקלדת נשארת בתוכם כל עוד הם פתוחים.</li>
        <li>צבעי הטקסט עומדים ביחס הניגודיות הנדרש, והאתר מכבד את ההגדרה "הפחתת תנועה" במכשיר.</li>
        <li>אפשר להגדיל את הטקסט בדפדפן, ובטלפון להגדיל תמונה בשתי אצבעות או בהקשה כפולה.</li>
        <li>בסרטים ארוכים יש רשימת פרקים עם מעבר ישיר לכל חלק.</li>
      </ul>
      <h2>מה עוד לא מושלם</h2>
      <ul>
        <li>לסרטים אין כתוביות או תמלול.</li>
      </ul>
      <h2>נתקלתם בבעיה?</h2>
      <p>נשמח לעזור ולתקן. אפשר לפנות לסטודיו:</p>
      <ul>
        {c?.phone && (
          <li>
            טלפון: <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>
          </li>
        )}
        {c?.instagram && (
          <li>
            אינסטגרם:{' '}
            <a href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noopener">
              @{c.instagram}
            </a>
          </li>
        )}
        {c?.contactLine && <li>{c.contactLine}</li>}
        {!c?.phone && !c?.instagram && !c?.contactLine && <li>דרך פרטי הקשר שקיבלתם מהסטודיו.</li>}
      </ul>
      <p className="a11y-date">ההצהרה עודכנה בספטמבר 2026.</p>
    </main>
  );
}
