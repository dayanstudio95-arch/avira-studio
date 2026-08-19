import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Save, MessageCircle } from "lucide-react";
import { toast } from "sonner";

const TEMPLATES = [
  {
    key: "template_contract",
    label: "שליחת חוזה",
    description: "ההודעה שתישלח כשלוחצים על 'שלח חוזה בוואטסאפ'",
    defaultValue: `שלום {{names}},

קישור לחוזה שלכם לחתימה:
{{contract_link}}

נשמח שתחתמו בהקדם 🙏`,
    variables: ["{{names}}", "{{event_date}}", "{{contract_link}}"],
  },
  {
    key: "template_questionnaire",
    label: "שאלון הפקה",
    description: "ההודעה שתישלח כשלוחצים על 'שלח שאלון בוואטסאפ'",
    defaultValue: `שלום {{names}},

נשמח אם תמלאו את השאלון הקצר לפני האירוע:
{{questionnaire_link}}

תודה! 📸`,
    variables: ["{{names}}", "{{event_date}}", "{{questionnaire_link}}"],
  },
  {
    key: "template_reminder",
    label: "תזכורת אירוע",
    description: "תבנית לתזכורת לפני האירוע",
    defaultValue: `שלום {{names}},

רצינו להזכיר שהאירוע שלכם מתקיים ב-{{event_date}}.
אנחנו מצפים לראותכם! 🎉`,
    variables: ["{{names}}", "{{event_date}}"],
  },
  {
    key: "template_lead_followup",
    label: "תזכורת פולו-אפ (חוזה לא נחתם)",
    description: "ההודעה שנשלחת מדף הלידים בכפתור 'שלח תזכורת ללידים בפולו-אפ' — ללידים ששלחתם להם חוזה ועדיין לא חתמו",
    defaultValue: `היי {{names}} 😊
רצינו לבדוק שקיבלתם את קישור החוזה ולוודא שהכל בסדר מצידכם.
נשמח שתחתמו בהקדם כדי לשריין את התאריך:
{{contract_link}}

זמינים לכל שאלה! 📸`,
    variables: ["{{names}}", "{{event_date}}", "{{contract_link}}"],
  },
  {
    key: "template_payment_request",
    label: "דרישת תשלום",
    description: "ההודעה שתישלח כשלוחצים על 'שלח דרישת תשלום' בוואטסאפ",
    defaultValue: `היי {{names}}, מזל טוב! 🥂 \nנשארה יתרה לתשלום על סך {{balance}} ש"ח.\nניתן לשלם כאן: {{payment_link}}`,
    variables: ["{{names}}", "{{balance}}", "{{payment_link}}"],
  },
  {
    key: "template_album_graphic",
    label: "שליחה לגרפיקאית (סקיצת אלבום)",
    description: "ההודעה שתישלח לגרפיקאית כשלוחצים על 'גרפיקה' בסטטוס עבודה",
    defaultValue: `היי, מצורף לינק לאירוע של {{names}} שהתקיים ב-{{event_date}} באולם {{venue}}.\nנשמח לקבל סקיצה לאלבום 🙏\nטלפון הזוג: {{couple_phone}}\nלינק לחומרים: {{album_sketch_link}}`,
    variables: ["{{names}}", "{{event_date}}", "{{venue}}", "{{couple_phone}}", "{{album_sketch_link}}"],
  },
  {
    key: "template_album_couple",
    label: "שליחת סקיצת אלבום לזוג",
    description: "ההודעה שתישלח לזוג כשלוחצים על 'זוג' (אלבום) בסטטוס עבודה",
    defaultValue: `שלום {{names}} 😊\nמוכנה הסקיצה לאלבום שלכם!\nלצפייה: {{album_sketch_link}}\nנשמח לשמוע מה דעתכם 📀`,
    variables: ["{{names}}", "{{event_date}}", "{{album_sketch_link}}"],
  },
  {
    key: "template_raw_link",
    label: "שליחת חומר גלם לעורך",
    description: "ההודעה שתישלח לעורך/ת כשלוחצים על 'שלח לעריכה' בסטטוס עבודה",
    defaultValue: `היי {{editor_name}}, מצורף לינק לחומר הגלם של {{names}} מתאריך {{event_date}} באולם {{venue}}.\nטלפון הזוג: {{couple_phone}}\nלינק לחומרים: {{raw_link}}`,
    variables: ["{{editor_name}}", "{{names}}", "{{event_date}}", "{{venue}}", "{{couple_phone}}", "{{raw_link}}"],
  },
  {
    key: "template_final_link",
    label: "שליחת סרטון/תמונות סופי לזוג",
    description: "ההודעה שתישלח לזוג כשלוחצים על 'שלח לזוג' (חומר סופי) בסטטוס עבודה",
    defaultValue: `שלום {{names}} 😊\nתאריך האירוע: {{event_date}}\nלצפייה: {{final_link}}`,
    variables: ["{{names}}", "{{event_date}}", "{{venue}}", "{{final_link}}"],
  },
  {
    key: "template_invoice_message",
    label: "שליחת חשבונית",
    description: "נוסח מוכן להודעת וואטסאפ עם קישור לחשבונית שהופקה (לשימוש ידני — הדביקו/שלחו בעצמכם, אין עדיין כפתור שליחה אוטומטי)",
    defaultValue: `היי {{names}}! ✅\nמצורפת החשבונית עבור התשלום שהתקבל:\n{{invoice_link}}\nתודה רבה!`,
    variables: ["{{names}}", "{{invoice_link}}"],
  },
  {
    key: "template_schedule_summer",
    label: "לוז קיץ",
    description: "ההודעה שתישלח כשלוחצים על כפתור 'לוז קיץ' בכרטיס הליד/אירוע",
    defaultValue: `שלום {{names}} 😊\n\nהנה הלוז המשוער ליום האירוע ({{event_date}}):\n\n[הכניסו כאן את פרטי הלוז]`,
    variables: ["{{names}}", "{{event_date}}", "{{venue}}"],
  },
  {
    key: "template_schedule_winter",
    label: "לוז חורף",
    description: "ההודעה שתישלח כשלוחצים על כפתור 'לוז חורף' בכרטיס הליד/אירוע",
    defaultValue: `שלום {{names}} 😊\n\nהנה הלוז המשוער ליום האירוע ({{event_date}}):\n\n[הכניסו כאן את פרטי הלוז]`,
    variables: ["{{names}}", "{{event_date}}", "{{venue}}"],
  },
  {
    key: "template_questionnaire_reminder",
    label: "תזכורת למילוי שאלון הפקה",
    description: "ההודעה שנשלחת ע\"י supabase/functions/send-questionnaire-reminders לזוגות עם אירוע מתקרב שעדיין לא מילאו שאלון — היתה קודם ניתנת לעריכה רק דרך מסך אוטומציות-צוות המנוטרל בהגדרות; זהו כעת המקום היחיד לעריכתה. שימו לב: תבנית זו משתמשת בתחביר $משתנה (לא {{משתנה}}) כי כך הפונקציה בשרת מחליפה את המשתנים בפועל.",
    defaultValue: `היי $couple_names, החודש שלכם כבר כמעט כאן! 🎊 נשמח אם תמלאו את השאלון: $questionnaire_link`,
    variables: ["$couple_names", "$questionnaire_link", "$event_date", "$venue"],
  },
];

