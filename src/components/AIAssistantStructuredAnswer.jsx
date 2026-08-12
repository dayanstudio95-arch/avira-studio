import React, { useState } from "react";
import SendStaffScheduleModal from "@/components/staffSchedule/SendStaffScheduleModal";

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
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const [y, m, d] = parts;
  return `${d}/${m}/${y.slice(2)}`;
}

function formatMonth(yyyyMM) {
  if (!yyyyMM) return '—';
  const parts = yyyyMM.split('-');
  if (parts.length < 2) return yyyyMM;
  const [y, m] = parts;
  return `${MONTH_NAMES_HE[parseInt(m) - 1] || ''} ${y}`;
}

function StaffScheduleAnswer({ data }) {
  const [showModal, setShowModal] = useState(false);

  // Send button guard: only show when fully resolved, no ambiguity, has events
  const canSend = !data.notFound && !data.ambiguous && !data.error &&
    data.staffId && data.count > 0;

  if (data.notFound) {
    return (
      <div className="text-sm text-gray-300">
        לא נמצא איש צוות בשם "{data.staffName}" במערכת.
      </div>
    );
  }

  if (data.ambiguous) {
    return (
      <div className="text-sm text-gray-300">
        נמצאו כמה אנשי צוות תואמים: <span className="text-yellow-400">{(data.candidates || []).join(', ')}</span>.
        <br />איזה מהם התכוונת?
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="text-sm text-yellow-300">
        {data.error}
      </div>
    );
  }

  // By month
  if (data.month) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-semibold text-yellow-400">
          האירועים של {data.staffName} — {formatMonth(data.month)} ({data.count} אירועים):
        </div>
        {data.count === 0 ? (
          <div className="text-sm text-gray-400">לא נמצאו אירועים בתקופה זו.</div>
        ) : (
          <div className="space-y-1">
            {data.events.map((e, i) => (
              <div key={i} className="text-sm text-gray-200 font-mono bg-gray-700/40 rounded px-2 py-1">
                📅 {formatDate(e.date)} | {e.coupleNames} | {e.venue || '—'} | {ROLE_LABELS[e.role] || e.role}
              </div>
            ))}
          </div>
        )}
        {canSend && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-700/30 border border-green-600/40 text-green-300 hover:bg-green-700/50 transition-colors"
          >
            📲 שלח לאיש הצוות
          </button>
        )}
        {showModal && <SendStaffScheduleModal data={data} onClose={() => setShowModal(false)} />}
      </div>
    );
  }

  // By year
  if (data.year) {
    return (
      <div className="space-y-2">
        <div className="text-sm font-semibold text-yellow-400">
          כל האירועים של {data.staffName} בשנת {data.year} ({data.count} אירועים):
        </div>
        {data.count === 0 ? (
          <div className="text-sm text-gray-400">לא נמצאו אירועים בשנה זו.</div>
        ) : (
          <div className="space-y-1">
            {data.events.map((e, i) => (
              <div key={i} className="text-sm text-gray-200 font-mono bg-gray-700/40 rounded px-2 py-1">
                📅 {formatDate(e.date)} — {e.coupleNames || '—'} — {e.venue || '—'} — {ROLE_LABELS[e.role] || e.role || '—'}
              </div>
            ))}
          </div>
        )}
        {canSend && (
          <button
            onClick={() => setShowModal(true)}
            className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-700/30 border border-green-600/40 text-green-300 hover:bg-green-700/50 transition-colors"
          >
            📲 שלח לאיש הצוות
          </button>
        )}
        {showModal && <SendStaffScheduleModal data={data} onClose={() => setShowModal(false)} />}
      </div>
    );
  }

  return null;
}

function UnpaidEventsAnswer({ data }) {
  const statusLabel = (status) => {
    if (status === 'Unpaid') return { icon: '💰', label: 'לא שולם' };
    if (status === 'Partially Paid') return { icon: '🔶', label: 'שולם חלקית' };
    return { icon: '❓', label: status };
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-yellow-400">
        {data.count === 0
          ? 'לא נמצאו חובות פתוחים 🎉'
          : `${data.count} אירועים עם תשלום לא מושלם:`}
      </div>
      {data.events.map((e, i) => {
        const { icon, label } = statusLabel(e.paymentStatus);
        return (
          <div key={i} className="text-sm text-gray-200 font-mono bg-gray-700/40 rounded px-2 py-1">
            {icon} {formatDate(e.date)} | {e.coupleNames} | {e.venue || '—'} | {label}
          </div>
        );
      })}
    </div>
  );
}

export default function StructuredAnswer({ data }) {
  if (!data || data.type !== 'structured_answer') return null;

  if (data.intent === 'staff_schedule_by_month') return <StaffScheduleAnswer data={data} />;
  if (data.intent === 'staff_schedule_by_year') return <StaffScheduleAnswer data={data} />;
  if (data.intent === 'unpaid_events') return <UnpaidEventsAnswer data={data} />;

  return <div className="text-sm text-gray-400">תשובה לא מוכרת.</div>;
}