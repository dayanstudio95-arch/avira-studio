// The studio's album sketch editor in the hub (work order item 41, port B9: /AlbumOrders/:id/design, `photos`
// module). Its photo bank is the event's photo gallery here — the Worker already reads the studio's clouds with the
// platform's keys, knows each photo's shape (`ar`), capture time (`t`) and set — so the hub never holds a Google key
// and its CSP never opens to a cloud (decision in the port's DECISIONS file).
// The routes (worker/index.ts, /api/admin/album-designer/*) only READ, and the album manager may call them too
// (DESIGNER_ROLES): the album roles of the hub (0100 / 0172). The bank's small pictures use the gallery's thumbs token
// (small previews only, P73) — never the studio pass — and the large preview / the original come through
// `…/file/:key` with the caller's session (CORS, Authorization), never cached at the edge.
import { readJpegInfo } from '../shared/print';
import type { Gallery, PhotoData } from './types';

/** The hub's album roles: who may design an album (RLS of album_designs, 0172). */
export const DESIGNER_ROLES = ['owner', 'admin', 'studio_manager', 'album_manager'] as const;

/**
 * The couple's album portal reads the sketch's photos with its portal link (work order item 42, port B10;
 * `/api/album-portal/design-bank`): calls per address and per order in 10 minutes, and at most this many galleries.
 */
export const DESIGN_BANK_LIMITS = { perAddress: 120, perOrder: 60, windowSeconds: 600, galleries: 5 } as const;

/** A photo gallery the editor can take photos from. */
export interface DesignerGallery {
  id: string;
  coupleName: string;
  date: string;
  eventId: string | null;
  photoCount: number;
}

/** The studio's photo galleries (not in the trash), newest first, in a few fields. */
export function designerGalleries(list: Gallery[]): DesignerGallery[] {
  return list
    .filter((g) => g.kind === 'photos' && !g.deletedAt)
    .map((g) => ({ id: g.id, coupleName: g.coupleName ?? '', date: g.date ?? '', eventId: g.eventId ?? null, photoCount: g.photoCount ?? 0 }));
}

/** A photo of the bank: what the editor needs to place, order and tag it — never where the file lives. */
export interface DesignerPhoto {
  key: string;
  name: string;
  ar?: number;
  t?: number;
  set?: string;
  folder?: string;
  size?: number;
}

/** The gallery's photos the couple can see (hidden ones are the studio's rejects), in the gallery's order, and its sets. */
export function designerPhotos(data: PhotoData | null): { gen: number; sets: { id: string; name: string }[]; items: DesignerPhoto[] } {
  if (!data) return { gen: 0, sets: [], items: [] };
  const items = data.items
    .filter((i) => !i.hidden)
    .map((i) => {
      const out: DesignerPhoto = { key: i.key, name: i.name };
      if (typeof i.ar === 'number' && i.ar > 0) out.ar = i.ar;
      if (typeof i.t === 'number') out.t = i.t;
      if (i.set) out.set = i.set;
      if (i.folder) out.folder = i.folder;
      if (typeof i.size === 'number') out.size = i.size;
      return out;
    });
  return { gen: data.gen ?? 0, sets: (data.sets ?? []).map((s) => ({ id: s.id, name: s.name })), items };
}

/**
 * Pixel size of a photo from the first bytes of its file (JPEG SOF or PNG IHDR), as it is SHOWN: a camera that wrote
 * a portrait as a turned landscape (EXIF orientation) is turned back by the photo's measured shape `ar`. null = the
 * size is not in those bytes (a long EXIF block) or the file is not a JPEG / PNG.
 */
export function pixelSize(bytes: Uint8Array, ar?: number): [number, number] | null {
  let w = 0;
  let h = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      ({ width: w, height: h } = readJpegInfo(bytes));
    } catch {
      return null;
    }
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes.length >= 24) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    w = v.getUint32(16);
    h = v.getUint32(20);
  }
  if (!(w > 0 && h > 0)) return null;
  if (typeof ar === 'number' && ar > 0 && w !== h && ar !== 1 && w > h !== ar > 1) [w, h] = [h, w];
  return [w, h];
}
