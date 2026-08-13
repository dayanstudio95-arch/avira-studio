import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { X, Send, Loader2, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";

// New (2026-08-13): bulk "send a reminder to every lead currently stuck in פולו-אפ"
// button, per explicit request — opens a preview of the exact message each lead will
// get, with a checkbox per lead so the studio can opt specific people out before
// sending. Uses the same {{names}}/{{event_date}}/{{contract_link}} merge-field
// convention as every other WhatsApp template in this app (see MessageTemplatesTab.jsx
// / UnifiedSidePanel.jsx's applyVariables), reading the `template_lead_followup`
// AppSetting so the wording stays editable from Settings -> תבניות הודעה like every
// other template.
const DEFAULT_TEMPLATE = `היי {{names}} 😊
רצינו לבדוק שקיבלתם את קישור החוזה ולוודא שהכל בסדר מצידכם.
נשמח שתחתמו בהקדם כדי לשריין את התאריך:
{{contract_link}}

זמינים לכל שאלה! 📸`;

export default function FollowUpReminderDialog({ isOpen, onClose, leads, onSent }) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState(null); // { sent: [], failed: [] } after sending

  const followUpLeads = useMemo(
    () => (leads || []).filter((l) => l.status === "פולו-אפ"),
    [leads]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSendResults(null);
    setCheckedIds(new Set(followUpLeads.filter((l) => l.phoneNumber).map((l) => l.id)));
    (async () => {
      try {
        const rows = await base44.entities.AppSetting.filter({ key: "template_lead_followup" });
        setTemplate(rows?.[0]?.value || DEFAULT_TEMPLATE);
      } catch {
        setTemplate(DEFAULT_TEMPLATE);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const applyVariables = (tpl, lead) => {
    const baseUrl = window.location.origin;
    const contractLink = `${baseUrl}/contract/${lead.id}`;
    const eventDateFormatted = lead.eventDate ? format(new Date(lead.eventDate), "d/M/yyyy") : "";
    return tpl
      .replace(/\{\{names\}\}/g, lead.coupleNames || "")
      .replace(/\{\{event_date\}\}/g, eventDateFormatted)
      .replace(/\{\{contract_link\}\}/g, contractLink);
  };

  const toggle = (id) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const eligible = followUpLeads.filter((l) => l.phoneNumber).map((l) => l.id);
    setCheckedIds((prev) => (prev.size === eligible.length ? new Set() : new Set(eligible)));
  };

  const handleSend = async () => {
    const targets = followUpLeads.filter((l) => checkedIds.has(l.id) && l.phoneNumber);
    if (targets.length === 0) {
      toast.error("לא נבחרו לידים לשליחה");
      return;
    }
    setIsSending(true);
    const sent = [];
    const failed = [];
    for (const lead of targets) {
      try {
        const message = applyVariables(template, lead);
        const res = await base44.functions.invoke("sendWhatsAppMessage", { to: lead.phoneNumber, message });
        if (res?.data?.error) throw new Error(res.data.error);
        sent.push(lead);
      } catch (e) {
        failed.push(lead);
      }
    }
    setIsSending(false);
    setSendResults({ sent, failed });
    if (sent.length > 0) {
      toast.success(`נשלחה תזכורת ל-${sent.length} לידים`);
      if (onSent) onSent();
    }
    if (failed.length > 0) {
      toast.error(`שליחה נכשלה עבור ${failed.length} לידים`);
    }
  };

  const eligibleCount = followUpLeads.filter((l) => l.phoneNumber).length;
  const allChecked = eligibleCount > 0 && checkedIds.size === eligibleCount;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <h2 className="text-xl font-bold text-white">
            שליחת תזכורת ללידים בפולו-אפ ({followUpLeads.length})
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {followUpLeads.length === 0 ? (
            <p className="text-gray-400 text-sm">אין כרגע לידים בסטטוס "פולו-אפ".</p>
          ) : (
            <>
              {/* Template preview / edit */}
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-300">נוסח ההודעה (תצוגה מקדימה)</span>
                  <button
                    onClick={() => setIsEditingTemplate((v) => !v)}
                    className="text-xs text-yellow-400 hover:underline"
                  >
                    {isEditingTemplate ? "סיום עריכה" : "ערוך נוסח"}
                  </button>
                </div>
                {isEditingTemplate ? (
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    rows={6}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-sm text-gray-200"
                    dir="rtl"
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans">
                    {followUpLeads[0] ? applyVariables(template, followUpLeads[0]) : template}
                  </pre>
                )}
                <p className="text-xs text-gray-500">
                  ניתן להשתמש ב- {"{{names}}"}, {"{{event_date}}"}, {"{{contract_link}}"} — כל ליד יקבל הודעה מותאמת אישית.
                </p>
              </div>

              {/* Lead checklist */}
              <div className="space-y-1">
                <button
                  onClick={toggleAll}
                  className="flex items-center gap-2 text-sm text-gray-300 hover:text-white mb-2"
                >
                  {allChecked ? <CheckSquare className="w-4 h-4 text-yellow-400" /> : <Square className="w-4 h-4" />}
                  בחר הכל / בטל הכל
                </button>
                <div className="max-h-64 overflow-y-auto space-y-1 border border-gray-800 rounded-lg p-2">
                  {followUpLeads.map((lead) => (
                    <label
                      key={lead.id}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer ${
                        !lead.phoneNumber ? "opacity-40 cursor-not-allowed" : "hover:bg-gray-800/50"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedIds.has(lead.id)}
                        disabled={!lead.phoneNumber}
                        onChange={() => toggle(lead.id)}
                        className="w-4 h-4 accent-yellow-400"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{lead.coupleNames || "—"}</div>
                        <div className="text-xs text-gray-500">
                          {lead.phoneNumber || "אין מספר טלפון"}
                          {lead.eventDate ? ` · ${format(new Date(lead.eventDate), "d/M/yyyy")}` : ""}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {sendResults && (
                <div className="text-xs space-y-1">
                  {sendResults.sent.length > 0 && (
                    <p className="text-green-400">✓ נשלח בהצלחה ל-{sendResults.sent.length} לידים</p>
                  )}
                  {sendResults.failed.length > 0 && (
                    <p className="text-red-400">
                      ✗ נכשל עבור: {sendResults.failed.map((l) => l.coupleNames).join(", ")}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
          >
            סגירה
          </button>
          {followUpLeads.length > 0 && (
            <button
              onClick={handleSend}
              disabled={isSending || checkedIds.size === 0}
              className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isSending ? "שולח..." : `שלח ל-${checkedIds.size} לידים`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
