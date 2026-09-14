import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { X, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_TEMPLATE, FOLLOWUP_TEMPLATE_KEY, FOLLOWUP_AFTER_DAYS_KEY } from "./WhatsAppFollowUpDialog";

// The permanent home of the follow-up wording — asked for on 2026-09-15: "כפתור שאני
// יגיד את ההגדרה של פולו-אפ ואת המלל". Until then the only editor was inside the send
// dialog, which said "לשמירה קבועה — הגדרות ← תבניות הודעה"; that tab never had this
// template. The pointer was dead, and every edit vanished after one send. Same family
// as the questionnaire / invoice / template bugs fixed earlier this month: the screen
// claimed a path that did not exist.
//
// Two settings, both in app_settings like every other template in this app:
//   template_whatsapp_followup    — the wording, with {{names}} / {{event_date}} / {{venue}}
//   whatsapp_followup_after_days  — how many days of silence after the price list before
//                                   a conversation enters the follow-up queue. Default 0
//                                   keeps the behaviour the queue always had (everyone
//                                   who got a price list and hasn't replied). A studio
//                                   that would rather not chase someone within the hour
//                                   sets 1–3 here.

const SAMPLE = {
  coupleNames: "נועה ואיתי",
  eventDate: "2027-06-16",
  venue: "אחוזת רונית",
};

function applySample(tpl) {
  return tpl
    .replace(/\{\{names\}\}/g, SAMPLE.coupleNames)
    .replace(/\{\{event_date\}\}/g, "16/6/2027")
    .replace(/\{\{venue\}\}/g, SAMPLE.venue);
}

export default function WhatsAppFollowUpSettingsDialog({ isOpen, onClose, onSaved }) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [afterDays, setAfterDays] = useState(0);
  const [ids, setIds] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    (async () => {
      setIsLoading(true);
      try {
        const rows = await base44.entities.AppSetting.list();
        const t = rows.find((r) => r.key === FOLLOWUP_TEMPLATE_KEY);
        const d = rows.find((r) => r.key === FOLLOWUP_AFTER_DAYS_KEY);
        if (!mounted) return;
        setTemplate(t?.value || DEFAULT_TEMPLATE);
        const parsed = parseInt(d?.value, 10);
        setAfterDays(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
        setIds({ template: t?.id || null, days: d?.id || null });
      } catch (e) {
        toast.error("טעינת ההגדרות נכשלה", { description: e.message });
      }
      if (mounted) setIsLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const upsert = async (key, id, value) => {
    if (id) {
      await base44.entities.AppSetting.update(id, { value });
      return id;
    }
    const created = await base44.entities.AppSetting.create({ key, value });
    return created.id;
  };

  const handleSave = async () => {
    if (!template.trim()) {
      toast.error("נוסח ההודעה לא יכול להיות ריק");
      return;
    }
    const days = Math.max(0, Math.floor(Number(afterDays) || 0));
    setIsSaving(true);
    try {
      const tId = await upsert(FOLLOWUP_TEMPLATE_KEY, ids.template, template);
      const dId = await upsert(FOLLOWUP_AFTER_DAYS_KEY, ids.days, String(days));
      setIds({ template: tId, days: dId });
      toast.success("הגדרות הפולו-אפ נשמרו");
      if (onSaved) onSaved();
      onClose();
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e.message });
    }
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="text-white text-lg font-semibold">הגדרות פולו-אפ</h2>
            <p className="text-gray-400 text-sm mt-0.5">
              הנוסח שיישלח למי שקיבל מחירון ולא ענה, ומתי הוא נכנס לתור
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="w-5 h-5 animate-spin ml-2" /> טוען...
            </div>
          ) : (
            <>
              <div>
                <label className="text-gray-300 text-sm font-medium block mb-2">נוסח ההודעה</label>
                <textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={8}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white text-sm"
                />
                <p className="text-gray-500 text-xs mt-1">
                  שדות שמתמלאים אוטומטית לכל שיחה: {"{{names}}"} — השמות, {"{{event_date}}"} — תאריך
                  האירוע, {"{{venue}}"} — האולם. שדה שהבוט לא הצליח לאסוף יישאר ריק.
                </p>
              </div>

              <div>
                <label className="text-gray-300 text-sm font-medium block mb-2">כך זה ייראה אצל הלקוח</label>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-gray-200 text-sm whitespace-pre-wrap">
                  {applySample(template)}
                </div>
              </div>

              <div>
                <label className="text-gray-300 text-sm font-medium block mb-2">
                  כמה ימים אחרי המחירון להכניס לתור הפולו-אפ
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={afterDays}
                    onChange={(e) => setAfterDays(e.target.value)}
                    className="w-24 bg-gray-800 border border-gray-700 rounded-lg p-2 text-white text-sm text-center"
                    dir="ltr"
                  />
                  <span className="text-gray-500 text-xs">
                    0 = מיד. מומלץ 2 — לתת לזוג יום-יומיים לענות לפני שדוחפים.
                  </span>
                </div>
              </div>

              <p className="text-xs text-amber-400/90 bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
                ⚠️ שום דבר כאן לא נשלח לבד. הפולו-אפ יוצא רק כשאתה לוחץ "שלח" בחלון
                "ממתינים לפולו-אפ", אחרי שראית מי ברשימה ומה בדיוק יקבל.
              </p>
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 flex justify-start gap-2">
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-400 hover:bg-yellow-500 px-4 py-2 text-sm font-semibold text-gray-900 disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isSaving ? "שומר..." : "שמור"}
          </button>
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:text-white">
            ביטול
          </button>
        </div>
      </div>
    </div>
  );
}
