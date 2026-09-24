import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bot, Inbox, UserSearch, Filter, MoonStar, Hand, ListChecks, FileText, Flame, Timer, FlaskConical,
  Save, Upload, Image as ImageIcon, AlertTriangle, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { uploadFile } from "@/api/uploadFile";
import BotStepCard from "@/components/bot/BotStepCard";
import TermListEditor from "@/components/bot/TermListEditor";
import BotSimulator from "@/components/whatsapp/BotSimulator";
import QuietHoursCard from "@/components/settings/QuietHoursCard";
import { useBotSettings, DEFAULT_GREETING, DEFAULT_NUDGE } from "@/components/settings/useBotSettings";
import {
  TERM_LISTS, LEAD_FIELDS, renderQuestionPreview, DEFAULT_QUESTION_TEXT_ONE, DEFAULT_QUESTION_TEXT_MANY,
} from "@/lib/botTerms";
import { FOLLOWUP_TEMPLATE_KEY, FOLLOWUP_AFTER_DAYS_KEY } from "@/components/whatsapp/WhatsAppFollowUpDialog";

// 🤖 מרכז שליטה לבוט (2026-09-24).
//
// The owner's question: "how do I know how the WhatsApp page works, what affects what,
// can I change the behaviour without code?" The answer is this page: the bot's chain
// drawn as ten steps in the order a message actually goes through them, each step with
// its own settings in place, and a "קבוע בקוד" line naming what is deliberately not a
// setting. The simulator at the bottom walks the same steps for a message he types.
//
// What is configurable here that used to be a constant: the gate's words (additions
// and switched-off built-ins), which details are required before the price list, the
// question wording, the per-conversation message ceiling, and the hours before the
// nudge. What is NOT: the rule itself (two independent signals, vendor veto), the
// contact lookup, the hot-lead prompt. A free "if X then Y" builder was considered and
// declined — one wrong rule sends a price list to a colleague, which is the failure the
// gate exists to prevent.
//
// The built-in word lists are fetched from whatsapp-bot-simulate `{mode:'describe'}`,
// not copied into src/: one source of truth for what the bot knows.

const help = (text) => <p className="text-gray-500 text-xs mt-1 mb-2">{text}</p>;
const inputCls = "bg-gray-800 border-gray-700 text-white";

