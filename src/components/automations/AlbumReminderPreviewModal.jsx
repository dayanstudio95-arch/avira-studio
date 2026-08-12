import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { X, Send, Loader2, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

function formatDateIL(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('he-IL');
}

function GroupSection({ title, color, items, selectedIds, onToggle, onSelectAll, onClearAll, defaultOpen = false, disableCheckboxes = false, daysUntil30Fn = null }) {
  const [open, setOpen] = useState(defaultOpen);
  if (items.length === 0) return null;

  const colorMap = {
    green: "border-green-700/50 bg-green-950/20",
    yellow: "border-yellow-700/50 bg-yellow-950/20",
    blue: "border-blue-700/50 bg-blue-950/20",
  };
  const headerMap = {
    green: "text-green-400",
    yellow: "text-yellow-400",
    blue: "text-blue-400",
  };

  const allSelected = items.length > 0 && items.every(i => selectedIds.has(i.eventId));
  const someSelected = items.some(i => selectedIds.has(i.eventId));

  return (
    <div className={`border rounded-xl overflow-hidden ${colorMap[color]}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <button
          className="flex-1 flex items-center justify-between text-sm font-bold"
          onClick={() => setOpen(o => !o)}
        >
          <span className={headerMap[color]}>{title} <span className="text-gray-400 font-normal">({items.length})</span></span>
          {open ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
        </button>
      </div>
      
      {open && (
        <>
          {!disableCheckboxes && (
            <div className="flex gap-2 px-4 py-2 border-b border-gray-700/50 bg-gray-800/30">
              <button
                onClick={() => onSelectAll(items.map(i => i.eventId))}
                className="text-xs px-2.5 py-1 bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 rounded hover:bg-indigo-800/60 transition-colors"
              >
                בחר הכל
              </button>
              <button
                onClick={() => onClearAll(items.map(i => i.eventId))}
                className="text-xs px-2.5 py-1 bg-gray-700/40 border border-gray-600/50 text-gray-300 rounded hover:bg-gray-600/60 transition-colors"
              >
                נקה
              </button>
              <span className="text-xs text-gray-500 ml-auto self-center">
                {items.filter(i => selectedIds.has(i.eventId)).length} / {items.length}
              </span>
            </div>
          )}

          <div className="divide-y divide-gray-800/60 max-h-96 overflow-y-auto">
            {items.map((item) => (
              <div key={item.eventId} className={`flex gap-3 px-4 py-3 items-start transition-colors ${selectedIds.has(item.eventId) ? 'bg-indigo-900/20' : ''}`}>
                {!disableCheckboxes && (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.eventId)}
                    onChange={e => onToggle(item.eventId, e.target.checked)}
                    className="mt-1 w-4 h-4 rounded accent-indigo-500 cursor-pointer shrink-0"
                  />
                )}
                {disableCheckboxes && <div className="mt-1 w-4 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-1">
                    <span className="text-white font-semibold text-sm">{item.name}</span>
                    <span className="text-gray-400 text-xs font-mono" dir="ltr">{item.phone || '—'}</span>
                    <span className="text-gray-300 text-xs font-mono">{formatDateIL(item.eventDate)}</span>
                    <span className="text-gray-400 text-xs">{item.daysSinceEvent} ימים</span>
                    {daysUntil30Fn && (
                      <span className="text-xs text-blue-400">עוד {daysUntil30Fn(item.daysSinceEvent)} ימים</span>
                    )}
                    {item.album_reminder_sent && (
                      <span className="text-xs text-yellow-400">נשלח: {formatDateIL(item.album_reminder_sent_at)}</span>
                    )}
                  </div>
                  <pre className="text-gray-300 text-[11px] whitespace-pre-wrap leading-relaxed bg-gray-950/60 rounded-lg p-2.5 border border-gray-700/40 max-h-20 overflow-y-auto font-sans" dir="rtl">
                    {item.message}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function AlbumReminderPreviewModal({ automation, previews, onClose, onSent }) {
  // Split previews into groups
  const notSentReady = previews.filter(p => !p.album_reminder_sent && p.daysSinceEvent >= 30);
  const alreadySent = previews.filter(p => p.album_reminder_sent && p.daysSinceEvent >= 30);
  const earlyStage = previews.filter(p => p.albumStatus !== 'sent' && p.daysSinceEvent < 30);

  const [selectedIds, setSelectedIds] = useState(() => {
    // Default: select all non-sent ready items (30+ days)
    return new Set(notSentReady.map(p => p.eventId));
  });
  const [sending, setSending] = useState(false);

  const toggleId = (id, checked) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      checked ? next.add(id) : next.delete(id);
      return next;
    });
  };

  const selectAll = (ids) => {
    setSelectedIds(prev => new Set([...prev, ...ids]));
  };

  const clearAll = (ids) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      ids.forEach(id => next.delete(id));
      return next;
    });
  };

  const daysUntil30 = (daysSinceEvent) => {
    return Math.max(0, 30 - daysSinceEvent);
  };

  const handleSend = async () => {
    if (selectedIds.size === 0) {
      toast.error("בחר לפחות זוג אחד לשליחה");
      return;
    }
    setSending(true);
    try {
      const res = await base44.functions.invoke("automationEngine", {
        automation_id: automation.id,
        triggered_by: "manual",
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
              <h2 className="text-lg font-bold text-white">תזכורת אלבום — בחר זוגות לשליחה</h2>
              <p className="text-gray-400 text-xs">סה״כ {previews.length} זוגות רלוונטיים</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Groups */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          <GroupSection
            title="🟢 לא נשלח — מוכן לשליחה"
            color="green"
            items={notSentReady}
            selectedIds={selectedIds}
            onToggle={toggleId}
            onSelectAll={selectAll}
            onClearAll={clearAll}
            defaultOpen={true}
            disableCheckboxes={false}
          />
          <GroupSection
            title="🟡 נשלח בעבר"
            color="yellow"
            items={alreadySent}
            selectedIds={selectedIds}
            onToggle={toggleId}
            onSelectAll={selectAll}
            onClearAll={clearAll}
            defaultOpen={false}
            disableCheckboxes={false}
          />
          <GroupSection
            title="🔵 עדיין לא עברו 30 יום"
            color="blue"
            items={earlyStage}
            selectedIds={selectedIds}
            onToggle={toggleId}
            onSelectAll={selectAll}
            onClearAll={clearAll}
            defaultOpen={false}
            disableCheckboxes={true}
            daysUntil30Fn={daysUntil30}
          />
          {previews.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-6">אין זוגות רלוונטיים</p>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-900/95 border-t border-gray-700 px-6 py-4 flex gap-3 rounded-b-2xl justify-between items-center">
          <span className="text-xs text-gray-400">
            {totalSelected === 0 ? '⚠️ לא נבחר אף אחד' : `✓ ${totalSelected} מ-${previews.length} נבחרו`}
          </span>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onClose} className="border-gray-600 text-gray-300 hover:bg-gray-800">ביטול</Button>
            <Button
              onClick={handleSend}
              disabled={sending || totalSelected === 0}
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