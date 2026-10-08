import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus, Copy, Trash2, Scissors } from "lucide-react";
import SpreadView from "./SpreadView";

// All spreads in a row at the bottom. Click = open, drag = reorder, small "+" between two spreads
// inserts a new one there, ✂ splits a crowded spread in two.
export default function SpreadStrip({ doc, assetsById, currentId, onSelect, onMove, onAdd, onInsertAt, onDuplicate, onRemove, onSplit }) {
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto px-3 py-2" dir="ltr">
      <DragDropContext onDragEnd={(r) => r.destination && onMove(r.source.index, r.destination.index)}>
        <Droppable droppableId="spreads" direction="horizontal">
          {(dp) => (
            <div ref={dp.innerRef} {...dp.droppableProps} className="flex items-stretch gap-2">
              {doc.pages.map((p, i) => {
                const filled = p.slots.filter((s) => s.assetId).length;
                return (
                  <Draggable key={p.id} draggableId={p.id} index={i}>
                    {(dg) => (
                      <div ref={dg.innerRef} {...dg.draggableProps} {...dg.dragHandleProps} className="group relative w-40 shrink-0">
                        <button
                          type="button"
                          onClick={() => onSelect(p.id)}
                          className={`block w-full overflow-hidden rounded border-2 ${p.id === currentId ? "border-amber-400" : "border-transparent hover:border-white/30"}`}
                        >
                          <SpreadView page={p} assetsById={assetsById} mini />
                        </button>
                        {onInsertAt && i < doc.pages.length - 1 && (
                          <button
                            type="button"
                            title="כפולה חדשה כאן (בין שתי הכפולות)"
                            onClick={() => onInsertAt(i + 1)}
                            className="absolute -right-2 top-[22px] z-10 flex h-5 w-5 items-center justify-center rounded-full bg-sky-500 text-white opacity-0 shadow group-hover:opacity-100"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400">
                          <span title={filled ? `${filled} תמונות` : "ריק"}>דף {i + 1}{i === 0 && p.title ? " (פתיחה)" : ""}</span>
                          <span className="flex gap-1 opacity-0 group-hover:opacity-100">
                            {onSplit && filled >= 2 && !p.title && (
                              <button type="button" title="פיצול לשתי כפולות" onClick={() => onSplit(p.id)} className="hover:text-white"><Scissors className="h-3 w-3" /></button>
                            )}
                            <button type="button" title="שכפול" onClick={() => onDuplicate(p.id)} className="hover:text-white"><Copy className="h-3 w-3" /></button>
                            {doc.pages.length > 1 && (
                              <button type="button" title="מחיקת הכפולה" onClick={() => onRemove(p.id)} className="hover:text-rose-400"><Trash2 className="h-3 w-3" /></button>
                            )}
                          </span>
                        </div>
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {dp.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <button
        type="button"
        onClick={onAdd}
        title="כפולה חדשה אחרי הנוכחית"
        className="flex h-[64px] w-16 shrink-0 items-center justify-center rounded border-2 border-dashed border-white/20 text-slate-400 hover:border-amber-400/60 hover:text-amber-300"
      >
        <Plus className="h-5 w-5" />
      </button>
    </div>
  );
}
