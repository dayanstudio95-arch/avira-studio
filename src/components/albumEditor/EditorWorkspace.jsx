import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  usageCounts, addPage, insertPageAt, removePage, duplicatePage, movePage, setTemplate, setTemplateAssigned, toggleFlip, setTitle,
  placeAsset, clearSlot, updateSlot, swapSlots, setPageProps, addHealPatch, tagAssets, moveSlot, pasteSlot,
} from "@/lib/albumDesign";
import { splitPage, placeGroup, addToPage, removeFromPage, fromIndices } from "@/lib/albumAutoLayout";
import { foldFaceWarnings } from "@/lib/albumFaces";
import SpreadView, { AdjustmentDefs } from "./SpreadView";
import PhotoBank from "./PhotoBank";
import SpreadStrip from "./SpreadStrip";
import PagePanel from "./PagePanel";
import { confirmDialog } from "@/components/ui/confirm-dialog";

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
  const [multiSel, setMultiSel] = useState([]); // ⌘+click on several photos of this spread → move them together
  const [heal, setHeal] = useState({ on: false, size: 4, offset: null });
  const [faces, setFaces] = useState({});
  const [bankW, setBankW] = useState(readBankW);
  const [splitFor, setSplitFor] = useState(null);
  const [clip, setClip] = useState(null); // { slot, cut } — copy / cut / paste of a photo
  const [moveAsk, setMoveAsk] = useState(null); // { from, to } — dropped on a full frame of another page
  const [dragging, setDragging] = useState(false); // a photo is being dragged → show the "add to this page" zone
  const [areaOver, setAreaOver] = useState(false);
  useEffect(() => {
    const start = (e) => setDragging([...(e.dataTransfer?.types || [])].some((t) => t.startsWith("application/x-avira")));
    const end = () => {
      setDragging(false);
      setAreaOver(false);
    };
    window.addEventListener("dragstart", start);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragstart", start);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, []);
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
    setMultiSel([]);
  }, [page?.id]);
  useEffect(() => {
    if (selectedSlot != null && page && selectedSlot >= page.slots.length) setSelectedSlot(null);
  }, [selectedSlot, page]);
  // the page re-laid out (undo, a move…) → frames picked by index no longer mean the same photos
  const slotIdsKey = page?.slots.map((s) => s.assetId || "").join();
  useEffect(() => {
    setMultiSel([]);
  }, [slotIdsKey]);

  // click = one frame (zoom, color…); ⌘/Ctrl/Shift+click = add / remove it from a group
  const selectSlot = (i, e) => {
    if (e && (e.metaKey || e.ctrlKey || e.shiftKey) && !locked) {
      if (!page.slots[i]?.assetId) return;
      setMultiSel((cur) => {
        const base = cur.length ? cur : selectedSlot != null && selectedSlot !== i && page.slots[selectedSlot]?.assetId ? [selectedSlot] : [];
        return base.includes(i) ? base.filter((k) => k !== i) : [...base, i];
      });
      setSelectedSlot(null);
      return;
    }
    setMultiSel([]);
    setSelectedSlot(i);
  };
  const groupSel = multiSel.filter((i) => page?.slots[i]?.assetId);

  // Faces on the fold — checked whenever this spread's photos or crops change.
  const slotsKey = JSON.stringify(page?.slots?.map((s) => [s.assetId, s.zoom, s.cx, s.cy]) || []) + page?.templateId + page?.flip + page?.blend + page?.fadeStrength;
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
  const goTo = async (id) => {
    if (id === page?.id) return;
    if (Object.keys(faces).length && page.foldOk !== slotsKey) {
      const ok = await confirmDialog("⚠️ בכפולה הזו יש פנים של אדם בדיוק על הקפל (אמצע האלבום) — בהדפסה הן ייחתכו בתפר.\n\nאישור = להמשיך בכל זאת · ביטול = להישאר ולתקן (להזיז / לזום / להחליף פריסה)");
      if (!ok) return;
      change((d) => setPageProps(d, page.id, { foldOk: slotsKey }));
    }
    setCurrentId(id);
    setSelectedSlot(null);
    setMultiSel([]);
    setHeal((h) => ({ ...h, on: false }));
  };
  const step = (dir) => {
    const next = doc.pages[pageIndex + dir];
    if (next) goTo(next.id);
  };

  const onKey = (e) => {
    const t = e.target;
    const typing = t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || (t.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(t.type));
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      if (typing || locked) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && !typing && ["c", "x", "v"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const k = e.key.toLowerCase();
      if (k === "c") copySel(false);
      else if (k === "x") copySel(true);
      else pasteSel();
    } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && groupSel.length) {
      e.preventDefault();
      change((d) => removeFromPage(d, page.id, groupSel, assetsById)); // back to the bank, the page closes the gaps
      setMultiSel([]);
    } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedSlot != null) {
      e.preventDefault();
      change((d) => clearSlot(d, page.id, selectedSlot));
    } else if (!typing && e.key === "Escape") {
      setSelectedSlot(null);
      setMultiSel([]);
    } else if (!typing && !mod && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      // same direction as the strip below (spread 1 on the left): ← = the spread to the left (previous)
      step(e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    // While a confirm is open the editor's shortcuts are off (QA 2026-10-09): window.confirm
    // used to block keys; the in-app confirm doesn't, and Delete / ⌘Z / arrows acted behind it.
    const h = (e) => {
      if (document.querySelector("[data-confirm-dialog]")) return;
      keyRef.current(e);
    };
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

  // ---- copy / cut / paste a photo (⌘C ⌘X ⌘V, or the buttons in the side panel) ----
  const selSlot = selectedSlot != null ? page?.slots[selectedSlot] : null;
  function copySel(cut) {
    if (locked) return;
    if (groupSel.length) {
      setClip({ slots: groupSel.map((i) => ({ ...page.slots[i] })) });
      if (cut) change((d) => removeFromPage(d, page.id, groupSel, assetsById));
      setMultiSel([]);
      return toast.success(`${groupSel.length} תמונות ${cut ? "נגזרו" : "הועתקו"} — עברו לדף אחר ו-⌘V`);
    }
    if (!selSlot?.assetId) return toast.info("בחרו קודם תמונה בכפולה");
    setClip({ slot: { ...selSlot } });
    if (cut) {
      change((d) => removeFromPage(d, page.id, selectedSlot, assetsById)); // the page closes the gap
      setSelectedSlot(null);
    }
    toast.success(cut ? "נגזר — בחרו מסגרת (גם בדף אחר) ו-⌘V" : "הועתק — בחרו מסגרת (גם בדף אחר) ו-⌘V");
  }
  // ⌘V: into the selected frame if it's EMPTY; otherwise the photo is ADDED to this page and the
  // layout changes to fit one more (the owner, 2026-10-08: "a full page grows, it doesn't replace").
  function pasteSel() {
    if (locked || !clip) return;
    if (clip.slots) {
      const looks = Object.fromEntries(clip.slots.map(({ assetId, filter, adj, shape, heal: h }) => [assetId, { filter, adj, shape, heal: h }]));
      return addPhotosHere({ ids: clip.slots.map((s) => s.assetId) }, looks);
    }
    const sel = selectedSlot != null && selectedSlot < page.slots.length ? selectedSlot : null;
    if (sel != null && !page.slots[sel]?.assetId) {
      change((d) => pasteSlot(d, page.id, sel, clip.slot));
      return;
    }
    const { assetId, filter, adj, shape, heal } = clip.slot;
    addPhotosHere({ ids: [assetId] }, { [assetId]: { filter, adj, shape, heal } });
  }

  function addPhotosHere({ ids, from }, extraLooks = {}, targetId = page.id) {
    const srcSlots = from ? doc.pages.find((p) => p.id === from.pageId)?.slots || [] : [];
    const assetIds = ids || fromIndices(from).map((k) => srcSlots[k]?.assetId).filter(Boolean);
    const r = addToPage(doc, targetId, assetIds, assetsById, from || null, extraLooks);
    if (r.error) return toast.error(r.error);
    if (r.doc === doc) return;
    edit(() => r.doc);
    setSelectedSlot(null);
    setMultiSel([]);
    const n = doc.pages.findIndex((p) => p.id === targetId) + 1;
    const many = assetIds.length > 1 ? `${assetIds.length} תמונות` : null;
    toast.success(from ? `${many ? `${many} עברו` : "התמונה עברה"} לדף ${n} — שני הדפים התאימו את הפריסה` : `${many ? `${many} נוספו` : "נוספה"} לדף ${n} — הפריסה התאימה את עצמה`);
  }

  // ---- a photo dragged from another page ----
  const dropFromSlot = (i, from) => {
    if (from.indices?.length > 1) return from.pageId === page.id ? null : addPhotosHere({ from }); // a group joins this page
    if (from.pageId === page.id) return change((d) => swapSlots(d, from, { pageId: page.id, index: i }));
    if (!page.slots[i]?.assetId) return change((d) => moveSlot(d, from, { pageId: page.id, index: i }));
    setMoveAsk({ from, to: { pageId: page.id, index: i } });
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
  const dropGroup = async (ids) => {
    if (locked || !ids.length) return;
    const hasPhotos = page.slots.some((s) => s.assetId);
    if (hasPhotos && !(await confirmDialog({ title: `להחליף את התמונות בכפולה הזו ב-${ids.length} התמונות שנבחרו?`, message: "או לשים אותן בכפולה חדשה אחרי הזו.", confirmText: "החלף", cancelText: "בכפולה חדשה" }))) return newSpreadFrom(ids);
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
        <div
          className="flex min-h-0 flex-1 items-center gap-2 px-2 py-4"
          onPointerDown={() => {
            // a click on the spread takes the keyboard back from a text field → ← / → work again
            const a = document.activeElement;
            if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) a.blur();
          }}
          onClick={(e) => e.target === e.currentTarget && setSelectedSlot(null)}
          onDragOver={(e) => {
            if (locked || ![...e.dataTransfer.types].some((t) => t.startsWith("application/x-avira"))) return;
            e.preventDefault();
            setAreaOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setAreaOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setAreaOver(false);
            setDragging(false);
            if (locked) return;
            // released around the spread (not on a frame) → the photo(s) join this page
            const group = e.dataTransfer.getData("application/x-avira-group");
            const asset = e.dataTransfer.getData("application/x-avira-asset");
            const slot = e.dataTransfer.getData("application/x-avira-slot");
            if (group) addPhotosHere({ ids: JSON.parse(group) });
            else if (asset) addPhotosHere({ ids: [asset] });
            else if (slot) {
              const from = JSON.parse(slot);
              if (from.pageId !== page.id) addPhotosHere({ from });
            }
          }}
        >
          <button type="button" onClick={() => step(1)} disabled={pageIndex >= doc.pages.length - 1} title="הכפולה הבאה (חץ ימינה →)" className="shrink-0 rounded-full p-2 text-slate-300 hover:bg-white/10 disabled:opacity-20">
            <ChevronRight className="h-7 w-7" />
          </button>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-3">
            <div className="text-xs text-slate-400">
              דף {pageIndex + 1} מתוך {doc.pages.length}{pageIndex === 0 && page.title ? " (פתיחה)" : ""}
              {Object.keys(faces).length > 0 && <span className="mr-2 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">⚠️ פנים על הקפל</span>}
            </div>
            {dragging && !locked && (
              <div className={`w-full max-w-[1400px] rounded-lg border-2 border-dashed px-3 py-2 text-center text-xs transition ${areaOver ? "border-emerald-400 bg-emerald-500/15 text-emerald-200" : "border-white/20 text-slate-400"}`}>
                ⬇ שחררו כאן (מחוץ למסגרות) כדי <b>להוסיף</b> לדף הזה — הפריסה תשתנה לפי כמות התמונות · על מסגרת = החלפה
              </div>
            )}
            <div className="w-full max-w-[1400px] shadow-2xl shadow-black/50">
              <SpreadView
                page={page}
                assetsById={assetsById}
                mini={locked}
                selectedSlot={selectedSlot}
                multiSelected={groupSel}
                onSelectSlot={selectSlot}
                onDropAsset={(i, assetId) => {
                  change((d) => placeAsset(d, page.id, i, assetId));
                  setSelectedSlot(i);
                }}
                onDropSlot={dropFromSlot}
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
            {!locked && groupSel.length > 0 && (
              <MultiMoveBar
                count={groupSel.length}
                pages={doc.pages}
                currentIndex={pageIndex}
                onMove={(targetId) => addPhotosHere({ from: { pageId: page.id, index: groupSel[0], indices: groupSel } }, {}, targetId)}
                onClear={() => setMultiSel([])}
              />
            )}
            {!locked && <div className="text-[11px] text-slate-500">גוררים תמונה מהבנק · בין מסגרות = החלפה · ⌘+לחיצה (בבנק או בכפולה) = כמה תמונות · לחיצה על תמונה = זום, צבע, תיקון · ←/→ מעבר בין כפולות</div>}
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
            onRemove={async (id) => {
              if (locked || !await confirmDialog("למחוק את הכפולה? (אפשר לבטל עם ⌘Z)")) return;
              edit((d) => removePage(d, id));
            }}
            onSplit={locked ? null : (id) => setSplitFor(id)}
            onDragHoverPage={locked ? null : (id) => id !== page.id && goTo(id)}
            onDropOnPage={locked ? null : (pageId, payload) => addPhotosHere(payload, {}, pageId)}
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
            clipboard={{ has: !!clip, copy: () => copySel(false), cut: () => copySel(true), paste: pasteSel }}
          />
        )}
      </div>

      {moveAsk && (
        <MoveDialog
          onClose={() => setMoveAsk(null)}
          onSwap={() => {
            change((d) => swapSlots(d, moveAsk.from, moveAsk.to));
            setMoveAsk(null);
          }}
          onMove={() => {
            change((d) => moveSlot(d, moveAsk.from, moveAsk.to));
            setMoveAsk(null);
            toast.success("הועברה — התמונה שהייתה כאן חזרה לבנק");
          }}
        />
      )}
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

function MoveDialog({ onClose, onSwap, onMove }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="text-lg font-semibold text-white">במסגרת הזו כבר יש תמונה</div>
        <button type="button" onClick={onSwap} className="w-full rounded-lg border border-white/15 p-3 text-right hover:border-amber-400/60 hover:bg-white/5">
          <div className="font-semibold text-white">⇄ להחליף ביניהן</div>
          <div className="text-xs text-slate-400">כל תמונה עוברת לדף של השנייה</div>
        </button>
        <button type="button" onClick={onMove} className="w-full rounded-lg border border-white/15 p-3 text-right hover:border-amber-400/60 hover:bg-white/5">
          <div className="font-semibold text-white">→ להעביר לכאן</div>
          <div className="text-xs text-slate-400">התמונה שהייתה כאן חוזרת לבנק התמונות, והמקום הישן מתרוקן</div>
        </button>
        <button type="button" onClick={onClose} className="w-full text-sm text-slate-400 hover:text-white">ביטול</button>
      </div>
    </div>
  );
}

