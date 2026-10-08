import { useMemo, useState } from "react";
import { FlipHorizontal, Trash2, RotateCcw, Sparkles } from "lucide-react";
import { getTemplate, cellRects, layoutRects, textRect, PHOTO_COUNTS, templatesForCount, templateKind, TITLE_TEMPLATES } from "@/lib/albumTemplates";
import { FILTERS, TITLE_FONTS, hebrewDateText, formatDotDate, minZoom } from "@/lib/albumDesign";
import { ADJ_FIELDS, isNeutral } from "@/lib/albumAdjust";
import { rankTemplates } from "@/lib/albumAutoLayout";

function TemplateThumb({ template, flip, active, onClick, badge }) {
  const rects = cellRects(template, flip);
  const text = textRect(template, flip);
  return (
    <button
      type="button"
      onClick={onClick}
      title={template.uses ? `בשימוש ב-${template.uses} כפולות בסקיצות שלך` : ""}
      className={`relative w-full overflow-hidden rounded border-2 bg-white ${active ? "border-amber-400" : "border-transparent hover:border-sky-400/70"}`}
      style={{ aspectRatio: "80 / 30" }}
      dir="ltr"
    >
      {rects.map((r, i) => (
        <span key={i} className="absolute bg-slate-400" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
      ))}
      {text && (
        <span className="absolute flex items-center justify-center text-[8px] tracking-widest text-slate-500" style={{ left: `${text.x}%`, top: `${text.y}%`, width: `${text.w}%`, height: `${text.h}%` }}>
          A &amp; B
        </span>
      )}
      {badge && <span className="absolute right-0.5 top-0.5 rounded bg-emerald-500 px-1 text-[8px] font-bold text-white">{badge}</span>}
    </button>
  );
}

const COLORS = ["#3a3a3a", "#000000", "#8b7355", "#6b7b8c", "#ffffff"];
const KINDS = [
  { id: "all", label: "הכל" },
  { id: "landscape", label: "לרוחב" },
  { id: "portrait", label: "לאורך" },
  { id: "mixed", label: "משולב" },
];

const Slider = ({ label, value, min, max, step, onChange, fmt }) => (
  <label className="block text-[11px] text-slate-300">
    <span className="flex justify-between"><span>{label}</span><span className="tabular-nums text-slate-400">{fmt ? fmt(value) : value}</span></span>
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-amber-400" />
  </label>
);

