import { useEffect, useRef, useState } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { Plus, Copy, Trash2, Scissors } from "lucide-react";
import SpreadView from "./SpreadView";

// All spreads in a row at the bottom. Click = open, drag = reorder, small "+" between two spreads
// inserts a new one there, ✂ splits a crowded spread in two.
// A page is dragged by its picture too (Avira, 2026-11-03): the picture is a button, and the drag library ignores
// drags that start on one unless told otherwise — before, only the small "דף N" line under it moved the page.
// Dragging a photo over a page in the strip opens that page (after a moment), so the photo can be
// dropped on one of its frames — that's how a photo moves between pages.
// The hold used to restart on every small move (2026-11-05, the owner couldn't get a page to open): moving between
// the photos of the small page, or onto the green note, counted as leaving the page. Now a page is left only when
// the pointer is outside it (enter / leave counted per page), the note lets the pointer through, and it opens after
// 0.7s.
let hoverTimer = null;
const HOLD_MS = 700;
const isPhotoDrag = (e) => [...(e.dataTransfer?.types || [])].some((t) => t.startsWith("application/x-avira"));

export default function SpreadStrip({ doc, assetsById, currentId, onSelect, onMove, onAdd, onInsertAt, onDuplicate, onRemove, onSplit, onDragHoverPage, onDropOnPage }) {
  const [over, setOver] = useState(null);
  const depth = useRef({}); // pageId → how many of its elements the dragged photo is over
  const stopHover = () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  };
  useEffect(() => {
    const reset = () => {
      depth.current = {};
      stopHover();
      setOver(null);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);
  return (
    <div className="flex items-stretch gap-2 overflow-x-auto px-3 py-2" dir="ltr">
      <DragDropContext onDragEnd={(r) => r.destination && onMove?.(r.source.index, r.destination.index)}>
        <Droppable droppableId="spreads" direction="horizontal">
          {(dp) => (
            <div ref={dp.innerRef} {...dp.droppableProps} className="flex items-stretch gap-2">
              {doc.pages.map((p, i) => {
                const filled = p.slots.filter((s) => s.assetId).length;
                return (
                  <Draggable key={p.id} draggableId={p.id} index={i} isDragDisabled={!onMove} disableInteractiveElementBlocking>
                    {(dg, snap) => (
                      <div ref={dg.innerRef} {...dg.draggableProps} {...dg.dragHandleProps} className={`group relative w-40 shrink-0 ${snap.isDragging ? "rounded shadow-2xl shadow-black/70 ring-2 ring-amber-400" : ""}`}>
                        <button
                          type="button"
                          title={onMove ? "לחיצה = פתיחת הדף · גרירה = העברה למקום אחר" : undefined}
                          onClick={() => onSelect(p.id)}
                          onDragEnter={(e) => {
                            if (!isPhotoDrag(e)) return;
                            depth.current[p.id] = (depth.current[p.id] || 0) + 1;
                          }}
                          onDragOver={(e) => {
                            if (!isPhotoDrag(e)) return;
                            e.preventDefault();
                            setOver(p.id);
                            // hold = open that page (to drop on a specific frame)
                            if (onDragHoverPage && !hoverTimer && p.id !== currentId) hoverTimer = setTimeout(() => { hoverTimer = null; onDragHoverPage(p.id); }, HOLD_MS);
                          }}
                          onDragLeave={() => {
                            depth.current[p.id] = Math.max(0, (depth.current[p.id] || 0) - 1);
                            if (depth.current[p.id]) return; // still over this page — moved between its own photos
                            stopHover();
                            setOver((o) => (o === p.id ? null : o));
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            depth.current[p.id] = 0;
                            stopHover();
                            setOver(null);
                            // drop = the photo joins this page, both pages re-layout
                            const group = e.dataTransfer.getData("application/x-avira-group");
                            const asset = e.dataTransfer.getData("application/x-avira-asset");
                            const slot = e.dataTransfer.getData("application/x-avira-slot");
                            if (group) onDropOnPage?.(p.id, { ids: JSON.parse(group) });
                            else if (asset) onDropOnPage?.(p.id, { ids: [asset] });
                            else if (slot) onDropOnPage?.(p.id, { from: JSON.parse(slot) });
                          }}
                          className={`relative block w-full overflow-hidden rounded border-2 ${over === p.id ? "border-emerald-400" : p.id === currentId ? "border-amber-400" : "border-transparent hover:border-white/30"}`}
                        >
                          <SpreadView page={p} assetsById={assetsById} mini />
                          {over === p.id && (
                            <span className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-emerald-500/70 text-[10px] font-bold leading-tight text-white" data-testid="strip-drop-note">
                              {p.id === currentId ? <>שחררו = הוספה<br />לדף הזה</> : <>החזיקו = פתיחת הדף<br />שחררו = הוספה לדף</>}
                            </span>
                          )}
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
                          <span title={filled ? `${filled} תמונות` : "ריק"} className="truncate">דף {i + 1}{i === 0 && p.title ? " (פתיחה)" : p.section ? ` · ${p.section}` : ""}</span>
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
