import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  usageCounts, addPage, insertPageAt, removePage, duplicatePage, movePage, setTemplate, setTemplateAssigned, toggleFlip, setTitle,
  placeAsset, clearSlot, updateSlot, swapSlots, setPageProps, addHealPatch, tagAssets,
} from "@/lib/albumDesign";
import { splitPage, placeGroup } from "@/lib/albumAutoLayout";
import { foldFaceWarnings } from "@/lib/albumFaces";
import SpreadView, { AdjustmentDefs } from "./SpreadView";
import PhotoBank from "./PhotoBank";
import SpreadStrip from "./SpreadStrip";
import PagePanel from "./PagePanel";

const BANK_W_KEY = "albumBankWidth";
const readBankW = () => {
  try {
    return Math.min(760, Math.max(220, Number(localStorage.getItem(BANK_W_KEY)) || 300));
  } catch {
    return 300;
  }
};

// The editor's working area — bank | spread | tools, and the strip of spreads — shared by the
// studio editor and the couple's editor (2026-10-08). `doc` is the display copy (signed URLs on
// uploaded photos); every change goes through `edit(fn, mergeKey)` (undo + autosave).
export default function EditorWorkspace({ doc, edit, undo, redo, locked = false, currentId, setCurrentId, bankProps = {}, studio = false, branding = null, brandingReady = false, onEnlarge = null }) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [heal, setHeal] = useState({ on: false, size: 4, offset: null });
  const [faces, setFaces] = useState({});
  const [bankW, setBankW] = useState(readBankW);
  const [splitFor, setSplitFor] = useState(null);
  const change = useCallback((fn, key) => !locked && edit(fn, key), [edit, locked]);

  const assetsById = useMemo(() => Object.fromEntries(doc.assets.map((a) => [a.id, a])), [doc.assets]);
  const usage = useMemo(() => usageCounts(doc), [doc]);
  const page = doc.pages.find((p) => p.id === currentId) || doc.pages[0];
  const pageIndex = doc.pages.indexOf(page);

  // A spread that was removed / undone away → fall back to the first.
  useEffect(() => {
    if (!doc.pages.some((p) => p.id === currentId)) setCurrentId(doc.pages[0]?.id);
  }, [doc.pages, currentId, setCurrentId]);

  // Another spread (added, split, undone…) → no frame stays selected from the previous one.
  useEffect(() => {
    setSelectedSlot(null);
  }, [page?.id]);
  useEffect(() => {
    if (selectedSlot != null && page && selectedSlot >= page.slots.length) setSelectedSlot(null);
  }, [selectedSlot, page]);

  // Faces on the fold — checked whenever this spread's photos or crops change.
  const slotsKey = JSON.stringify(page?.slots?.map((s) => [s.assetId, s.zoom, s.cx, s.cy]) || []) + page?.templateId + page?.flip + page?.blend;
  useEffect(() => {
    setFaces({});
    if (!page) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      foldFaceWarnings(page, assetsById).then((w) => alive && setFaces(w)).catch(() => {});
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [slotsKey, page?.id]); // page/assets read fresh on purpose: re-check only when what's on the spread changes

  // Leaving a spread with a face on the fold needs a "yes, it's fine" (remembered per spread
  // until its photos/crops change again).
  const goTo = (id) => {
    if (id === page?.id) return;
    if (Object.keys(faces).length && page.foldOk !== slotsKey) {
      const ok = window.confirm("⚠️ בכפולה הזו יש פנים של אדם בדיוק על הקפל (אמצע האלבום) — בהדפסה הן ייחתכו בתפר.\n\nאישור = להמשיך בכל זאת · ביטול = להישאר ולתקן (להזיז / לזום / להחליף פריסה)");
      if (!ok) return;
      change((d) => setPageProps(d, page.id, { foldOk: slotsKey }));
    }
    setCurrentId(id);
    setSelectedSlot(null);
    setHeal((h) => ({ ...h, on: false }));
  };
  const step = (dir) => {
    const next = doc.pages[pageIndex + dir];
    if (next) goTo(next.id);
  };

  const onKey = (e) => {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (typing || locked) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedSlot != null) {
      e.preventDefault();
      change((d) => clearSlot(d, page.id, selectedSlot));
    } else if (!typing && e.key === "Escape") {
      setSelectedSlot(null);
    } else if (!typing && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      // same direction as the strip below (spread 1 on the left): ← = the spread to the left (previous)
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const h = (e) => keyRef.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const pickFromBank = (assetId) => {
    if (locked) return;
    const sel = selectedSlot != null && selectedSlot < page.slots.length ? selectedSlot : null;
    const i = sel ?? page.slots.findIndex((s) => !s.assetId);
    if (i < 0) return toast.info("בחרו מסגרת בכפולה, או גררו את התמונה אליה");
    change((d) => placeAsset(d, page.id, i, assetId));
  };

  const photosOf = (ids) => ids.map((id) => assetsById[id]).filter(Boolean);
  const newSpreadFrom = (ids) => {
    if (locked || !ids.length) return;
    const { doc: next, pageIds } = placeGroup(doc, photosOf(ids), { afterIndex: pageIndex });
    edit(() => next);
    if (pageIds[0]) {
      setCurrentId(pageIds[0]);
      setSelectedSlot(null);
    }
    toast.success(`${ids.length} תמונות בכפולה חדשה — בפאנל משמאל: הפריסות שהכי מתאימות להן`);
  };
  const dropGroup = (ids) => {
    if (locked || !ids.length) return;
    const hasPhotos = page.slots.some((s) => s.assetId);
    if (hasPhotos && !window.confirm(`להחליף את התמונות בכפולה הזו ב-${ids.length} התמונות שנבחרו?\n\nביטול = לשים אותן בכפולה חדשה אחרי הזו`)) return newSpreadFrom(ids);
    const { doc: next, pageIds } = placeGroup(doc, photosOf(ids), { replacePageId: page.id });
    edit(() => next);
    if (pageIds[0]) setCurrentId(pageIds[0]);
  };

  // resizable bank (drag its inner edge)
  const startResize = (e) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = bankW;
    const move = (ev) => setBankW(Math.min(760, Math.max(220, w0 + (x0 - ev.clientX))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setBankW((w) => {
        try {
          localStorage.setItem(BANK_W_KEY, String(w));
        } catch {
          /* private mode — width just isn't remembered */
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!page) return null;
  const splitPageObj = splitFor && doc.pages.find((p) => p.id === splitFor);

  return (
    <div className="flex min-h-0 flex-1">
      <AdjustmentDefs doc={doc} />
      {/* photo bank (right) */}
      <div className="relative shrink-0 border-l border-white/10 bg-[#0B1529]" style={{ width: bankW }}>
        <PhotoBank
          doc={doc}
          usage={usage}
          onPick={pickFromBank}
          onNewSpread={locked ? null : newSpreadFrom}
          onTag={studio ? (ids, tag) => edit((d) => tagAssets(d, ids, tag)) : null}
          {...bankProps}
        />
        <div onPointerDown={startResize} title="גררו כדי להגדיל / להקטין את בנק התמונות" className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize hover:bg-amber-400/40" />
      </div>

      {/* spread */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center gap-2 px-2 py-4" onClick={(e) => e.target === e.currentTarget && setSelectedSlot(null)}>
          <button type="button" onClick={() => step(1)} disabled={pageIndex >= doc.pages.length - 1} title="הכפולה הבאה (חץ ימינה →)" className="shrink-0 rounded-full p-2 text-slate-300 hover:bg-white/10 disabled:opacity-20">
            <ChevronRight className="h-7 w-7" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
            <div className="text-xs text-slate-400">
              {pageIndex === 0 && page.title ? "כפולת פתיחה" : `כפולה ${pageIndex + 1} מתוך ${doc.pages.length}`}
              {Object.keys(faces).length > 0 && <span className="mr-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">⚠️ פנים על הקפל</span>}
            </div>
            <div className="w-full max-w-[1400px] shadow-2xl shadow-black/50">
              <SpreadView
                page={page}
                assetsById={assetsById}
                mini={locked}
                selectedSlot={selectedSlot}
                onSelectSlot={setSelectedSlot}
                onDropAsset={(i, assetId) => {
                  change((d) => placeAsset(d, page.id, i, assetId));
                  setSelectedSlot(i);
                }}
                onDropSlot={(i, from) => change((d) => swapSlots(d, from, { pageId: page.id, index: i }))}
                onDropGroup={dropGroup}
                onCropChange={(i, crop) => change((d) => updateSlot(d, page.id, i, crop))}
                onTitleChange={(patch) => change((d) => setTitle(d, page.id, patch))}
                branding={branding}
                onBrandingChange={(patch) => change((d) => setPageProps(d, page.id, { branding: { ...page.branding, ...patch } }))}
                heal={heal}
                onHeal={(i, patch) => {
                  // Photoshop clone-stamp: the first click after Alt+click fixes the offset
                  let p = patch;
                  if (heal.pending && heal.sourcePoint) {
                    p = { ...patch, sx: heal.sourcePoint.x, sy: heal.sourcePoint.y };
                    setHeal((h) => ({ ...h, offset: { dx: h.sourcePoint.x - patch.x, dy: h.sourcePoint.y - patch.y }, pending: false }));
                  }
                  change((d) => addHealPatch(d, page.id, i, p));
                }}
                onHealSource={(pt) => {
                  setHeal((h) => ({ ...h, sourcePoint: pt, offset: null, pending: true }));
                  toast.info("נקודת המקור נבחרה — עכשיו לחצו על מה שרוצים למחוק");
                }}
                faceWarnings={faces}
              />
            </div>
            {!locked && <div className="text-[11px] text-slate-500">גוררים תמונה מהבנק · בין מסגרות = החלפה · ⌘+לחיצה בבנק = כמה תמונות · לחיצה על תמונה = זום, צבע, תיקון · ←/→ מעבר בין כפולות</div>}
          </div>
          <button type="button" onClick={() => step(-1)} disabled={pageIndex <= 0} title="הכפולה הקודמת (← חץ שמאלה)" className="shrink-0 rounded-full p-2 text-slate-300 hover:bg-white/10 disabled:opacity-20">
            <ChevronLeft className="h-7 w-7" />
          </button>
        </div>
        <div className="border-t border-white/10 bg-[#0B1529]">
          <SpreadStrip
            doc={doc}
            assetsById={assetsById}
            currentId={page.id}
            onSelect={goTo}
            onMove={(from, to) => change((d) => movePage(d, from, to))}
            onAdd={() => {
              if (locked) return;
              const next = addPage(doc, pageIndex);
              edit(() => next);
              setCurrentId(next.pages[pageIndex + 1].id);
            }}
            onInsertAt={
              locked
                ? null
                : (i) => {
                    const next = insertPageAt(doc, i);
                    edit(() => next);
                    setCurrentId(next.pages[i].id);
                  }
            }
            onDuplicate={(id) => change((d) => duplicatePage(d, id))}
            onRemove={(id) => {
              if (locked || !window.confirm("למחוק את הכפולה? (אפשר לבטל עם ⌘Z)")) return;
              edit((d) => removePage(d, id));
            }}
            onSplit={locked ? null : (id) => setSplitFor(id)}
          />
        </div>
      </div>

      {/* tools (left) */}
      <div className="w-72 shrink-0 overflow-y-auto border-r border-white/10 bg-[#0B1529]">
        {!locked && (
          <PagePanel
            page={page}
            doc={doc}
            assetsById={assetsById}
            selectedSlot={selectedSlot}
            onTemplate={(tid, flip, assign) => change((d) => (assign ? setTemplateAssigned(d, page.id, tid, flip, assign) : setTemplate(d, page.id, tid)))}
            onFlip={() => change((d) => toggleFlip(d, page.id))}
            onSlot={(patch) => change((d) => updateSlot(d, page.id, selectedSlot, patch), `slot:${page.id}:${selectedSlot}:${Object.keys(patch).join()}`)}
            onClearSlot={() => change((d) => clearSlot(d, page.id, selectedSlot))}
            onTitle={(patch) => change((d) => setTitle(d, page.id, patch), `title:${page.id}:${Object.keys(patch).join()}`)}
            onPage={(patch) => change((d) => setPageProps(d, page.id, patch), `page:${page.id}:${Object.keys(patch).join()}`)}
            heal={heal}
            setHeal={setHeal}
            brandingReady={brandingReady}
            onEnlarge={onEnlarge}
          />
        )}
      </div>

      {splitPageObj && (
        <SplitDialog
          page={splitPageObj}
          onClose={() => setSplitFor(null)}
          onSplit={(keep) => {
            edit((d) => splitPage(d, splitPageObj.id, keep, assetsById));
            setSplitFor(null);
            toast.success("הכפולה פוצלה לשתיים");
          }}
        />
      )}
    </div>
  );
}

function SplitDialog({ page, onClose, onSplit }) {
  const n = page.slots.filter((s) => s.assetId).length;
  const [keep, setKeep] = useState(Math.ceil(n / 2));
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-white">✂️ פיצול כפולה</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="text-sm text-slate-400">יש בכפולה {n} תמונות. כמה להשאיר כאן? השאר עוברות לכפולה חדשה מיד אחריה, ולכל אחת נבחרת הפריסה שהכי מתאימה.</div>
        <input type="range" min={1} max={n - 1} value={keep} onChange={(e) => setKeep(Number(e.target.value))} className="w-full accent-amber-400" />
        <div className="flex justify-between text-sm">
          <span>נשארות כאן: <b className="text-white">{keep}</b></span>
          <span>עוברות לכפולה חדשה: <b className="text-white">{n - keep}</b></span>
        </div>
        <button type="button" onClick={() => onSplit(keep)} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500">פצל</button>
      </div>
    </div>
  );
}