export default function MessageTemplatesTab() {
  const [templates, setTemplates] = useState({});
  const [settingIds, setSettingIds] = useState({});
  const [saving, setSaving] = useState({});

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    const settings = await base44.entities.AppSetting.list();
    const loaded = {};
    const ids = {};
    TEMPLATES.forEach(t => {
      const found = settings.find(s => s.key === t.key);
      loaded[t.key] = found?.value || t.defaultValue;
      if (found) ids[t.key] = found.id;
    });
    setTemplates(loaded);
    setSettingIds(ids);
  };

  const handleSave = async (key) => {
    setSaving(prev => ({ ...prev, [key]: true }));
    try {
      if (settingIds[key]) {
        await base44.entities.AppSetting.update(settingIds[key], { value: templates[key] });
      } else {
        const created = await base44.entities.AppSetting.create({ key, value: templates[key] });
        setSettingIds(prev => ({ ...prev, [key]: created.id }));
      }
      toast.success("התבנית נשמרה בהצלחה");
    } catch {
      toast.error("שגיאה בשמירה");
    }
    setSaving(prev => ({ ...prev, [key]: false }));
  };

  return (
    <div className="space-y-6" dir="rtl">
      <Card className="bg-blue-900/20 border-blue-700/40">
        <CardContent className="p-4">
          <p className="text-blue-300 text-sm">
            💡 ניתן להשתמש במשתנים בתוך התבניות. המערכת תחליף אותם אוטומטית לפני השליחה:
            <span className="font-mono text-yellow-300 mx-1">{"{{names}}"}</span> שמות הזוג,
            <span className="font-mono text-yellow-300 mx-1">{"{{event_date}}"}</span> תאריך האירוע,
            <span className="font-mono text-yellow-300 mx-1">{"{{contract_link}}"}</span> לינק לחוזה,
            <span className="font-mono text-yellow-300 mx-1">{"{{questionnaire_link}}"}</span> לינק לשאלון,
            <span className="font-mono text-yellow-300 mx-1">{"{{balance}}"}</span> יתרה לתשלום,
            <span className="font-mono text-yellow-300 mx-1">{"{{payment_link}}"}</span> לינק לתשלום.
          </p>
        </CardContent>
      </Card>

      {TEMPLATES.map(t => (
        <Card key={t.key} className="bg-gray-900/50 border-gray-800">
          <CardHeader className="border-b border-gray-800 pb-4">
            <CardTitle className="text-white flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-green-400" />
              {t.label}
            </CardTitle>
            <p className="text-gray-400 text-sm mt-1">{t.description}</p>
            <div className="flex gap-2 flex-wrap mt-2">
              {t.variables.map(v => (
                <button
                  key={v}
                  onClick={() => setTemplates(prev => ({ ...prev, [t.key]: (prev[t.key] || "") + v }))}
                  className="font-mono text-xs bg-gray-800 hover:bg-gray-700 text-yellow-300 border border-gray-600 px-2 py-1 rounded"
                >
                  {v}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <textarea
              value={templates[t.key] || ""}
              onChange={e => setTemplates(prev => ({ ...prev, [t.key]: e.target.value }))}
              rows={5}
              dir="rtl"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white text-sm resize-y focus:outline-none focus:border-yellow-400"
            />
            <Button
              onClick={() => handleSave(t.key)}
              disabled={saving[t.key]}
              className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
            >
              <Save className="w-4 h-4 mr-2" />
              {saving[t.key] ? "שומר..." : "שמור תבנית"}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}