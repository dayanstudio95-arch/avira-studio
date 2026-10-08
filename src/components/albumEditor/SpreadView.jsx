import { useEffect, useRef, useState } from "react";
import { getTemplate, layoutRects, textRect, cellAspect } from "@/lib/albumTemplates";
import { computeCrop, centerFromOffset, filterCss, effectiveDpi, titleNames, minZoom, titleLineFonts } from "@/lib/albumDesign";
import { assetSrc } from "@/lib/albumAssets";
import { slotFilter, docFilters } from "@/lib/albumAdjust";
import { applyHealPatches } from "@/lib/albumHeal";

export const ASSET_MIME = "application/x-avira-asset";
export const SLOT_MIME = "application/x-avira-slot";
export const GROUP_MIME = "application/x-avira-group";

// What is being dragged from the bank right now — dragover can't read dataTransfer contents, and
// the cell needs the photo's shape to turn red on a portrait-into-landscape mismatch.
let dragAssets = null;
export const setDragAssets = (list) => {
  dragAssets = list;
};

// The adjustment looks of the whole document as SVG filters (screen + export use them).
export function AdjustmentDefs({ doc }) {
  const html = docFilters(doc).join("");
  return (
    <svg width="0" height="0" style={{ position: "absolute", width: 0, height: 0 }} aria-hidden="true">
      <defs dangerouslySetInnerHTML={{ __html: html }} />
    </svg>
  );
}

// photo shape vs cell shape → "bad" when a portrait photo would land in a clearly landscape cell
// (or the other way round): most of the photo would be cut off.
function shapeMismatch(asset, rect) {
  if (!asset?.w || !asset?.h) return false;
  const pa = asset.w / asset.h;
  const ca = cellAspect(rect);
  return (pa < 0.9 && ca > 1.25) || (pa > 1.15 && ca < 0.8);
}

// One spread (80×30). Geometry is in percent of the spread, fonts in cqw (percent of the spread's
// width), so the same page renders identically as a big editable spread and as a strip thumbnail.
// Images are positioned with computeCrop() — the same formula the full-size export uses.
export default function SpreadView({
  page,
  assetsById,
  mini = false,
  selectedSlot = null,
  onSelectSlot,
  onDropAsset,
  onDropSlot,
  onDropGroup,
  onCropChange,
  onTitleChange,
  branding = null,
  onBrandingChange,
  heal = null, // { on, size, offset } — clone brush
  onHeal,
  onHealSource,
  faceWarnings = {},
}) {
  const t = getTemplate(page.templateId);
  const rects = layoutRects(t, page.flip, page.blend, page.fadeStrength ?? 100);
  const text = textRect(t, page.flip);
  const boxRef = useRef(null);
  return (
    <div ref={boxRef} className="relative w-full overflow-hidden bg-white select-none" style={{ aspectRatio: "80 / 30", containerType: "inline-size" }} dir="ltr">
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
          onDropGroup={onDropGroup}
          onCropChange={onCropChange}
          heal={selectedSlot === i ? heal : null}
          onHeal={onHeal}
          onHealSource={onHealSource}
          faceWarning={faceWarnings[i]}
        />
      ))}
      {text && page.title && <TitleText rect={text} title={page.title} spreadRef={boxRef} onChange={mini ? null : onTitleChange} />}
      {page.title && page.branding?.show && branding && (
        <BrandingBlock data={branding} conf={page.branding} spreadRef={boxRef} onChange={mini ? null : onBrandingChange} />
      )}
      {/* the fold */}
      {!mini && <div className="pointer-events-none absolute inset-y-0 left-1/2 z-30 w-px bg-black/15" />}
    </div>
  );
}

