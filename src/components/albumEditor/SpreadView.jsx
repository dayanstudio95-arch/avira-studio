import { useRef, useState } from "react";
import { getTemplate, cellRects, textRect } from "@/lib/albumTemplates";
import { computeCrop, centerFromOffset, filterCss, titleFont, effectiveDpi } from "@/lib/albumDesign";
import { assetSrc } from "@/lib/albumAssets";

const ASSET_MIME = "application/x-avira-asset";
const SLOT_MIME = "application/x-avira-slot";
export { ASSET_MIME, SLOT_MIME };

// One spread (80×30). Geometry is in percent of the spread, fonts in cqw (percent of the spread's
// width), so the same page renders identically as a big editable spread and as a strip thumbnail.
// Images are positioned with computeCrop() — the same formula the full-size export uses.
export default function SpreadView({
  page,
  assetsById,
  mini = false,
  selectedSlot = null, // index
  onSelectSlot,
  onDropAsset, // (index, assetId)
  onDropSlot, // (index, { pageId, index })
  onCropChange, // (index, { cx, cy, zoom }) — committed on release
}) {
  const t = getTemplate(page.templateId);
  const rects = cellRects(t, page.flip);
  const text = textRect(t, page.flip);
  return (
    <div
      className="relative w-full bg-white select-none"
      style={{ aspectRatio: "80 / 30", containerType: "inline-size" }}
      dir="ltr"
    >
      {rects.map((r, i) => (
        <Cell
          key={i}
          index={i}
          rect={r}
          slot={page.slots[i] || {}}
          asset={assetsById[page.slots[i]?.assetId]}
          pageId={page.id}
          mini={mini}
          selected={selectedSlot === i}
          onSelect={onSelectSlot}
          onDropAsset={onDropAsset}
          onDropSlot={onDropSlot}
          onCropChange={onCropChange}
        />
      ))}
      {text && page.title && <TitleText rect={text} title={page.title} />}
      {/* the fold */}
      {!mini && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-black/10" />}
    </div>
  );
}

function TitleText({ rect, title }) {
  const f = titleFont(title.font);
  const scale = title.scale || 1;
  const hebrewFamily = /heebo|frank|assistant/.test(title.font) ? f.family : "'Heebo', sans-serif";
  return (
    <div
      className="absolute flex flex-col items-center justify-center text-center"
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, color: title.color || "#3a3a3a" }}
    >
      {title.names && (
        <div style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: `${1.9 * scale}cqw`, letterSpacing: "0.22em", lineHeight: 1.2 }} dir="auto">
          {title.names}
        </div>
      )}
      {title.date && (
        <div style={{ fontFamily: f.family, fontWeight: f.weight, fontSize: `${1.15 * scale}cqw`, letterSpacing: "0.12em", marginTop: "1.1cqw" }}>{title.date}</div>
      )}
      {title.showHebrew && title.hebrewDate && (
        <div style={{ fontFamily: hebrewFamily, fontWeight: 300, fontSize: `${0.95 * scale}cqw`, marginTop: "0.45cqw" }} dir="rtl">
          {title.hebrewDate}
        </div>
      )}
    </div>
  );
}

