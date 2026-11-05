import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Loader2, Clock, Tag, X, PlusSquare, ChevronUp, ChevronDown } from "lucide-react";
import { sortAssets } from "@/lib/albumDesign";
import { chapterRuns, dividerRange, setDivider, setRun, shiftBoundary, suggestChapter, shapeCounts } from "@/lib/albumChapters";
import { assetSrc } from "@/lib/albumAssets";
import { ASSET_MIME, GROUP_MIME, setDragAssets } from "./SpreadView";

// The owner's tags (2026-10-08) — one photo can have several. Stored in doc.tags[assetId].
export const PHOTO_TAGS = [
  { id: "bride_prep", label: "התארגנות כלה" },
  { id: "groom_prep", label: "התארגנות חתן" },
  { id: "first_look", label: "מפגש" },
  { id: "couple", label: "צילומי זוגיות" },
  { id: "bride", label: "כלה לבד" },
  { id: "groom", label: "חתן לבד" },
  { id: "bride_family", label: "משפחת כלה" },
  { id: "groom_family", label: "משפחת חתן" },
  { id: "venue", label: "אולם" },
  { id: "ketubah", label: "כתובה" },
  { id: "chuppah", label: "חופה" },
  { id: "dancing", label: "ריקודים" },
];
const TAG_LABEL = Object.fromEntries(PHOTO_TAGS.map((t) => [t.id, t.label]));

