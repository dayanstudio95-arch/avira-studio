// Album design editor, stage 4 (2026-10-08): the couple saves their edited sketch from the public
// portal. Nothing the browser sends is trusted — this rebuilds a clean document:
//   - the photo list (assets) is NEVER taken from the client: it is the studio's photos + the
//     couple's own uploads as recorded server-side; a slot pointing at anything else is emptied;
//   - every page / slot / number / string is shape-checked and clamped;
//   - sizes are capped (80 spreads, 20 photos a spread, short strings).
// Pure, no Deno APIs — unit-tested in scripts/test-whatsapp-bot.mjs (PART 42).
// Template ids and filter ids mirror src/lib/albumTemplates.js / albumDesign.js (synced by hand —
// a template the server doesn't know only means that page falls back to the 4-photo layout).

const TEMPLATE_ID = /^(p([1-9]|10)-[a-z]|g([1-9]|1\d|20)-[lpm]\d{1,2}|t-[a-z])$/;
const FILTER_IDS = new Set(['none', 'bw-classic', 'bw-soft', 'bw-contrast', 'bw-matte', 'bw-warm']);
const FONT_IDS = new Set(['josefin', 'cormorant', 'italiana', 'montserrat', 'playfair', 'bodoni', 'tenor', 'marcellus', 'raleway', 'greatvibes', 'allura', 'parisienne',
  'bellefair', 'frank', 'heebo', 'assistant', 'davidlibre', 'notoserifhe', 'rubik', 'varela', 'amatic', 'karantina']);
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_PAGES = 80;
const MAX_SLOTS = 20;

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

// Lightroom-style adjustments (src/lib/albumAdjust.js ADJ_FIELDS) — numbers, clamped.
const ADJ_LIMITS: Record<string, [number, number]> = {
  exposure: [-2, 2], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
  temp: [-100, 100], tint: [-100, 100], saturation: [-100, 100], sharpness: [0, 100],
};
function cleanAdj(a: any) {
  const out: Record<string, number> = {};
  if (!a || typeof a !== 'object') return out;
  for (const [k, [lo, hi]] of Object.entries(ADJ_LIMITS)) {
    const v = a[k];
    if (typeof v === 'number' && Number.isFinite(v) && v !== 0) out[k] = Math.min(hi, Math.max(lo, v));
  }
  return out;
}

export function sanitizeClientDoc(input: any, allowedAssets: any[], studioDoc: any) {
  const allowed = new Set(allowedAssets.map((a) => a.id));
  const rawPages = Array.isArray(input?.pages) ? input.pages.slice(0, MAX_PAGES) : [];
  const seenIds = new Set<string>();
  const pages = rawPages
    .filter((p: any) => p && typeof p === 'object')
    .map((p: any, i: number) => {
      let id = str(p.id, 60) || `pg_c${i}`;
      if (seenIds.has(id)) id = `${id}_${i}`;
      seenIds.add(id);
      const templateId = TEMPLATE_ID.test(String(p.templateId)) ? String(p.templateId) : 'p4-a';
      const slots = (Array.isArray(p.slots) ? p.slots.slice(0, MAX_SLOTS) : []).map((s: any) => ({
        assetId: s && allowed.has(s.assetId) ? s.assetId : null,
        zoom: num(s?.zoom, 0.2, 4, 1), // < 1 = zoomed out (photo fits inside the cell)
        cx: num(s?.cx, 0, 1, 0.5),
        cy: num(s?.cy, 0, 1, 0.5),
        filter: FILTER_IDS.has(s?.filter) ? s.filter : 'none',
        shape: s?.shape === 'ellipse' ? 'ellipse' : 'rect',
        adj: cleanAdj(s?.adj),
        heal: (Array.isArray(s?.heal) ? s.heal.slice(0, 200) : []).map((h: any) => ({
          x: num(h?.x, 0, 1, 0.5), y: num(h?.y, 0, 1, 0.5), sx: num(h?.sx, -0.5, 1.5, 0.5), sy: num(h?.sy, -0.5, 1.5, 0.5), r: num(h?.r, 0.001, 0.5, 0.02),
        })),
      }));
      const page: any = { id, templateId, flip: p.flip === true, slots, blend: p.blend === 'fade' ? 'fade' : 'none', fadeStrength: num(p.fadeStrength, 0, 200, 100) };
      if (typeof p.foldOk === 'string') page.foldOk = p.foldOk.slice(0, 4000);
      if (p.branding && typeof p.branding === 'object') {
        page.branding = { show: p.branding.show === true, x: num(p.branding.x, -10, 100, 3), y: num(p.branding.y, -10, 100, 72), scale: num(p.branding.scale, 0.5, 3, 1) };
      }
      if (templateId.startsWith('t-') && p.title && typeof p.title === 'object') {
        page.title = {
          names: str(p.title.names, 120),
          namesEn: str(p.title.namesEn, 120),
          lang: p.title.lang === 'en' ? 'en' : 'he',
          dx: num(p.title.dx, -60, 60, 0),
          dy: num(p.title.dy, -60, 60, 0),
          date: str(p.title.date, 40),
          hebrewDate: str(p.title.hebrewDate, 60),
          showHebrew: p.title.showHebrew !== false,
          font: FONT_IDS.has(p.title.font) ? p.title.font : 'bellefair',
          syncFonts: p.title.syncFonts !== false,
          fontNames: FONT_IDS.has(p.title.fontNames) ? p.title.fontNames : null,
          fontDate: FONT_IDS.has(p.title.fontDate) ? p.title.fontDate : null,
          fontHebrew: FONT_IDS.has(p.title.fontHebrew) ? p.title.fontHebrew : null,
          color: COLOR.test(String(p.title.color)) ? p.title.color : '#3a3a3a',
          scale: num(p.title.scale, 0.4, 3, 1),
        };
      }
      return page;
    });
  return {
    v: 1,
    assets: allowedAssets,
    cameraOffsets: studioDoc?.cameraOffsets && typeof studioDoc.cameraOffsets === 'object' ? studioDoc.cameraOffsets : {},
    pages: pages.length ? pages : (studioDoc?.pages || []),
  };
}

