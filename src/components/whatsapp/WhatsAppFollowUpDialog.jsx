import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { X, Send, Loader2, CheckSquare, Square, Clock } from "lucide-react";
import { toast } from "sonner";
import { conversationTitle, daysSince } from "./whatsappInboxShared";

// "Everyone who got a price list and then went quiet" — the studio's actual sales
// queue, and the thing Daniel asked for in the same breath as the bot itself:
// "שכל מי שקיבל הצעת מחיר ייכנס לרשימת פולו-אפ שאני אוכל לשלוח הודעה נוספת".
//
// ⚠️ Nothing here is automatic. Daniel reads the exact message each person will get,
// unticks anyone he'd rather write to himself, and presses send. That was his explicit
// choice on 2026-09-09 — he had just switched off a paid third-party bot for
// improvising at his customers, and a follow-up nudge is precisely the kind of message
// that reads badly when a machine gets it slightly wrong.
//
// Deliberately modelled on src/components/leads/FollowUpReminderDialog.jsx rather than
// invented: same {{merge_field}} convention as every other WhatsApp template in this
// app, same editable-AppSetting-backed wording, same per-row checkbox and same
// sent/failed summary. The differences are only what the data forces — these are
// whatsapp_conversations, not leads, so there is no contract link, and the merge fields
// are the details the bot collected in Stage 3.
//
// Who is in the queue is decided by the caller (WhatsAppInbox), which passes only
// conversations at state PRICELIST_SENT with no followup_sent_at.

const DEFAULT_TEMPLATE = `היי {{names}} 😊
רצינו לוודא שקיבלתם את המחירון ולבדוק אם יש שאלות.
נשמח לשמור לכם את התאריך {{event_date}} — נותרו לנו מעט תאריכים בעונה.

זמינים לכל שאלה! 📸`;