// The couple's photos in album order (shooting time + per-camera offset).
//  - drag a photo onto a cell, or click it to fill the selected / first empty cell;
//  - ⌘/Ctrl+click = multi-select, Shift+click = a range → tag them, or put them on a new spread
//    (or drag the whole group onto a spread);
//  - hover = big preview; used photos are greyed out.
//  - chapters (2026-11-05, studio only): in "הכל", "⫶ חוצץ" on a photo closes a chapter there — the photos from the
//    previous divider up to it — and asks which chapter they are (the next one in the studio's order is offered
//    first). A line with the chapter's name, count and shapes heads each chapter; ↑ ↓ move the line by one photo,
//    × takes the chapter off. Kept in doc.chapterOf; the page planner ("סקיצה לפי פרקים") builds on it.
export default function PhotoBank({ doc, usage, onPick, onRefresh, refreshing, onCameraOffset, skipped = [], headerExtra = null, onTag, onNewSpread, chapters = null, onChapterOf = null, onAddChapter = null }) {
  const [filter, setFilter] = useState("all");
  const [showCameras, setShowCameras] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [tagMenu, setTagMenu] = useState(false);
  const [preview, setPreview] = useState(null); // { asset, x, y }
  const hoverTimer = useRef(null);
  const rootRef = useRef(null);
  const tags = doc.tags || {};

  const sorted = useMemo(() => sortAssets(doc.assets, doc.cameraOffsets), [doc.assets, doc.cameraOffsets]);
  const chapterOf = useMemo(() => doc.chapterOf || {}, [doc.chapterOf]);
  const chaptersOn = filter === "all" && Boolean(chapters?.length && onChapterOf);
  const chapterLabel = useMemo(() => Object.fromEntries((chapters || []).map((c) => [c.id, c.label])), [chapters]);
  const runs = useMemo(() => (chaptersOn ? chapterRuns(sorted, chapterOf) : []), [chaptersOn, sorted, chapterOf]);
  const runAtStart = useMemo(() => Object.fromEntries(runs.map((r, k) => [r.start, k])), [runs]);
  const [ask, setAsk] = useState(null); // { x, left, top } — the divider question
  const openAsk = (x, e) => {
    const left = Math.max(8, Math.min(window.innerWidth - 340, e.clientX - 300));
    const top = Math.max(8, Math.min(window.innerHeight - 260, e.clientY + 10));
    setAsk({ x, left, top });
  };
  const shown = sorted.filter((a) => {
    if (filter === "all") return true;
    if (filter === "unused") return !usage[a.id];
    if (filter === "used") return usage[a.id];
    if (filter.startsWith("tag:")) return (tags[a.id] || []).includes(filter.slice(4));
    if (filter.startsWith("src:")) return (a.group || "") === filter.slice(4);
    return true;
  });
  const usedCount = doc.assets.filter((a) => usage[a.id]).length;
  const tagCounts = useMemo(() => {
    const m = {};
    for (const list of Object.values(tags)) for (const t of list || []) m[t] = (m[t] || 0) + 1;
    return m;
  }, [tags]);
  const groups = useMemo(() => {
    const m = {};
    for (const a of doc.assets) if (a.group) m[a.group] = (m[a.group] || 0) + 1;
    return Object.entries(m);
  }, [doc.assets]);
  const cameras = useMemo(() => {
    const m = {};
    for (const a of doc.assets) m[a.camera] = (m[a.camera] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [doc.assets]);

  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const click = (e, a, index) => {
    if (e.metaKey || e.ctrlKey) {
      setSelected((s) => {
        const n = new Set(s);
        n.has(a.id) ? n.delete(a.id) : n.add(a.id);
        return n;
      });
      setAnchor(index);
      return;
    }
    if (e.shiftKey && anchor != null) {
      const [lo, hi] = [Math.min(anchor, index), Math.max(anchor, index)];
      setSelected((s) => new Set([...s, ...shown.slice(lo, hi + 1).map((x) => x.id)]));
      return;
    }
    setSelected(new Set());
    setAnchor(index);
    onPick(a.id);
  };

  const allSelected = [...selected];
  const ordered = sorted.filter((a) => selected.has(a.id)).map((a) => a.id);

  const tabBtn = (key, label, n) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      className={`whitespace-nowrap rounded-md border px-2.5 py-1 text-xs ${filter === key ? "border-amber-400/80 bg-amber-400/10 text-amber-200" : "border-white/10 text-slate-300 hover:text-white"}`}
    >
      {label}{n != null ? ` (${n})` : ""}
    </button>
  );

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">בנק תמונות</div>
          {onRefresh && (
            <button type="button" onClick={onRefresh} disabled={refreshing} title="טעינה מחדש מהתיקייה ב-Drive (תמונות חדשות נוספות)" className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-50">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          )}
        </div>
        <div className="text-xs text-slate-400">
          {doc.assets.length} תמונות · {usedCount} בשימוש · {doc.assets.length - usedCount} לא בשימוש
        </div>
        <div className="flex flex-wrap gap-1.5">
          {tabBtn("all", "הכל")}
          {tabBtn("unused", "לא בשימוש")}
          {tabBtn("used", "בשימוש")}
          {groups.map(([g, n]) => tabBtn(`src:${g}`, g, n))}
          {PHOTO_TAGS.filter((t) => tagCounts[t.id]).map((t) => tabBtn(`tag:${t.id}`, t.label, tagCounts[t.id]))}
          {cameras.length > 1 && onCameraOffset && (
            <button type="button" onClick={() => setShowCameras((v) => !v)} className="flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:text-white">
              <Clock className="h-3.5 w-3.5" /> שעון מצלמות
            </button>
          )}
        </div>
        {showCameras && onCameraOffset && (
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-slate-300">
            <div className="text-slate-400">התמונות מסודרות לפי שעת הצילום. אם השעון של מצלמה לא היה מכוון — תקנו אותו כאן:</div>
            {cameras.map(([cam, n]) => (
              <div key={cam} className="flex items-center justify-between gap-2">
                <span dir="ltr" className="truncate">{cam} ({n})</span>
                <select value={doc.cameraOffsets?.[cam] || 0} onChange={(e) => onCameraOffset(cam, Number(e.target.value))} className="h-7 rounded border border-white/10 bg-[#0B1529] px-1 text-xs text-white">
                  {[-180, -120, -90, -60, -30, -15, 0, 15, 30, 60, 90, 120, 180].map((m) => (
                    <option key={m} value={m}>{m === 0 ? "בלי תיקון" : `${m > 0 ? "+" : "−"}${Math.abs(m) >= 60 ? `${Math.abs(m) / 60} שע׳` : `${Math.abs(m)} דק׳`}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {headerExtra}
        {skipped.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
            {skipped.length} קבצים לא נטענו (רק JPG/PNG): {skipped.slice(0, 3).map((s) => s.name).join(", ")}{skipped.length > 3 ? "…" : ""}
          </div>
        )}
        {allSelected.length > 0 ? (
          <div className="space-y-1.5 rounded-lg border border-sky-400/40 bg-sky-400/10 p-2 text-xs text-sky-100">
            <div className="flex items-center justify-between">
              <span>נבחרו {allSelected.length} · גררו לכפולה, או:</span>
              <button type="button" onClick={() => setSelected(new Set())} title="ניקוי הבחירה" className="text-sky-200 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {onNewSpread && (
                <button type="button" onClick={() => { onNewSpread(ordered); setSelected(new Set()); }} className="flex items-center gap-1 rounded-md bg-sky-500 px-2 py-1 font-semibold text-white hover:bg-sky-600">
                  <PlusSquare className="h-3.5 w-3.5" /> לכפולה חדשה
                </button>
              )}
              {onTag && (
                <button type="button" onClick={() => setTagMenu((v) => !v)} className="flex items-center gap-1 rounded-md border border-sky-300/40 px-2 py-1 hover:bg-white/10">
                  <Tag className="h-3.5 w-3.5" /> תגית
                </button>
              )}
            </div>
            {tagMenu && onTag && (
              <div className="flex flex-wrap gap-1 pt-1">
                {PHOTO_TAGS.map((t) => (
                  <button key={t.id} type="button" onClick={() => { onTag(allSelected, t.id); setTagMenu(false); setSelected(new Set()); }} className="rounded border border-white/15 px-1.5 py-0.5 hover:border-amber-300 hover:text-amber-200">
                    {t.label}
                  </button>
                ))}
                <button type="button" onClick={() => { onTag(allSelected, null); setTagMenu(false); setSelected(new Set()); }} className="rounded border border-rose-300/40 px-1.5 py-0.5 text-rose-200 hover:bg-rose-500/10">הסר תגיות</button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-[10px] text-slate-500">⌘+לחיצה = בחירה מרובה · Shift+לחיצה = טווח</div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))" }}>
          {shown.map((a, index) => {
            const used = usage[a.id];
            const isSel = selected.has(a.id);
            const t = tags[a.id] || [];
            const k = chaptersOn ? runAtStart[index] : undefined;
            return [
              k != null && (
                <ChapterBar
                  key={`run-${a.id}`}
                  run={runs[k]}
                  index={k}
                  photos={sorted.slice(runs[k].start, runs[k].end + 1)}
                  chapters={chapters}
                  label={chapterLabel[runs[k].chapterId]}
                  onlyLoose={runs.length === 1 && !runs[0].chapterId}
                  onSet={(cid) => onChapterOf((m) => setRun(m, runs[k].ids, cid))}
                  onShift={(dir) => onChapterOf((m) => shiftBoundary(m, sorted, k, dir))}
                />
              ),
              <button
                key={a.id}
                type="button"
                draggable
                onDragStart={(e) => {
                  clearTimeout(hoverTimer.current);
                  setPreview(null);
                  if (isSel && allSelected.length > 1) {
                    e.dataTransfer.setData(GROUP_MIME, JSON.stringify(ordered));
                    setDragAssets(ordered.map((id) => doc.assets.find((x) => x.id === id)));
                  } else {
                    e.dataTransfer.setData(ASSET_MIME, a.id);
                    setDragAssets([a]);
                  }
                  e.dataTransfer.effectAllowed = "copy";
                }}
                onDragEnd={() => setDragAssets(null)}
                onClick={(e) => click(e, a, index)}
                onMouseEnter={(e) => {
                  const { clientX: x, clientY: y } = e;
                  clearTimeout(hoverTimer.current);
                  hoverTimer.current = setTimeout(() => setPreview({ asset: a, x, y }), 280);
                }}
                onMouseLeave={() => {
                  clearTimeout(hoverTimer.current);
                  setPreview(null);
                }}
                className={`group relative aspect-square overflow-hidden rounded bg-white/5 ${isSel ? "ring-2 ring-sky-400" : ""}`}
              >
                <img
                  src={assetSrc(a, 300)}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  alt=""
                  draggable={false}
                  className={`h-full w-full object-cover transition ${used && !isSel ? "opacity-35 grayscale-[70%]" : ""}`}
                />
                {used ? <span className="absolute left-1 top-1 rounded bg-emerald-500 px-1 text-[10px] font-bold text-white">×{used}</span> : null}
                {isSel && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-sky-500 text-[10px] font-bold text-white">✓</span>}
                {t.length > 0 && (
                  <span className="absolute bottom-0.5 right-0.5 max-w-[90%] truncate rounded bg-black/60 px-1 text-[9px] text-amber-200">{t.map((x) => TAG_LABEL[x]).join(" · ")}</span>
                )}
                {chaptersOn && (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      openAsk(index, e);
                    }}
                    title="חוצץ אחרי התמונה הזו — סוגר פרק (התמונות מהחוצץ הקודם ועד כאן)"
                    className="absolute bottom-1 left-1 hidden items-center gap-0.5 rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-gray-900 shadow group-hover:flex"
                    data-testid="bank-divider"
                  >
                    ⫶ חוצץ
                  </span>
                )}
              </button>,
            ];
          })}
        </div>
        {!shown.length && <div className="py-10 text-center text-xs text-slate-500">אין תמונות בסינון הזה</div>}
      </div>
      {preview && <HoverPreview {...preview} bankLeft={rootRef.current?.getBoundingClientRect().left ?? window.innerWidth} />}
      {ask && chaptersOn && (
        <DividerQuestion
          {...ask}
          range={dividerRange(sorted, chapterOf, ask.x)}
          chapters={chapters}
          suggested={suggestChapter(chapters, sorted, chapterOf, ask.x)}
          onChoose={(cid) => {
            onChapterOf((m) => setDivider(m, sorted, ask.x, cid));
            setAsk(null);
          }}
          onAdd={
            onAddChapter
              ? (label) => {
                  const cid = onAddChapter(label);
                  if (cid) onChapterOf((m) => setDivider(m, sorted, ask.x, cid));
                  setAsk(null);
                }
              : null
          }
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  );
}

// The line over a chapter in the bank: its name (change it here), how many photos and of which shape; ↑ ↓ move the
// line between it and the chapter above by one photo; × = these photos are in no chapter again.
function ChapterBar({ run, index, photos, chapters, label, onlyLoose, onSet, onShift }) {
  const { portrait, landscape } = shapeCounts(photos);
  const loose = !run.chapterId;
  return (
    <div style={{ gridColumn: "1 / -1" }} className={`flex items-center gap-1.5 pt-1 text-[11px] ${index ? "mt-1" : ""} ${loose ? "border-t border-dashed border-white/20 text-slate-400" : "border-t-2 border-amber-400/80 text-amber-100"}`} data-testid="bank-chapter">
      {loose ? (
        <span className="font-semibold">בלי פרק</span>
      ) : (
        <select value={run.chapterId} onChange={(e) => onSet(e.target.value)} title="שינוי הפרק של התמונות האלה" className="h-6 max-w-[45%] rounded border border-amber-400/40 bg-[#0B1529] px-1 text-[11px] font-semibold text-amber-100">
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
          {!label && <option value={run.chapterId}>פרק שנמחק</option>}
        </select>
      )}
      <span className="truncate text-slate-400">
        {photos.length} · {portrait} לאורך · {landscape} לרוחב
      </span>
      {onlyLoose && <span className="truncate text-slate-500">— ⫶ על התמונה האחרונה של כל פרק</span>}
      <span className="ms-auto flex shrink-0 items-center">
        {index > 0 && (
          <>
            <button type="button" onClick={() => onShift(-1)} title="התמונה הראשונה כאן עוברת לפרק שמעל" className="rounded p-0.5 hover:bg-white/10"><ChevronUp className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => onShift(1)} title="התמונה האחרונה של הפרק שמעל עוברת לכאן" className="rounded p-0.5 hover:bg-white/10"><ChevronDown className="h-3.5 w-3.5" /></button>
          </>
        )}
        {!loose && (
          <button type="button" onClick={() => onSet(null)} title="ביטול הפרק — התמונות חוזרות להיות בלי פרק" className="rounded p-0.5 hover:bg-white/10 hover:text-rose-300"><X className="h-3.5 w-3.5" /></button>
        )}
      </span>
    </div>
  );
}

// "⫶ חוצץ" asks which chapter the photos up to here are; the suggested one has the focus (Enter = it).
// data-confirm-dialog: the editor's keys (arrows, Delete, ⌘Z) wait while it's open.
function DividerQuestion({ left, top, range, chapters, suggested, onChoose, onAdd, onClose }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const esc = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  if (!range) return null;
  return createPortal(
    <div className="fixed inset-0 z-[80]" onClick={onClose} data-confirm-dialog>
      <div className="absolute w-[330px] space-y-2 rounded-xl border border-white/15 bg-[#0B1529] p-3 text-sm text-slate-200 shadow-2xl" style={{ left, top }} onClick={(e) => e.stopPropagation()} dir="rtl" data-testid="divider-question">
        <div>
          התמונות {range.from + 1} עד {range.to + 1} <span className="text-slate-400">({range.ids.length})</span> הן:
        </div>
        <div className="flex flex-wrap gap-1.5">
          {chapters.map((c) => (
            <button
              key={c.id}
              type="button"
              autoFocus={c.id === suggested}
              onClick={() => onChoose(c.id)}
              className={`rounded-full border px-2.5 py-1 text-xs ${c.id === suggested ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/15 hover:border-white/40"}`}
            >
              {c.label}
              {c.id === suggested ? " · הבא בסדר" : ""}
            </button>
          ))}
        </div>
        {onAdd && (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (label.trim()) onAdd(label.trim());
            }}
          >
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="פרק חדש (למשל מפגש)" className="h-8 min-w-0 flex-1 rounded border border-white/10 bg-[#070F1F] px-2 text-xs text-white" />
            <button type="submit" disabled={!label.trim()} className="rounded border border-white/15 px-2 text-xs hover:bg-white/10 disabled:opacity-40">הוספה</button>
          </form>
        )}
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Enter = {chapters.find((c) => c.id === suggested)?.label}</span>
          <button type="button" onClick={onClose} className="hover:text-white">ביטול</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Big preview OUTSIDE the bank — just to its left, over the spread area — so it never covers the
// neighbouring photos (2026-10-08: on the bank's left column it used to hide the ones next to it).
// `side` (the opening-photo picker): "left"/"right" = pinned to that side of `box` instead.
export function HoverPreview({ asset, y, bankLeft, side = null, box = null }) {
  const landscape = (asset.w || 3) >= (asset.h || 2);
  const w = landscape ? 560 : 380;
  const h = Math.round((w * (asset.h || 2)) / (asset.w || 3));
  const left = side && box ? (side === "left" ? box.left + 16 : box.right - w - 16) : Math.max(12, bankLeft - w - 16);
  const top = Math.max(12, Math.min(y - h / 2, window.innerHeight - h - 40));
  return createPortal(
    <div className="pointer-events-none fixed z-[90] overflow-hidden rounded-lg border border-white/20 bg-black shadow-2xl" style={{ left, top, width: w }}>
      <img src={assetSrc(asset, 1000)} referrerPolicy="no-referrer" alt="" className="block w-full" style={{ height: h, objectFit: "cover" }} />
      <div className="flex justify-between bg-black/80 px-2 py-1 text-[11px] text-slate-300" dir="ltr">
        <span className="truncate">{asset.name}</span>
        {asset.w ? <span>{asset.w}×{asset.h}</span> : null}
      </div>
    </div>,
    document.body
  );
}
