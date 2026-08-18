import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Send, Loader2, Eye, PenLine, ArrowRight } from "lucide-react";
import { toast } from "sonner";

// NOTE: these values intentionally match staff_members.role (STAFF_JOB_ROLES in
// src/lib/staffRoles.js) — the automation-engine edge function's runCustomStaffMessage
// filters `staff_members` by this exact field (`m.role !== targetRole`), NOT by the
// per-event team-assignment role (photographer1/photographer2/etc. in
// events.team[].role, a different concept — see src/lib/staffRoles.js's header
// comment). So "photographer" (singular, matching staff_members.role) here is
// correct, not a mismatch with EVENT_TEAM_ROLES's "photographer1"/"photographer2".
const ROLE_OPTIONS = [
  { value: "all", label: "כל אנשי הצוות" },
  { value: "photographer", label: "צלמים" },
  { value: "videographer", label: "צלמי וידאו" },
  { value: "editor", label: "עורכים" },
  { value: "graphic_designer", label: "מעצבים גרפיים" },
];

export default function CustomStaffMessageModal({ automation, onClose, onSent }) {
  const [step, setStep] = useState("compose"); // "compose" | "preview"
  const [targetRole, setTargetRole] = useState("all");
  const [messageText, setMessageText] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sending, setSending] = useState(false);

  const handlePreview = async () => {
    if (!messageText.trim()) {
      toast.error("כתוב תוכן הודעה לפני תצוגה מקדימה");
      return;
    }
    setLoadingPreview(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        dry_run: true,
        message_template_override: messageText,
        target_role_override: targetRole,
      });
      const rows = res.data?.results?.[0]?.previews || [];
      if (rows.length === 0) {
        toast.info("לא נמצאו אנשי צוות מתאימים לתפקיד שנבחר");
      } else {
        setPreviews(rows);
        setSelectedIds(new Set(rows.map(r => r.staffId).filter(Boolean)));
        setStep("preview");
      }
    } catch (e) {
      toast.error("שגיאה בטעינת תצוגה מקדימה: " + e.message);
    }
    setLoadingPreview(false);
  };

  const toggleId = (id, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(previews.map(p => p.staffId).filter(Boolean)));
  const clearAll = () => setSelectedIds(new Set());

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      toast.error("בחר לפחות איש צוות אחד לשליחה");
      return;
    }
    setSending(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        message_template_override: messageText,
        target_role_override: targetRole,
        selectedStaffIds: Array.from(selectedIds),
      });
      const sent = res.data?.results?.[0]?.sent || 0;
      toast.success(`נשלחו ${sent} הודעות בהצלחה!`);
      onSent();
      onClose();
    } catch (e) {
      toast.error("שגיאה בשליחה: " + e.message);
    }
    setSending(false);
  };

  const totalSelected = selectedIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="bg-gray-900/95 border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center">
              {step === "compose" ? <PenLine className="w-5 h-5 text-indigo-400" /> : <Eye className="w-5 h-5 text-indigo-400" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {step === "compose" ? "הודעה מותאמת אישית לצוות" : "תצוגה מקדימה — בחר למי לשלוח"}
              </h2>
              <p className="text-gray-400 text-xs">
                {step === "compose" ? "כתבו הודעה חופשית ובחרו קהל יעד" : `סה״כ ${previews.length} אנשי צוות מתאימים`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        {step === "compose" ? (
          <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">שלח אל</label>
              <div className="grid grid-cols-2 gap-2">
                {ROLE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTargetRole(opt.value)}
                    className={`text-sm px-3 py-2 rounded-lg border transition-colors text-right ${
                      targetRole === opt.value
                        ? "bg-indigo-900/50 border-indigo-600 text-indigo-200"
                        : "bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-gray-300 text-sm font-medium block mb-2">תוכן ההודעה</label>
              <textarea
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                placeholder={"כתבו כאן את ההודעה שתישלח בוואטסאפ...\n\nאפשר להשתמש ב-{staff_name} כדי לפנות לכל אחד בשמו האישי."}
                rows={8}
                dir="rtl"
                className="w-full bg-gray-800/60 border border-gray-700 rounded-xl p-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-600 resize-none"
              />
              <p className="text-gray-600 text-xs mt-1.5">💡 {"{staff_name}"} יוחלף אוטומטית בשם איש הצוות</p>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs px-2.5 py-1 bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 rounded hover:bg-indigo-800/60 transition-colors"
              >
                בחר הכל
              </button>
              <button
                onClick={clearAll}
                className="text-xs px-2.5 py-1 bg-gray-700/40 border border-gray-600/50 text-gray-300 rounded hover:bg-gray-600/60 transition-colors"
              >
                נקה
              </button>
              <span className="text-xs text-gray-500 ml-auto self-center">{totalSelected} / {previews.length}</span>
            </div>

            <div className="border border-gray-700/60 rounded-xl divide-y divide-gray-800/60 overflow-hidden">
              {previews.map((item) => (
                <div key={item.staffId} className={`flex gap-3 px-4 py-3 items-start transition-colors ${selectedIds.has(item.staffId) ? 'bg-indigo-900/20' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.staffId)}
                    onChange={e => toggleId(item.staffId, e.target.checked)}
                    className="mt-1 w-4 h-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap mb-1">
                      <span className="text-white font-semibold text-sm">{item.name}</span>
                      <span className="text-gray-400 text-xs font-mono" dir="ltr">{item.staffPhone || '— אין טלפון'}</span>
                    </div>
                    <pre className="text-gray-300 text-[11px] whitespace-pre-wrap leading-relaxed bg-gray-950/60 rounded-lg p-2.5 border border-gray-700/40 max-h-24 overflow-y-auto font-sans" dir="rtl">
                      {item.message}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-gray-900/95 border-t border-gray-700 px-6 py-4 flex gap-3 rounded-b-2xl justify-between items-center">
          {step === "compose" ? (
            <>
              <span className="text-xs text-gray-600">אין שליחה עדיין — בשלב הבא תוכלו לבחור למי בדיוק לשלוח</span>
              <Button
                onClick={handlePreview}
                disabled={loadingPreview || !messageText.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-2"
              >
                {loadingPreview ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                תצוגה מקדימה
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("compose")} className="border-gray-600 text-gray-300 hover:bg-gray-800 gap-1.5">
                <ArrowRight className="w-3.5 h-3.5" />
                חזרה לעריכה
              </Button>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {totalSelected === 0 ? '⚠️ לא נבחר אף אחד' : `✓ ${totalSelected} נבחרו`}
                </span>
                <Button
                  onClick={handleSend}
                  disabled={sending || totalSelected === 0}
                  className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  שלח {totalSelected > 0 ? `ל-${totalSelected}` : ''}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
