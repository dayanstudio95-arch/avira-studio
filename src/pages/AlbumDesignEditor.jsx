import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Undo2, Redo2, History, Check, AlertTriangle, CloudOff, FolderOpen, Monitor } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import {
  emptyDoc, usageCounts, priceSummary, sortAssets, TITLE_FONTS,
  addPage, removePage, duplicatePage, movePage, setTemplate, toggleFlip, setTitle,
  placeAsset, clearSlot, updateSlot, swapSlots,
} from "@/lib/albumDesign";
import { parseFolderId, listFolderImages, hasDriveKey } from "@/lib/googleDrive";
import { useDesignDoc } from "@/components/albumEditor/useDesignDoc";
import SpreadView from "@/components/albumEditor/SpreadView";
import PhotoBank from "@/components/albumEditor/PhotoBank";
import SpreadStrip from "@/components/albumEditor/SpreadStrip";
import PagePanel from "@/components/albumEditor/PagePanel";
import RevisionsDialog from "@/components/albumEditor/RevisionsDialog";

// Album design editor — stage 1 (2026-10-08, the owner's request: design the album sketch inside
// AVIRA instead of SmartAlbums). Desktop only, opened from an album order ("🎨 עורך סקיצה (בטא)").
// Photos come from the couple's Google Drive folder and are never copied; the design is one JSON
// document in album_designs (0079). Stage 3 will export it as print-ready spreads into the
// existing album_version flow — until then nothing here reaches the couple.

const FONT_HREF = `https://fonts.googleapis.com/css2?${TITLE_FONTS.map((f) => `family=${f.google}`).join("&")}&display=swap`;

function useTitleFonts() {
  useEffect(() => {
    if (document.querySelector("link[data-album-fonts]")) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = FONT_HREF;
    l.dataset.albumFonts = "1";
    document.head.appendChild(l);
  }, []);
}

export default function AlbumDesignEditor() {
  const { orderId } = useParams();
  useTitleFonts();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [order, setOrder] = useState(null);
  const [names, setNames] = useState({ display: "", date: "" });
  const [design, setDesign] = useState(null);
  const [extraPrice, setExtraPrice] = useState(0);
  const [wide, setWide] = useState(() => window.innerWidth >= 1024);

  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [o] = await base44.entities.AlbumOrder.filter({ id: orderId });
        if (!o) throw new Error("הזמנת האלבום לא נמצאה");
        setOrder(o);
        let display = o.coupleNamesManual || "";
        let date = o.weddingDateManual || "";
        if (o.eventId) {
          const [ev] = await base44.entities.Event.filter({ id: o.eventId }).catch(() => []);
          if (ev) {
            display = ev.coupleNames || display;
            date = ev.date || date;
          }
        }
        setNames({ display, date });
        const { data: d, error } = await supabase.from("album_designs").select("*").eq("album_order_id", orderId).maybeSingle();
        if (error) throw error;
        setDesign(d || null);
        const { data: addon } = await supabase.from("album_addons").select("price").eq("category", "extra_pages").eq("active", true).maybeSingle();
        setExtraPrice(Number(addon?.price) || 0);
      } catch (e) {
        setLoadError(e?.message || "שגיאה בטעינה");
      } finally {
        setLoading(false);
      }
    })();
  }, [orderId]);

  const back = (
    <Link to={`/AlbumOrders/${orderId}`} className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
      <ArrowRight className="h-4 w-4" /> חזרה להזמנה
    </Link>
  );

  if (!wide) {
    return (
      <Shell>
        <div className="m-auto max-w-sm space-y-3 p-6 text-center text-slate-300">
          <Monitor className="mx-auto h-10 w-10 text-amber-300" />
          <div className="text-lg font-semibold text-white">העורך עובד במחשב בלבד</div>
          <div className="text-sm">פתחו את ההזמנה במחשב (רצוי Chrome) כדי לעצב את הסקיצה.</div>
          {back}
        </div>
      </Shell>
    );
  }
  if (loading) return <Shell><Loader2 className="m-auto h-8 w-8 animate-spin text-amber-300" /></Shell>;
  if (loadError) {
    return (
      <Shell>
        <div className="m-auto space-y-3 text-center text-slate-300">
          <AlertTriangle className="mx-auto h-8 w-8 text-rose-400" />
          <div>{loadError}</div>
          {back}
        </div>
      </Shell>
    );
  }
  if (!design) return <Setup orderId={orderId} names={names} back={back} onCreated={setDesign} />;
  return <Editor key={design.id} design={design} order={order} names={names} back={back} extraPrice={extraPrice} />;
}

