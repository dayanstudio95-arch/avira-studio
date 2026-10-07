import React, { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Trash2, SlidersHorizontal, LayoutGrid, X, Bell, History, CalendarClock } from "lucide-react";
import { BOXES } from "@/lib/chatModel";

export const LABEL_COLORS = ["#E5484D", "#F76B15", "#C2410C", "#12A594", "#3E63DD", "#8E4EC6", "#D6409F", "#64748B"];

// Desktop sidebar of "אווירה צ'אט": the boxes, the owner's labels, and the way back to
// the full system. On a phone the same boxes come from the "עוד" tab (ChatApp.jsx).
export default function ChatSidebar({ box, setBox, counts, labels, onCreateLabel, onDeleteLabel, onOpenNotifications, onOpenMeetings, className = "" }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCreateLabel(name, color);
      setName("");
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  const row = (key, label, extra = null) => {
    const on = box === key;
    const n = counts[key] || 0;
    const urgent = (key === "needs" || key === "hot") && n > 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setBox(key)}
        className={`group flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-start text-sm transition-colors ${
          on ? "chat-box-on font-semibold text-white" : "text-gray-300 hover:bg-gray-800/60"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2 truncate">{extra}{label}</span>
        <span className={urgent ? "rounded-full bg-red-500 px-2 text-xs font-bold text-white" : "text-xs text-gray-500"}>{n}</span>
      </button>
    );
  };

  return (
    <nav aria-label="תיבות" className={`flex flex-col gap-0.5 overflow-y-auto border-l border-gray-800 bg-gray-950 p-3 ${className}`}>
      <div className="flex items-center gap-2 px-2 pb-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-400 text-lg font-bold text-gray-900">א</span>
        <span className="text-[15px] font-bold text-white">אווירה צ'אט</span>
      </div>

      {BOXES.filter((b) => b.primary).map((b) => row(b.key, b.label))}

      <div className="mt-4 px-3 pb-1 text-xs font-semibold text-gray-500">עוד</div>
      {BOXES.filter((b) => !b.primary).map((b) => row(b.key, b.label))}

      <div className="mt-4 px-3 pb-1 text-xs font-semibold text-gray-500">התוויות שלי</div>
      {labels.map((l) =>
        row(
          "label:" + l.id,
          <span className="flex items-center gap-2">
            {l.name}
            {box === "label:" + l.id && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`מחק את התווית ${l.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`למחוק את התווית "${l.name}"? היא תוסר מכל השיחות.`)) onDeleteLabel(l.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    if (window.confirm(`למחוק את התווית "${l.name}"? היא תוסר מכל השיחות.`)) onDeleteLabel(l.id);
                  }
                }}
                className="text-gray-500 hover:text-red-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </span>
            )}
          </span>,
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: l.color }} />
        )
      )}
      {adding ? (
        <form onSubmit={submit} className="mt-1 space-y-2 rounded-lg border border-gray-800 p-2">
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="שם התווית"
              aria-label="שם התווית"
              className="min-w-0 flex-1 rounded-md border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-white outline-none focus:border-yellow-500"
            />
            <button type="button" onClick={() => setAdding(false)} aria-label="ביטול" className="p-1 text-gray-500 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="צבע">
            {LABEL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full ${color === c ? "ring-2 ring-white ring-offset-2 ring-offset-gray-950" : ""}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <button type="submit" disabled={busy || !name.trim()} className="w-full rounded-md bg-yellow-400 py-1.5 text-sm font-semibold text-gray-900 disabled:opacity-50">
            הוסף תווית
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 flex items-center gap-2 rounded-lg border border-dashed border-gray-700 px-3 py-2 text-sm text-gray-400 hover:text-white"
        >
          <Plus className="h-4 w-4" /> תווית חדשה
        </button>
      )}

      <div className="mt-auto space-y-0.5 border-t border-gray-800 pt-3">
        {onOpenMeetings && (
          <button type="button" onClick={onOpenMeetings} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-semibold text-yellow-300 hover:bg-gray-800/60">
            <CalendarClock className="h-4 w-4" /> פגישות
          </button>
        )}
        <button type="button" onClick={onOpenNotifications} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm text-gray-400 hover:bg-gray-800/60 hover:text-white">
          <Bell className="h-4 w-4" /> התראות
        </button>
        <Link to="/BotControlCenter" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800/60 hover:text-white">
          <SlidersHorizontal className="h-4 w-4" /> מרכז שליטה לבוט
        </Link>
        <Link to="/" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400 hover:bg-gray-800/60 hover:text-white">
          <LayoutGrid className="h-4 w-4" /> למערכת המלאה
        </Link>
        <Link to="/WhatsAppInbox" className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-500 hover:bg-gray-800/60 hover:text-white">
          <History className="h-4 w-4" /> מסך השיחות הישן (גיבוי)
        </Link>
      </div>
    </nav>
  );
}
