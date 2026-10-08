import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Loader2, Undo2, Redo2, Check, CloudOff, Upload, Send, Monitor } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { priceSummary, FONT_HREF } from "@/lib/albumDesign";
import { brandingFor } from "@/lib/albumStudioSettings";
import { uploadQualityWarnings } from "@/lib/albumAssets";
import { useDesignDoc } from "./useDesignDoc";
import EditorWorkspace from "./EditorWorkspace";
import SourcesDialog from "./SourcesDialog";
import EnlargementsDialog from "./EnlargementsDialog";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// The couple edits their album from the portal link (stage 4, 2026-10-08). Same editor pieces as
// the studio's, minus the studio-only tools (Drive folder, camera clocks, export, history).
// Everything goes through the album-portal function with their portal token — they never get a
// database session — and it's a DRAFT: the studio's version is untouched until the studio takes
// theirs. "שליחה לסטודיו" locks the draft and notifies the studio.


const portal = (token, action, extra = {}) => base44.functions.invoke("albumPortal", { token, action, ...extra }).then((r) => r.data);

export default function CoupleEditor({ token, onClose }) {
  const [state, setState] = useState(null); // getDesign response
  const [error, setError] = useState("");
  const wide = typeof window !== "undefined" && window.innerWidth >= 1024;

  useEffect(() => {
    if (!document.querySelector("link[data-album-fonts]")) {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = FONT_HREF;
      l.dataset.albumFonts = "1";
      document.head.appendChild(l);
    }
    portal(token, "getDesign").then(setState).catch((e) => setError(e.message));
  }, [token]);

  const shell = (children) => (
    <div className="fixed inset-0 z-[60] flex bg-[#070F1F] text-slate-200" dir="rtl">{children}</div>
  );
  if (!wide) {
    return shell(
      <div className="m-auto max-w-sm space-y-3 p-6 text-center">
        <Monitor className="mx-auto h-10 w-10 text-amber-300" />
        <div className="text-lg font-semibold text-white">העריכה עובדת במחשב</div>
        <div className="text-sm text-slate-400">פתחו את הקישור הזה במחשב (רצוי בדפדפן Chrome) כדי לערוך את האלבום.</div>
        <button type="button" onClick={onClose} className="text-sm text-amber-300 underline">חזרה</button>
      </div>
    );
  }
  if (error) return shell(<div className="m-auto space-y-3 text-center"><div className="text-rose-300">{error}</div><button type="button" onClick={onClose} className="text-sm underline">חזרה</button></div>);
  if (!state) return shell(<Loader2 className="m-auto h-8 w-8 animate-spin text-amber-300" />);
  if (!state.enabled) return shell(<div className="m-auto space-y-3 text-center"><div>העריכה לא פתוחה כרגע.</div><button type="button" onClick={onClose} className="text-sm underline">חזרה</button></div>);
  return <Editor token={token} initial={state} onClose={onClose} />;
}