export default function PagePanel({ page, selectedSlot, doc, assetsById, onTemplate, onFlip, onSlot, onClearSlot, onTitle, onPage, heal, setHeal, brandingReady, onEnlarge }) {
  const [kind, setKind] = useState("all");
  const [showAdj, setShowAdj] = useState(false);
  const t = getTemplate(page.templateId);
  const count = t.cells.length;
  const isTitle = Boolean(t.title);
  const slot = selectedSlot != null ? page.slots[selectedSlot] : null;
  const asset = slot?.assetId ? assetsById?.[slot.assetId] || doc.assets.find((a) => a.id === slot.assetId) : null;
  const rect = selectedSlot != null ? layoutRects(t, page.flip, page.blend)[selectedSlot] : null;
  const zMin = asset && rect ? minZoom(rect.w * 80, rect.h * 30, asset.w || 1, asset.h || 1) : 1;

  const photos = useMemo(() => page.slots.map((s) => s.assetId && (assetsById?.[s.assetId] || doc.assets.find((a) => a.id === s.assetId))).filter(Boolean), [page.slots, assetsById, doc.assets]);
  const recommended = useMemo(() => (!isTitle && photos.length >= 1 ? rankTemplates(photos).slice(0, 4) : []), [photos, isTitle]);
  const list = isTitle ? TITLE_TEMPLATES : templatesForCount(count).filter((tp) => kind === "all" || templateKind(tp) === kind);

  const pickCount = (n) => {
    const first = templatesForCount(n)[0];
    if (first) onTemplate(first.id);
  };
  const adj = slot?.adj || {};

  return (
    <div className="space-y-5 p-3 text-sm">
      {slot && (
        <section className="space-y-2 rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-amber-200">תמונה {selectedSlot + 1}</div>
            {asset && (
              <button type="button" onClick={onClearSlot} className="flex items-center gap-1 text-xs text-slate-300 hover:text-rose-300">
                <Trash2 className="h-3.5 w-3.5" /> הוצא מהכפולה
              </button>
            )}
          </div>
          {asset ? (
            <>
              <div className="truncate text-[11px] text-slate-400" dir="ltr">{asset.name}</div>
              {onEnlarge && (
                <button type="button" onClick={() => onEnlarge(asset.id)} className="w-full rounded-md border border-amber-400/40 py-1 text-xs text-amber-200 hover:bg-amber-400/10">🖼️ סמן להגדלה (קנבס / זכוכית)</button>
              )}
              <Slider label="גודל (זום)" value={slot.zoom || 1} min={Math.round(zMin * 100) / 100} max={4} step={0.01} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onSlot({ zoom: v })} />
              <div className="flex gap-1.5">
                <button type="button" onClick={() => onSlot({ zoom: zMin, cx: 0.5, cy: 0.5 })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-slate-300 hover:text-white">כל התמונה</button>
                <button type="button" onClick={() => onSlot({ zoom: 1, cx: 0.5, cy: 0.5 })} className="flex-1 rounded border border-white/10 py-1 text-[11px] text-slate-300 hover:text-white">מילוי המסגרת</button>
              </div>
              <div className="text-[11px] text-slate-500">גררו את התמונה בתוך המסגרת כדי להזיז · גלגלת = זום</div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" onClick={() => onSlot({ filter: f.id })} className={`rounded-md border px-2 py-1 text-xs ${(slot.filter || "none") === f.id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300 hover:text-white"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 text-xs">
                {[["rect", "מלבן"], ["ellipse", "אליפסה רכה"]].map(([id, label]) => (
                  <button key={id} type="button" onClick={() => onSlot({ shape: id })} className={`flex-1 rounded-md border py-1 ${(slot.shape || "rect") === id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300"}`}>{label}</button>
                ))}
              </div>
              <button type="button" onClick={() => setShowAdj((v) => !v)} className="w-full rounded-md border border-white/10 py-1.5 text-xs text-slate-200 hover:bg-white/5">
                🎚️ תיקוני צבע ואור {isNeutral(adj) ? "" : "•"} {showAdj ? "▴" : "▾"}
              </button>
              {showAdj && (
                <div className="space-y-1.5 rounded-md bg-black/20 p-2">
                  {ADJ_FIELDS.map((f) => (
                    <Slider key={f.key} label={f.label} value={adj[f.key] || 0} min={f.min} max={f.max} step={f.step} fmt={f.fmt} onChange={(v) => onSlot({ adj: { ...adj, [f.key]: v } })} />
                  ))}
                  <button type="button" onClick={() => onSlot({ adj: {} })} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"><RotateCcw className="h-3 w-3" /> איפוס</button>
                </div>
              )}
              <div className="space-y-1.5 rounded-md bg-black/20 p-2">
                <label className="flex items-center justify-between text-xs text-slate-200">
                  <span>🩹 מברשת תיקון</span>
                  <input type="checkbox" checked={!!heal?.on} onChange={(e) => setHeal((h) => ({ ...h, on: e.target.checked }))} />
                </label>
                {heal?.on && (
                  <>
                    <Slider label="גודל מברשת" value={heal.size || 4} min={1} max={20} step={0.5} onChange={(v) => setHeal((h) => ({ ...h, size: v }))} />
                    <div className="text-[10px] leading-snug text-slate-400">
                      Option/Alt+לחיצה = מאיפה להעתיק (רקע נקי). לחיצה = מוחק במקום. בלי בחירה — מעתיק מהצד.
                      {heal.offset ? " ✓ נבחרה נקודת מקור" : ""}
                    </div>
                  </>
                )}
                {slot.heal?.length ? (
                  <button type="button" onClick={() => onSlot({ heal: [] })} className="text-[11px] text-slate-400 hover:text-white">נקה {slot.heal.length} תיקונים</button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400">גררו תמונה מהבנק, או לחצו על תמונה בבנק כדי לשים אותה כאן.</div>
          )}
        </section>
      )}

      {isTitle && page.title && (
        <section className="space-y-2">
          <div className="font-semibold text-white">טקסט הפתיחה</div>
          <div className="flex gap-1.5 text-xs">
            {[["he", "עברית"], ["en", "English"]].map(([id, label]) => (
              <button key={id} type="button" onClick={() => onTitle({ lang: id })} className={`flex-1 rounded-md border py-1 ${(page.title.lang || "he") === id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300"}`}>{label}</button>
            ))}
          </div>
          <input value={page.title.names} onChange={(e) => onTitle({ names: e.target.value })} placeholder="דניאל & סבינה" className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" dir="rtl" />
          <input value={page.title.namesEn || ""} onChange={(e) => onTitle({ namesEn: e.target.value })} placeholder="Daniel & Sabina" className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" dir="ltr" />
          <input type="date" onChange={(e) => onTitle({ date: formatDotDate(e.target.value), hebrewDate: hebrewDateText(e.target.value) })} className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" title="בחירת תאריך ממלאת גם את התאריך העברי" />
          <input value={page.title.date} onChange={(e) => onTitle({ date: e.target.value })} placeholder="16.03.2025" className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" dir="ltr" />
          <div className="flex items-center gap-2">
            <input value={page.title.hebrewDate} onChange={(e) => onTitle({ hebrewDate: e.target.value })} placeholder="ט״ז באדר, תשפ״ה" className="h-9 flex-1 rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" />
            <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={page.title.showHebrew} onChange={(e) => onTitle({ showHebrew: e.target.checked })} /> להציג</label>
          </div>
          <select value={page.title.font} onChange={(e) => onTitle({ font: e.target.value })} className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white">
            <optgroup label="עברית (⭐ מומלץ)">{TITLE_FONTS.filter((f) => f.lang === "he").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>
            <optgroup label="English (⭐ recommended)">{TITLE_FONTS.filter((f) => f.lang === "en").map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</optgroup>
          </select>
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => onTitle({ color: c })} title={c} className={`h-6 w-6 rounded-full border-2 ${page.title.color === c ? "border-amber-400" : "border-white/20"}`} style={{ background: c }} />
            ))}
          </div>
          <Slider label="גודל הטקסט" value={page.title.scale || 1} min={0.4} max={3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onTitle({ scale: v })} />
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>גוררים את הטקסט על הכפולה כדי להזיז</span>
            <button type="button" onClick={() => onTitle({ dx: 0, dy: 0 })} className="text-slate-400 hover:text-white">מרכז</button>
          </div>
          <div className="space-y-1.5 rounded-md bg-black/20 p-2">
            <label className="flex items-center justify-between text-xs text-slate-200">
              <span>לוגו + QR אינסטגרם + טלפון</span>
              <input type="checkbox" checked={!!page.branding?.show} onChange={(e) => onPage({ branding: { x: 3, y: 72, scale: 1, ...page.branding, show: e.target.checked } })} />
            </label>
            {page.branding?.show && (
              <>
                {!brandingReady && <div className="text-[10px] text-amber-300">חסרים לוגו / טלפון / אינסטגרם — הגדרות ← פרטי הסטודיו.</div>}
                <Slider label="גודל" value={page.branding.scale || 1} min={0.5} max={3} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => onPage({ branding: { ...page.branding, scale: v } })} />
                <div className="text-[10px] text-slate-500">גוררים אותו על הכפולה למיקום הרצוי.</div>
              </>
            )}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-white">{isTitle ? "פריסת הפתיחה" : "כמה תמונות בכפולה"}</div>
          <button type="button" onClick={onFlip} className="flex items-center gap-1 text-xs text-slate-300 hover:text-white" title="היפוך ימין↔שמאל">
            <FlipHorizontal className="h-4 w-4" /> היפוך
          </button>
        </div>
        <div className="flex gap-1.5 text-xs">
          {[["none", "קו לבן"], ["fade", "מעבר רך בין תמונות"]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => onPage({ blend: id })} className={`flex-1 rounded-md border py-1 ${(page.blend || "none") === id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300"}`}>{label}</button>
          ))}
        </div>
        {!isTitle && (
          <>
            <div className="flex flex-wrap gap-1">
              {PHOTO_COUNTS.map((n) => (
                <button key={n} type="button" onClick={() => pickCount(n)} className={`h-7 w-7 rounded-md border text-xs ${n === count ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300 hover:text-white"}`}>
                  {n}
                </button>
              ))}
            </div>
            {recommended.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center gap-1 text-xs text-emerald-300"><Sparkles className="h-3.5 w-3.5" /> מתאים הכי טוב לתמונות שבכפולה</div>
                <div className="grid grid-cols-2 gap-2">
                  {recommended.map((r, i) => (
                    <TemplateThumb key={`${r.templateId}${r.flip}`} template={getTemplate(r.templateId)} flip={r.flip} active={r.templateId === page.templateId && r.flip === !!page.flip} badge={i === 0 ? "הכי טוב" : null} onClick={() => onTemplate(r.templateId, r.flip, r.assign)} />
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-1 text-[11px]">
              {KINDS.map((k) => (
                <button key={k.id} type="button" onClick={() => setKind(k.id)} className={`flex-1 rounded border py-0.5 ${kind === k.id ? "border-amber-400 text-amber-200" : "border-white/10 text-slate-400"}`}>{k.label}</button>
              ))}
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          {list.map((tp) => (
            <TemplateThumb key={tp.id} template={tp} flip={page.flip} active={tp.id === page.templateId} onClick={() => onTemplate(tp.id)} />
          ))}
        </div>
        {!list.length && <div className="text-[11px] text-slate-500">אין פריסה מהסוג הזה ל-{count} תמונות</div>}
        {!isTitle && <div className="text-[11px] text-slate-500">החלפת פריסה שומרת את התמונות שכבר בכפולה, לפי הסדר.</div>}
      </section>
    </div>
  );
}
