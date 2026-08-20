import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Send, Loader2, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

const HEBREW_MONTHS = ["","ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

function formatDateIL(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

function GroupSection({ title, color, items, selectable, selectedIds, onToggle, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  const colorMap = {
    green: "border-green-700/50 bg-green-950/20",
    yellow: "border-yellow-700/50 bg-yellow-950/20",
    blue: "border-blue-700/50 bg-blue-950/20",
    gray: "border-gray-700/50 bg-gray-800/20",
  };
  const headerMap = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    blue: "text-blue-400",
    gray: "text-gray-400",
  };

  return (
    <div className={`border rounded-xl overflow-hidden ${colorMap[color]}`}>
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-bold"
        onClick={() => setOpen(o => !o)}
      >
        <span className={headerMap[color]}>{title} <span className="text-gray-400 font-normal">({items.length})</span></span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>
      {open && (
        <div className="divide-y divide-gray-800/60">
          {items.map((item) => (
            <div key={item.eventId} className={`flex gap-3 px-4 py-3 items-start transition-colors ${selectable && selectedIds.has(item.eventId) ? 'bg-indigo-900/20' : ''}`}>
              {selectable && (
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.eventId)}
                  onChange={e => onToggle(item.eventId, e.target.checked)}
                  className="mt-1 w-4 h-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                />
              )}
              {!selectable && <div className="mt-1 w-4 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-1">
                  <span className="text-white font-semibold text-sm">{item.name}</span>
                  <span className="text-gray-400 text-xs font-mono" dir="ltr">{item.staffPhone || '—'}</span>
                  <span className="text-gray-300 text-xs font-mono">{formatDateIL(item.eventDate)}</span>
                  {item.questionnaireSentAt && (
                    <span className="text-xs text-yellow-400">נשלח: {formatDateIL(item.questionnaireSentAt)}</span>
                  )}
                  {!item.hasLinkedLead && (
                    <span className="text-xs text-orange-400 border border-orange-600/50 rounded px-1.5 py-0.5 bg-orange-950/30">⚠ בלי Lead מקושר</span>
                  )}
                </div>
                <pre className="text-gray-300 text-[11px] whitespace-pre-wrap leading-relaxed bg-gray-950/60 rounded-lg p-2.5 border border-gray-700/40 max-h-28 overflow-y-auto font-sans" dir="rtl">
                  {item.message}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function QuestionnaireSendPreviewModal({ automation, onClose, onSent }) {
  const now = new Date();
  const defaultMonth = now.getMonth() + 2 > 12
    ? { month: 1, year: now.getFullYear() + 1 }
    : { month: now.getMonth() + 2, year: now.getFullYear() };

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth.month);
  const [selectedYear, setSelectedYear] = useState(defaultMonth.year);
  const [groups, setGroups] = useState(null); // { readyToSend, alreadySent, sentNoReply, completed }
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  // Selected event IDs for sending (readyToSend + optionally sentNoReply)
  const [selectedIds, setSelectedIds] = useState(new Set());

  const targetYYYYMM = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  const loadPreview = async () => {
    setLoading(true);
    setGroups(null);
    setSelectedIds(new Set());
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        dry_run: true,
        targetYYYYMM,
      });
      const g = res.data?.results?.[0]?.groups;
      if (!g) {
        toast.info("אין אירועים בחודש שנבחר");
        setLoading(false);
        return;
      }
      setGroups(g);
      // Default: select only readyToSend
      setSelectedIds(new Set((g.readyToSend || []).map(e => e.eventId)));
    } catch (e) {
      toast.error("שגיאה בטעינת preview: " + e.message);
    }
    setLoading(false);
  };

  const toggleId = (id, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) { toast.error("בחר לפחות זוג אחד לשליחה"); return; }
    setSending(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
        targetYYYYMM,
        selectedEventIds: Array.from(selectedIds),
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
  const totalEvents = groups ? (groups.readyToSend?.length || 0) + (groups.sentNoReply?.length || 0) + (groups.completed?.length || 0) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="bg-gray-900/95 border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-900/60 border border-indigo-700/50 flex items-center justify-center">
              <Eye className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">שליחת שאלון הכנה</h2>
              <p className="text-gray-400 text-xs">בחר חודש יעד וצפה בסטטוס כל זוג לפני שליחה</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Month picker */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-gray-400 text-xs block mb-1">חודש</label>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(Number(e.target.value))}
              className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {HEBREW_MONTHS.slice(1).map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-gray-400 text-xs block mb-1">שנה</label>
            <select
              value={selectedYear}
              onChange={e => setSelectedYear(Number(e.target.value))}
              className="bg-gray-700 border border-gray-600 text-white rounded-lg px-3 py-2 text-sm"
            >
              {Array.from({ length: 4 }, (_, i) => now.getFullYear() + i).map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <Button
            onClick={loadPreview}
            disabled={loading}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "טען preview"}
          </Button>
          {groups && (
            <span className="text-xs text-gray-400 self-center">{totalEvents} אירועים בחודש {HEBREW_MONTHS[selectedMonth]} {selectedYear}</span>
          )}
        </div>

        {/* Groups */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {!groups && !loading && (
            <p className="text-gray-500 text-sm text-center py-8">בחר חודש ולחץ "טען preview"</p>
          )}
          {loading && (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
            </div>
          )}
          {groups && (
            <>
              <GroupSection
                title="✅ מוכן לשליחה — לא קיבלו שאלון"
                color="green"
                items={groups.readyToSend || []}
                selectable
                selectedIds={selectedIds}
                onToggle={toggleId}
                defaultOpen
              />
              <GroupSection
                title="🔔 נשלח — לא ענו עדיין"
                color="yellow"
                items={groups.sentNoReply || []}
                selectable
                selectedIds={selectedIds}
                onToggle={toggleId}
                defaultOpen={false}
              />
              <GroupSection
                title="✔️ הושלם — מילאו שאלון"
                color="blue"
                items={groups.completed || []}
                selectable={false}
                selectedIds={new Set()}
                onToggle={() => {}}
                defaultOpen={false}
              />
              {groups.readyToSend?.length === 0 && groups.sentNoReply?.length === 0 && groups.completed?.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-6">אין אירועים בחודש זה</p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-900/95 border-t border-gray-700 px-6 py-4 flex gap-3 rounded-b-2xl justify-between items-center">
          <span className="text-xs text-gray-400">
            {groups
              ? totalSelected === 0
                ? '⚠️ לא נבחר אף זוג'
                : `✓ ${totalSelected} נבחרו לשליחה`
              : ''}
          </span>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700">ביטול</Button>
            <Button
              onClick={handleSend}
              disabled={sending || totalSelected === 0 || !groups}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold gap-2"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              אשר ושלח {totalSelected > 0 ? `${totalSelected} הודעות` : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}