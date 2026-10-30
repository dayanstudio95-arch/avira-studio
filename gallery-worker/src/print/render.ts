// Draws album spreads at full print size in the browser, from the original photos.
import { albumSize, placePhoto, registerTemplates, slotAspect, template, type Album, type AlbumSpread, type AlbumText, FONTS_URL } from '../../shared/album';
import { setJpegDpi } from '../../shared/print';

export interface PhotoSource {
  /** Original file (full quality). */
  full: (key: string) => string;
  /** Large preview, used only when the original can't be decoded by the browser (e.g. HEIC). */
  fallback: (key: string) => string;
}

export interface RenderResult {
  blob: Blob;
  /** Photos that had to use the preview instead of the original. */
  lowRes: string[];
}

/** Makes sure every font and weight used on the album is loaded before drawing text. */
export async function loadAlbumFonts(album: Album): Promise<void> {
  if (!document.querySelector('link[data-album-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONTS_URL;
    l.dataset.albumFonts = '1';
    document.head.appendChild(l);
    await new Promise((r) => (l.onload = l.onerror = () => r(null)));
  }
  const wanted = new Set<string>();
  for (const s of album.spreads) for (const t of s.texts) wanted.add(fontSpec(t, 40));
  await Promise.all([...wanted].map((f) => document.fonts.load(f).catch(() => [])));
}

function fontSpec(t: AlbumText, px: number): string {
  return `${t.italic ? 'italic ' : ''}${t.weight} ${px}px '${t.font}', 'Assistant', sans-serif`;
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return createImageBitmap(await res.blob());
}

/** Whether this browser can hold one full spread in a canvas (phones usually can't). */
export function canRenderFullSize(width: number, height: number): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(width - 2, height - 2, 1, 1);
    const ok = ctx.getImageData(width - 2, height - 2, 1, 1).data[0] === 255;
    c.width = c.height = 1;
    return ok;
  } catch {
    return false;
  }
}

export async function renderSpread(spread: AlbumSpread, album: Album, src: PhotoSource, onPhoto?: (done: number, total: number) => void): Promise<RenderResult> {
  registerTemplates(album.custom); // layouts made in this album
  const size = albumSize(album.size);
  const [W, H] = size.spreadPx;
  const t = template(spread.template);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const lowRes: string[] = [];
  const jobs = t.slots.map((r, i) => ({ r, fill: spread.fills[i] })).filter((j) => j.fill?.photo);
  let done = 0;
  // Two originals at a time: fast enough, and keeps memory in check with 20–30 MB files.
  const queue = [...jobs];
  const worker = async () => {
    while (queue.length) {
      const { r, fill } = queue.shift()!;
      let bmp: ImageBitmap;
      try {
        bmp = await loadBitmap(src.full(fill.photo));
      } catch {
        bmp = await loadBitmap(src.fallback(fill.photo));
        lowRes.push(fill.photo);
      }
      // Slot edges snap to whole pixels so neighbouring photos keep an even gap.
      const x0 = Math.round(r.x * W);
      const y0 = Math.round(r.y * H);
      const x1 = Math.round((r.x + r.w) * W);
      const y1 = Math.round((r.y + r.h) * H);
      const sw = x1 - x0;
      const sh = y1 - y0;
      const p = placePhoto(slotAspect(r, size), bmp.width / bmp.height, fill);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, sw, sh);
      ctx.clip();
      ctx.drawImage(bmp, x0 + p.x * sw, y0 + p.y * sh, p.w * sw, p.h * sh);
      ctx.restore();
      bmp.close();
      onPhoto?.(++done, jobs.length);
    }
  };
  await Promise.all([worker(), worker()]);

  for (const tx of spread.texts) drawText(ctx, tx, W, H);

  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('הדפדפן לא הצליח ליצור את הקובץ'))), 'image/jpeg', 0.95));
  canvas.width = canvas.height = 1; // free the memory now, not at garbage-collection time
  const bytes = setJpegDpi(new Uint8Array(await blob.arrayBuffer()), size.dpi);
  return { blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), lowRes };
}

/** Same geometry as the editor: text box centred on (x, y), line height 1.15, aligned inside the box. */
function drawText(ctx: CanvasRenderingContext2D, t: AlbumText, W: number, H: number) {
  if (!t.text.trim()) return;
  const px = t.size * H;
  ctx.save();
  ctx.font = fontSpec(t, px);
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'middle';
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${t.spacing * px}px`;
  const hebrew = /[֐-׿]/.test(t.text);
  ctx.direction = hebrew ? 'rtl' : 'ltr';
  const lines = t.text.split('\n');
  const lh = px * 1.15;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const cx = t.x * W;
  const top = t.y * H - (lines.length * lh) / 2 + lh / 2;
  ctx.textAlign = t.align === 'center' ? 'center' : t.align;
  const x = t.align === 'center' ? cx : t.align === 'right' ? cx + boxW / 2 : cx - boxW / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + i * lh));
  ctx.restore();
}
