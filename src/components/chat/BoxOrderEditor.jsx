import React, { useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { GripVertical, Loader2 } from "lucide-react";
import { BOXES } from "@/lib/chatModel";

// "סדר" in the chat sidebar (2026-10-09, the owner's request): drag the boxes into the order
// he works in, and between the top (always visible, also the phone's top row) and "עוד".
// Saved per user (profiles.chat_prefs.boxOrder), so the computer and the iPhone match.
export default function BoxOrderEditor({ primary, more, onSave, onCancel }) {
  const [lists, setLists] = useState({ primary, more });
  const [saving, setSaving] = useState(false);

  const onDragEnd = ({ source, destination }) => {
    if (!destination) return;
    setLists((cur) => {
      const next = { primary: [...cur.primary], more: [...cur.more] };
      const [moved] = next[source.droppableId].splice(source.index, 1);
      next[destination.droppableId].splice(destination.index, 0, moved);
      return next;
    });
  };

  const save = async (value) => {
    setSaving(true);
    try {
      await onSave(value);
    } finally {
      setSaving(false);
    }
  };

  const column = (id, title, hint) => (
    <>
      <div className="mt-3 px-1 pb-1 text-xs font-semibold text-gray-500">
        {title} <span className="font-normal text-gray-600">{hint}</span>
      </div>
      <Droppable droppableId={id}>
        {(drop, snap) => (
          <div ref={drop.innerRef} {...drop.droppableProps} className={`min-h-[44px] space-y-1 rounded-lg p-0.5 ${snap.isDraggingOver ? "bg-yellow-400/5" : ""}`}>
            {lists[id].map((b, i) => (
              <Draggable key={b.key} draggableId={b.key} index={i}>
                {(drag, ds) => (
                  <div
                    ref={drag.innerRef}
                    {...drag.draggableProps}
                    {...drag.dragHandleProps}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                      ds.isDragging ? "border-yellow-500 bg-gray-800 text-white shadow-lg" : "border-gray-800 bg-gray-900 text-gray-200"
                    }`}
                  >
                    <GripVertical className="h-4 w-4 shrink-0 text-gray-500" />
                    <span className="truncate">{b.label}</span>
                  </div>
                )}
              </Draggable>
            ))}
            {drop.placeholder}
          </div>
        )}
      </Droppable>
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <p className="px-1 text-xs text-gray-400">גררו כל תיבה למקום שנוח לכם. כדי להוסיף כפתור מעל הרשימה — גררו אותו מ"עוד" ל"למעלה"; כדי להוריד — בחזרה ל"עוד".</p>
        <DragDropContext onDragEnd={onDragEnd}>
          {column("primary", "למעלה", "· גם בכפתורים שמעל הרשימה ובטלפון")}
          {column("more", "עוד", "")}
        </DragDropContext>
      </div>
      <div className="flex shrink-0 gap-1.5 border-t border-gray-800 p-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => save({ primary: lists.primary.map((b) => b.key), more: lists.more.map((b) => b.key) })}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-yellow-400 py-2 text-sm font-semibold text-gray-900 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} שמור
        </button>
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-lg border border-gray-700 px-3 text-sm text-gray-300">ביטול</button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setLists({ primary: BOXES.filter((b) => b.primary), more: BOXES.filter((b) => !b.primary) })}
          title="חזרה לסדר המקורי (צריך עדיין ללחוץ שמור)"
          className="rounded-lg px-2 text-sm text-gray-500 hover:text-white"
        >
          איפוס
        </button>
      </div>
    </div>
  );
}