export default function WhatsAppFollowUpDialog({ isOpen, onClose, conversations, onSent }) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [isSending, setIsSending] = useState(false);
  const [sendResults, setSendResults] = useState(null);

  // Oldest silence first — that is the one most likely to be slipping away.
  const queue = useMemo(
    () =>
      (conversations || [])
        .slice()
        .sort((a, b) => new Date(a.lastBotMessageAt || 0) - new Date(b.lastBotMessageAt || 0)),
    [conversations]
  );

  useEffect(() => {
    if (!isOpen) return;
    setSendResults(null);
    setCheckedIds(new Set(queue.filter((c) => c.phone).map((c) => c.id)));
    (async () => {
      try {
        const rows = await base44.entities.AppSetting.filter({ key: "template_whatsapp_followup" });
        setTemplate(rows?.[0]?.value || DEFAULT_TEMPLATE);
      } catch {
        setTemplate(DEFAULT_TEMPLATE);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  // Merge fields come from what the bot actually collected. An empty one leaves an empty
  // string rather than the raw {{token}} — a customer should never see our plumbing.
  const applyVariables = (tpl, c) => {
    const eventDateFormatted = c.eventDate ? format(new Date(c.eventDate), "d/M/yyyy") : "";
    return tpl
      .replace(/\{\{names\}\}/g, c.coupleNames || c.displayName || "")
      .replace(/\{\{event_date\}\}/g, eventDateFormatted)
      .replace(/\{\{venue\}\}/g, c.venue || "");
  };

  const toggle = (id) =>
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const eligible = queue.filter((c) => c.phone);
  const allChecked = eligible.length > 0 && checkedIds.size === eligible.length;
  const toggleAll = () =>
    setCheckedIds((prev) => (prev.size === eligible.length ? new Set() : new Set(eligible.map((c) => c.id))));

  const handleSend = async () => {
    const targets = eligible.filter((c) => checkedIds.has(c.id));
    if (targets.length === 0) {
      toast.error("לא נבחרו שיחות לשליחה");
      return;
    }
    setIsSending(true);
    const sent = [];
    const failed = [];
    for (const c of targets) {
      try {
        const message = applyVariables(template, c);
        const res = await base44.functions.invoke("sendWhatsAppMessage", { to: c.phone, message });
        if (res?.data?.error) throw new Error(res.data.error);
        // Two writes, both mattering for a different reason:
        //   followupSentAt — takes this conversation out of the queue, so tomorrow's
        //     list doesn't offer to nudge the same person again.
        //   botEnabled     — a human is now in this conversation. The outgoing webhook
        //     would set this a moment later anyway, but not before the customer could
        //     reply and reach a bot that should already have fallen silent.
        await base44.entities.WhatsAppConversation.update(c.id, {
          followupSentAt: new Date().toISOString(),
          botEnabled: false,
        }).catch(() => {});
        sent.push(c);
      } catch {
        failed.push(c);
      }
    }
    setIsSending(false);
    setSendResults({ sent, failed });
    if (sent.length > 0) {
      toast.success(`נשלח פולו-אפ ל-${sent.length} שיחות`);
      if (onSent) onSent();
    }
    if (failed.length > 0) toast.error(`שליחה נכשלה עבור ${failed.length} שיחות`);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            <h2 className="text-white text-lg font-semibold">שליחת פולו-אפ</h2>
            <p className="text-gray-400 text-sm mt-0.5">
              {queue.length} שיחות שקיבלו מחירון ועדיין לא נשלח אליהן פולו-אפ
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-gray-300 text-sm font-medium">נוסח ההודעה</label>
              <button
                onClick={() => setIsEditingTemplate((v) => !v)}
                className="text-xs text-yellow-400 hover:text-yellow-300 underline"
              >
                {isEditingTemplate ? "סיום עריכה" : "עריכת נוסח"}
              </button>
            </div>
            {isEditingTemplate ? (
              <>
                <textarea
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  rows={7}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg p-3 text-white text-sm"
                />
                <p className="text-gray-500 text-xs mt-1">
                  ניתן להשתמש ב- {"{{names}}"}, {"{{event_date}}"}, {"{{venue}}"} — כל אחד יקבל הודעה מותאמת.
                  העריכה כאן היא לשליחה הזו בלבד; לשמירה קבועה — הגדרות ← תבניות הודעה.
                </p>
              </>
            ) : (
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-gray-200 text-sm whitespace-pre-wrap">
                {template}
              </div>
            )}
          </div>

          <div>
            <button
              onClick={toggleAll}
              className="flex items-center gap-2 text-sm text-gray-300 hover:text-white mb-2"
            >
              {allChecked ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {allChecked ? "בטל בחירת הכל" : "בחר הכל"} ({checkedIds.size}/{eligible.length})
            </button>

            <div className="space-y-2">
              {queue.map((c) => {
                const days = daysSince(c.lastBotMessageAt);
                const disabled = !c.phone;
                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border p-3 ${
                      disabled ? "border-gray-800 bg-gray-800/20 opacity-60" : "border-gray-700 bg-gray-800/40"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => !disabled && toggle(c.id)}
                        disabled={disabled}
                        className="mt-0.5 text-gray-300 disabled:opacity-40"
                      >
                        {checkedIds.has(c.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white text-sm font-medium">{conversationTitle(c)}</span>
                          {days !== null && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                              <Clock className="w-3 h-3" />
                              {days === 0 ? "היום" : `לפני ${days} ימים`}
                            </span>
                          )}
                          {disabled && <span className="text-[11px] text-red-400">אין מספר טלפון</span>}
                        </div>
                        <div className="text-gray-400 text-xs mt-1 whitespace-pre-wrap">
                          {applyVariables(template, c)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {queue.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-6">
                  אין כרגע שיחות שממתינות לפולו-אפ.
                </p>
              )}
            </div>
          </div>

          {sendResults && (
            <div className="rounded-lg border border-gray-700 bg-gray-800/60 p-3 text-sm">
              <p className="text-emerald-400">נשלח בהצלחה: {sendResults.sent.length}</p>
              {sendResults.failed.length > 0 && (
                <p className="text-red-400 mt-1">נכשל: {sendResults.failed.length}</p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 p-5 border-t border-gray-800">
          <button onClick={onClose} className="text-gray-400 hover:text-white text-sm">
            סגור
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || checkedIds.size === 0}
            className="inline-flex items-center gap-2 rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-600 disabled:opacity-50"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {isSending ? "שולח..." : `שלח ל-${checkedIds.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}
