import { useRef, useState } from "react";
import { X, Loader2, FolderOpen, Upload } from "lucide-react";
import { parseFolderId, listFolderImages } from "@/lib/googleDrive";

// "+ מקור תמונות" (2026-10-08): more photos from another place, shown as their own tab in the
// bank under a name (e.g. "מגנטים"). Two ways:
//  - a Google Drive folder link (shared "anyone with the link");
//  - files or a whole folder from the computer — for Pixieset / WeTransfer / Jumbo / MyAirBridge
//    and the like (they have no way to pull photos directly: download there, upload here).
export default function SourcesDialog({ onClose, onDrive, onFiles }) {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const filesRef = useRef(null);
  const dirRef = useRef(null);

  const addDrive = async () => {
    setError("");
    const folderId = parseFolderId(link);
    if (!name.trim()) return setError("צריך שם ללשונית (למשל: מגנטים)");
    if (!folderId) return setError("זה לא נראה כמו קישור לתיקייה ב-Google Drive");
    setBusy(true);
    try {
      const { assets } = await listFolderImages(folderId);
      await onDrive(name.trim(), folderId, assets);
      onClose();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const pickFiles = (ref) => {
    if (!name.trim()) return setError("צריך שם ללשונית (למשל: מגנטים)");
    ref.current?.click();
  };
  const gotFiles = async (e) => {
    const files = Array.from(e.target.files || []).filter((f) => /\.(jpe?g|png)$/i.test(f.name) || /^image\/(jpeg|png)$/.test(f.type));
    e.target.value = "";
    if (!files.length) return setError("לא נמצאו קבצי JPG / PNG");
    onClose();
    await onFiles(name.trim(), files);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-white">+ מקור תמונות נוסף</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <label className="block text-sm">
          שם הלשונית
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={30} placeholder="למשל: מגנטים" className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-[#070F1F] px-3 text-white" />
        </label>
        <div className="space-y-2 rounded-lg border border-white/10 p-3">
          <div className="text-sm font-medium text-white">קישור לתיקייה ב-Google Drive</div>
          <div className="flex gap-2">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" dir="ltr" className="h-10 flex-1 rounded-lg border border-white/10 bg-[#070F1F] px-3 text-sm text-white" />
            <button type="button" onClick={addDrive} disabled={busy || !link.trim()} className="flex h-10 items-center gap-1.5 rounded-lg bg-sky-500 px-3 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />} הוסף
            </button>
          </div>
          <div className="text-[11px] text-slate-500">התיקייה צריכה להיות משותפת ב"כל מי שיש לו את הקישור".</div>
        </div>
        <div className="space-y-2 rounded-lg border border-white/10 p-3">
          <div className="text-sm font-medium text-white">מהמחשב</div>
          <div className="text-[11px] text-slate-500">ל-Pixieset, WeTransfer, ג׳מבו מייל, MyAirBridge וכו׳ — מורידים משם, ומעלים כאן קבצים או תיקייה שלמה (JPG / PNG).</div>
          <div className="flex gap-2">
            <input ref={filesRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={gotFiles} />
            <input ref={dirRef} type="file" webkitdirectory="" multiple className="hidden" onChange={gotFiles} />
            <button type="button" onClick={() => pickFiles(filesRef)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-xs hover:bg-white/5"><Upload className="h-4 w-4" /> קבצים</button>
            <button type="button" onClick={() => pickFiles(dirRef)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/15 py-2 text-xs hover:bg-white/5"><FolderOpen className="h-4 w-4" /> תיקייה שלמה</button>
          </div>
        </div>
        {error && <div className="rounded-lg bg-rose-500/15 p-2 text-sm text-rose-200">{error}</div>}
      </div>
    </div>
  );
}
