import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import { albumSize, centerFromOffset, crossesFold, placePhoto, slotAspect, template, type AlbumSpread, type AlbumText, type SlotFill } from '../../shared/album';

export type Selection = { kind: 'slot'; index: number } | { kind: 'text'; id: string } | null;

interface Props {
  spread: AlbumSpread;
  sizeKey: string;
  ars: Map<string, number>;
  base: string;
  editable: boolean;
  selection?: Selection;
  onSelect?: (s: Selection) => void;
  onFill?: (index: number, fill: SlotFill) => void;
  onDropPhoto?: (index: number, key: string) => void;
  /** A photo dragged from a slot (on this page or another one: "page:slot") onto slot `to`. */
  onMove?: (from: { s: number; i: number }, to: number) => void;
  onText?: (t: AlbumText) => void;
  /** Which page this is (for dragging photos between pages). */
  spreadIndex?: number;
  /** The slot being positioned (double-click): dragging inside it moves the photo within the slot. */
  cropIndex?: number | null;
  onCrop?: (index: number | null) => void;
  /** A slot waiting to receive the photo being moved (move mode): highlight targets. */
  moving?: boolean;
  /** Small thumbnails (the strip) skip the fold labels and use the smallest previews. */
  mini?: boolean;
}

/** Drag data for a photo taken from a slot: "page:slot". */
export const SLOT_REF = 'text/slotref';
export function readSlotRef(e: DragEvent): { s: number; i: number } | null {
  const v = e.dataTransfer.getData(SLOT_REF);
  const m = /^(\d+):(\d+)$/.exec(v);
  return m ? { s: Number(m[1]), i: Number(m[2]) } : null;
}