function Shell({ children }) {
  return (
    <div className="fixed inset-0 z-[60] flex bg-[#070F1F]" dir="rtl">
      {children}
    </div>
  );
}

// ---- first time: connect the Drive folder ---------------------------------------------------
function Setup({ orderId, names, back, onCreated }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState(null); // { folderId, assets, skipped }

  const load = async () => {
    setError("");
    setFound(null);
    const folderId = parseFolderId(link);
    if (!folderId) return setError("זה לא נראה כמו קישור לתיקייה ב-Google Drive");
    setBusy(true);
    try {
      const r = await listFolderImages(folderId);
      setFound({ folderId, ...r });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const create = async () => {
    setBusy(true);
    const doc = emptyDoc({ assets: sortAssets(found.assets), names: names.display, date: names.date });
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("album_designs")
      .insert({ album_order_id: orderId, drive_folder_url: link.trim(), drive_folder_id: found.folderId, doc, created_by: user?.id })
      .select("*")
      .single();
    setBusy(false);
    if (err) return setError(err.message);
    onCreated(data);
  };

  return (
    <Shell>
      <div className="m-auto w-full max-w-lg space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-6 text-slate-200">
        {back}
        <div>
          <div className="text-xl font-bold text-white">🎨 עורך סקיצה (בטא) — {names.display || "אלבום"}</div>
          <div className="mt-1 text-sm text-slate-400">מדביקים קישור לתיקיית Google Drive עם התמונות של הזוג. התמונות נשארות ב-Drive, שום דבר לא מועתק.</div>
        </div>
        {!hasDriveKey() && <div className="rounded-lg bg-rose-500/15 p-3 text-sm text-rose-200">חסר מפתח Google במערכת (VITE_GOOGLE_API_KEY) — צריך להגדיר לפני שימוש.</div>}
        <ol className="list-decimal space-y-1 pe-5 text-xs text-slate-400">
          <li>ב-Drive: קליק ימני על התיקייה ← שיתוף ← "כל מי שיש לו את הקישור" (צופה).</li>
          <li>העתקת קישור, והדבקה כאן.</li>
        </ol>
        <div className="flex gap-2">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" dir="ltr" className="h-10 flex-1 rounded-lg border border-white/10 bg-[#070F1F] px-3 text-sm text-white" />
          <button type="button" onClick={load} disabled={busy || !link.trim()} className="flex h-10 items-center gap-1.5 rounded-lg bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50">
            {busy && !found ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} טען
          </button>
        </div>
        {error && <div className="rounded-lg bg-rose-500/15 p-3 text-sm text-rose-200">{error}</div>}
        {found && (
          <div className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <div className="text-emerald-200">נמצאו {found.assets.length} תמונות{found.skipped.length ? ` · ${found.skipped.length} קבצים לא נתמכים (רק JPG/PNG)` : ""}</div>
            <button type="button" onClick={create} disabled={busy || !found.assets.length} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500 disabled:opacity-50">
              {busy ? "יוצר…" : "פתח את העורך"}
            </button>
          </div>
        )}
      </div>
    </Shell>
  );
}

// ---- the editor -------------------------------------------------------------------------------
function SaveBadge({ state, error }) {
  if (state === "saving" || state === "dirty") return <span className="flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> שומר…</span>;
  if (state === "error") return <span className="flex items-center gap-1 text-xs text-rose-300" title={error}><CloudOff className="h-3.5 w-3.5" /> השמירה נכשלה</span>;
  if (state === "conflict") return null;
  return <span className="flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" /> נשמר</span>;
}

function Editor({ design, names, back, extraPrice }) {
  const { doc, edit, undo, redo, canUndo, canRedo, saveState, saveError, snapshot } = useDesignDoc(design);
  const [currentId, setCurrentId] = useState(() => doc.pages[0]?.id);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [skipped, setSkipped] = useState([]);
  const [showRevisions, setShowRevisions] = useState(false);

  const assetsById = useMemo(() => Object.fromEntries(doc.assets.map((a) => [a.id, a])), [doc.assets]);
  const usage = useMemo(() => usageCounts(doc), [doc]);
  const page = doc.pages.find((p) => p.id === currentId) || doc.pages[0];
  const pageIndex = doc.pages.indexOf(page);
  const price = priceSummary(doc.pages.length, extraPrice);

  const goTo = (id) => {
    setCurrentId(id);
    setSelectedSlot(null);
  };

  // A spread that was removed / undone away → fall back to the first.
  useEffect(() => {
    if (!doc.pages.some((p) => p.id === currentId)) setCurrentId(doc.pages[0]?.id);
  }, [doc.pages, currentId]);

  const onKey = useCallback(
    (e) => {
      const typing = /input|textarea|select/i.test(e.target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selectedSlot != null) {
        e.preventDefault();
        edit((d) => clearSlot(d, page.id, selectedSlot));
      } else if (!typing && e.key === "Escape") {
        setSelectedSlot(null);
      } else if (!typing && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !mod) {
        const next = doc.pages[pageIndex + (e.key === "ArrowLeft" ? 1 : -1)];
        if (next) goTo(next.id);
      }
    },
    [undo, redo, edit, page?.id, selectedSlot, doc.pages, pageIndex]
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { assets, skipped: sk } = await listFolderImages(design.drive_folder_id);
      setSkipped(sk);
      const known = new Set(doc.assets.map((a) => a.id));
      const added = assets.filter((a) => !known.has(a.id));
      if (added.length) edit((d) => ({ ...d, assets: [...d.assets, ...added] }));
      toast.success(added.length ? `נוספו ${added.length} תמונות חדשות` : "אין תמונות חדשות בתיקייה");
    } catch (e) {
      toast.error(e.message);
    }
    setRefreshing(false);
  };

  const pickFromBank = (assetId) => {
    if (selectedSlot == null) {
      // no cell chosen → first empty cell of this spread
      const i = page.slots.findIndex((s) => !s.assetId);
      if (i < 0) return toast.info("בחרו מסגרת בכפולה, או גררו את התמונה אליה");
      edit((d) => placeAsset(d, page.id, i, assetId));
      return;
    }
    edit((d) => placeAsset(d, page.id, selectedSlot, assetId));
  };

  const saveVersion = async () => {
    const { error } = await snapshot("manual");
    error ? toast.error("שמירת הגרסה נכשלה") : toast.success("נשמרה גרסה — אפשר לחזור אליה מ'היסטוריה'");
  };

  return (
    <Shell>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex items-center gap-4 border-b border-white/10 bg-[#0B1529] px-4 py-2">
          {back}
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">🎨 {names.display || "אלבום"} <span className="text-xs font-normal text-amber-300">בטא</span></div>
          </div>
          <SaveBadge state={saveState} error={saveError} />
          <div className="ms-auto flex items-center gap-1">
            <button type="button" onClick={undo} disabled={!canUndo} title="ביטול (⌘Z)" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
            <button type="button" onClick={redo} disabled={!canRedo} title="חזרה (⌘⇧Z)" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
            <button type="button" onClick={saveVersion} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">שמור גרסה</button>
            <button type="button" onClick={() => setShowRevisions(true)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10"><History className="h-4 w-4" /> היסטוריה</button>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200" title={`${price.included} כפולות כלולות במחיר האלבום`}>
            {price.pages} כפולות · {price.extra ? <span className="text-amber-300">{price.extra} נוספות · +₪{price.extraCost.toLocaleString()}</span> : <span className="text-emerald-300">בתוך ה-{price.included} הכלולות</span>}
          </div>
        </div>

        {saveState === "conflict" && (
          <div className="flex items-center justify-between gap-3 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">
            <span>⚠️ הסקיצה נשמרה בינתיים ממקום אחר (לשונית או מחשב אחר). כדי לא לדרוס — השינויים כאן לא נשמרים. רעננו את הדף.</span>
            <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-rose-500 px-3 py-1 text-xs font-semibold text-white">רענון</button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* photo bank (right) */}
          <div className="w-72 shrink-0 border-l border-white/10 bg-[#0B1529]">
            <PhotoBank
              doc={doc}
              usage={usage}
              onPick={pickFromBank}
              onRefresh={refresh}
              refreshing={refreshing}
              skipped={skipped}
              onCameraOffset={(cam, m) => edit((d) => ({ ...d, cameraOffsets: { ...d.cameraOffsets, [cam]: m } }))}
            />
          </div>

          {/* spread */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6" onClick={(e) => e.target === e.currentTarget && setSelectedSlot(null)}>
              <div className="text-xs text-slate-400">{pageIndex === 0 && page.title ? "כפולת פתיחה" : `כפולה ${pageIndex + 1} מתוך ${doc.pages.length}`}</div>
              <div className="w-full max-w-[1400px] shadow-2xl shadow-black/50">
                <SpreadView
                  page={page}
                  assetsById={assetsById}
                  selectedSlot={selectedSlot}
                  onSelectSlot={setSelectedSlot}
                  onDropAsset={(i, assetId) => { edit((d) => placeAsset(d, page.id, i, assetId)); setSelectedSlot(i); }}
                  onDropSlot={(i, from) => edit((d) => swapSlots(d, from, { pageId: page.id, index: i }))}
                  onCropChange={(i, crop) => edit((d) => updateSlot(d, page.id, i, crop))}
                />
              </div>
              <div className="text-[11px] text-slate-500">גוררים תמונה מהבנק למסגרת · גוררים בין מסגרות כדי להחליף · לחיצה על מסגרת = זום, הזזה ושחור-לבן · ←/→ מעבר בין כפולות</div>
            </div>
            <div className="border-t border-white/10 bg-[#0B1529]">
              <SpreadStrip
                doc={doc}
                assetsById={assetsById}
                currentId={page.id}
                onSelect={goTo}
                onMove={(from, to) => edit((d) => movePage(d, from, to))}
                onAdd={() => {
                  const next = addPage(doc, pageIndex);
                  edit(() => next);
                  goTo(next.pages[pageIndex + 1].id);
                }}
                onDuplicate={(id) => edit((d) => duplicatePage(d, id))}
                onRemove={(id) => {
                  if (!window.confirm("למחוק את הכפולה? (אפשר לבטל עם ⌘Z)")) return;
                  edit((d) => removePage(d, id));
                }}
              />
            </div>
          </div>

          {/* tools (left) */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-white/10 bg-[#0B1529]">
            <PagePanel
              page={page}
              doc={doc}
              selectedSlot={selectedSlot}
              onTemplate={(tid) => edit((d) => setTemplate(d, page.id, tid))}
              onFlip={() => edit((d) => toggleFlip(d, page.id))}
              onSlot={(patch) => edit((d) => updateSlot(d, page.id, selectedSlot, patch), `slot:${page.id}:${selectedSlot}:${Object.keys(patch).join()}`)}
              onClearSlot={() => edit((d) => clearSlot(d, page.id, selectedSlot))}
              onTitle={(patch) => edit((d) => setTitle(d, page.id, patch), `title:${page.id}:${Object.keys(patch).join()}`)}
            />
          </div>
        </div>
      </div>

      {showRevisions && (
        <RevisionsDialog
          designId={design.id}
          onClose={() => setShowRevisions(false)}
          onRestore={async (restored) => {
            await snapshot("before_restore");
            edit(() => restored);
            setShowRevisions(false);
            toast.success("הגרסה שוחזרה (אפשר לבטל עם ⌘Z)");
          }}
        />
      )}
    </Shell>
  );
}
