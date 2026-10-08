import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, Loader2, Undo2, Redo2, History, Check, AlertTriangle, CloudOff, FolderOpen, Monitor, Sparkles, Send, Download } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import {
  emptyDoc, priceSummary, sortAssets, FONT_HREF,
  setPageCount, resetSketch,
} from "@/lib/albumDesign";
import { presetFromDoc } from "@/lib/albumAutoLayout";
import { useStudioBranding, savePresetToSettings } from "@/lib/albumStudioSettings";
import { parseFolderId, listFolderImages, hasDriveKey } from "@/lib/googleDrive";
import { useDesignDoc } from "@/components/albumEditor/useDesignDoc";
import EditorWorkspace from "@/components/albumEditor/EditorWorkspace";
import RevisionsDialog from "@/components/albumEditor/RevisionsDialog";
import AutoSketchDialog from "@/components/albumEditor/AutoSketchDialog";
import ExportDialog from "@/components/albumEditor/ExportDialog";
import { downloadSpreadFile } from "@/lib/albumExport";
import { uploadStudioFiles, prepareEnlargementFiles } from "@/lib/albumUploads";
import SourcesDialog from "@/components/albumEditor/SourcesDialog";
import EnlargementsDialog from "@/components/albumEditor/EnlargementsDialog";

// Album design editor — stage 1 (2026-10-08, the owner's request: design the album sketch inside
// AVIRA instead of SmartAlbums). Desktop only, opened from an album order ("🎨 עורך סקיצה (בטא)").
// Photos come from the couple's Google Drive folder and are never copied; the design is one JSON
// document in album_designs (0079). "ייצוא לזוג" turns it into print-ready spreads as a normal
// album_version (albumExport.js); the couple can edit a draft of their own (0080, CoupleEditor).


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
  const [spreads, setSpreads] = useState(30);

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
    const doc = emptyDoc({ assets: sortAssets(found.assets), names: names.display, date: names.date, spreads: Math.max(2, Math.min(80, Number(spreads) || 30)) });
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
            <label className="flex items-center justify-between gap-2 text-slate-200">
              כמה כפולות באלבום (כולל הפתיחה)
              <input type="number" min={2} max={80} value={spreads} onChange={(e) => setSpreads(e.target.value)} className="h-9 w-20 rounded-lg border border-white/10 bg-[#070F1F] px-2 text-white" />
            </label>
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

