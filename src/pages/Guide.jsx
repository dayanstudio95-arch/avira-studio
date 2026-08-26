import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Info,
  Github,
  Database,
  Cloud,
  Globe,
  MessageCircle,
  Receipt,
  CalendarDays,
  Mail,
  Bot,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";

// Static, hardcoded internal reference page -- admin-only (see App.jsx: this
// route is registered ONLY in the final admin <Routes> block, never in any of
// the scoped-role blocks, so it needs no isAdmin() check of its own here).
// Purpose: a permanent "in case I'm on my own" map of every place this
// system's code/data/deployment lives, and every external service it's
// registered with -- so the studio owner can find/change anything even
// without developer/AI help. Update this file whenever a new
// service/integration is added to the system.
//
// Each entry: id, icon, title, description, optional external url/urlLabel,
// optional inAppLocation (where within the system itself the connection/keys
// are configured), optional blanks[] (things this codebase cannot know --
// left for the owner to fill in by hand, never guessed).
const SERVICES = [
  {
    id: "github",
    icon: Github,
    title: "קוד המקור (GitHub)",
    description: "כל קוד המערכת (המסכים, הלוגיקה, הפונקציות) נשמר כאן בשליטת גרסאות. כל שינוי בקוד עובר דרך כאן.",
    url: "https://github.com/dayanstudio95-arch/avira-studio",
    urlLabel: "לצפייה במאגר הקוד",
  },
  {
    id: "supabase",
    icon: Database,
    title: "בסיס הנתונים (Supabase)",
    description:
      "כאן נמצא כל המידע האמיתי של המערכת: לידים, אירועים, אנשי צוות, תשלומים ועוד. יש כאן גם 3 מקומות אחסון קבצים (חוזים חתומים, מדיה שהועלתה, קבצי אלבומים) וכ-40 \"פונקציות שרת\" (Edge Functions) שמריצות את הלוגיקה מאחורי הקלעים -- שינוי בהן דורש עדכון קוד ופריסה מחדש, לא רק לחיצות בדשבורד.",
    url: "https://supabase.com/dashboard/project/yzurelfhjkgqrluifszz",
    urlLabel: "לדשבורד בסיס הנתונים",
  },
  {
    id: "vercel",
    icon: Cloud,
    title: "אחסון ופריסת האתר (Vercel)",
    description:
      "כאן האתר עצמו \"רץ\" בפועל -- כל עדכון קוד שמתפרסם, מתפרסם דרך כאן. גם ניהול הדומיין המחובר לאתר נמצא כאן.",
    url: "https://vercel.com/avira2/avira-studio",
    urlLabel: "לדשבורד הפריסה",
    inAppLocation: "פרויקט avira-studio, ארגון/scope avira2",
  },
  {
    id: "domain",
    icon: Globe,
    title: "הדומיין (new.avira-studio.com)",
    description: "כתובת האתר. מחובר דרך Vercel (ראה למעלה).",
    blanks: ["אצל איזה רשם דומיינים נרשם הדומיין, ואיפה מנוהל ה-DNS אם לא ב-Vercel"],
  },
  {
    id: "greenapi",
    icon: MessageCircle,
    title: "וואטסאפ (Green API)",
    description: "שולח הודעות וואטסאפ אוטומטיות מהמערכת (תזכורות, עדכונים ללקוחות ולצוות).",
    url: "https://console.green-api.com",
    urlLabel: "לדשבורד Green API",
    inAppLocation: "מפתחות החיבור מוזנים ב״הגדרות → חיבורים״ בתוך המערכת",
    blanks: ["מייל/חשבון שנרשמו בו לשירות"],
  },
  {
    id: "greeninvoice",
    icon: Receipt,
    title: "חשבוניות (חשבונית ירוקה / Morning)",
    description: "מפיק חשבוניות וקבלות עבור לקוחות.",
    url: "https://app.greeninvoice.co.il",
    urlLabel: "לדשבורד חשבונית ירוקה",
    inAppLocation: "פרטי החיבור מוזנים ב״הגדרות → חיבורים״ בתוך המערכת",
    blanks: ["מייל/חשבון שנרשמו בו לשירות"],
  },
  {
    id: "googlecalendar",
    icon: CalendarDays,
    title: "יומן Google (סנכרון)",
    description: "כל איש צוות מסנכרן את היומן האישי שלו עם לוח האירועים של המערכת.",
    inAppLocation: "מתחברים דרך ״הגדרות → חיבורים״ או דף הפרופיל האישי; גישה חיצונית (Google Cloud Console) נדרשת רק אם האינטגרציה עצמה נשברת",
    blanks: ["אם קיים חשבון Google Cloud נפרד להגדרות המערכת, ובאיזה מייל"],
  },
  {
    id: "resend",
    icon: Mail,
    title: "שליחת מיילים (Resend)",
    description: "שולח מיילים אוטומטיים מהמערכת, למשל גיבוי חודשי למייל.",
    url: "https://resend.com/login",
    urlLabel: "לדשבורד Resend",
    blanks: ["מייל/חשבון שנרשמו בו לשירות"],
  },
  {
    id: "anthropic",
    icon: Bot,
    title: "עוזר ה-AI (Anthropic Claude)",
    description: "מפעיל את הצ׳אט העוזר החכם בתוך המערכת.",
    url: "https://console.anthropic.com",
    urlLabel: "לדשבורד Anthropic",
    inAppLocation: "אם המפתח יפוג/יוחלף -- מתעדכן בהגדרות שרת (Edge Function secrets), לא דרך האתר",
    blanks: ["מייל/חשבון שנרשמו בו לשירות"],
  },
];

