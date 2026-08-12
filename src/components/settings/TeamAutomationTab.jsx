import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Trash2, Save, Play, Settings, Edit, X, Check } from "lucide-react";

export default function TeamAutomationTab() {
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [newStaffForm, setNewStaffForm] = useState({ name: "", role: "photographer", phoneNumber: "", email: "" });
  const [editingStaff, setEditingStaff] = useState(null);
  const [editStaffForm, setEditStaffForm] = useState({});
  const [isAddingStaff, setIsAddingStaff] = useState(false);

  // Automation states — DISABLED: managed exclusively via AutomationsDashboard
  const [monthlySched, setMonthlySched] = useState({ enabled: false });
  const [dailyBrief, setDailyBrief] = useState({ enabled: false });
  const [questionnaireReminder, setQuestionnaireReminder] = useState({ enabled: false });
  const [isRunningMonthly, setIsRunningMonthly] = useState(false);
  const [isRunningDaily, setIsRunningDaily] = useState(false);
  const [isRunningQuestionnaire, setIsRunningQuestionnaire] = useState(false);

  // Template states
  const [showMonthlyTemplate, setShowMonthlyTemplate] = useState(false);
  const [monthlyTemplate, setMonthlyTemplate] = useState("");
  const [showDailyTemplate, setShowDailyTemplate] = useState(false);
  const [dailyTemplate, setDailyTemplate] = useState("");
  const [showQuestionnaireTemplate, setShowQuestionnaireTemplate] = useState(false);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState("היי $couple_names, החודש שלכם כבר כמעט כאן! 🎊 כדי שנתחיל להיערך, נשמח אם תמלאו את השאלון בקישור: $questionnaire_link");

  // Load data
  useEffect(() => {
    loadStaffMembers();
    loadTemplates();
  }, []);

  const loadStaffMembers = async () => {
    setIsLoadingStaff(true);
    try {
      const staff = await base44.entities.StaffMember.list();
      setStaffMembers(staff);
    } catch (error) {
      toast.error("שגיאה בטעינת אנשי הצוות");
    } finally {
      setIsLoadingStaff(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const settings = await base44.entities.AppSetting.list();
      const monthlyTpl = settings.find(s => s.key === 'template_monthly_schedule')?.value;
      const dailyTpl = settings.find(s => s.key === 'template_daily_brief')?.value;
      const questTpl = settings.find(s => s.key === 'template_questionnaire_reminder')?.value;
      if (monthlyTpl) setMonthlyTemplate(monthlyTpl);
      if (dailyTpl) setDailyTemplate(dailyTpl);
      if (questTpl) setQuestionnaireTemplate(questTpl);
    } catch (error) {
      console.error("Error loading templates:", error);
    }
  };

  const handleAddStaff = async () => {
    if (!newStaffForm.name) {
      toast.error("שם הוא שדה חובה");
      return;
    }
    setIsAddingStaff(true);
    try {
      await base44.entities.StaffMember.create({
        name: newStaffForm.name,
        role: newStaffForm.role,
        phoneNumber: newStaffForm.phoneNumber || undefined,
        email: newStaffForm.email || undefined,
      });
      toast.success("איש צוות חדש נוסף בהצלחה");
      setNewStaffForm({ name: "", role: "photographer", phoneNumber: "", email: "" });
      loadStaffMembers();
    } catch (error) {
      toast.error("שגיאה בהוספת איש צוות");
    } finally {
      setIsAddingStaff(false);
    }
  };

  const handleEditStaff = (staff) => {
    setEditingStaff(staff.id);
    setEditStaffForm({ name: staff.name, role: staff.role, phoneNumber: staff.phoneNumber || "", email: staff.email || "" });
  };

  const handleSaveEdit = async (id) => {
    try {
      await base44.entities.StaffMember.update(id, {
        name: editStaffForm.name,
        role: editStaffForm.role,
        phoneNumber: editStaffForm.phoneNumber || undefined,
        email: editStaffForm.email || undefined,
      });
      toast.success("איש צוות עודכן");
      setEditingStaff(null);
      loadStaffMembers();
    } catch (error) {
      toast.error("שגיאה בשמירה");
    }
  };

  const handleDeleteStaff = async (id) => {
    if (!confirm("האם אתה בטוח שברצונך למחוק את אנשי הצוות הזה?")) return;
    try {
      await base44.entities.StaffMember.delete(id);
      toast.success("אנשי צוות נמחק בהצלחה");
      loadStaffMembers();
    } catch (error) {
      toast.error("שגיאה במחיקת אנשי צוות");
    }
  };

  const handleSaveTemplate = async (key, value) => {
    try {
      const existing = await base44.entities.AppSetting.filter({ key });
      if (existing.length > 0) {
        await base44.entities.AppSetting.update(existing[0].id, { value });
      } else {
        await base44.entities.AppSetting.create({ key, value });
      }
      toast.success("התבנית נשמרה בהצלחה");
    } catch (error) {
      toast.error("שגיאה בשמירת התבנית");
    }
  };

  const handleRunAutomation = async (functionName) => {
    const isMonthly = functionName === "monthly";
    const isQuestionnaire = functionName === "questionnaire";
    if (isMonthly) setIsRunningMonthly(true);
    else if (isQuestionnaire) setIsRunningQuestionnaire(true);
    else setIsRunningDaily(true);

    const label = isMonthly ? 'לו"ז חודשי' : isQuestionnaire ? 'שאלון הכנה' : 'סיכום יומי';
    const toastId = toast.loading(`מפעיל ${label}...`);
    
    try {
      const fnName = isMonthly ? "monthlyCrewSchedule" : isQuestionnaire ? "sendQuestionnaireReminders" : "dailyEventBrief";
      const result = await base44.functions.invoke(fnName, {});
      
      if (result.data?.success) {
        toast.success(`${label} הופעל בהצלחה - נשלח ל-${result.data.results?.length || 0}`, { id: toastId });
      } else {
        toast.error(result.data?.error || 'שגיאה בהרצת הפונקציה', { id: toastId });
      }
    } catch (error) {
      toast.error(`שגיאה: ${error.message || 'בעיה בהרצה'}`, { id: toastId });
    } finally {
      if (isMonthly) setIsRunningMonthly(false);
      else if (isQuestionnaire) setIsRunningQuestionnaire(false);
      else setIsRunningDaily(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* אנשי צוות */}
      <div>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">👥 ניהול אנשי צוות</h3>
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="שם"
              value={newStaffForm.name}
              onChange={e => setNewStaffForm({ ...newStaffForm, name: e.target.value })}
              className="bg-gray-900 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <select
              value={newStaffForm.role}
              onChange={e => setNewStaffForm({ ...newStaffForm, role: e.target.value })}
              className="bg-gray-900 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="photographer">צלם</option>
              <option value="videographer">וידאו</option>
              <option value="editor">עורך</option>
              <option value="lighting">תאורן</option>
            </select>
            <input
              type="tel"
              placeholder="טלפון"
              value={newStaffForm.phoneNumber}
              onChange={e => setNewStaffForm({ ...newStaffForm, phoneNumber: e.target.value })}
              className="bg-gray-900 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <input
              type="email"
              placeholder="אימייל (לזימון יומן)"
              value={newStaffForm.email}
              onChange={e => setNewStaffForm({ ...newStaffForm, email: e.target.value })}
              className="bg-gray-900 text-white border border-gray-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
            <Button
              onClick={handleAddStaff}
              disabled={isAddingStaff}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              הוסף
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                 <tr className="bg-gray-800 border-b border-gray-700">
                   <th className="text-right px-3 py-2 text-gray-400">שם</th>
                   <th className="text-right px-3 py-2 text-gray-400">תפקיד</th>
                   <th className="text-right px-3 py-2 text-gray-400">טלפון</th>
                   <th className="text-right px-3 py-2 text-gray-400">אימייל</th>
                   <th className="text-right px-3 py-2 text-gray-400">פעולות</th>
                 </tr>
               </thead>
               <tbody>
                 {staffMembers.map(staff => (
                   <tr key={staff.id} className="border-b border-gray-700/40 hover:bg-gray-800/40">
                     {editingStaff === staff.id ? (
                       <>
                         <td className="px-2 py-1"><input value={editStaffForm.name} onChange={e => setEditStaffForm({...editStaffForm, name: e.target.value})} className="bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 text-sm w-full" /></td>
                         <td className="px-2 py-1">
                           <select value={editStaffForm.role} onChange={e => setEditStaffForm({...editStaffForm, role: e.target.value})} className="bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 text-sm">
                             <option value="photographer">צלם</option>
                             <option value="videographer">וידאו</option>
                             <option value="editor">עורך</option>
                             <option value="lighting">תאורן</option>
                           </select>
                         </td>
                         <td className="px-2 py-1"><input type="tel" value={editStaffForm.phoneNumber} onChange={e => setEditStaffForm({...editStaffForm, phoneNumber: e.target.value})} className="bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 text-sm w-full" /></td>
                         <td className="px-2 py-1"><input type="email" value={editStaffForm.email} onChange={e => setEditStaffForm({...editStaffForm, email: e.target.value})} placeholder="email@example.com" className="bg-gray-900 text-white border border-gray-600 rounded px-2 py-1 text-sm w-full" /></td>
                         <td className="px-2 py-1">
                           <div className="flex gap-1">
                             <button onClick={() => handleSaveEdit(staff.id)} className="text-green-400 hover:text-green-300"><Check className="w-4 h-4" /></button>
                             <button onClick={() => setEditingStaff(null)} className="text-gray-400 hover:text-gray-300"><X className="w-4 h-4" /></button>
                           </div>
                         </td>
                       </>
                     ) : (
                       <>
                         <td className="px-3 py-2 text-gray-300">{staff.name}</td>
                         <td className="px-3 py-2 text-gray-300"><span className="text-xs bg-gray-700 px-2 py-1 rounded">{staff.role}</span></td>
                         <td className="px-3 py-2 text-gray-300">{staff.phoneNumber}</td>
                         <td className="px-3 py-2 text-blue-400 text-sm">{staff.email || <span className="text-gray-600 text-xs">אין</span>}</td>
                         <td className="px-3 py-2">
                           <div className="flex gap-2">
                             <button onClick={() => handleEditStaff(staff)} className="text-yellow-400 hover:text-yellow-300"><Edit className="w-4 h-4" /></button>
                             <button onClick={() => handleDeleteStaff(staff.id)} className="text-red-400 hover:text-red-300"><Trash2 className="w-4 h-4" /></button>
                           </div>
                         </td>
                       </>
                     )}
                   </tr>
                 ))}
               </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* אוטומציות */}
      <div>
        <h3 className="text-lg font-semibold text-gray-100 mb-4">⚙️ ניהול אוטומציות</h3>
        <div className="mb-4 p-3 rounded-lg bg-yellow-900/30 border border-yellow-700/50 text-yellow-300 text-sm">
          ⚠️ האוטומציות מנוהלות דרך <strong>לוח האוטומציות</strong> בתפריט. הכרטיסים כאן מנוטרלים כדי למנוע כפילות.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-50 pointer-events-none">
          {/* לו"ז חודשי */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-100">📅 לו"ז חודשי לצוות</h4>
              <Switch
                checked={monthlySched.enabled}
                onCheckedChange={e => setMonthlySched({ enabled: e })}
              />
            </div>
            <p className="text-xs text-gray-400">רץ כל 1 לחודש ב-10:00</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleRunAutomation("monthly")}
                disabled={isRunningMonthly}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <Play className="w-3 h-3" />
                {isRunningMonthly ? "מריץ..." : "הפעל עכשיו"}
              </Button>
              <button
                onClick={() => setShowMonthlyTemplate(!showMonthlyTemplate)}
                className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            {showMonthlyTemplate && (
              <div className="bg-gray-900 border border-gray-600 rounded p-3 space-y-2">
                <p className="text-xs text-gray-400">עריכת תבנית הודעה</p>
                <textarea
                  className="w-full bg-gray-950 text-white text-xs border border-gray-700 rounded p-2 resize-none focus:outline-none focus:border-blue-500"
                  rows={4}
                  value={monthlyTemplate}
                  onChange={e => setMonthlyTemplate(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveTemplate("template_monthly_schedule", monthlyTemplate)}
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  <Save className="w-3 h-3" />
                  שמור
                </Button>
              </div>
            )}
          </div>

          {/* סיכום יומי */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-100">📋 סיכום אירועים יומי</h4>
              <Switch
                checked={dailyBrief.enabled}
                onCheckedChange={e => setDailyBrief({ enabled: e })}
              />
            </div>
            <p className="text-xs text-gray-400">רץ כל יום ב-09:00</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleRunAutomation("daily")}
                disabled={isRunningDaily}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <Play className="w-3 h-3" />
                {isRunningDaily ? "מריץ..." : "הפעל עכשיו"}
              </Button>
              <button
                onClick={() => setShowDailyTemplate(!showDailyTemplate)}
                className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            {showDailyTemplate && (
              <div className="bg-gray-900 border border-gray-600 rounded p-3 space-y-2">
                <p className="text-xs text-gray-400">עריכת תבנית הודעה</p>
                <textarea
                  className="w-full bg-gray-950 text-white text-xs border border-gray-700 rounded p-2 resize-none focus:outline-none focus:border-blue-500"
                  rows={4}
                  value={dailyTemplate}
                  onChange={e => setDailyTemplate(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveTemplate("template_daily_brief", dailyTemplate)}
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  <Save className="w-3 h-3" />
                  שמור
                </Button>
              </div>
            )}
          </div>

          {/* שאלון הכנה לזוגות */}
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-gray-100">📝 שליחת שאלון הכנה לזוגות</h4>
              <Switch
                checked={questionnaireReminder.enabled}
                onCheckedChange={e => setQuestionnaireReminder({ enabled: e })}
              />
            </div>
            <p className="text-xs text-gray-400">רץ כל 1 לחודש ב-09:00 — שולח לזוגות עם אירוע בחודש הקרוב</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => handleRunAutomation("questionnaire")}
                disabled={isRunningQuestionnaire}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white gap-2"
              >
                <Play className="w-3 h-3" />
                {isRunningQuestionnaire ? "מריץ..." : "הפעל עכשיו"}
              </Button>
              <button
                onClick={() => setShowQuestionnaireTemplate(!showQuestionnaireTemplate)}
                className="px-3 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
            {showQuestionnaireTemplate && (
              <div className="bg-gray-900 border border-gray-600 rounded p-3 space-y-2">
                <p className="text-xs text-gray-400">עריכת תבנית הודעה — משתנים: <code>$couple_names</code>, <code>$questionnaire_link</code></p>
                <textarea
                  className="w-full bg-gray-950 text-white text-xs border border-gray-700 rounded p-2 resize-none focus:outline-none focus:border-blue-500"
                  rows={4}
                  value={questionnaireTemplate}
                  onChange={e => setQuestionnaireTemplate(e.target.value)}
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveTemplate("template_questionnaire_reminder", questionnaireTemplate)}
                  className="w-full bg-green-600 hover:bg-green-700 text-white gap-2"
                >
                  <Save className="w-3 h-3" />
                  שמור
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}