function Editor({ design, order, names, back, extraPrice }) {
  const { doc, edit, undo, redo, canUndo, canRedo, saveState, saveError, snapshot, saveNow } = useDesignDoc(design);
  const [showAuto, setShowAuto] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [currentId, setCurrentId] = useState(() => doc.pages[0]?.id);
  const [refreshing, setRefreshing] = useState(false);
  const [skipped, setSkipped] = useState([]);
  const [showRevisions, setShowRevisions] = useState(false);
  const [countOpen, setCountOpen] = useState(false);
  const [countValue, setCountValue] = useState(doc.pages.length);
  const [showSources, setShowSources] = useState(false);
  const [uploading, setUploading] = useState(null);
  const [enlarge, setEnlarge] = useState(null); // null | { adding: assetId|null }
  const [enlargements, setEnlargements] = useState(design.enlargements || []);
  const [products, setProducts] = useState([]);
  const [preparing, setPreparing] = useState(null);
  useEffect(() => {
    supabase.from("album_addons").select("id, name, price, category").in("category", ["canvas", "glass"]).eq("active", true).order("sort_order").then(({ data }) => setProducts(data || []));
  }, []);

  // ---- the couple (stage 4): edit switch, their submitted draft, their uploaded photos ----
  const [client, setClient] = useState({ enabled: !!design.client_edit_enabled, submittedAt: design.client_submitted_at, note: design.client_note, doc: null, uploads: [] });
  const loadClient = useCallback(async () => {
    const { data } = await supabase.from("album_designs").select("client_edit_enabled, client_submitted_at, client_note, client_doc, client_uploads, enlargements").eq("id", design.id).maybeSingle();
    if (data) {
      setClient({ enabled: data.client_edit_enabled, submittedAt: data.client_submitted_at, note: data.client_note, doc: data.client_doc, uploads: data.client_uploads || [] });
      setEnlargements(data.enlargements || []);
    }
  }, [design.id]);
  useEffect(() => {
    loadClient();
    const t = setInterval(loadClient, 60000);
    return () => clearInterval(t);
  }, [loadClient]);
  const [uploadUrls, setUploadUrls] = useState({});
  const uploadKeys = useMemo(() => doc.assets.filter((a) => a.source === "upload" && a.fileKey && !uploadUrls[a.id]), [doc.assets, uploadUrls]);
  useEffect(() => {
    if (!uploadKeys.length) return;
    supabase.storage.from("album-files").createSignedUrls(uploadKeys.map((a) => a.fileKey), 3600).then(({ data }) => {
      const m = {};
      uploadKeys.forEach((a, i) => { if (data?.[i]?.signedUrl) m[a.id] = data[i].signedUrl; });
      setUploadUrls((u) => ({ ...u, ...m }));
    });
  }, [uploadKeys]);
  const shownAssets = useMemo(() => doc.assets.map((a) => (a.source === "upload" ? { ...a, url: uploadUrls[a.id] } : a)), [doc.assets, uploadUrls]);
  const shownDoc = useMemo(() => ({ ...doc, assets: shownAssets }), [doc, shownAssets]);

  // ---- studio branding on the opening spread: logo + Instagram QR + phone (Settings → studio) ----
  const branding = useStudioBranding(order?.tenantId || design.tenant_id);

  const toggleClientEdit = async () => {
    const enabled = !client.enabled;
    const { error } = await supabase.from("album_designs").update({ client_edit_enabled: enabled }).eq("id", design.id);
    if (error) return toast.error("העדכון נכשל");
    setClient((c) => ({ ...c, enabled }));
    toast.success(enabled ? "הזוג יכול לערוך עכשיו מהקישור שלהם (בכפתור 'עריכת האלבום')" : "העריכה של הזוג נסגרה");
  };
  const acceptClient = async () => {
    if (!client.doc) return;
    if (!window.confirm("לקחת את הגרסה של הזוג לעורך? הגרסה הנוכחית שלך נשמרת בהיסטוריה (ואפשר ⌘Z).")) return;
    await snapshot("manual");
    const theirs = client.doc;
    edit(() => ({ ...theirs, cameraOffsets: doc.cameraOffsets, tags: doc.tags }));
    await supabase.from("album_designs").update({ client_submitted_at: null, client_note: null, client_doc: null }).eq("id", design.id);
    toast.success("הגרסה של הזוג נטענה. בדקו, תקנו אם צריך, ו'ייצוא לזוג' כשמוכן.");
    loadClient();
  };
  const returnToClient = async () => {
    await supabase.from("album_designs").update({ client_submitted_at: null }).eq("id", design.id);
    toast.success("הוחזר לזוג — הם יכולים להמשיך לערוך את הטיוטה שלהם");
    loadClient();
  };

  const page = doc.pages.find((p) => p.id === currentId) || doc.pages[0];
  const pageIndex = doc.pages.indexOf(page);
  const price = priceSummary(doc.pages.length, extraPrice);

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

  const downloadCurrent = async () => {
    setDownloading(true);
    try {
      await downloadSpreadFile(page, doc, `${String(pageIndex + 1).padStart(3, "0")}.jpg`, branding.data);
      toast.success("הכפולה ירדה בגודל מלא (9449×3543, 300dpi)");
    } catch (e) {
      toast.error(e?.message || "הורדת הכפולה נכשלה");
    }
    setDownloading(false);
  };

  // ---- extra photo sources (a second Drive folder / files from the computer → their own tab) ----
  const addDriveSource = async (name, folderId, assets) => {
    const known = new Set(doc.assets.map((a) => a.id));
    const added = assets.filter((a) => !known.has(a.id)).map((a) => ({ ...a, group: name }));
    edit((d) => ({ ...d, assets: [...d.assets, ...added] }));
    toast.success(`נוספו ${added.length} תמונות בלשונית "${name}"`);
  };
  const addFileSource = async (name, files) => {
    try {
      const assets = await uploadStudioFiles(files, { tenantId: order?.tenantId || design.tenant_id, orderId: design.album_order_id, group: name, onProgress: setUploading });
      edit((d) => ({ ...d, assets: [...d.assets, ...assets] }));
      toast.success(`הועלו ${assets.length} תמונות בלשונית "${name}"`);
    } catch (e) {
      toast.error(e.message);
    }
    setUploading(null);
  };

  // ---- photos for enlargement (canvas / glass) ----
  const saveEnlargements = async (next) => {
    const { error } = await supabase.from("album_designs").update({ enlargements: next }).eq("id", design.id);
    if (error) return toast.error("השמירה נכשלה");
    setEnlargements(next);
  };
  const addEnlargement = async ({ assetId, addonId, orientation, note }) => {
    const p = products.find((x) => x.id === addonId);
    await saveEnlargements([...enlargements, { id: `en_${Date.now().toString(36)}`, assetId, addonId, addonName: p?.name, addonPrice: Number(p?.price) || 0, category: p?.category, orientation, note, by: "studio", fileKey: null }].slice(0, 20));
    setEnlarge({ adding: null });
    toast.success("סומן להגדלה");
  };
  const prepareEnlargements = async () => {
    setPreparing("0");
    try {
      const byId = Object.fromEntries(doc.assets.map((a) => [a.id, a]));
      const next = await prepareEnlargementFiles(enlargements, byId, { tenantId: order?.tenantId || design.tenant_id, orderId: design.album_order_id, onProgress: setPreparing });
      await saveEnlargements(next);
      toast.success("קבצי ההגדלה מוכנים — מופיעים בקישור של בית הדפוס");
    } catch (e) {
      toast.error(e.message);
    }
    setPreparing(null);
  };

  const resetAll = async () => {
    const used = doc.pages.reduce((n, p) => n + p.slots.filter((s) => s.assetId).length, 0);
    if (!window.confirm(`לאפס את הסקיצה?\n\nכל ${used} התמונות יוצאו מהכפולות (נשארות בבנק), ${doc.pages.length} הכפולות יישארו ריקות. טקסט הפתיחה נשמר.\n\nאפשר לחזור אחורה עם ⌘Z (או "היסטוריה").`)) return;
    await snapshot("manual");
    edit((d) => resetSketch(d));
    setCurrentId(doc.pages[0]?.id);
    toast.success("הסקיצה אופסה — ⌘Z מחזיר אותה");
  };

  const saveVersion = async () => {
    const { error } = await snapshot("manual");
    error ? toast.error("שמירת הגרסה נכשלה") : toast.success("נשמרה גרסה — אפשר לחזור אליה מ'היסטוריה'");
  };

  const applyCount = () => {
    const { doc: next, blocked } = setPageCount(doc, Number(countValue) || doc.pages.length);
    edit(() => next);
    setCountOpen(false);
    if (blocked) toast.warning(`${blocked} כפולות עם תמונות לא נמחקו — מחקו אותן ידנית אם צריך`);
  };

  const savePreset = async () => {
    const name = window.prompt("שם לפריסט (סדר הפריסות של הסקיצה הזו, לשימוש באלבומים הבאים):", names.display ? `כמו ${names.display}` : "");
    if (!name) return;
    try {
      await savePresetToSettings(presetFromDoc(doc, name));
      toast.success(`הפריסט "${name}" נשמר — בוחרים אותו ב'סקיצה אוטומטית'`);
    } catch (e) {
      toast.error(e?.message || "שמירת הפריסט נכשלה");
    }
  };

  return (
    <Shell>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-white/10 bg-[#0B1529] px-4 py-2">
          {back}
          <div className="min-w-0">
            <div className="truncate font-semibold text-white">🎨 {names.display || "אלבום"} <span className="text-xs font-normal text-amber-300">בטא</span></div>
          </div>
          <SaveBadge state={saveState} error={saveError} />
          <div className="ms-auto flex items-center gap-1">
            <button type="button" onClick={undo} disabled={!canUndo} title="ביטול (⌘Z)" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
            <button type="button" onClick={redo} disabled={!canRedo} title="חזרה (⌘⇧Z)" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => setShowAuto(true)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-200 hover:bg-white/10"><Sparkles className="h-4 w-4" /> סקיצה אוטומטית</button>
            <button type="button" onClick={resetAll} title="מוציא את כל התמונות מהכפולות (עם אישור). ⌘Z מחזיר." className="rounded-md px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10">↺ איפוס סקיצה</button>
            <button type="button" onClick={savePreset} title="שומר את סדר הפריסות של הסקיצה הזו כתבנית לאלבומים הבאים" className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">⭐ שמור כפריסט</button>
            <button type="button" onClick={downloadCurrent} disabled={downloading} title="מוריד את הכפולה הזו בגודל הדפסה מלא — לבדיקת איכות" className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10 disabled:opacity-50">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} כפולה בגודל מלא
            </button>
            <button type="button" onClick={() => setEnlarge({ adding: null })} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">🖼️ הגדלות{enlargements.length ? ` (${enlargements.length})` : ""}</button>
            <button type="button" onClick={saveVersion} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">שמור גרסה</button>
            <button type="button" onClick={() => setShowRevisions(true)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10"><History className="h-4 w-4" /> היסטוריה</button>
          </div>
          <button
            type="button"
            onClick={toggleClientEdit}
            title="כשפתוח — הזוג רואה בקישור שלהם כפתור 'עריכת האלבום', עורך טיוטה משלו ושולח לך. הגרסה שלך לא משתנה עד שתאשר."
            className={`rounded-lg border px-2.5 py-1.5 text-xs ${client.enabled ? "border-emerald-400/60 bg-emerald-400/10 text-emerald-200" : "border-white/15 text-slate-300 hover:bg-white/10"}`}
          >
            {client.enabled ? "✓ הזוג יכול לערוך" : "לאפשר לזוג לערוך"}
          </button>
          <button type="button" onClick={() => setShowExport(true)} disabled={saveState === "conflict"} className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-gray-900 hover:bg-amber-500 disabled:opacity-40">
            <Send className="h-4 w-4" /> ייצוא לזוג
          </button>
          <div className="relative">
            <button type="button" onClick={() => { setCountValue(doc.pages.length); setCountOpen((v) => !v); }} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 hover:border-amber-400/50" title={`${price.included} כפולות כלולות במחיר האלבום · לחיצה = לשנות את מספר הכפולות`}>
              {price.pages} כפולות · {price.extra ? <span className="text-amber-300">{price.extra} נוספות · +₪{price.extraCost.toLocaleString()}</span> : <span className="text-emerald-300">בתוך ה-{price.included} הכלולות</span>}
            </button>
            {countOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-56 space-y-2 rounded-lg border border-white/10 bg-[#0B1529] p-3 text-xs shadow-xl">
                <div className="text-slate-300">כמה כפולות באלבום (כולל הפתיחה)?</div>
                <input type="number" min={1} max={80} value={countValue} onChange={(e) => setCountValue(e.target.value)} className="h-8 w-full rounded border border-white/10 bg-[#070F1F] px-2 text-white" />
                <div className="text-[10px] text-slate-500">מוסיף כפולות ריקות בסוף, או מוחק ריקות מהסוף. כפולות עם תמונות לא נמחקות.</div>
                <button type="button" onClick={applyCount} className="h-8 w-full rounded bg-amber-400 font-bold text-gray-900">החל</button>
              </div>
            )}
          </div>
        </div>

        {client.submittedAt && (
          <div className="flex flex-wrap items-center justify-between gap-3 bg-sky-500/15 px-4 py-2 text-sm text-sky-100">
            <span>💌 הזוג שלח שינויים בסקיצה ({new Date(client.submittedAt).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}){client.note ? ` — "${client.note}"` : ""}</span>
            <span className="flex gap-2">
              <button type="button" onClick={acceptClient} className="rounded-md bg-sky-500 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-600">לקחת את הגרסה שלהם לעורך</button>
              <button type="button" onClick={returnToClient} className="rounded-md border border-sky-300/40 px-3 py-1 text-xs hover:bg-white/10">להחזיר להם לעריכה</button>
            </span>
          </div>
        )}
        {saveState === "conflict" && (
          <div className="flex items-center justify-between gap-3 bg-rose-500/15 px-4 py-2 text-sm text-rose-100">
            <span>⚠️ הסקיצה נשמרה בינתיים ממקום אחר (לשונית או מחשב אחר). כדי לא לדרוס — השינויים כאן לא נשמרים. רעננו את הדף.</span>
            <button type="button" onClick={() => window.location.reload()} className="rounded-md bg-rose-500 px-3 py-1 text-xs font-semibold text-white">רענון</button>
          </div>
        )}

        <EditorWorkspace
          doc={shownDoc}
          edit={edit}
          undo={undo}
          redo={redo}
          currentId={currentId}
          setCurrentId={setCurrentId}
          studio
          branding={branding.data}
          brandingReady={branding.ready}
          onEnlarge={(assetId) => setEnlarge({ adding: assetId })}
          bankProps={{
            headerExtra: (
              <button type="button" onClick={() => setShowSources(true)} disabled={!!uploading} className="w-full rounded-lg border border-dashed border-sky-400/50 py-1.5 text-xs text-sky-200 hover:bg-sky-400/10 disabled:opacity-50">
                {uploading ? `מעלה ${uploading}…` : "+ מקור תמונות נוסף (Drive / מהמחשב)"}
              </button>
            ),
            onRefresh: refresh,
            refreshing,
            skipped,
            onCameraOffset: (cam, m) => edit((d) => ({ ...d, cameraOffsets: { ...d.cameraOffsets, [cam]: m } })),
          }}
        />
      </div>

      {showSources && <SourcesDialog onClose={() => setShowSources(false)} onDrive={addDriveSource} onFiles={addFileSource} />}
      {enlarge && (
        <EnlargementsDialog
          list={enlargements}
          products={products}
          assetsById={Object.fromEntries(shownAssets.map((a) => [a.id, a]))}
          adding={enlarge.adding}
          onAdd={addEnlargement}
          onRemove={(id) => saveEnlargements(enlargements.filter((e) => e.id !== id))}
          onPrepare={prepareEnlargements}
          preparing={preparing}
          onClose={() => setEnlarge(null)}
        />
      )}
      {showAuto && (
        <AutoSketchDialog
          doc={doc}
          onClose={() => setShowAuto(false)}
          onApply={async (pages) => {
            await snapshot("manual");
            edit((d) => ({ ...d, pages }));
            setShowAuto(false);
            setCurrentId(pages[0].id);
            toast.success(`נוצרה סקיצה של ${pages.length} כפולות — עכשיו מתקנים (⌘Z מבטל)`);
          }}
        />
      )}
      {showExport && (
        <ExportDialog
          design={design}
          doc={doc}
          orderId={design.album_order_id}
          tenantId={order?.tenantId || design.tenant_id}
          branding={branding.data}
          beforeExport={saveNow}
          onClose={() => setShowExport(false)}
        />
      )}
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