// Drag something positioned in % of the spread; commits once, on release.
function useSpreadDrag(spreadRef, pos, onCommit) {
  const [live, setLive] = useState(null);
  const down = (e) => {
    if (!onCommit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const box = spreadRef.current.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let last = null;
    const move = (ev) => {
      last = { x: pos.x + ((ev.clientX - start.x) / box.width) * 100, y: pos.y + ((ev.clientY - start.y) / box.height) * 100 };
      setLive(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (last) onCommit(last);
      setLive(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return [live || pos, down];
}

function TitleText({ rect, title, spreadRef, onChange }) {
  const fonts = titleLineFonts(title);
  const scale = title.scale || 1;
  const [pos, down] = useSpreadDrag(spreadRef, { x: title.dx || 0, y: title.dy || 0 }, onChange && ((p) => onChange({ dx: Math.round(p.x * 10) / 10, dy: Math.round(p.y * 10) / 10 })));
  const names = titleNames(title);
  return (
    <div
      onPointerDown={down}
      title={onChange ? "גררו כדי להזיז את הטקסט" : undefined}
      className={`absolute z-20 flex flex-col items-center justify-center text-center ${onChange ? "cursor-move hover:outline hover:outline-1 hover:outline-dashed hover:outline-sky-400/70" : ""}`}
      style={{ left: `${rect.x + pos.x}%`, top: `${rect.y + pos.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, color: title.color || "#3a3a3a" }}
    >
      {names && (
        <div style={{ fontFamily: fonts.names.family, fontWeight: fonts.names.weight, fontSize: `${1.9 * scale}cqw`, letterSpacing: "0.22em", lineHeight: 1.2 }} dir="auto">
          {names}
        </div>
      )}
      {title.date && <div style={{ fontFamily: fonts.date.family, fontWeight: fonts.date.weight, fontSize: `${1.15 * scale}cqw`, letterSpacing: "0.12em", marginTop: "1.1cqw" }}>{title.date}</div>}
      {title.showHebrew && title.hebrewDate && (
        <div style={{ fontFamily: fonts.hebrew.family, fontWeight: fonts.hebrew.weight, fontSize: `${0.95 * scale}cqw`, marginTop: "0.45cqw" }} dir="rtl">
          {title.hebrewDate}
        </div>
      )}
    </div>
  );
}

// Studio logo + Instagram QR + phone, small, on the opening spread (2026-10-08). Same sizes in
// cqw as the export (albumRender.drawBranding).
export function brandingSizes(scale = 1) {
  return { logoH: 2.2 * scale, qr: 3.2 * scale, phone: 0.65 * scale, gap: 0.45 * scale };
}

function BrandingBlock({ data, conf, spreadRef, onChange }) {
  const s = brandingSizes(conf.scale || 1);
  const [pos, down] = useSpreadDrag(spreadRef, { x: conf.x ?? 3, y: conf.y ?? 72 }, onChange && ((p) => onChange({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })));
  return (
    <div
      onPointerDown={down}
      className={`absolute z-20 flex flex-col items-center ${onChange ? "cursor-move hover:outline hover:outline-1 hover:outline-dashed hover:outline-sky-400/70" : ""}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, gap: `${s.gap}cqw` }}
    >
      {data.logoUrl && <img src={data.logoUrl} alt="" draggable={false} style={{ height: `${s.logoH}cqw`, width: "auto" }} />}
      {data.qrDataUrl && <img src={data.qrDataUrl} alt="" draggable={false} style={{ height: `${s.qr}cqw`, width: `${s.qr}cqw` }} />}
      {data.phone && <div style={{ fontFamily: "'Bellefair', serif", fontSize: `${s.phone}cqw`, color: "#555", letterSpacing: "0.08em" }} dir="ltr">{data.phone}</div>}
    </div>
  );
}

// Thumbnail + heal strokes, drawn on a canvas (only for photos that have strokes).
const thumbCache = new Map();
async function loadThumb(url) {
  if (!thumbCache.has(url)) {
    thumbCache.set(
      url,
      fetch(url, { referrerPolicy: "no-referrer" })
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
    );
  }
  return thumbCache.get(url);
}

function HealedImage({ asset, heal, style }) {
  const ref = useRef(null);
  useEffect(() => {
    let alive = true;
    loadThumb(assetSrc(asset, 1400)).then((bmp) => {
      if (!alive || !ref.current) return;
      const c = ref.current;
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      applyHealPatches(ctx, bmp.width, bmp.height, heal);
    });
    return () => {
      alive = false;
    };
  }, [asset, heal]);
  return <canvas ref={ref} className="absolute max-w-none" style={style} />;
}

function cellMasks(rect, slot) {
  const m = [];
  if (rect.fadeL) m.push(`linear-gradient(to right, transparent 0%, #000 ${rect.fadeL}%)`);
  if (rect.fadeT) m.push(`linear-gradient(to bottom, transparent 0%, #000 ${rect.fadeT}%)`);
  if (slot.shape === "ellipse") m.push("radial-gradient(ellipse 50% 50% at 50% 50%, #000 86%, transparent 100%)");
  if (!m.length) return {};
  const img = m.join(", ");
  return { maskImage: img, WebkitMaskImage: img, maskComposite: "intersect", WebkitMaskComposite: "source-in" };
}

function Cell({ index, rect, slot, asset, pageId, mini, selected, onSelect, onDropAsset, onDropSlot, onDropGroup, onCropChange, heal, onHeal, onHealSource, faceWarning }) {
  const ref = useRef(null);
  const [over, setOver] = useState(null); // null | "good" | "bad"
  const [live, setLive] = useState(null); // crop while dragging / wheeling, committed on release
  const wheelTimer = useRef(null);
  const crop = { zoom: slot.zoom, cx: slot.cx, cy: slot.cy, ...live };
  const healing = !mini && selected && heal?.on && asset;

  let img = null;
  if (asset) {
    // Percent units: the cell's real shape (cm) so the cover maths match the export.
    const cw = rect.w * 80;
    const ch = rect.h * 30;
    const c = computeCrop(cw, ch, asset.w || 1, asset.h || 1, crop);
    const style = {
      width: `${(c.drawW / cw) * 100}%`,
      height: `${(c.drawH / ch) * 100}%`,
      left: `${(c.offX / cw) * 100}%`,
      top: `${(c.offY / ch) * 100}%`,
      filter: slotFilter(slot, filterCss(slot.filter)),
    };
    img = slot.heal?.length ? (
      <HealedImage asset={asset} heal={slot.heal} style={style} />
    ) : (
      // The bank's small thumbnail (already cached) shows at once; the sharp one loads on top.
      <>
        <img src={assetSrc(asset, mini ? 240 : 300)} referrerPolicy="no-referrer" draggable={false} alt="" loading={mini ? "lazy" : "eager"} className="absolute max-w-none" style={style} />
        {!mini && asset.source !== "upload" && <img src={assetSrc(asset, 1400)} referrerPolicy="no-referrer" draggable={false} alt="" className="absolute max-w-none" style={style} />}
      </>
    );
  }

  const lowDpi = !mini && asset ? effectiveDpi(asset, rect, Math.max(1, crop.zoom || 1)) : null;

  const pointToImage = (e) => {
    const box = ref.current.getBoundingClientRect();
    const c = computeCrop(box.width, box.height, asset.w, asset.h, crop);
    return { x: (e.clientX - box.left - c.offX) / c.drawW, y: (e.clientY - box.top - c.offY) / c.drawH, rel: box.width / c.drawW };
  };

  const handlers = mini
    ? {}
    : {
        onClick: () => onSelect?.(index),
        draggable: Boolean(asset) && !selected,
        onDragStart: (e) => {
          e.dataTransfer.setData(SLOT_MIME, JSON.stringify({ pageId, index }));
          e.dataTransfer.effectAllowed = "move";
          setDragAssets(asset ? [asset] : null);
        },
        onDragEnd: () => setDragAssets(null),
        onDragOver: (e) => {
          const types = e.dataTransfer.types;
          if (types.includes(ASSET_MIME) || types.includes(SLOT_MIME) || types.includes(GROUP_MIME)) {
            e.preventDefault();
            e.stopPropagation();
            const single = dragAssets?.length === 1 ? dragAssets[0] : null;
            setOver(single && shapeMismatch(single, rect) ? "bad" : "good");
          }
        },
        onDragLeave: () => setOver(null),
        onDrop: (e) => {
          e.preventDefault();
          e.stopPropagation(); // the area around the spread has its own drop ("add to this page")
          setOver(null);
          const group = e.dataTransfer.getData(GROUP_MIME);
          if (group) return onDropGroup?.(JSON.parse(group));
          const assetId = e.dataTransfer.getData(ASSET_MIME);
          if (assetId) return onDropAsset?.(index, assetId);
          const from = e.dataTransfer.getData(SLOT_MIME);
          if (from) {
            const src = JSON.parse(from);
            if (src.pageId !== pageId || src.index !== index) onDropSlot?.(index, src);
          }
        },
        onPointerDown: (e) => {
          if (!selected || !asset || e.button !== 0) return;
          e.preventDefault();
          if (healing) {
            // Alt/Option+click = where to copy from; click = paint a patch
            const p = pointToImage(e);
            const r = ((heal.size || 4) / 100) * p.rel;
            if (e.altKey) return onHealSource?.({ x: p.x, y: p.y });
            const off = heal.offset || { dx: -2.2 * r, dy: 0 };
            onHeal?.(index, { x: p.x, y: p.y, r, sx: p.x + off.dx, sy: p.y + off.dy });
            return;
          }
          // Pan: drag the photo inside the selected cell.
          const box = ref.current.getBoundingClientRect();
          const start = { x: e.clientX, y: e.clientY };
          const c0 = computeCrop(box.width, box.height, asset.w, asset.h, crop);
          let last = null;
          const move = (ev) => {
            const offX = c0.offX + (ev.clientX - start.x);
            const offY = c0.offY + (ev.clientY - start.y);
            const { cx, cy } = centerFromOffset(box.width, box.height, c0.drawW, c0.drawH, offX, offY);
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
          const box = ref.current.getBoundingClientRect();
          const lo = minZoom(box.width, box.height, asset.w, asset.h);
          const zoom = Math.min(4, Math.max(lo, (crop.zoom || 1) * (1 - e.deltaY * 0.0015)));
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
      className={`group/cell absolute overflow-hidden ${asset && slot.shape !== "ellipse" ? "bg-gray-200" : asset ? "" : "bg-gray-100"} ${mini ? "" : healing ? "cursor-crosshair" : selected ? "cursor-move" : "cursor-pointer"}`}
      style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%`, zIndex: rect.z + 1, ...cellMasks(rect, slot) }}
      {...handlers}
    >
      {img}
      {!asset && !mini && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400">גררו תמונה לכאן</div>}
      {/* frame on top of the photo (an outline on the cell itself is painted under it) */}
      {!mini && (
        <div
          className={`pointer-events-none absolute inset-0 ${
            over === "bad" ? "bg-rose-500/25 ring-[3px] ring-inset ring-rose-500" : over === "good" ? "ring-[3px] ring-inset ring-emerald-400" : selected ? "ring-[3px] ring-inset ring-amber-400" : "group-hover/cell:ring-2 group-hover/cell:ring-inset group-hover/cell:ring-sky-400/70"
          }`}
        />
      )}
      {over === "bad" && (
        <div className="pointer-events-none absolute inset-x-1 top-1 rounded bg-rose-600 px-1.5 py-1 text-center text-[10px] font-semibold leading-tight text-white">
          {(dragAssets?.[0]?.w || 0) < (dragAssets?.[0]?.h || 0) ? "תמונה לאורך במשבצת לרוחב — רוב התמונה ייחתך. עדיף תמונה לרוחב" : "תמונה לרוחב במשבצת לאורך — רוב התמונה ייחתך. עדיף תמונה לאורך"}
        </div>
      )}
      {lowDpi != null && lowDpi < 200 && (
        <div className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-semibold text-black" title="התמונה קטנה מדי לגודל הזה בהדפסה">
          ⚠️ {lowDpi}dpi
        </div>
      )}
      {faceWarning && !mini && (
        <div className="absolute bottom-1 right-1 rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white" title="פנים של אדם נופלות על הקפל של האלבום">
          ⚠️ פנים בקפל
        </div>
      )}
    </div>
  );
}