// The couple's photo list = studio photos + their own uploads + the extra Drive folders they
// added (all recorded server-side; the browser's list is never used).
export function clientAssets(studioDoc: any, uploads: any[], sources: any[] = []) {
  const studio = Array.isArray(studioDoc?.assets) ? studioDoc.assets : [];
  const ups = (Array.isArray(uploads) ? uploads : []).map((u) => ({
    id: u.id, name: u.name, w: u.w, h: u.h, size: u.size, source: 'upload', fileKey: u.fileKey, camera: 'העלאות הזוג', time: null, group: u.group || 'העלאות שלנו',
  }));
  const fromSources = (Array.isArray(sources) ? sources : []).flatMap((src) => (src.assets || []).map((a: any) => ({ ...a, group: src.name })));
  const seen = new Set();
  return [...studio, ...ups, ...fromSources].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

// A Google Drive folder the couple added (e.g. the magnets photographer). The list comes from
// their browser (the Drive key only works from our site), so every field is shape-checked.
const DRIVE_ID = /^[A-Za-z0-9_-]{10,80}$/;
export function sanitizeSource(input: any) {
  const name = str(input?.name, 30).trim();
  const folderId = DRIVE_ID.test(String(input?.folderId)) ? String(input.folderId) : null;
  if (!name || !folderId) return null;
  const assets = (Array.isArray(input?.assets) ? input.assets.slice(0, 500) : [])
    .filter((a: any) => DRIVE_ID.test(String(a?.id)))
    .map((a: any) => ({
      id: String(a.id), name: str(a.name, 120), w: num(a.w, 0, 20000, 0), h: num(a.h, 0, 20000, 0),
      size: num(a.size, 0, 2e8, 0), time: str(a.time, 25) || null, camera: str(a.camera, 40) || name,
    }));
  return { id: `src_${folderId.slice(0, 12)}`, name, folderId, assets };
}

// Photos marked "להגדלה": a photo the couple can see, a canvas/glass product from the catalog
// (name + price snapshotted now), portrait/landscape. Max 20.
export function sanitizeEnlargements(list: any, allowedIds: Set<string>, products: Record<string, any>, by: string) {
  return (Array.isArray(list) ? list.slice(0, 20) : [])
    .filter((e: any) => allowedIds.has(e?.assetId) && products[e?.addonId])
    .map((e: any) => ({
      id: str(e.id, 40) || `en_${Math.random().toString(36).slice(2, 10)}`,
      assetId: e.assetId,
      addonId: e.addonId,
      addonName: products[e.addonId].name,
      addonPrice: Number(products[e.addonId].price) || 0,
      category: products[e.addonId].category,
      orientation: e.orientation === 'landscape' ? 'landscape' : 'portrait',
      note: str(e.note, 200),
      by: e.by === 'studio' ? 'studio' : by,
      fileKey: typeof e.fileKey === 'string' ? e.fileKey : null,
    }));
}

export const safeUploadName = (name: unknown) =>
  String(name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo';