/** One spread (two pages) drawn at any width, exactly as it will be printed. */
export function SpreadView({ spread, sizeKey, ars, base, editable, selection, onSelect, onFill, onDropPhoto, onMove, onText, spreadIndex = 0, cropIndex = null, onCrop, moving, mini }: Props) {
  const size = albumSize(sizeKey);
  const t = template(spread.template);
  const box = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setPx({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const drag = useRef<{ index: number; startX: number; startY: number; x: number; y: number; w: number; h: number; sw: number; sh: number } | null>(null);
  const textDrag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null);

  const startPan = (e: PointerEvent, index: number) => {
    if (!editable || cropIndex !== index) return;
    const fill = spread.fills[index];
    if (!fill.photo) return;
    const r = t.slots[index];
    const p = placePhoto(slotAspect(r, size), ars.get(fill.photo) ?? 1.5, fill);
    drag.current = { index, startX: e.clientX, startY: e.clientY, x: p.x, y: p.y, w: p.w, h: p.h, sw: r.w * px.w, sh: r.h * px.h };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const movePan = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || !onFill) return;
    const nx = d.x + (e.clientX - d.startX) / d.sw;
    const ny = d.y + (e.clientY - d.startY) / d.sh;
    const { cx, cy } = centerFromOffset(Math.min(0, Math.max(1 - d.w, nx)), Math.min(0, Math.max(1 - d.h, ny)), d.w, d.h);
    onFill(d.index, { ...spread.fills[d.index], cx, cy });
  };
  const endPan = () => (drag.current = null);

  const startText = (e: PointerEvent, text: AlbumText) => {
    if (!editable) return;
    onSelect?.({ kind: 'text', id: text.id });
    textDrag.current = { id: text.id, startX: e.clientX, startY: e.clientY, x: text.x, y: text.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  const moveText = (e: PointerEvent) => {
    const d = textDrag.current;
    if (!d || !onText || !px.w) return;
    const text = spread.texts.find((x) => x.id === d.id);
    if (!text) return;
    onText({ ...text, x: Math.max(0, Math.min(1, d.x + (e.clientX - d.startX) / px.w)), y: Math.max(0, Math.min(1, d.y + (e.clientY - d.startY) / px.h)) });
  };

  const size2 = mini ? 'm' : 'm';
  return (
    <div ref={box} className={`spread${mini ? ' mini' : ''}`} style={{ aspectRatio: `${size.widthCm} / ${size.heightCm}` }} onPointerDown={() => editable && onSelect?.(null)} data-testid={mini ? undefined : 'spread'}>
      {t.panels.map((p, i) => (
        <div key={`p${i}`} className="panel" style={pct(p)} />
      ))}
      {t.slots.map((r, i) => {
        const fill = spread.fills[i] ?? { photo: '', zoom: 1, cx: 0.5, cy: 0.5 };
        const selected = selection?.kind === 'slot' && selection.index === i;
        const cropping = cropIndex === i;
        const p = fill.photo ? placePhoto(slotAspect(r, size), ars.get(fill.photo) ?? 1.5, fill) : null;
        // Big slots get the larger preview so they stay sharp on screen.
        const q = !mini && r.w > 0.3 ? 'l' : size2;
        return (
          <div
            key={i}
            className={`slot${selected ? ' sel' : ''}${fill.photo ? '' : ' empty'}${cropping ? ' crop' : ''}${moving && !mini ? ' target' : ''}`}
            style={pct(r)}
            onPointerDown={(e) => {
              if (!editable) return;
              e.stopPropagation();
              onSelect?.({ kind: 'slot', index: i });
              startPan(e, i);
            }}
            onDoubleClick={() => editable && fill.photo && onCrop?.(cropping ? null : i)}
            // Drag = move the photo to another slot (on any page). While positioning, drag moves it inside the slot.
            draggable={editable && !mini && Boolean(fill.photo) && !cropping}
            onDragStart={(e) => {
              e.dataTransfer.setData(SLOT_REF, `${spreadIndex}:${i}`);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onPointerMove={movePan}
            onPointerUp={endPan}
            onDragOver={(e: DragEvent) => editable && e.preventDefault()}
            onDrop={(e: DragEvent) => {
              if (!editable) return;
              e.preventDefault();
              const key = e.dataTransfer.getData('text/photo');
              const from = readSlotRef(e);
              if (key) onDropPhoto?.(i, key);
              else if (from) onMove?.(from, i);
            }}
            data-testid={mini ? undefined : 'slot'}
            data-slot={mini || !editable ? undefined : i}
          >
            {p && (
              <img
                src={`${base}/${fill.photo}?s=${q}`}
                alt=""
                draggable={false}
                loading={mini ? 'lazy' : 'eager'}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }}
              />
            )}
            {!p && !mini && <span className="slot-hint">גררו תמונה</span>}
            {!mini && crossesFold(r) && <span className="fold-badge">עוברת בקפל</span>}
            {!mini && cropping && <span className="crop-badge">גררו למיקום · לחיצה כפולה לסיום</span>}
          </div>
        );
      })}
      {spread.texts.map((tx) => (
        <div
          key={tx.id}
          className={`album-text${selection?.kind === 'text' && selection.id === tx.id ? ' sel' : ''}`}
          style={textStyle(tx, px.h)}
          onPointerDown={(e) => startText(e, tx)}
          onPointerMove={moveText}
          onPointerUp={() => (textDrag.current = null)}
          data-testid={mini ? undefined : 'album-text'}
        >
          {tx.text || ' '}
        </div>
      ))}
      {!mini && <div className="fold" />}
    </div>
  );
}

function pct(r: { x: number; y: number; w: number; h: number }): CSSProperties {
  return { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` };
}

export function textStyle(t: AlbumText, spreadHeightPx: number): CSSProperties {
  return {
    left: `${t.x * 100}%`,
    top: `${t.y * 100}%`,
    fontFamily: `'${t.font}', 'Assistant', sans-serif`,
    fontSize: `${Math.max(4, t.size * spreadHeightPx)}px`,
    color: t.color,
    fontWeight: t.weight,
    fontStyle: t.italic ? 'italic' : 'normal',
    letterSpacing: `${t.spacing}em`,
    textAlign: t.align,
  };
}
