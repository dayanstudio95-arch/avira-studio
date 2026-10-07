import { FlipHorizontal, Trash2 } from "lucide-react";
import { getTemplate, cellRects, textRect, PHOTO_COUNTS, templatesForCount } from "@/lib/albumTemplates";
import { FILTERS, TITLE_FONTS, hebrewDateText, formatDotDate } from "@/lib/albumDesign";

function TemplateThumb({ template, flip, active, onClick }) {
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
    </button>
  );
}

const COLORS = ["#3a3a3a", "#000000", "#8b7355", "#6b7b8c", "#ffffff"];

export default function PagePanel({ page, selectedSlot, doc, onTemplate, onFlip, onSlot, onClearSlot, onTitle }) {
  const t = getTemplate(page.templateId);
  const count = t.cells.length;
  const isTitle = Boolean(t.title);
  const list = templatesForCount(count, { title: isTitle });
  const slot = selectedSlot != null ? page.slots[selectedSlot] : null;
  const asset = slot?.assetId ? doc.assets.find((a) => a.id === slot.assetId) : null;

  const pickCount = (n) => {
    const first = templatesForCount(n)[0];
    if (first) onTemplate(first.id);
  };

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
              <label className="block text-xs text-slate-300">
                זום ({Math.round((slot.zoom || 1) * 100)}%)
                <input type="range" min={1} max={4} step={0.05} value={slot.zoom || 1} onChange={(e) => onSlot({ zoom: Number(e.target.value) })} className="mt-1 w-full accent-amber-400" />
              </label>
              <div className="text-[11px] text-slate-500">גררו את התמונה בתוך המסגרת כדי להזיז · גלגלת = זום</div>
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onSlot({ filter: f.id })}
                    className={`rounded-md border px-2 py-1 text-xs ${(slot.filter || "none") === f.id ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300 hover:text-white"}`}
                  >
                    {f.label}
                  </button>
                ))}
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
          <input value={page.title.names} onChange={(e) => onTitle({ names: e.target.value })} placeholder="Talya & Avinoam" className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" dir="auto" />
          <div className="flex gap-2">
            <input
              type="date"
              onChange={(e) => onTitle({ date: formatDotDate(e.target.value), hebrewDate: hebrewDateText(e.target.value) })}
              className="h-9 flex-1 rounded-md border border-white/10 bg-[#0B1529] px-2 text-white"
              title="בחירת תאריך ממלאת גם את התאריך העברי"
            />
          </div>
          <input value={page.title.date} onChange={(e) => onTitle({ date: e.target.value })} placeholder="16.03.2025" className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" dir="ltr" />
          <div className="flex items-center gap-2">
            <input value={page.title.hebrewDate} onChange={(e) => onTitle({ hebrewDate: e.target.value })} placeholder="ט״ז באדר, תשפ״ה" className="h-9 flex-1 rounded-md border border-white/10 bg-[#0B1529] px-2 text-white" />
            <label className="flex items-center gap-1 text-xs text-slate-300">
              <input type="checkbox" checked={page.title.showHebrew} onChange={(e) => onTitle({ showHebrew: e.target.checked })} /> להציג
            </label>
          </div>
          <select value={page.title.font} onChange={(e) => onTitle({ font: e.target.value })} className="h-9 w-full rounded-md border border-white/10 bg-[#0B1529] px-2 text-white">
            {TITLE_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => onTitle({ color: c })} title={c} className={`h-6 w-6 rounded-full border-2 ${page.title.color === c ? "border-amber-400" : "border-white/20"}`} style={{ background: c }} />
            ))}
            <label className="ms-auto text-xs text-slate-300">
              גודל
              <input type="range" min={0.6} max={1.6} step={0.05} value={page.title.scale || 1} onChange={(e) => onTitle({ scale: Number(e.target.value) })} className="w-24 accent-amber-400" />
            </label>
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
        {!isTitle && (
          <div className="flex flex-wrap gap-1">
            {PHOTO_COUNTS.map((n) => (
              <button key={n} type="button" onClick={() => pickCount(n)} className={`h-7 w-7 rounded-md border text-xs ${n === count ? "border-amber-400 bg-amber-400/15 text-amber-100" : "border-white/10 text-slate-300 hover:text-white"}`}>
                {n}
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {list.map((tp) => (
            <TemplateThumb key={tp.id} template={tp} flip={page.flip} active={tp.id === page.templateId} onClick={() => onTemplate(tp.id)} />
          ))}
        </div>
        {!isTitle && <div className="text-[11px] text-slate-500">החלפת פריסה שומרת את התמונות שכבר בכפולה, לפי הסדר.</div>}
      </section>
    </div>
  );
}