function Cell({ index, rect, slot, asset, pageId, mini, selected, onSelect, onDropAsset, onDropSlot, onCropChange }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  const [live, setLive] = useState(null); // crop while dragging / wheeling, committed on release
  const wheelTimer = useRef(null);
  const crop = { zoom: slot.zoom, cx: slot.cx, cy: slot.cy, ...live };

  let img = null;
  if (asset) {
    // Percent units: the cell is 100×(100·h/w·…) — use the cell's real aspect so cover math is right.
    const cw = rect.w * 80;
    const ch = rect.h * 30;
    const c = computeCrop(cw, ch, asset.w || 1, asset.h || 1, crop);
    const style = {
      width: `${(c.drawW / cw) * 100}%`,
      height: `${(c.drawH / ch) * 100}%`,
      left: `${(c.offX / cw) * 100}%`,
      top: `${(c.offY / ch) * 100}%`,
      filter: filterCss(slot.filter),
    };
    // The bank's small thumbnail (already cached) shows at once; the sharp one loads on top.
    img = (
      <>
        <img src={assetSrc(asset, mini ? 240 : 300)} referrerPolicy="no-referrer" draggable={false} alt="" loading={mini ? "lazy" : "eager"} className="absolute max-w-none" style={style} />
        {!mini && asset.source !== "upload" && <img src={assetSrc(asset, 1400)} referrerPolicy="no-referrer" draggable={false} alt="" className="absolute max-w-none" style={style} />}
      </>
    );
  }

  const lowDpi = !mini && asset ? effectiveDpi(asset, rect, crop.zoom) : null;

  const handlers = mini
    ? {}
    : {
        onClick: () => onSelect?.(index),
        draggable: Boolean(asset) && !selected,
        onDragStart: (e) => {
          e.dataTransfer.setData(SLOT_MIME, JSON.stringify({ pageId, index }));
          e.dataTransfer.effectAllowed = "move";
        },
        onDragOver: (e) => {
          if (e.dataTransfer.types.includes(ASSET_MIME) || e.dataTransfer.types.includes(SLOT_MIME)) {
            e.preventDefault();
            setOver(true);
          }
        },
        onDragLeave: () => setOver(false),
        onDrop: (e) => {
          e.preventDefault();
          setOver(false);
          const assetId = e.dataTransfer.getData(ASSET_MIME);
          if (assetId) return onDropAsset?.(index, assetId);
          const from = e.dataTransfer.getData(SLOT_MIME);
          if (from) {
            const src = JSON.parse(from);
            if (src.pageId !== pageId || src.index !== index) onDropSlot?.(index, src);
          }
        },
        // Pan: drag the photo inside the selected cell.
        onPointerDown: (e) => {
          if (!selected || !asset || e.button !== 0) return;
          e.preventDefault();
          const box = ref.current.getBoundingClientRect();
          const start = { x: e.clientX, y: e.clientY };
          const c0 = computeCrop(box.width, box.height, asset.w, asset.h, crop);
          let last = null;
          const move = (ev) => {
            const offX = c0.offX + (ev.clientX - start.x);
            const offY = c0.offY + (ev.clientY - start.y);
            const { cx, cy } = centerFromOffset(box.width, box.height, c0.drawW, c0.drawH, offX, offY);
            // run through computeCrop so the stored centre is already clamped
            const clamped = computeCrop(box.width, box.height, asset.w, asset.h, { zoom: crop.zoom, cx, cy });
            last = centerFromOffset(box.width, box.height, clamped.drawW, clamped.drawH, clamped.offX, clamped.offY);
            setLive({ zoom: crop.zoom, ...last });
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (last) onCropChange?.(index, { zoom: crop.zoom, ...last });
            setLive(null);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        },
        onWheel: (e) => {
          if (!selected || !asset) return;
          const zoom = Math.min(4, Math.max(1, (crop.zoom || 1) * (1 - e.deltaY * 0.0015)));
          setLive({ zoom, cx: crop.cx, cy: crop.cy });
          clearTimeout(wheelTimer.current);
          wheelTimer.current = setTimeout(() => {
            onCropChange?.(index, { zoom, cx: crop.cx, cy: crop.cy });
            setLive(null);
          }, 350);
        },
      };

  return (
    <div
      ref={ref}
      className={`group/cell absolute overflow-hidden ${asset ? "bg-gray-200" : "bg-gray-100"} ${mini ? "" : selected ? "cursor-move" : "cursor-pointer"}`}
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }}
      {...handlers}
    >
      {img}
      {!asset && !mini && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400">גררו תמונה לכאן</div>
      )}
      {/* frame on top of the photo (an outline on the cell itself is painted under it) */}
      {!mini && (
        <div
          className={`pointer-events-none absolute inset-0 ${
            over ? "ring-[3px] ring-inset ring-emerald-400" : selected ? "ring-[3px] ring-inset ring-amber-400" : "group-hover/cell:ring-2 group-hover/cell:ring-inset group-hover/cell:ring-sky-400/70"
          }`}
        />
      )}
      {lowDpi != null && lowDpi < 200 && (
        <div className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black" title="התמונה קטנה מדי לגודל הזה בהדפסה">
          ⚠️ {lowDpi}dpi
        </div>
      )}
    </div>
  );
}
