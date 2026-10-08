import { useEffect, useMemo, useState } from "react";
import { X, Sparkles } from "lucide-react";
import { autoLayout, applyPreset, OPENING_TEMPLATE } from "@/lib/albumAutoLayout";
import { getTemplate, cellRects, textRect } from "@/lib/albumTemplates";
import { loadPresets } from "@/lib/albumStudioSettings";
import { sortAssets, PAGE_BASELINE } from "@/lib/albumDesign";
import { assetSrc } from "@/lib/albumAssets";
import { PHOTO_TAGS } from "./PhotoBank";

// "✨ סקיצה אוטומטית" (2026-10-08, the owner's flow):
//   1. how many photos on the opening page (1–3);
//   2. pick those photos (usually the couple from the outdoor shoot — not the first of the day) and
//      how many pages → "צור סקיצה". The picked photos fill the opening and don't repeat later;
//      everything else is laid out in shooting order. The current sketch is snapshotted first
//      (היסטוריה) and the whole thing is one ⌘Z away.
export default function AutoSketchDialog({ doc, onClose, onApply }) {
  const [step, setStep] = useState(1);
  const [openingCount, setOpeningCount] = useState(2);
  const [picked, setPicked] = useState([]);
  const [tab, setTab] = useState("all");
  const [spreads, setSpreads] = useState(PAGE_BASELINE);
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  useEffect(() => {
    loadPresets().then(setPresets);
  }, []);
  const preset = presets.find((p) => p.id === presetId) || null;
  const sorted = useMemo(() => sortAssets(doc.assets, doc.cameraOffsets), [doc.assets, doc.cameraOffsets]);
  const n = preset ? preset.pages.length : Math.max(2, Math.min(80, Number(spreads) || PAGE_BASELINE));
  const title = doc.pages.find((p) => p.title)?.title || null;
  const tags = doc.tags || {};
  const tagTabs = PHOTO_TAGS.filter((t) => Object.values(tags).some((l) => (l || []).includes(t.id)));
  const shown = tab === "all" ? sorted : sorted.filter((a) => (tags[a.id] || []).includes(tab));

  const build = () => {
    if (preset) {
      const r = applyPreset(sorted.filter((a) => !picked.includes(a.id)), preset, { title });
      // the preset's opening gets the picked photos
      const first = r.pages[0];
      if (first?.title) first.slots = first.slots.map((s, i) => (picked[i] ? { ...s, assetId: picked[i] } : s));
      return r;
    }
    return autoLayout(sorted, { spreads: n, title, openingCount, openingIds: picked });
  };

  const toggle = (id) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= openingCount ? [...p.slice(1), id] : [...p, id]));

  const hasWork = doc.pages.some((p) => p.slots.some((s) => s.assetId));
  const avg = (sorted.length - picked.length) / Math.max(1, n - 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className={`max-h-[92vh] w-full space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200 ${step === 2 ? "max-w-4xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-white"><Sparkles className="h-5 w-5 text-amber-300" /> סקיצה אוטומטית</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {step === 1 ? (
          <>
            <div className="text-sm text-slate-400">
              <b className="text-white">שלב 1 מתוך 2 — דף הפתיחה.</b> כמה תמונות בדף הראשון? בשלב הבא בוחרים אותן (למשל הזוג מצילומי החוץ), והשאר מסודר לבד לפי סדר הצילום.
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3].map((k) => (
                <button key={k} type="button" onClick={() => { setOpeningCount(k); setPicked((p) => p.slice(0, k)); }} className={`space-y-1 rounded-lg border-2 p-2 text-xs ${openingCount === k ? "border-amber-400 bg-amber-400/10" : "border-white/10 hover:border-white/30"}`}>
                  <OpeningThumb templateId={OPENING_TEMPLATE[k]} />
                  <div>{k} {k === 1 ? "תמונה" : "תמונות"}</div>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setStep(2)} className="h-11 w-full rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500">המשך — בחירת התמונות</button>
          </>
        ) : (
          <>
            <div className="text-sm text-slate-400">
              <b className="text-white">שלב 2 מתוך 2 — בחרו {openingCount === 1 ? "תמונה אחת" : `${openingCount} תמונות`} לדף הפתיחה</b> (לחיצה = בחירה, המספר = הסדר).
              הן לא יופיעו שוב בהמשך האלבום.
            </div>
            {tagTabs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[{ id: "all", label: "הכל" }, ...tagTabs].map((t) => (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-md border px-2.5 py-1 text-xs ${tab === t.id ? "border-amber-400/80 bg-amber-400/10 text-amber-200" : "border-white/10 text-slate-300"}`}>{t.label}</button>
                ))}
              </div>
            )}
            <div className="grid max-h-[45vh] gap-1.5 overflow-y-auto rounded-lg bg-black/20 p-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))" }}>
              {shown.map((a) => {
                const k = picked.indexOf(a.id);
                return (
                  <button key={a.id} type="button" onClick={() => toggle(a.id)} title={a.name} className={`relative aspect-square overflow-hidden rounded ${k >= 0 ? "ring-4 ring-amber-400" : "hover:ring-2 hover:ring-white/40"}`}>
                    <img src={assetSrc(a, 300)} referrerPolicy="no-referrer" loading="lazy" alt="" className="h-full w-full object-cover" />
                    {k >= 0 && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-gray-900">{k + 1}</span>}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white/[0.04] p-3 text-sm">
              {presets.length > 0 && (
                <label className="min-w-[200px] flex-1">
                  לפי
                  <select value={presetId} onChange={(e) => setPresetId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#070F1F] px-2 text-white">
                    <option value="">סידור אוטומטי (לפי צורת התמונות)</option>
                    {presets.map((p) => <option key={p.id} value={p.id}>⭐ {p.name} ({p.pages.length} דפים)</option>)}
                  </select>
                </label>
              )}
              {!preset && (
                <label className="w-36">
                  כמה דפים (כולל הפתיחה)
                  <input type="number" min={2} max={80} value={spreads} onChange={(e) => setSpreads(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-white/10 bg-[#070F1F] px-2 text-white" />
                </label>
              )}
              <div className="flex-1 text-xs text-slate-400">
                {sorted.length} תמונות · {n} דפים · בערך {avg.toFixed(1)} תמונות לדף
                {n > PAGE_BASELINE && <div className="text-amber-300">{n - PAGE_BASELINE} דפים מעבר ל-{PAGE_BASELINE} הכלולים</div>}
              </div>
            </div>
            {hasWork && <div className="text-xs text-amber-200">⚠️ הסקיצה הנוכחית תוחלף. היא נשמרת בהיסטוריה, ואפשר גם לבטל עם ⌘Z.</div>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="h-11 rounded-lg border border-white/15 px-4 text-sm hover:bg-white/5">חזרה</button>
              <button
                type="button"
                disabled={picked.length !== openingCount}
                onClick={() => onApply(build().pages)}
                className="h-11 flex-1 rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500 disabled:opacity-40"
              >
                {picked.length === openingCount ? "צור סקיצה" : `בחרו עוד ${openingCount - picked.length} ${openingCount - picked.length === 1 ? "תמונה" : "תמונות"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function OpeningThumb({ templateId }) {
  const t = getTemplate(templateId);
  const text = textRect(t);
  return (
    <div className="relative w-full overflow-hidden rounded bg-white" style={{ aspectRatio: "80 / 30" }} dir="ltr">
      {cellRects(t).map((r, i) => (
        <span key={i} className="absolute bg-slate-400" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
      ))}
      {text && <span className="absolute flex items-center justify-center text-[7px] tracking-widest text-slate-500" style={{ left: `${text.x}%`, top: `${text.y}%`, width: `${text.w}%`, height: `${text.h}%` }}>A &amp; B</span>}
    </div>
  );
}
