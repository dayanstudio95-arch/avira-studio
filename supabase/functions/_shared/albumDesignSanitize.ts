// Album design editor, stage 4 (2026-10-08): the couple saves their edited sketch from the public
// portal. Nothing the browser sends is trusted — this rebuilds a clean document:
//   - the photo list (assets) is NEVER taken from the client: it is the studio's photos + the
//     couple's own uploads as recorded server-side; a slot pointing at anything else is emptied;
//   - every page / slot / number / string is shape-checked and clamped;
//   - sizes are capped (80 spreads, 10 photos a spread, short strings).
// Pure, no Deno APIs — unit-tested in scripts/test-whatsapp-bot.mjs (PART 42).
// Template ids and filter ids mirror src/lib/albumTemplates.js / albumDesign.js (synced by hand —
// a template the server doesn't know only means that page falls back to the 4-photo layout).

const TEMPLATE_ID = /^(p([1-9]|10)-[a-z]|t-[a-z])$/;
const FILTER_IDS = new Set(['none', 'bw-classic', 'bw-soft', 'bw-contrast', 'bw-matte', 'bw-warm']);
const FONT_IDS = new Set(['josefin', 'cormorant', 'montserrat', 'heebo', 'frank', 'assistant']);
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_PAGES = 80;
const MAX_SLOTS = 10;

const num = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt;
  return Math.min(hi, Math.max(lo, n));
};
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

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
        zoom: num(s?.zoom, 1, 4, 1),
        cx: num(s?.cx, 0, 1, 0.5),
        cy: num(s?.cy, 0, 1, 0.5),
        filter: FILTER_IDS.has(s?.filter) ? s.filter : 'none',
      }));
      const page: any = { id, templateId, flip: p.flip === true, slots };
      if (templateId.startsWith('t-') && p.title && typeof p.title === 'object') {
        page.title = {
          names: str(p.title.names, 120),
          date: str(p.title.date, 40),
          hebrewDate: str(p.title.hebrewDate, 60),
          showHebrew: p.title.showHebrew !== false,
          font: FONT_IDS.has(p.title.font) ? p.title.font : 'josefin',
          color: COLOR.test(String(p.title.color)) ? p.title.color : '#3a3a3a',
          scale: num(p.title.scale, 0.6, 1.6, 1),
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

// The couple's photo list = studio photos + their own uploads (server-recorded).
export function clientAssets(studioDoc: any, uploads: any[]) {
  const studio = Array.isArray(studioDoc?.assets) ? studioDoc.assets : [];
  const ups = (Array.isArray(uploads) ? uploads : []).map((u) => ({
    id: u.id, name: u.name, w: u.w, h: u.h, size: u.size, source: 'upload', fileKey: u.fileKey, camera: 'העלאות הזוג', time: null,
  }));
  return [...studio, ...ups];
}

export const safeUploadName = (name: unknown) =>
  String(name || 'photo').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80) || 'photo';
