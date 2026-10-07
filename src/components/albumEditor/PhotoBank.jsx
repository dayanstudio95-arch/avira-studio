import { useMemo, useState } from "react";
import { RefreshCw, Loader2, Clock } from "lucide-react";
import { sortAssets } from "@/lib/albumDesign";
import { thumbUrl } from "@/lib/googleDrive";
import { ASSET_MIME } from "./SpreadView";

const FILTERS = [
  { key: "all", label: "הכל" },
  { key: "unused", label: "לא בשימוש" },
  { key: "used", label: "בשימוש" },
];

// The couple's photos from Drive, in album order (shooting time + per-camera offset).
// Drag a photo onto a cell, or click it to fill the selected cell.
export default function PhotoBank({ doc, usage, onPick, onRefresh, refreshing, onCameraOffset, skipped = [] }) {
  const [filter, setFilter] = useState("all");
  const [showCameras, setShowCameras] = useState(false);
  const sorted = useMemo(() => sortAssets(doc.assets, doc.cameraOffsets), [doc.assets, doc.cameraOffsets]);
  const shown = sorted.filter((a) => (filter === "unused" ? !usage[a.id] : filter === "used" ? usage[a.id] : true));
  const usedCount = doc.assets.filter((a) => usage[a.id]).length;
  const cameras = useMemo(() => {
    const m = {};
    for (const a of doc.assets) m[a.camera] = (m[a.camera] || 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [doc.assets]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-white">בנק תמונות</div>
          <button type="button" onClick={onRefresh} disabled={refreshing} title="טעינה מחדש מהתיקייה ב-Drive (תמונות חדשות נוספות)" className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-50">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
        <div className="text-xs text-slate-400">
          {doc.assets.length} תמונות · {usedCount} בשימוש · {doc.assets.length - usedCount} לא בשימוש
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-md border px-2.5 py-1 text-xs ${filter === f.key ? "border-amber-400/80 bg-amber-400/10 text-amber-200" : "border-white/10 text-slate-300 hover:text-white"}`}
            >
              {f.label}
            </button>
          ))}
          {cameras.length > 1 && (
            <button type="button" onClick={() => setShowCameras((v) => !v)} className="flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-slate-300 hover:text-white">
              <Clock className="h-3.5 w-3.5" /> שעון מצלמות
            </button>
          )}
        </div>
        {showCameras && (
          <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-slate-300">
            <div className="text-slate-400">התמונות מסודרות לפי שעת הצילום. אם השעון של מצלמה לא היה מכוון — תקנו אותו כאן:</div>
            {cameras.map(([cam, n]) => (
              <div key={cam} className="flex items-center justify-between gap-2">
                <span dir="ltr" className="truncate">{cam} ({n})</span>
                <select
                  value={doc.cameraOffsets?.[cam] || 0}
                  onChange={(e) => onCameraOffset(cam, Number(e.target.value))}
                  className="h-7 rounded border border-white/10 bg-[#0B1529] px-1 text-xs text-white"
                >
                  {[-180, -120, -90, -60, -30, -15, 0, 15, 30, 60, 90, 120, 180].map((m) => (
                    <option key={m} value={m}>{m === 0 ? "בלי תיקון" : `${m > 0 ? "+" : "−"}${Math.abs(m) >= 60 ? `${Math.abs(m) / 60} שע׳` : `${Math.abs(m)} דק׳`}`}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {skipped.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
            {skipped.length} קבצים לא נטענו (רק JPG/PNG): {skipped.slice(0, 3).map((s) => s.name).join(", ")}{skipped.length > 3 ? "…" : ""}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="grid grid-cols-3 gap-1.5">
          {shown.map((a) => (
            <button
              key={a.id}
              type="button"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(ASSET_MIME, a.id);
                e.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onPick(a.id)}
              title={a.name}
              className="group relative aspect-square overflow-hidden rounded bg-white/5"
            >
              <img src={thumbUrl(a.id, 300)} referrerPolicy="no-referrer" loading="lazy" alt="" draggable={false} className="h-full w-full object-cover" />
              {usage[a.id] ? (
                <span className="absolute left-1 top-1 rounded bg-emerald-500 px-1 text-[10px] font-bold text-white">×{usage[a.id]}</span>
              ) : null}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 text-[9px] text-white opacity-0 group-hover:opacity-100" dir="ltr">{a.name}</span>
            </button>
          ))}
        </div>
        {!shown.length && <div className="py-10 text-center text-xs text-slate-500">אין תמונות בסינון הזה</div>}
      </div>
    </div>
  );
}