function Editor({ token, initial, onClose }) {
  const persist = useCallback(
    async (doc, version) => {
      try {
        const r = await portal(token, "saveClientDoc", { doc: { pages: doc.pages }, version });
        return { version: r.version };
      } catch (e) {
        return /conflict/.test(e.message) ? { conflict: true } : { error: e.message };
      }
    },
    [token]
  );
  const fakeDesign = useMemo(() => ({ doc: initial.doc }), [initial.doc]);
  const { doc, edit, undo, redo, canUndo, canRedo, saveState, saveError, saveNow } = useDesignDoc(fakeDesign, { persist, initialVersion: initial.docVersion });
  const [urls, setUrls] = useState(initial.uploadUrls || {});
  const [submitted, setSubmitted] = useState(initial.submittedAt);
  const [currentId, setCurrentId] = useState(() => doc.pages[0]?.id);
  const [uploading, setUploading] = useState(null);
  const [showSend, setShowSend] = useState(false);
  const [note, setNote] = useState("");
  const [branding, setBranding] = useState(null);
  const [showSources, setShowSources] = useState(false);
  const [enlarge, setEnlarge] = useState(null);
  const [enlargements, setEnlargements] = useState(initial.enlargements || []);
  const fileRef = useRef(null);
  const locked = Boolean(submitted);

  useEffect(() => {
    if (initial.branding) brandingFor(initial.branding).then(setBranding);
  }, [initial.branding]);

  const shownAssets = useMemo(() => doc.assets.map((a) => (a.source === "upload" ? { ...a, url: urls[a.id] } : a)), [doc.assets, urls]);
  const shownDoc = useMemo(() => ({ ...doc, assets: shownAssets }), [doc, shownAssets]);
  const price = priceSummary(doc.pages.length, initial.extraPagePrice);

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    return uploadFiles(files, null);
  };
  const uploadFiles = async (files, group) => {
    for (const [n, file] of files.entries()) {
      setUploading(`${n + 1}/${files.length}`);
      try {
        let width = 0;
        let height = 0;
        try {
          const bmp = await createImageBitmap(file);
          width = bmp.width;
          height = bmp.height;
          bmp.close();
        } catch {
          /* unreadable → the type warning below covers it */
        }
        const warnings = uploadQualityWarnings({ name: file.name, type: file.type, size: file.size, width, height });
        if (warnings.some((w) => w.code === "type")) {
          toast.error(`${file.name}: אפשר להעלות רק JPG או PNG`);
          continue;
        }
        if (warnings.length && !await confirmDialog(`${file.name}\n\n${warnings.map((w) => "• " + w.text).join("\n")}\n\nלהעלות בכל זאת?`)) continue;
        const { path, token: upToken } = await portal(token, "createClientPhotoUploadUrl", { fileName: file.name });
        const { error } = await supabase.storage.from("album-files").uploadToSignedUrl(path, upToken, file);
        if (error) throw error;
        const { asset } = await portal(token, "confirmClientPhotoUpload", { path, name: file.name, w: width, h: height, warnings: warnings.map((w) => w.code), group });
        setUrls((u) => ({ ...u, [asset.id]: asset.url }));
        edit((d) => ({ ...d, assets: [...d.assets, { ...asset, url: undefined }] }));
      } catch (err) {
        toast.error(`${file.name}: ${err.message || "ההעלאה נכשלה"}`);
      }
    }
    setUploading(null);
  };

  const addDriveSource = async (name, folderId, assets) => {
    const r = await portal(token, "addClientSource", { source: { name, folderId, assets } });
    const known = new Set(doc.assets.map((a) => a.id));
    edit((d) => ({ ...d, assets: [...d.assets, ...r.assets.filter((a) => !known.has(a.id))] }));
    toast.success(`נוספו ${r.source.count} תמונות בלשונית "${name}"`);
  };
  const saveEnlargements = async (next) => {
    try {
      const r = await portal(token, "setEnlargements", { enlargements: next });
      setEnlargements(r.enlargements);
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    }
  };
  const addEnlargement = async ({ assetId, addonId, orientation, note }) => {
    if (await saveEnlargements([...enlargements, { assetId, addonId, orientation, note, by: "couple" }])) {
      setEnlarge({ adding: null });
      toast.success("סומן להגדלה ⭐");
    }
  };

  const send = async () => {
    try {
      await saveNow();
      const r = await portal(token, "submitClientEdits", { note });
      setSubmitted(r.submittedAt);
      setShowSend(false);
      toast.success("השינויים נשלחו לסטודיו 💌");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const badge =
    saveState === "saving" || saveState === "dirty" ? <span className="flex items-center gap-1 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> שומר…</span>
    : saveState === "error" ? <span className="flex items-center gap-1 text-xs text-rose-300" title={saveError}><CloudOff className="h-3.5 w-3.5" /> השמירה נכשלה</span>
    : saveState === "conflict" ? <span className="text-xs text-rose-300">נפתח במקום אחר — רעננו</span>
    : <span className="flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" /> נשמר</span>;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#070F1F] text-slate-200" dir="rtl">
      <div className="flex items-center gap-4 border-b border-white/10 bg-[#0B1529] px-4 py-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"><ArrowRight className="h-4 w-4" /> חזרה</button>
        <div className="font-semibold text-white">✏️ עריכת האלבום</div>
        {!locked && badge}
        <div className="ms-auto flex items-center gap-1">
          <button type="button" onClick={undo} disabled={!canUndo || locked} title="ביטול (⌘Z)" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={!canRedo || locked} title="חזרה" className="rounded p-1.5 text-slate-300 hover:bg-white/10 disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1 text-xs">
          {price.pages} כפולות · {price.extra ? <span className="text-amber-300">{price.extra} נוספות · +₪{price.extraCost.toLocaleString()}</span> : <span className="text-emerald-300">בתוך ה-{price.included} הכלולות</span>}
        </div>
        <button type="button" onClick={() => setEnlarge({ adding: null })} className="rounded-md px-2 py-1 text-xs text-slate-300 hover:bg-white/10">🖼️ להגדלה{enlargements.length ? ` (${enlargements.length})` : ""}</button>
        {!locked && (
          <button type="button" onClick={() => setShowSend(true)} className="flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-bold text-gray-900 hover:bg-amber-500"><Send className="h-4 w-4" /> שליחה לסטודיו</button>
        )}
      </div>
      {locked && (
        <div className="bg-emerald-500/15 px-4 py-2 text-sm text-emerald-100">💌 השינויים נשלחו לסטודיו — נעבור עליהם ונחזור אליכם עם גרסה מעודכנת. בינתיים העריכה נעולה.</div>
      )}

      <EditorWorkspace
        doc={shownDoc}
        edit={edit}
        undo={undo}
        redo={redo}
        locked={locked}
        currentId={currentId}
        setCurrentId={setCurrentId}
        branding={branding}
        brandingReady={Boolean(branding)}
        onEnlarge={(assetId) => setEnlarge({ adding: assetId })}
        bankProps={{
          headerExtra: !locked && (
            <>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={onFiles} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={!!uploading} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-400/50 py-2 text-xs text-amber-200 hover:bg-amber-400/10 disabled:opacity-50">
                {uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> מעלה {uploading}…</> : <><Upload className="h-4 w-4" /> להעלות תמונה משלכם</>}
              </button>
              <button type="button" onClick={() => setShowSources(true)} className="w-full rounded-lg border border-dashed border-sky-400/50 py-1.5 text-xs text-sky-200 hover:bg-sky-400/10">+ קישור / תיקייה נוספת (למשל מגנטים)</button>
            </>
          ),
        }}
      />

      {showSources && <SourcesDialog onClose={() => setShowSources(false)} onDrive={addDriveSource} onFiles={(name, files) => uploadFiles(files, name)} />}
      {enlarge && (
        <EnlargementsDialog
          list={enlargements}
          products={initial.enlargementProducts || []}
          assetsById={Object.fromEntries(shownAssets.map((a) => [a.id, a]))}
          adding={enlarge.adding}
          onAdd={addEnlargement}
          onRemove={(id) => saveEnlargements(enlargements.filter((e) => e.id !== id))}
          onClose={() => setEnlarge(null)}
        />
      )}
      {showSend && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setShowSend(false)}>
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-white/10 bg-[#0B1529] p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-lg font-semibold text-white">לשלוח את השינויים לסטודיו?</div>
            <div className="text-sm text-slate-400">הסטודיו יעבור על השינויים ויחזור אליכם עם גרסה מעודכנת. אחרי השליחה העריכה ננעלת עד שהסטודיו יחזיר אותה.</div>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="הערה לסטודיו (לא חובה)" className="w-full rounded-lg border border-white/10 bg-[#070F1F] p-2 text-sm text-white" />
            <button type="button" onClick={send} className="h-10 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500">שליחה</button>
          </div>
        </div>
      )}
    </div>
  );
}
