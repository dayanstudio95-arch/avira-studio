import { useEffect, useMemo, useRef, useState } from "react";
import { X, Sparkles, ChevronUp, ChevronDown } from "lucide-react";
import { autoLayout, applyPreset, OPENING_TEMPLATE, autoLayoutByChapters } from "@/lib/albumAutoLayout";
import { chapterSections, planPages, shapeCounts, IMPORTANCE, DEFAULT_PER_PAGE } from "@/lib/albumChapters";
import { getTemplate, cellRects, textRect } from "@/lib/albumTemplates";
import { loadPresets } from "@/lib/albumStudioSettings";
import { sortAssets, PAGE_BASELINE } from "@/lib/albumDesign";
import { assetSrc } from "@/lib/albumAssets";

// "✨ סקיצה אוטומטית" (2026-10-08, the owner's flow):
//   1. how many photos on the opening page (1–3);
//   2. pick those photos (usually the couple from the outdoor shoot — not the first of the day) and
//      how many pages → "צור סקיצה". The picked photos fill the opening and don't repeat later;
//      everything else is laid out in shooting order. The current sketch is snapshotted first
//      (היסטוריה) and the whole thing is one ⌘Z away.
// byChapters (2026-11-05, "📑 סקיצה לפי פרקים" — replaced "סקיצה לפי תוויות"): a third step plans the pages of each
// chapter marked in the bank (albumChapters.planPages: count, shape, importance; 30 pages for 150 photos, extra pages
// with their price above that) — each chapter on its own pages, photos of two chapters never share a page.
export default function AutoSketchDialog({ doc, onClose, onApply, byChapters = false, chapters = [], perPage = DEFAULT_PER_PAGE, onImportance = null, extraPrice = 0 }) {
  const [step, setStep] = useState(1);
  const [openingCount, setOpeningCount] = useState(2);
  const [picked, setPicked] = useState([]);
  const [tab, setTab] = useState("all");
  const [spreads, setSpreads] = useState(PAGE_BASELINE);
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  // a fixed preview pane beside the grid (2026-10-08: a floating preview hid photos) — shows the
  // photo under the mouse, otherwise the last one picked
  const [hovered, setHovered] = useState(null);
  const hoverTimer = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hoverOn = (a) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(a), 120);
  };
  const hoverOff = () => clearTimeout(hoverTimer.current);
  useEffect(() => {
    loadPresets().then(setPresets);
  }, []);
  const preset = presets.find((p) => p.id === presetId) || null;
  const sorted = useMemo(() => sortAssets(doc.assets, doc.cameraOffsets), [doc.assets, doc.cameraOffsets]);
  const n = preset ? preset.pages.length : Math.max(2, Math.min(80, Number(spreads) || PAGE_BASELINE));
  const title = doc.pages.find((p) => p.title)?.title || null;
  const chapterOf = doc.chapterOf || {};
  // step 2: the opening photos can be looked for by chapter (usually in "צילומי חוץ")
  const chapterTabs = byChapters ? chapters.filter((c) => Object.values(chapterOf).includes(c.id)).map((c) => ({ id: c.id, label: c.label })) : [];
  const shown = tab === "all" ? sorted : sorted.filter((a) => chapterOf[a.id] === tab);
  const totalSteps = byChapters ? 3 : 2;

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
      <div className={`max-h-[92vh] w-full space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-[#0B1529] p-5 text-slate-200 ${step === 2 ? "max-w-7xl" : step === 3 ? "max-w-2xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-lg font-semibold text-white"><Sparkles className="h-5 w-5 text-amber-300" /> {byChapters ? "סקיצה לפי פרקים" : "סקיצה אוטומטית"}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {step === 1 ? (
          <>
            <div className="text-sm text-slate-400">
              <b className="text-white">שלב 1 מתוך {totalSteps} — דף הפתיחה.</b> כמה תמונות בדף הראשון? בשלב הבא בוחרים אותן (למשל הזוג מצילומי החוץ), והשאר מסודר לבד לפי סדר הצילום.
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
        ) : step === 3 ? (
          <ChapterPlanner
            sorted={sorted}
            chapterOf={chapterOf}
            chapters={chapters}
            perPage={perPage}
            picked={picked}
            title={title}
            openingCount={openingCount}
            extraPrice={extraPrice}
            hasWork={hasWork}
            onImportance={onImportance}
            onBack={() => setStep(2)}
            onApply={onApply}
          />
        ) : (
          <>
            <div className="text-sm text-slate-400">
              <b className="text-white">שלב 2 מתוך {totalSteps} — בחרו {openingCount === 1 ? "תמונה אחת" : `${openingCount} תמונות`} לדף הפתיחה</b> (לחיצה = בחירה, המספר = הסדר).
              הן לא יופיעו שוב בהמשך האלבום.
            </div>
            {chapterTabs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {[{ id: "all", label: "הכל" }, ...chapterTabs].map((t) => (
                  <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`rounded-md border px-2.5 py-1 text-xs ${tab === t.id ? "border-amber-400/80 bg-amber-400/10 text-amber-200" : "border-white/10 text-slate-300"}`}>{t.label}</button>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <div onMouseLeave={hoverOff} className="max-h-[52vh] min-w-0 flex-1 self-start overflow-y-auto rounded-lg bg-black/20 p-1.5">
                <div className="grid content-start gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))" }}>
                {shown.map((a) => {
                  const k = picked.indexOf(a.id);
                  return (
                    <button key={a.id} type="button" onClick={() => toggle(a.id)} onMouseEnter={() => hoverOn(a)} className={`relative aspect-square overflow-hidden rounded ${k >= 0 ? "ring-4 ring-amber-400" : hovered?.id === a.id ? "ring-2 ring-sky-400" : "hover:ring-2 hover:ring-white/40"}`}>
                      <img src={assetSrc(a, 300)} referrerPolicy="no-referrer" loading="lazy" alt="" className="h-full w-full object-cover" />
                      {k >= 0 && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-sm font-bold text-gray-900">{k + 1}</span>}
                    </button>
                  );
                })}
                </div>
              </div>
              <PreviewPane asset={hovered || sorted.find((a) => a.id === picked[picked.length - 1]) || null} pickedIndex={hovered ? picked.indexOf(hovered.id) : picked.length - 1} onToggle={toggle} />
            </div>
            {!byChapters && <div className="flex flex-wrap items-end gap-3 rounded-lg bg-white/[0.04] p-3 text-sm">
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
            </div>}
            {hasWork && !byChapters && <div className="text-xs text-amber-200">⚠️ הסקיצה הנוכחית תוחלף. היא נשמרת בהיסטוריה, ואפשר גם לבטל עם ⌘Z.</div>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setStep(1)} className="h-11 rounded-lg border border-white/15 px-4 text-sm hover:bg-white/5">חזרה</button>
              <button
                type="button"
                disabled={picked.length !== openingCount}
                onClick={() => (byChapters ? setStep(3) : onApply(build().pages))}
                className="h-11 flex-1 rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500 disabled:opacity-40"
              >
                {picked.length === openingCount ? (byChapters ? "המשך — כמה דפים לכל פרק" : "צור סקיצה") : `בחרו עוד ${openingCount - picked.length} ${openingCount - picked.length === 1 ? "תמונה" : "תמונות"}`}
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

// The big preview beside the grid: the photo under the mouse (or the last one picked).
function PreviewPane({ asset, pickedIndex, onToggle }) {
  return (
    <div className="flex h-[52vh] w-[42%] shrink-0 flex-col overflow-hidden rounded-lg bg-black/40">
      {asset ? (
        <>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            <img key={asset.id} src={assetSrc(asset, 1000)} referrerPolicy="no-referrer" alt="" className="max-h-full max-w-full rounded object-contain" />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-xs">
            <span className="truncate text-slate-400" dir="ltr">{asset.name}{asset.w ? ` · ${asset.w}×${asset.h}` : ""}</span>
            <button type="button" onClick={() => onToggle(asset.id)} className={`shrink-0 rounded-md px-3 py-1 font-semibold ${pickedIndex >= 0 ? "border border-white/20 text-slate-200" : "bg-amber-400 text-gray-900"}`}>
              {pickedIndex >= 0 ? `נבחרה (${pickedIndex + 1}) — הסר` : "בחר לפתיחה"}
            </button>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-slate-500">העבירו את העכבר על תמונה כדי לראות אותה כאן בגדול</div>
      )}
    </div>
  );
}

const IMPORTANCE_LOOK = {
  high: "border-emerald-400/50 bg-emerald-400/15 text-emerald-100",
  mid: "border-sky-400/50 bg-sky-400/15 text-sky-100",
  low: "border-white/15 bg-white/[0.04] text-slate-300",
};

// Step 3 of "סקיצה לפי פרקים": the chapters in shooting order (↑ ↓ to change), each with its photos, shapes,
// importance and pages. Importance is the studio's (saved for the next albums too); − / + fixes one chapter's pages
// for this album and the others even out. Over 150 photos → extra pages, with the price; "לדחוס ל-30" undoes that.
function ChapterPlanner({ sorted, chapterOf, chapters, perPage, picked, title, openingCount, extraPrice, hasWork, onImportance, onBack, onApply }) {
  const all = useMemo(() => chapterSections(sorted, chapterOf, chapters, { skip: picked }), [sorted, chapterOf, chapters, picked]);
  const [order, setOrder] = useState(() => all.map((x) => x.id ?? "_loose"));
  const [includeLoose, setIncludeLoose] = useState(true);
  const [looseImportance, setLooseImportance] = useState("low");
  const [overrides, setOverrides] = useState({}); // sectionKey → pages
  const [squeeze, setSqueeze] = useState(false);
  const keyOf = (x) => x.id ?? "_loose";
  const byKey = Object.fromEntries(all.map((x) => [keyOf(x), x]));
  const listed = [...order.filter((k) => byKey[k]), ...all.map(keyOf).filter((k) => !order.includes(k))].map((k) => byKey[k]);
  const sections = listed.filter((x) => x.id || includeLoose).map((x) => (x.id ? x : { ...x, importance: looseImportance }));
  const plan = planPages(sections, {
    perPage,
    openingPhotos: picked.length,
    squeeze,
    overrides: Object.fromEntries(sections.map((x, i) => [i, overrides[keyOf(x)]]).filter(([, v]) => v != null)),
  });
  const pagesOf = (x) => plan.pages[sections.indexOf(x)] ?? 0;
  const move = (i, d) =>
    setOrder(() => {
      const keys = listed.map(keyOf);
      const j = i + d;
      if (j < 0 || j >= keys.length) return keys;
      [keys[i], keys[j]] = [keys[j], keys[i]];
      return keys;
    });
  const bump = (x, d) => setOverrides((o) => ({ ...o, [keyOf(x)]: Math.max(1, pagesOf(x) + d) }));
  const setImportance = (x, imp) => {
    setOverrides((o) => ({ ...o, [keyOf(x)]: undefined }));
    if (!x.id) setLooseImportance(imp);
    else onImportance?.(x.id, imp);
  };
  const build = () =>
    onApply(autoLayoutByChapters(sorted, { title, openingCount, openingIds: picked, sections: sections.map((x) => ({ label: x.label, photos: x.photos })), pages: plan.pages }).pages);

  return (
    <>
      <div className="text-sm text-slate-400">
        <b className="text-white">שלב 3 מתוך 3 — כמה דפים לכל פרק.</b> לפי כמות התמונות, הצורה שלהן והחשיבות (גבוהה = פחות תמונות בדף). החשיבות נשמרת גם לאלבומים הבאים. − / + = תיקון לאלבום הזה, והפרקים האחרים מתאזנים.
      </div>
      <div className="divide-y divide-white/5 rounded-lg bg-white/[0.03]" data-testid="chapter-planner">
        {listed.map((x, i) => {
          const on = x.id || includeLoose;
          const { portrait, landscape } = shapeCounts(x.photos);
          const imp = x.id ? x.importance : looseImportance;
          const n = pagesOf(x);
          return (
            <div key={keyOf(x)} className={`flex items-center gap-2 px-2 py-2 text-sm ${on ? "" : "opacity-40"}`} data-testid="planner-row">
              <span className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded hover:bg-white/10 disabled:opacity-20"><ChevronUp className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === listed.length - 1} className="rounded hover:bg-white/10 disabled:opacity-20"><ChevronDown className="h-3.5 w-3.5" /></button>
              </span>
              <span className="w-28 shrink-0">
                {x.id ? (
                  <span className="font-semibold text-white">{x.label}</span>
                ) : (
                  <label className="flex items-center gap-1.5 text-slate-300">
                    <input type="checkbox" checked={includeLoose} onChange={(e) => setIncludeLoose(e.target.checked)} /> בלי פרק
                  </label>
                )}
                <span className="block text-[11px] text-slate-400">{x.photos.length} · {portrait} לאורך · {landscape} לרוחב</span>
              </span>
              <span className="flex flex-1 justify-center gap-1">
                {IMPORTANCE.map((m) => (
                  <button key={m.id} type="button" disabled={!on} onClick={() => setImportance(x, m.id)} className={`rounded-md border px-2 py-0.5 text-xs ${imp === m.id ? IMPORTANCE_LOOK[m.id] : "border-white/10 text-slate-500 hover:text-slate-200"}`}>
                    {m.label}
                  </button>
                ))}
              </span>
              <span className="w-32 shrink-0 text-left">
                <span className="flex items-center justify-end gap-1.5">
                  <button type="button" disabled={!on || n <= 1} onClick={() => bump(x, -1)} className="h-6 w-6 rounded border border-white/15 hover:bg-white/10 disabled:opacity-30" aria-label="פחות דפים">−</button>
                  <b className="w-6 text-center text-white" data-testid="planner-pages">{on ? n : 0}</b>
                  <button type="button" disabled={!on} onClick={() => bump(x, 1)} className="h-6 w-6 rounded border border-white/15 hover:bg-white/10 disabled:opacity-30" aria-label="יותר דפים">+</button>
                </span>
                <span className="block text-[10px] text-slate-500">
                  {on && n ? `כ-${Math.round((x.photos.length / n) * 10) / 10} בדף` : ""}
                  {overrides[keyOf(x)] != null && (
                    <button type="button" onClick={() => setOverrides((o) => ({ ...o, [keyOf(x)]: undefined }))} className="mr-1 text-amber-300 hover:underline">ידני ↺</button>
                  )}
                </span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1 text-sm" data-testid="planner-total">
        <div>
          פתיח ({picked.length} תמונות) + {plan.total - 1} דפים = <b className="text-white">{plan.total} דפים</b> · {plan.photos} תמונות ·{" "}
          {plan.extra > 0 ? (
            <span className="text-amber-300">{plan.extra === 1 ? "דף נוסף אחד" : `${plan.extra} דפים נוספים`}{extraPrice ? ` · +₪${(plan.extra * extraPrice).toLocaleString()}` : ""}</span>
          ) : (
            <span className="text-emerald-300">בתוך ה-{PAGE_BASELINE} הכלולים</span>
          )}
        </div>
        {(plan.extra > 0 || squeeze) && (
          <button type="button" onClick={() => setSqueeze((v) => !v)} className="text-xs text-sky-300 hover:underline">
            {squeeze ? "לבטל את הדחיסה (דפים נוספים לפי כמות התמונות)" : `לדחוס ל-${PAGE_BASELINE} דפים, בלי תוספת`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1" dir="rtl">
        <span className="flex h-6 w-9 items-center justify-center rounded border border-amber-400/60 text-[9px] text-amber-200">פתיח</span>
        {sections.map((x) =>
          Array.from({ length: pagesOf(x) }, (_, j) => (
            <span key={`${keyOf(x)}-${j}`} className={`flex h-6 w-9 items-center justify-center truncate rounded border text-[9px] ${IMPORTANCE_LOOK[x.importance]}`}>{j === 0 ? x.label.split(" ")[0] : ""}</span>
          ))
        )}
      </div>
      {hasWork && <div className="text-xs text-amber-200">⚠️ הסקיצה הנוכחית תוחלף. היא נשמרת בהיסטוריה, ואפשר גם לבטל עם ⌘Z.</div>}
      <div className="flex gap-2">
        <button type="button" onClick={onBack} className="h-11 rounded-lg border border-white/15 px-4 text-sm hover:bg-white/5">חזרה</button>
        <button type="button" onClick={build} disabled={!sections.length} className="h-11 flex-1 rounded-lg bg-amber-400 font-bold text-gray-900 hover:bg-amber-500 disabled:opacity-40" data-testid="planner-build">
          צור סקיצה לפי הפרקים ({plan.total} דפים)
        </button>
      </div>
    </>
  );
}