export default function BotControlCenter() {
  const { user } = useAuth();
  const canManage = isAdmin(user);
  const { values, setValue, save, loading, saving, dirty } = useBotSettings();

  // What the bot knows right now, from the server (built-in lists + effective lists).
  const [described, setDescribed] = useState(null);
  const [describeError, setDescribeError] = useState(null);
  const loadDescribe = async () => {
    try {
      const res = await base44.functions.invoke("whatsappBotSimulate", { mode: "describe" });
      setDescribed(res?.data || null);
      setDescribeError(null);
    } catch (e) {
      setDescribeError(e?.message || "שגיאה לא ידועה");
    }
  };
  useEffect(() => {
    loadDescribe();
  }, []);

  const [isUploading, setIsUploading] = useState(false);
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("צריך לבחור קובץ תמונה");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("התמונה גדולה מדי (מעל 5MB). נסה לייצא אותה קטנה יותר.");
      return;
    }
    setIsUploading(true);
    try {
      const { file_url } = await uploadFile({ file });
      setValue("whatsapp_pricelist_url", file_url);
      toast.success("התמונה הועלתה. עכשיו צריך ללחוץ על שמור.");
    } catch (err) {
      console.error("Error uploading price list image:", err);
      toast.error(`העלאת התמונה נכשלה: ${err?.message || "שגיאה לא ידועה"}`);
    }
    setIsUploading(false);
  };

  const handleSave = async () => {
    const ok = await save();
    if (ok) loadDescribe();
  };

  const enabled = !!values.whatsapp_bot_enabled;
  const required = values.whatsapp_required_fields || [];
  const requiredLabels = LEAD_FIELDS.filter((f) => required.includes(f.key)).map((f) => f.label);
  const maxMessages = Math.min(6, Math.max(2, parseInt(values.whatsapp_max_bot_messages, 10) || 3));
  const questionSettings = useMemo(
    () => ({
      questionTextOne: values.whatsapp_question_text_one || DEFAULT_QUESTION_TEXT_ONE,
      questionTextMany: values.whatsapp_question_text_many || DEFAULT_QUESTION_TEXT_MANY,
    }),
    [values.whatsapp_question_text_one, values.whatsapp_question_text_many]
  );

  // The effective lists for warnings: server's view, adjusted for unsaved edits.
  const effectiveForWarnings = useMemo(() => {
    const b = described?.builtinTerms || {};
    const out = {};
    for (const l of TERM_LISTS) {
      out[l.key] = [...(b[l.key] || []), ...(values[l.settingKey] || [])];
    }
    return out;
  }, [described, values]);

  const toggleRequired = (key, on) => {
    setValue("whatsapp_required_fields", (prev) => {
      const set = new Set(prev || []);
      if (on) set.add(key);
      else set.delete(key);
      return LEAD_FIELDS.map((f) => f.key).filter((k) => set.has(k));
    });
  };

  if (!canManage) {
    return (
      <div className="p-6 text-gray-400" dir="rtl">
        רק מנהל מערכת יכול לראות את מרכז השליטה לבוט.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5 pb-28" dir="rtl">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Bot className="w-7 h-7 text-blue-400" />
          מרכז שליטה לבוט
        </h1>
        <p className="text-gray-400 text-sm">
          כל הודעה שנכנסת לוואטסאפ של הסטודיו עוברת את עשרת השלבים האלה, בסדר הזה. כל שלב מסביר מה הוא בודק
          ומה אתה יכול לשנות בו. שינוי נשמר בלחיצה אחת למטה ונכנס לתוקף בהודעה הבאה, בלי עדכון תוכנה.
        </p>
        <div
          className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${
            enabled ? "border-emerald-700/60 bg-emerald-950/30" : "border-gray-700 bg-gray-800/40"
          }`}
        >
          <div>
            <p className="text-white font-medium">{enabled ? "הבוט פעיל ושולח הודעות" : "הבוט כבוי — לא נשלחת אף הודעה"}</p>
            <p className="text-gray-400 text-xs mt-0.5">
              {enabled ? "פנייה חדשה שתעבור את השלבים תקבל תשובה בלי אישור שלך." : "ההודעות ממשיכות להיכנס לדף השיחות. הבוט רק לא עונה."}
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={(v) => setValue("whatsapp_bot_enabled", v)} disabled={loading} />
        </div>
        {describeError && (
          <p className="text-xs text-amber-300/90">לא הצלחתי לקרוא מהשרת את רשימות המילים המובנות ({describeError}). ההגדרות עדיין נטענות ונשמרות.</p>
        )}
      </header>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400 py-10 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" /> טוען הגדרות...
        </div>
      ) : (
        <>
          {/* 1 */}
          <BotStepCard
            number={1}
            title="הודעה נכנסת"
            icon={Inbox}
            summary={
              <>
                <p>כל הודעה נרשמת בדף השיחות, גם כשהבוט כבוי. אותה הודעה שמגיעה פעמיים נרשמת פעם אחת.</p>
                <p>הודעה בקבוצה — הבוט שותק תמיד.</p>
                <p>
                  <span className="text-gray-200">אם אתה ענית בשיחה</span> (מהטלפון או מהמסך), הבוט מושתק באותה שיחה לתמיד. אפשר
                  להחזיר אותו מהמתג שבראש השיחה.
                </p>
              </>
            }
            fixed="הכללים האלה. אין הגדרה שפותחת את הבוט בקבוצות או מעל תשובה שלך."
          />

          {/* 2 */}
          <BotStepCard
            number={2}
            title="מי כותב?"
            icon={UserSearch}
            summary={
              <>
                <p>המספר נבדק מול הלקוחות, הלידים ואנשי הצוות במערכת. מוכר → הבוט שותק. לא מוכר → ממשיכים.</p>
                <p>טעית? בדף השיחות לוחצים על התג ליד השם ובוחרים ידנית "צוות" / "לקוח" / "לא מוכר". בחירה ידנית לא נדרסת.</p>
                <p>"צור ליד" מתוך שיחה הופך אותה למוכרת, והבוט משתתק בה.</p>
              </>
            }
            fixed="סדר הבדיקה (לקוח, ליד, צוות). כשהבדיקה נכשלת הבוט מניח 'צוות' ושותק."
          />

          {/* 3 */}
          <BotStepCard
            number={3}
            title="האם זו פנייה לצילום?"
            icon={Filter}
            tone="warn"
            summary={
              <>
                <p>
                  הבוט לא מבין עברית. הוא מחפש מילים מארבע רשימות. הכלל: <span className="text-gray-200">מילת ספק ⛔ משתיקה תמיד</span>.
                  אחרת, מי שהגיע ממודעה או כתב "מתחתן" עובר לבד. כל השאר צריך{" "}
                  <span className="text-gray-200">שני סימנים</span>: מילת שירות (חתונה, צילום…) <span className="text-gray-200">וגם</span> מילת
                  מחיר/זמינות או תאריך.
                </p>
                <p>מילה שלא ברשימות = הבוט שותק. זו הכוונה: שתיקה עולה תשובה ידנית, טעות עולה מחירון לקולגה.</p>
                <p>אפשר להוסיף מילים משלך ולכבות מילים מובנות. הסימולטור בתחתית מראה איזו מילה תפסה.</p>
              </>
            }
            fixed="הכלל של שני הסימנים והכרעת הספק. ניתן לשנות רק את המילים."
          >
            {!described && !describeError && (
              <p className="text-gray-500 text-xs flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> טוען את הרשימות המובנות...
              </p>
            )}
            {TERM_LISTS.map((l) => (
              <TermListEditor
                key={l.key}
                listKey={l.key}
                label={l.label}
                hint={l.hint}
                builtin={described?.builtinTerms?.[l.key] || []}
                extra={values[l.settingKey] || []}
                disabled={values.whatsapp_terms_disabled || []}
                onChangeExtra={(arr) => setValue(l.settingKey, arr)}
                onChangeDisabled={(arr) => setValue("whatsapp_terms_disabled", arr)}
                effectiveLists={effectiveForWarnings}
                canManage={canManage}
              />
            ))}
            <p className="text-xs text-gray-500">
              תאריך (12/7/27, "16 ביוני") נחשב לסימן שני אוטומטית. מילים נבדקות בלי ניקוד ובלי אותיות סופיות, אז "אלבום" תופס גם "אלבומים".
            </p>
          </BotStepCard>

          {/* 4 */}
          <BotStepCard
            number={4}
            title="שעות שקט"
            icon={MoonStar}
            summary={
              <>
                <p>
                  חלון אחד לכל המערכת (גם לתזכורות ולשאלונים). <span className="text-gray-200">לבוט</span> ההודעה לא נזרקת: היא נשמרת ונשלחת
                  בסיום החלון. זוג שכתב ב-23:30 מקבל תשובה ב-08:00.
                </p>
              </>
            }
            fixed="מה נדחה: ברכה, שאלה ומחירון. תזכורת וסיכום יומי פשוט לא רצים בשעות שקט."
          >
            <p className="text-xs text-gray-500">לשעות השקט יש כפתור שמירה משלהן (בתוך הכרטיס), כי הן משותפות לכל האוטומציות.</p>
            <QuietHoursCard />
          </BotStepCard>

          {/* 5 */}
          <BotStepCard
            number={5}
            title="הפתיחה"
            icon={Hand}
            summary={
              <>
                <p>הודעה ראשונה ממספר לא מוכר שעברה את שלב 3 מקבלת את הודעת הפתיחה, פעם אחת, אחרי השהיה.</p>
              </>
            }
            fixed="פתיחה נשלחת רק פעם אחת לשיחה. הודעה שנייה באותו לילה לא מייצרת פתיחה שנייה."
          >
            <div>
              <Label className="text-gray-300">הודעת הפתיחה</Label>
              {help("כדאי לבקש בה בדיוק את הפרטים שסימנת בשלב 6 — הבוט ישאל שוב רק על מה שחסר.")}
              <Textarea
                value={values.whatsapp_greeting_text}
                onChange={(e) => setValue("whatsapp_greeting_text", e.target.value)}
                rows={7}
                placeholder={DEFAULT_GREETING}
                className={inputCls}
              />
              {!String(values.whatsapp_greeting_text || "").trim() && (
                <button
                  type="button"
                  onClick={() => setValue("whatsapp_greeting_text", DEFAULT_GREETING)}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline"
                >
                  השתמש בנוסח מוצע
                </button>
              )}
            </div>
            <div>
              <Label className="text-gray-300">הודעת פתיחה למי שהגיע ממודעה (לא חובה)</Label>
              {help("מי שלחץ על מודעה בפייסבוק/אינסטגרם מקבל את הנוסח הזה במקום הרגיל. ריק = הרגילה.")}
              <Textarea
                value={values.whatsapp_greeting_text_ad}
                onChange={(e) => setValue("whatsapp_greeting_text_ad", e.target.value)}
                rows={4}
                className={inputCls}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-300">השהיה לפני הפתיחה (שניות)</Label>
                {help("כדי שהתשובה לא תגיע באותה שנייה. 0 עד 300. השאלות והמחירון נשלחים בלי השהיה.")}
                <Input type="number" min={0} max={300} value={values.whatsapp_reply_delay_seconds} onChange={(e) => setValue("whatsapp_reply_delay_seconds", e.target.value)} className={inputCls} dir="ltr" />
              </div>
              <div>
                <Label className="text-gray-300">מקסימום הודעות בוט בשעה (לכל הסטודיו)</Label>
                {help("תקרת ביטחון. אם משהו ישתבש, זה מה שמגביל את הנזק. 1 עד 60.")}
                <Input type="number" min={1} max={60} value={values.whatsapp_max_bot_messages_per_hour} onChange={(e) => setValue("whatsapp_max_bot_messages_per_hour", e.target.value)} className={inputCls} dir="ltr" />
              </div>
            </div>
          </BotStepCard>

          {/* 6 */}
          <BotStepCard
            number={6}
            title="איסוף פרטים"
            icon={ListChecks}
            summary={
              <>
                <p>
                  כל תשובה של הלקוח נקראת (בעזרת AI) ומה שזוהה נשמר על השיחה. אם חסר פרט שסימנת כנדרש, הבוט שואל{" "}
                  <span className="text-gray-200">רק על מה שחסר</span>. כשהכל ידוע — שלב 7.
                </p>
                <p>תשובה שאינה טקסט (הקלטה, תמונה) עוברת אליך: הבוט לא יכול לקרוא אותה.</p>
              </>
            }
            fixed="מה הבוט יודע לחלץ: שמות, תאריך, מקום, מספר מוזמנים. פרט לא-נדרש שהלקוח כתב נשמר בכל מקרה."
          >
            <div>
              <Label className="text-gray-300">אילו פרטים חייבים להיות ידועים לפני שנשלח מחירון?</Label>
              {help("פחות פרטים = מחירון מהר יותר, פולו-אפ עם פחות מידע. לפחות פרט אחד.")}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {LEAD_FIELDS.map((f) => {
                  const on = required.includes(f.key);
                  const last = on && required.length === 1;
                  return (
                    <label key={f.key} className={`flex items-center gap-2 rounded-lg border p-2 text-sm ${on ? "border-yellow-500/40 bg-yellow-500/5 text-gray-100" : "border-gray-800 text-gray-400"}`}>
                      <Checkbox checked={on} disabled={last} onCheckedChange={(v) => toggleRequired(f.key, !!v)} />
                      {f.label}
                      {last && <span className="text-xs text-gray-500 mr-auto">(האחרון — חייב להישאר)</span>}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-300">השאלה כשחסר פרט אחד</Label>
                {help("{{missing}} מתחלף בשם הפרט החסר. בלי {{missing}} הבוט משתמש בנוסח המובנה.")}
                <Textarea value={values.whatsapp_question_text_one} onChange={(e) => setValue("whatsapp_question_text_one", e.target.value)} rows={3} placeholder={DEFAULT_QUESTION_TEXT_ONE} className={inputCls} />
              </div>
              <div>
                <Label className="text-gray-300">השאלה כשחסרים כמה פרטים</Label>
                {help("{{missing_list}} מתחלף ברשימת הפרטים החסרים, שורה לכל פרט.")}
                <Textarea value={values.whatsapp_question_text_many} onChange={(e) => setValue("whatsapp_question_text_many", e.target.value)} rows={3} placeholder={DEFAULT_QUESTION_TEXT_MANY} className={inputCls} />
              </div>
            </div>
            <div>
              <p className="text-gray-300 text-sm mb-1">כך זה ייראה אצל הלקוח</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 text-gray-200 whitespace-pre-wrap">
                  {renderQuestionPreview(requiredLabels.slice(0, 1), questionSettings)}
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 text-gray-200 whitespace-pre-wrap">
                  {renderQuestionPreview(requiredLabels.length > 1 ? requiredLabels : [...requiredLabels, "(פרט נוסף)"], questionSettings)}
                </div>
              </div>
            </div>
            <div>
              <Label className="text-gray-300">כמה שאלות מקסימום אחרי הפתיחה?</Label>
              {help("אחרי זה הבוט מפסיק לשאול והשיחה עוברת אליך (מופיעה תחת \"לא סיימו פרטים\"). 1 עד 5.")}
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={maxMessages - 1}
                  onChange={(e) => setValue("whatsapp_max_bot_messages", String((parseInt(e.target.value, 10) || 1) + 1))}
                  className={`${inputCls} w-24`}
                  dir="ltr"
                />
                <span className="text-gray-500 text-xs">= פתיחה + {maxMessages - 1} שאלות, ואז מסירה אליך. התזכורת (שלב 9) לא נספרת.</span>
              </div>
            </div>
          </BotStepCard>

          {/* 7 */}
          <BotStepCard
            number={7}
            title="המחירון"
            icon={FileText}
            summary={<p>נשלח פעם אחת, כשכל הפרטים הנדרשים ידועים. השיחה עוברת ל"נשלח מחירון" ונכנסת לתור הפולו-אפ.</p>}
            fixed="נוסח ארוך מ-1024 תווים נשלח כהודעה נפרדת אחרי התמונה. כשאין נוסח וגם אין תמונה — השיחה עוברת אליך."
          >
            <div>
              <Label className="text-gray-300">נוסח המחירון</Label>
              {help("אפשר להעתיק בדיוק את הנוסח שאתה שולח היום ידנית.")}
              <Textarea value={values.whatsapp_pricelist_text} onChange={(e) => setValue("whatsapp_pricelist_text", e.target.value)} rows={8} className={inputCls} />
            </div>
            <div>
              <Label className="text-gray-300">תמונת המחירון</Label>
              {help("נשלחת יחד עם הנוסח. JPG או PNG, עד 5MB.")}
              {values.whatsapp_pricelist_url ? (
                <div className="flex items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/50 p-3">
                  <img src={values.whatsapp_pricelist_url} alt="תצוגה מקדימה של המחירון" className="h-20 w-20 rounded object-cover border border-gray-700" />
                  <div className="min-w-0 flex-1">
                    <p className="text-emerald-400 text-sm flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> התמונה מוכנה לשליחה</p>
                    <p className="text-gray-500 text-xs mt-1 break-all" dir="ltr">{values.whatsapp_pricelist_url}</p>
                  </div>
                  <button type="button" onClick={() => setValue("whatsapp_pricelist_url", "")} className="text-xs text-red-400 hover:text-red-300 underline shrink-0">הסר</button>
                </div>
              ) : (
                <label className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-700 bg-gray-800/30 p-5 text-center ${isUploading ? "opacity-60" : "cursor-pointer hover:border-gray-600"}`}>
                  <Upload className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-300">{isUploading ? "מעלה..." : "לחץ כדי להעלות את תמונת המחירון"}</span>
                  <input type="file" accept="image/*" className="hidden" disabled={isUploading} onChange={handleUpload} />
                </label>
              )}
            </div>
          </BotStepCard>

          {/* 8 */}
          <BotStepCard
            number={8}
            title="אחרי המחירון"
            icon={Flame}
            summary={
              <>
                <p>
                  מכאן הבוט <span className="text-gray-200">שותק</span>. כל תשובה של הלקוח מדורגת (AI) חם / פושר / קר; ליד חם ראשון שולח לך
                  התראה בוואטסאפ ובפעמון. הדירוג צובע שורה, לא שולח ללקוח כלום.
                </p>
                <p>מי שלא ענה נכנס ל"ממתינים לפולו-אפ" בדף השיחות. הפולו-אפ יוצא רק בלחיצה שלך.</p>
              </>
            }
            fixed="הגדרת 'חם' (רוצה לסגור / לקבוע שיחה / לשריין תאריך) והנימוק שמוצג בשיחה."
          >
            <div>
              <Label className="text-gray-300">כמה ימים אחרי המחירון להכניס לתור הפולו-אפ</Label>
              {help("0 = מיד. מומלץ 2 — לתת לזוג יום-יומיים לענות לפני שדוחפים.")}
              <Input type="number" min={0} max={30} value={values[FOLLOWUP_AFTER_DAYS_KEY]} onChange={(e) => setValue(FOLLOWUP_AFTER_DAYS_KEY, e.target.value)} className={`${inputCls} w-24`} dir="ltr" />
            </div>
            <div>
              <Label className="text-gray-300">נוסח הפולו-אפ</Label>
              {help("שדות: {{names}} השמות · {{event_date}} תאריך · {{venue}} האולם. שדה שלא נאסף נשאר ריק.")}
              <Textarea value={values[FOLLOWUP_TEMPLATE_KEY]} onChange={(e) => setValue(FOLLOWUP_TEMPLATE_KEY, e.target.value)} rows={6} className={inputCls} />
            </div>
          </BotStepCard>

          {/* 9 */}
          <BotStepCard
            number={9}
            title="תחזוקה: תזכורת וסיכום יומי"
            icon={Timer}
            summary={
              <>
                <p>פעם בשעה המערכת בודקת: מי באמצע מסירת פרטים ונעלם → תזכורת אחת בלבד. הודעות שנדחו בגלל שעות שקט → נשלחות.</p>
                <p>פעם ביום נשלח סיכום למספר ההתראות: פניות, מחירונים, לידים חמים, מי מחכה לך.</p>
              </>
            }
            fixed="תזכורת אחת לשיחה. הסיכום נשלח גם כשהבוט כבוי. שניהם כפופים למכסה השעתית."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-gray-300">אחרי כמה שעות שקט לשלוח תזכורת</Label>
                {help("נמדד מההודעה האחרונה של הבוט. 1 עד 168 (שבוע).")}
                <Input type="number" min={1} max={168} value={values.whatsapp_nudge_after_hours} onChange={(e) => setValue("whatsapp_nudge_after_hours", e.target.value)} className={inputCls} dir="ltr" />
              </div>
              <div>
                <Label className="text-gray-300">שעת הסיכום היומי (0–23)</Label>
                {help(<>נשלח למספר שבהגדרות ← <Link to="/Settings" className="underline text-blue-400">התראות</Link>. בלי מספר — אין סיכום.</>)}
                <Input type="number" min={0} max={23} value={values.whatsapp_digest_hour} onChange={(e) => setValue("whatsapp_digest_hour", e.target.value)} className={inputCls} dir="ltr" />
              </div>
            </div>
            <div>
              <Label className="text-gray-300">נוסח התזכורת</Label>
              {help("ריק = הנוסח המובנה.")}
              <Textarea value={values.whatsapp_flow_nudge_text} onChange={(e) => setValue("whatsapp_flow_nudge_text", e.target.value)} rows={2} placeholder={DEFAULT_NUDGE} className={inputCls} />
            </div>
          </BotStepCard>

          {/* 10 */}
          <BotStepCard
            number={10}
            title="בדוק בעצמך"
            icon={FlaskConical}
            summary={
              <p>
                הקלד הודעה ותראה את השלבים 1–5 בדיוק כפי שהבוט עובר אותם, ואיפה הוא עצר. שום דבר לא נשלח. הבדיקה רצה על
                ההגדרות <span className="text-gray-200">השמורות</span> — שמור קודם אם שינית משהו.
              </p>
            }
          >
            <BotSimulator />
          </BotStepCard>
        </>
      )}

      {/* Sticky save bar */}
      {/* Bottom-left, away from the AI assistant's bottom-right button. */}
      <div className="fixed bottom-4 left-4 md:bottom-6 md:left-6 z-30">
        <div>
          <div className="rounded-xl border border-gray-700 bg-gray-900/95 backdrop-blur p-3 flex items-center gap-4 shadow-xl">
            <p className="text-xs text-gray-400 flex items-center gap-1">
              {dirty ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> יש שינויים שלא נשמרו
                </>
              ) : (
                "הכל שמור"
              )}
            </p>
            <Button onClick={handleSave} disabled={saving || loading} className="bg-yellow-500 hover:bg-yellow-600 text-black">
              {saving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
              {saving ? "שומר..." : "שמור את כל ההגדרות"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