// ⌘+click picked several photos on this spread → move them all to another page (both re-layout).
function MultiMoveBar({ count, pages, currentIndex, onMove, onClear }) {
  const [to, setTo] = useState("");
  return (
    <div className="flex w-full max-w-[1400px] flex-wrap items-center gap-2 rounded-lg border border-sky-400/50 bg-sky-500/15 px-3 py-2 text-xs text-sky-100">
      <b>{count} תמונות נבחרו</b>
      <span className="text-sky-200/80">· גררו אחת מהן לדף ברצועה למטה, או:</span>
      <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-white/20 bg-[#0B1529] px-2 py-1 text-xs text-white">
        <option value="">העבר לדף…</option>
        {pages.map((p, i) => (i === currentIndex ? null : <option key={p.id} value={p.id}>דף {i + 1}{p.section ? ` · ${p.section}` : ""}</option>))}
      </select>
      <button type="button" disabled={!to} onClick={() => onMove(to)} className="rounded bg-sky-500 px-3 py-1 font-semibold text-white hover:bg-sky-400 disabled:opacity-40">
        העבר
      </button>
      <span className="text-sky-200/70">· ⌘X ואז ⌘V בדף אחר · Delete = החזרה לבנק</span>
      <button type="button" onClick={onClear} className="mr-auto rounded px-2 py-1 text-sky-200 hover:bg-white/10">✕ ביטול בחירה</button>
    </div>
  );
}
