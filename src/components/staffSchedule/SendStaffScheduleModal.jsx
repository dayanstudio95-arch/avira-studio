import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Send, Loader2, MessageSquare } from "lucide-react";

const ROLE_LABELS = {
  photographer1: 'צלם 1',
  photographer2: 'צלם 2',
  videographer: 'צלם וידאו',
  videographer2: 'צלם וידאו 2',
  editor: 'עורך',
};

const MONTH_NAMES_HE = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMonth(yyyyMM) {
  if (!yyyyMM) return '—';
  const [y, m] = yyyyMM.split('-');
  return `${MONTH_NAMES_HE[parseInt(m) - 1] || ''} ${y}`;
}

/**
 * Builds the WhatsApp message deterministically from structured answer data.
 * No LLM involved.
 */
export function buildScheduleMessage(data) {
  const lines = [];

  if (data.intent === 'staff_schedule_by_month') {
    lines.push(`📅 לוח עבודה — ${data.staffName}`);
    lines.push(`חודש: ${formatMonth(data.month)}`);
    lines.push(`סה"כ ${data.count} אירועים`);
    lines.push('');
    data.events.forEach((e, i) => {
      const role = ROLE_LABELS[e.role] || e.role || '';
      lines.push(`${i + 1}. ${formatDate(e.date)} — ${e.coupleNames || '—'}${e.venue ? ` | ${e.venue}` : ''}${role ? ` | ${role}` : ''}`);
    });
  } else if (data.intent === 'staff_schedule_by_year') {
    lines.push(`📅 לוח עבודה שנתי — ${data.staffName}`);
    lines.push(`שנת ${data.year}`);
    // Cap at 25 events to keep message manageable
    const MAX = 25;
    const capped = data.events.slice(0, MAX);
    lines.push(`סה"כ ${data.count} אירועים`);
    if (data.count > MAX) lines.push(`(מוצגים ${MAX} הראשונים)`);
    lines.push('');
    capped.forEach((e, i) => {
      const role = ROLE_LABELS[e.role] || e.role || '';
      lines.push(`${i + 1}. ${formatDate(e.date)} — ${e.coupleNames || '—'}${e.venue ? ` | ${e.venue}` : ''}${role ? ` | ${role}` : ''}`);
    });
  }

  return lines.join('\n');
}

/**
 * SendStaffScheduleModal
 * Props:
 *   data        — the full structured answer object (from aiAssistant)
 *   phoneNumber — resolved phone (fetched by parent or passed from data if available)
 *   onClose     — close callback
 */
export default function SendStaffScheduleModal({ data, onClose }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const message = buildScheduleMessage(data);

  const handleConfirmSend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('sendStaffScheduleMessage', {
        staffId: data.staffId,
        message,
      });
      if (res?.data?.success) {
        setSent(true);
      } else {
        setError(res?.data?.error || 'שגיאה לא ידועה');
      }
    } catch (err) {
      setError(err?.message || 'שגיאה בשליחה');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-md mx-4 p-5 text-right"
        dir="rtl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 text-white font-semibold text-base">
            <MessageSquare className="w-4 h-4 text-green-400" />
            שליחת לוח עבודה לאיש צוות
          </div>
        </div>

        {/* Recipient info */}
        <div className="bg-gray-800 rounded-xl px-4 py-3 mb-4 text-sm text-gray-200 space-y-1">
          <div><span className="text-gray-400">שם: </span>{data.staffName}</div>
          <div><span className="text-gray-400">מזהה: </span><span className="font-mono text-xs text-gray-500">{data.staffId}</span></div>
          <div className="text-xs text-gray-500 mt-1">מספר הטלפון יוטען מהמערכת בעת השליחה</div>
        </div>

        {/* Message preview */}
        <div className="bg-gray-800 rounded-xl px-4 py-3 mb-5">
          <div className="text-xs text-gray-400 mb-2">תצוגה מקדימה של ההודעה:</div>
          <pre className="text-sm text-gray-100 whitespace-pre-wrap font-sans leading-relaxed">{message}</pre>
        </div>

        {/* Status */}
        {error && (
          <div className="bg-red-900/40 border border-red-600/50 rounded-lg px-3 py-2 text-sm text-red-300 mb-4">
            שגיאה: {error}
          </div>
        )}
        {sent && (
          <div className="bg-green-900/40 border border-green-600/50 rounded-lg px-3 py-2 text-sm text-green-300 mb-4">
            ✅ ההודעה נשלחה בהצלחה
          </div>
        )}

        {/* Actions */}
        {!sent ? (
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={onClose} disabled={sending}
              className="border-gray-600 text-gray-300 hover:bg-gray-700">
              ביטול
            </Button>
            <Button
              onClick={handleConfirmSend}
              disabled={sending}
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sending ? 'שולח…' : 'אשר ושלח'}
            </Button>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button onClick={onClose} className="bg-gray-700 hover:bg-gray-600 text-white">סגור</Button>
          </div>
        )}
      </div>
    </div>
  );
}