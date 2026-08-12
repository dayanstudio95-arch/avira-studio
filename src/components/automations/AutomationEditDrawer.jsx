import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { uploadFile } from "@/api/uploadFile";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Save, Trash2 } from "lucide-react";

const FREQUENCY_OPTIONS = [
  { value: "monthly_1st", label: "כל 1 לחודש" },
  { value: "daily", label: "כל יום" },
  { value: "manual", label: "ידני בלבד" }
];

const MONTH_OFFSET_OPTIONS = [
  { value: 0, label: "החודש הנוכחי" },
  { value: 1, label: "חודש הבא" },
  { value: 2, label: "עוד שני חודשים" },
  { value: 3, label: "עוד שלושה חודשים" },
];

const DEFAULT_FORM = {
  name: "",
  type: "custom",
  emoji: "⚙️",
  frequency: "monthly_1st",
  scheduledTime: "09:00",
  timeDirection: "future",
  monthOffset: 1,
  daysOffset: 30,
  filterLogic: "",
  messageTemplate: "",
  mediaFileUrl: "",
  isActive: true
};

export default function AutomationEditDrawer({ isOpen, onClose, automation, onSaved }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (automation) {
      setForm({
        name: automation.name || "",
        emoji: automation.emoji || "⚙️",
        frequency: automation.frequency || "monthly_1st",
        scheduledTime: automation.scheduledTime || "09:00",
        timeDirection: automation.timeDirection || "future",
        monthOffset: automation.monthOffset ?? 1,
        daysOffset: automation.daysOffset ?? 30,
        filterLogic: automation.filterLogic || "",
        messageTemplate: automation.messageTemplate || "",
        mediaFileUrl: automation.mediaFileUrl || "",
        isActive: automation.isActive !== false
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [automation, isOpen]);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const fileInputRef = useRef(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const { file_url } = await uploadFile({ file });
      set('mediaFileUrl', file_url);
    } catch (e) {
      toast.error("שגיאה בהעלאת הקובץ: " + (e.message || ""));
    }
    setIsUploading(false);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.messageTemplate.trim()) {
      toast.error("שם ונוסח הודעה הם שדות חובה");
      return;
    }
    setIsSaving(true);
    try {
      if (automation?.id) {
        await base44.entities.Automation.update(automation.id, form);
      } else {
        await base44.entities.Automation.create(form);
      }
      toast.success(automation?.id ? "האוטומציה עודכנה" : "האוטומציה נוצרה");
      onSaved();
    } catch (e) {
      toast.error("שגיאה בשמירה");
    }
    setIsSaving(false);
  };

  const handleDelete = async () => {
    if (!automation?.id || !confirm("האם למחוק אוטומציה זו?")) return;
    setIsDeleting(true);
    try {
      await base44.entities.Automation.delete(automation.id);
      toast.success("האוטומציה נמחקה");
      onSaved();
    } catch {
      toast.error("שגיאה במחיקה");
    }
    setIsDeleting(false);
  };

  const fieldClass = "w-full bg-gray-900 text-white border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500";

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto max-w-lg" dir="rtl">
        <SheetHeader>
          <SheetTitle className="text-white text-xl">
            {automation ? "עריכת אוטומציה" : "אוטומציה חדשה"}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {/* Name + Emoji */}
          <div className="flex gap-2">
            <div className="w-20">
              <label className="text-xs text-gray-400 mb-1 block">אימוג'י</label>
              <input className={fieldClass} value={form.emoji} onChange={e => set("emoji", e.target.value)} placeholder="⚙️" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-gray-400 mb-1 block">שם האוטומציה *</label>
              <input className={fieldClass} value={form.name} onChange={e => set("name", e.target.value)} placeholder="שליחת שאלון הכנה" />
            </div>
          </div>

          {/* Frequency + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">תדר הפעלה</label>
              <select className={fieldClass} value={form.frequency} onChange={e => set("frequency", e.target.value)}>
                {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value} className="bg-gray-900">{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">⏰ שעת ריצה</label>
              <input
                type="time"
                className={fieldClass + " font-mono"}
                value={form.scheduledTime || "09:00"}
                onChange={e => set("scheduledTime", e.target.value)}
              />
            </div>
          </div>

          {/* Time Direction */}
          {form.frequency !== 'manual' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">כיוון זמן</label>
              <div className="flex gap-2">
                {[
                  { value: 'future', label: '⏭️ אירועים עתידיים' },
                  { value: 'past', label: '⏪️ אירועי עבר' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('timeDirection', opt.value)}
                    className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                      form.timeDirection === opt.value
                        ? 'bg-blue-600 border-blue-500 text-white'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Future: Month Offset */}
          {form.frequency === 'monthly_1st' && form.timeDirection === 'future' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">📅 חודש יעד</label>
              <select className={fieldClass} value={form.monthOffset ?? 1} onChange={e => set("monthOffset", Number(e.target.value))}>
                {MONTH_OFFSET_OPTIONS.map(o => <option key={o.value} value={o.value} className="bg-gray-900">{o.label}</option>)}
              </select>
            </div>
          )}

          {/* Past: Days Offset */}
          {form.timeDirection === 'past' && form.frequency !== 'manual' && (
            <div>
              <label className="text-xs text-gray-400 mb-1 block">🕒 חיפוש אירועים לפני X ימים</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="365"
                  className={fieldClass + " w-24 text-center"}
                  value={form.daysOffset ?? 30}
                  onChange={e => set('daysOffset', Number(e.target.value))}
                />
                <span className="text-gray-400 text-sm">יום אחורה</span>
              </div>
              <p className="text-xs text-gray-600 mt-1">לדוגמא: 30 = אירועים שהיו לפני 30 יום בדיוק</p>
            </div>
          )}

          {/* Filter Logic */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">לוגיקת סינון (ה-AI יפרש)</label>
            <textarea
              className={fieldClass}
              rows={3}
              value={form.filterLogic}
              onChange={e => set("filterLogic", e.target.value)}
              placeholder="לדוגמה: כל הלידים עם תאריך אירוע בחודש הקלנדרי הבא שעדיין לא מילאו שאלון"
            />
            <p className="text-xs text-gray-600 mt-1">תאר בשפה חופשית אילו רשומות לטרגט</p>
          </div>

          {/* Message Template */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">נוסח ההודעה *</label>
            <textarea
              className={fieldClass}
              rows={6}
              value={form.messageTemplate}
              onChange={e => set("messageTemplate", e.target.value)}
              placeholder="היי $couple_names, החודש שלכם כמעט כאן! 🎊&#10;מלאו שאלון: $questionnaire_link"
            />
            <div className="text-xs text-gray-600 mt-1 space-y-0.5">
              <p>משתנים זמינים:</p>
              <p><code className="bg-gray-800 px-1 rounded">$couple_names</code> · <code className="bg-gray-800 px-1 rounded">$questionnaire_link</code> · <code className="bg-gray-800 px-1 rounded">$event_date</code> · <code className="bg-gray-800 px-1 rounded">$venue</code></p>
            </div>
          </div>

          {/* Media File Upload */}
          <div>
            <label className="text-xs text-gray-400 mb-1 block">🖼️ תמונה/קובץ מדיה (רשות)</label>
            <div className="flex items-center gap-3">
              {form.mediaFileUrl ? (
                <div className="flex items-center gap-2 bg-gray-800 border border-green-700 rounded-lg px-3 py-2 flex-1">
                  <img src={form.mediaFileUrl} alt="preview" className="w-10 h-10 object-cover rounded" onError={e => e.target.style.display='none'} />
                  <span className="text-green-400 text-xs flex-1 truncate">תמונה נטענה ✅</span>
                  <button onClick={() => set('mediaFileUrl', '')} className="text-red-400 hover:text-red-300 text-xs">הסר</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="flex-1 py-2 px-3 bg-gray-800 border border-gray-700 border-dashed rounded-lg text-sm text-gray-400 hover:bg-gray-700 hover:border-blue-500 transition-colors"
                >
                  {isUploading ? 'מעלה...' : '+ בחר תמונה לשליחה'}
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*,video/*,.pdf" className="hidden" onChange={handleFileUpload} />
            </div>
            {form.mediaFileUrl && <p className="text-xs text-gray-600 mt-1">נוסח ההודעה ישלח כקיפתון (Caption) מתחת התמונה</p>}
          </div>



          {/* Active Toggle */}
          <div className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg p-3">
            <span className="text-sm text-gray-300">אוטומציה פעילה</span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={e => set("isActive", e.target.checked)} className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:bg-green-500 transition-colors"></div>
              <div className="absolute w-5 h-5 bg-white rounded-full shadow top-0.5 left-0.5 peer-checked:translate-x-5 transition-transform"></div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button onClick={handleSave} disabled={isSaving} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2">
              <Save className="w-4 h-4" />
              {isSaving ? "שומר..." : "שמור"}
            </Button>
            {automation?.id && (
              <Button onClick={handleDelete} disabled={isDeleting} variant="outline" className="border-red-700 text-red-400 hover:bg-red-500/10 gap-2">
                <Trash2 className="w-4 h-4" />
                {isDeleting ? "מוחק..." : "מחק"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}