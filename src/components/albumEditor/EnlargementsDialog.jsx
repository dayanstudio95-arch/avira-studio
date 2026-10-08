import { useState } from "react";
import { X, Trash2, Loader2 } from "lucide-react";
import { assetSrc } from "@/lib/albumAssets";

// "🖼️ תמונות להגדלה" (2026-10-08): photos the couple (or the studio) want printed big — canvas or
// glass, from the album add-ons catalog — with portrait/landscape. `adding` = mark a new one.
// The studio can then prepare the files; the print-shop link offers them as a separate download.
export default function EnlargementsDialog({ list, products, assetsById, adding = null, onAdd, onRemove, onClose, onPrepare, preparing = null }) {
  const asset = adding ? assetsById[adding] : null;
  const [addonId, setAddonId] = useState(products[0]?.id || "");
  const [orientation, setOrientation] = useState(asset && asset.w > asset.h ? "landscape" : "portrait");
  const [note, setNote] = useState("");
  const label = (c) => (c === "glass" ? "זכוכית" : "קנבס");

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-white">🖼️ תמונות להגדלה</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {asset && (
          <div className="space-y-3 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
            <div className="flex gap-3">
              <img src={assetSrc(asset, 300)} referrerPolicy="no-referrer" alt="" className="h-20 w-20 rounded object-cover" />
              <div className="flex-1 space-y-2 text-sm">
                {products.length ? (
                  <select value={addonId} onChange={(e) => setAddonId(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-[#070F1F] px-2 text-white">
                    {products.map((p) => <option key={p.id} value={p.id}>{label(p.category)} · {p.name}{Number(p.price) ? ` · ₪${Number(p.price).toLocaleString()}` : ""}</option>)}
                  </select>
                ) : (
                  <div className="text-xs text-amber-300">אין בקטלוג מוצרי קנבס / זכוכית פעילים.</div>
                )}
                <div className="flex gap-2 text-xs">
                  {[["portrait", "עומדת"], ["landscape", "שוכבת"]].map(([id, l]) => (
                    <button key={id} type="button" onClick={() => setOrientation(id)} className={`flex-1 rounded-md border py-1 ${orientation === id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10"}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="הערה (גודל, מיקום בבית…) — לא חובה" className="h-9 w-full rounded-md border border-white/10 bg-[#070F1F] px-2 text-sm text-white" />
            <button type="button" disabled={!addonId} onClick={() => onAdd({ assetId: asset.id, addonId, orientation, note })} className="h-9 w-full rounded-md bg-amber-400 text-sm font-bold text-gray-900 disabled:opacity-40">סמן להגדלה</button>
          </div>
        )}

        {list.length ? (
          <div className="space-y-2">
            {list.map((e) => {
              const a = assetsById[e.assetId];
              return (
                <div key={e.id} className="flex items-center gap-3 rounded-lg bg-white/[0.04] p-2 text-sm">
                  {a ? <img src={assetSrc(a, 200)} referrerPolicy="no-referrer" alt="" className="h-12 w-12 rounded object-cover" /> : <div className="h-12 w-12 rounded bg-white/10" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{label(e.category)} · {e.addonName} · {e.orientation === "landscape" ? "שוכבת" : "עומדת"}</div>
                    <div className="truncate text-[11px] text-slate-400">{e.by === "studio" ? "סומן בסטודיו" : "סומן ע״י הזוג"}{e.note ? ` · ${e.note}` : ""}{e.fileKey ? " · ✓ קובץ מוכן לבית הדפוס" : ""}</div>
                  </div>
                  {onRemove && <button type="button" onClick={() => onRemove(e.id)} title="הסר" className="text-slate-400 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>}
                </div>
              );
            })}
          </div>
        ) : (
          !asset && <div className="py-6 text-center text-sm text-slate-400">עוד לא סומנו תמונות. לחצו על תמונה בכפולה ← "סמן להגדלה".</div>
        )}

        {onPrepare && list.length > 0 && (
          <button type="button" onClick={onPrepare} disabled={!!preparing} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-sky-500 text-sm font-semibold text-white disabled:opacity-50">
            {preparing ? <><Loader2 className="h-4 w-4 animate-spin" /> מכין {preparing}…</> : "הכן קבצים לבית הדפוס (יופיעו בקישור של בית הדפוס)"}
          </button>
        )}
      </div>
    </div>
  );
}
