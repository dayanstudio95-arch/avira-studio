import { useEffect, useMemo, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { autoLayout, applyPreset } from "@/lib/albumAutoLayout";
import { loadPresets } from "@/lib/albumStudioSettings";
import { sortAssets, PAGE_BASELINE } from "@/lib/albumDesign";

// "✨ סקיצה אוטומטית" (stage 2). Rebuilds every spread from the photos in shooting order. The
// current sketch is snapshotted first (היסטוריה) and the whole thing is one ⌘Z away.
export default function AutoSketchDialog({ doc, onClose, onApply }) {
  const [spreads, setSpreads] = useState(PAGE_BASELINE);
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  useEffect(() => {
    loadPresets().then(setPresets);
  }, []);
  const preset = presets.find((p) => p.id === presetId) || null;
  const sorted = useMemo(() => sortAssets(doc.assets, doc.cameraOffsets), [doc.assets, doc.cameraOffsets]);
  const n = preset ? preset.pages.length : Math.max(1, Math.min(80, Number(spreads) || PAGE_BASELINE));
  const preview = useMemo(() => {
    const title = doc.pages.find((p) => p.title)?.title || null;
    return preset ? applyPreset(sorted, preset, { title }) : autoLayout(sorted, { spreads: n, title });
  }, [sorted, n, doc.pages, preset]);
  const avg = sorted.length / n;
  const hasWork = doc.pages.some((p) => p.slots.some((s) => s.assetId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-white"><Sparkles className="h-5 w-5 text-amber-300" /> סקיצה אוטומטית</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        <div className="text-sm text-slate-400">
          המערכת מסדרת את כל התמונות לפי שעת הצילום, מחלקת אותן לכפולות בקצב של הסקיצות שלך (כל כמה כפולות — כפולה עם תמונות גדולות),
          ובוחרת לכל כפולה את הפריסה שהכי מתאימה לצורת התמונות. אחר כך מתקנים ידנית.
        </div>
        {presets.length > 0 && (
          <label className="block text-sm">
            לפי
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-[#070F1F] px-2 text-white">
              <option value="">סידור אוטומטי (לפי צורת התמונות)</option>
              {presets.map((p) => <option key={p.id} value={p.id}>⭐ {p.name} ({p.pages.length} כפולות)</option>)}
            </select>
          </label>
        )}
        {!preset && <label className="block text-sm">
          כמה כפולות (כולל הפתיחה)
          <input type="number" min={2} max={80} value={spreads} onChange={(e) => setSpreads(e.target.value)} className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-[#070F1F] px-3 text-white" />
        </label>}
        <div className="rounded-lg bg-white/[0.04] p-3 text-sm">
          {sorted.length} תמונות ← {n} כפולות · בערך {avg.toFixed(1)} תמונות לכפולה
          {n > PAGE_BASELINE && <div className="mt-1 text-amber-300">{n - PAGE_BASELINE} כפולות מעבר ל-{PAGE_BASELINE} הכלולות</div>}
          {preview.unused > 0 && <div className="mt-1 text-amber-300">{preview.unused} תמונות לא ייכנסו {preset ? "(הפריסט קטן מכמות התמונות)" : "(מקסימום 10 בכפולה)"} — הן יישארו בבנק</div>}
        </div>
        {hasWork && <div className="text-xs text-amber-200">⚠️ הסקיצה הנוכחית תוחלף. היא נשמרת בהיסטוריה, ואפשר גם לבטל עם ⌘Z.</div>}
        <button type="button" onClick={() => onApply(preview.pages)} className="h-11 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500">
          צור סקיצה
        </button>
      </div>
    </div>
  );
}