function ServiceCard({ service }) {
  const Icon = service.icon;
  return (
    <Card className="bg-gray-900 border-gray-800 text-white">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="w-4 h-4 text-yellow-400 shrink-0" />
          {service.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-gray-300">{service.description}</p>

        {service.inAppLocation && (
          <p className="text-xs text-gray-500">
            <span className="text-gray-400 font-medium">בתוך המערכת: </span>
            {service.inAppLocation}
          </p>
        )}

        {service.url && (
          <a href={service.url} target="_blank" rel="noopener noreferrer">
            <Button
              variant="outline"
              size="sm"
              className="border-gray-700 text-gray-200 hover:bg-gray-800 hover:text-yellow-400 gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {service.urlLabel || "פתיחת הדשבורד"}
            </Button>
          </a>
        )}

        {service.blanks?.map((blank, i) => (
          <div
            key={i}
            className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 text-yellow-300 text-xs p-2"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{blank}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function Guide() {
  const linkedServices = SERVICES.filter((s) => s.url);

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="bg-gray-900 border-gray-800 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Info className="w-5 h-5 text-yellow-400" />
              מדריך המערכת
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-gray-300 space-y-2">
            <p>
              דף זה מרכז במקום אחד את כל המקומות שבהם המערכת "חיה" -- הקוד, בסיס
              הנתונים, האחסון והפריסה -- ואת כל השירותים החיצוניים שהמערכת רשומה
              ומחוברת אליהם. המטרה: אם יום כלשהו יהיה צורך לשנות או לגשת למשהו
              בלי גישה לעזרה חיצונית, אפשר יהיה לדעת בדיוק איפה כל דבר נמצא, למה
              הוא משמש ולאן להתחבר.
            </p>
            <p className="text-gray-500 text-xs">
              חשוב לעדכן את הדף הזה בכל פעם שמתווסף שירות או חיבור חדש למערכת.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {SERVICES.map((service) => (
            <ServiceCard key={service.id} service={service} />
          ))}
        </div>

        <Card className="bg-gray-900 border-gray-800 text-white">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">טבלת סיכום מהיר</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-400">שירות</TableHead>
                  <TableHead className="text-gray-400">קישור</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedServices.map((service) => (
                  <TableRow key={service.id} className="border-gray-800">
                    <TableCell className="text-gray-200">{service.title}</TableCell>
                    <TableCell>
                      <a
                        href={service.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-yellow-400 hover:underline inline-flex items-center gap-1"
                      >
                        {service.url}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
