// Public, no-login privacy policy page -- /privacy.
//
// Exists because Google Cloud Console refuses to move the OAuth app out of
// "Testing" publishing status without an "Application privacy policy link"
// (the Branding page's yellow "OAuth configuration is incomplete" banner).
// Testing-mode grants expire after 7 days, which is the leading suspect for
// the 2026-08-26 calendar outage, so this page is what unblocks publishing.
//
// Deliberately 100% static: no data fetch, no token, no tenant lookup, no
// auth. Google's reviewers and couples must both be able to open it cold, and
// a policy page that can fail to load is worse than useless. It is therefore
// also the only page in the app that hardcodes studio contact details --
// tenants.email / phone are all empty strings today, so reading them would
// render a policy with no contact address at all.
//
// The Google-specific sections below are not filler: Google's OAuth
// verification explicitly requires the policy to name the scopes requested,
// state what is done with the data, and confirm Limited Use compliance.
const STUDIO_NAME = "אווירה סטודיו";
const CONTACT_EMAIL = "dayanstudio95@gmail.com";
const LAST_UPDATED = "27 באוגוסט 2026";

function Section({ title, children }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold text-white">{title}</h2>
      <div className="text-sm text-gray-300 leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-gray-950 py-10 px-5" dir="rtl">
      <div className="max-w-2xl mx-auto bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 space-y-7">
        <header className="space-y-1 border-b border-gray-800 pb-5">
          <h1 className="text-xl font-bold text-white">מדיניות פרטיות</h1>
          <p className="text-sm text-gray-400">{STUDIO_NAME} — מערכת ניהול הסטודיו</p>
          <p className="text-xs text-gray-500">עודכן לאחרונה: {LAST_UPDATED}</p>
        </header>

        <Section title="מי אנחנו">
          <p>
            {STUDIO_NAME} מפעיל מערכת פנימית לניהול הסטודיו — ניהול פניות של זוגות, אירועים,
            צוות הצילום, תשלומים ואלבומים. המערכת מיועדת לשימוש הסטודיו ולקוחותיו בלבד, ואינה
            שירות פתוח להרשמה.
          </p>
        </Section>

        <Section title="איזה מידע נשמר במערכת">
          <ul className="list-disc pr-5 space-y-1">
            <li>פרטי קשר של זוגות: שמות, טלפון, דוא״ל.</li>
            <li>פרטי האירוע: תאריך, אולם, חבילת הצילום, שעות ולוח זמנים.</li>
            <li>תשובות לשאלון ההפקה שהזוג ממלא לקראת האירוע.</li>
            <li>חוזים חתומים דיגיטלית, כולל מועד החתימה.</li>
            <li>מידע כספי של האירוע: סכומים, מקדמות, תשלומים וחשבוניות.</li>
            <li>פרטי אנשי הצוות המשובצים לאירוע: שם, טלפון, דוא״ל ותעריף.</li>
            <li>קבצי אלבום ותמונות שהועלו לצורך עיצוב האלבום ואישורו.</li>
          </ul>
        </Section>

        <Section title="למה המידע משמש">
          <p>
            המידע משמש אך ורק לצורך אספקת שירותי הצילום שהוזמנו: תיאום האירוע, שיבוץ הצוות,
            שליחת עדכונים ותזכורות לזוג ולצוות בוואטסאפ, הפקת חשבוניות, וניהול תהליך עיצוב
            האלבום. איננו מוכרים מידע, איננו משכירים אותו, ואיננו משתמשים בו לפרסום או
            להעברה לצדדים שלישיים לצרכיהם.
          </p>
        </Section>

        <Section title="חיבור ליומן Google">
          <p>
            הסטודיו יכול לחבר את חשבון ה-Google שלו למערכת, כדי שאירועי הצילום יופיעו
            אוטומטית ביומן. החיבור נעשה דרך מסך ההרשאות הרשמי של Google, והמערכת מבקשת את
            ההרשאות הבאות:
          </p>
          <ul className="list-disc pr-5 space-y-1">
            <li>
              <span dir="ltr" className="font-mono text-xs text-gray-400">
                https://www.googleapis.com/auth/calendar
              </span>{" "}
              — ליצירה ולעדכון של אירועי הצילום ביומן הסטודיו.
            </li>
            <li>
              <span dir="ltr" className="font-mono text-xs text-gray-400">
                https://www.googleapis.com/auth/userinfo.email
              </span>{" "}
              — כדי להציג איזה חשבון Google מחובר.
            </li>
          </ul>
          <p>
            המערכת כותבת ליומן רק אירועים של הסטודיו עצמו — תאריך, שעה, מקום, שמות הזוג
            ופרטי ההפקה. היא אינה קוראת, אוספת או שומרת אירועים אישיים אחרים מהיומן.
          </p>
          <p>
            השימוש במידע שמתקבל מממשקי Google תואם את{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-yellow-400 underline underline-offset-2"
            >
              מדיניות נתוני המשתמש של Google API Services
            </a>
            , לרבות דרישות ה-Limited Use. המידע משמש אך ורק לפעולת הסנכרון המתוארת כאן,
            אינו מועבר לצד שלישי, ואינו משמש לפרסום או לאימון מודלים.
          </p>
          <p>
            ניתן לנתק את החיבור בכל רגע ממסך ההגדרות במערכת, או ישירות בעמוד ההרשאות של
            חשבון Google:{" "}
            <span dir="ltr" className="font-mono text-xs text-gray-400">
              myaccount.google.com/permissions
            </span>
            . לאחר הניתוק המערכת מוחקת את אסימוני הגישה ומפסיקה לעדכן את היומן.
          </p>
        </Section>

        <Section title="שירותים חיצוניים">
          <p>
            המערכת נעזרת בספקי תשתית ושירות מקצועיים, כל אחד למטרה מוגדרת בלבד: אחסון
            נתונים מאובטח, שליחת הודעות וואטסאפ לזוג ולצוות, הפקת חשבוניות דיגיטליות,
            וסנכרון יומן Google כמתואר לעיל. הספקים מקבלים רק את המידע הנחוץ לביצוע אותה
            פעולה.
          </p>
        </Section>

        <Section title="אבטחת מידע">
          <p>
            הנתונים נשמרים בשרתים מאובטחים, מוצפנים בהעברה (HTTPS) ובאחסון. הגישה למערכת
            מוגבלת למשתמשים מורשים של הסטודיו בלבד, לפי הרשאות תפקיד. קישורים ציבוריים
            (חוזה, שאלון, פורטל אלבום) מוגנים באמצעות מזהה סודי ייחודי ונבדקים בצד השרת בכל
            פנייה.
          </p>
        </Section>

        <Section title="שמירת מידע ומחיקה">
          <p>
            המידע נשמר כל עוד הוא נדרש לצורך מתן השירות ולעמידה בחובות חשבונאיות וחוקיות.
            כל זוג רשאי לבקש לעיין במידע שנשמר עליו, לתקן אותו או לבקש את מחיקתו — בכפוף
            לחובות שמירה חוקיות על מסמכים כספיים.
          </p>
        </Section>

        <Section title="יצירת קשר">
          <p>
            לכל שאלה בנושא פרטיות, או לבקשה בנוגע למידע השמור עליכם, ניתן לפנות אלינו בדוא״ל:{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              dir="ltr"
              className="text-yellow-400 underline underline-offset-2"
            >
              {CONTACT_EMAIL}
            </a>
          </p>
        </Section>

        <footer className="border-t border-gray-800 pt-5 text-xs text-gray-500">
          © {new Date().getFullYear()} {STUDIO_NAME}. כל הזכויות שמורות.
        </footer>
      </div>
    </div>
  );
}
