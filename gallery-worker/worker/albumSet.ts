// The studio's album-choice folder (Avira, 2026-11-02, the owner's request). His price list ("מחירון 2027 אלבומים")
// was copied into every wedding's cloud folder, where it became the gallery's "בחירת אלבום" set. Now it is one folder
// in the gallery settings: its photos join every photo gallery's list in that set, marked `studio` — a folder load
// keeps them, the next folder in the settings replaces them (same keys, so the couple's hearts stay) — unless the
// gallery has its own copy (a subfolder that fills the set: its own wins) or the studio switched it off there
// (`studioSetOff`). Couples see them like any photo; guests don't by default (the set starts in guestHiddenSets).
import { sortByName, uniqueKey } from './photos';
import { presetForFolder } from '../shared/photosets';
import { HttpError, type PhotoData, type PhotoItem } from './types';

export const ALBUM_SET = 'בחירת אלבום';
/** The folder the studio's photos show under in the studio's own screen. */
export const STUDIO_FOLDER = 'בחירת אלבום · מההגדרות';
/** A price list, not a wedding. */
export const STUDIO_SET_MAX = 100;

export interface StudioAlbumSet {
  url: string;
  provider: PhotoData['provider'];
  /** The folder's photos in name order; `ar` once the settings screen measured it. */
  items: { name: string; ref: string; size?: number; v?: string; ar?: number }[];
  /** When the folder was read. */
  at: string;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The settings' copy of a folder just read (listPhotos); a photo read before keeps its measured shape. */
export function studioSetFrom(url: string, data: PhotoData, before?: StudioAlbumSet, now = new Date()): StudioAlbumSet {
  if (data.items.length > STUDIO_SET_MAX) throw new HttpError(400, `בתיקייה יש ${data.items.length} תמונות. בתיקיית "בחירת אלבום" אפשר עד ${STUDIO_SET_MAX}.`);
  const was = new Map((before?.items ?? []).map((i) => [i.ref, i]));
  const items = sortByName(data.items).map(({ name, ref, size, v }) => {
    const prev = was.get(ref);
    const ar = prev && prev.v === v ? prev.ar : undefined;
    return { name, ref, ...(size ? { size } : {}), ...(v ? { v } : {}), ...(ar ? { ar } : {}) };
  });
  return { url, provider: data.provider, items, at: now.toISOString() };
}

/** The gallery's "בחירת אלבום" set ('' when the studio renamed or removed it). */
export function albumSetId(data: Pick<PhotoData, 'sets'> | null | undefined): string {
  return data?.sets.find((s) => norm(s.name) === ALBUM_SET)?.id ?? '';
}

/** The gallery's own folder fills "בחירת אלבום" (a price-list subfolder copied into it): its own copy wins. */
export function hasOwnAlbumCopy(data: PhotoData): boolean {
  const id = albumSetId(data);
  return Boolean(id) && data.items.some((i) => !i.studio && i.set === id && Boolean(i.folder) && presetForFolder(i.folder!) === ALBUM_SET);
}

/**
 * The list with the studio's folder as it is now: the studio's photos of before leave, and the folder's photos come
 * at the end in "בחירת אלבום" — a photo that was there keeps its key and whether it is hidden. Nothing comes when
 * there is no folder in the settings, the studio switched it off here, or the gallery has its own copy. `before`:
 * where the keys come from (a folder load passes the saved list — the merged one has no studio photos).
 */
export function withStudioSet(data: PhotoData, set: StudioAlbumSet | undefined, before: PhotoData | null = data): PhotoData {
  const own = data.items.filter((i) => !i.studio);
  const bare = { ...data, items: own };
  if (!set?.items.length || data.studioSetOff || hasOwnAlbumCopy(bare)) return bare;
  let sets = data.sets;
  let id = albumSetId(data);
  if (!id) {
    const ids = new Set(sets.map((s) => s.id));
    let n = sets.length + 1;
    while (ids.has(`s${n}`)) n++;
    id = `s${n}`;
    sets = [...sets, { id, name: ALBUM_SET }];
  }
  const prev = new Map((before?.items ?? []).filter((i) => i.studio).map((i) => [i.ref, i]));
  const taken = new Set(own.map((i) => i.key));
  const added: PhotoItem[] = set.items.map((f) => {
    const p = prev.get(f.ref);
    let key: string;
    if (p && !taken.has(p.key)) {
      key = p.key;
      taken.add(key);
    } else key = uniqueKey(f.ref, taken);
    const ar = f.ar ?? (p && p.v === f.v ? p.ar : undefined);
    return {
      key,
      name: f.name,
      ref: f.ref,
      set: id,
      folder: STUDIO_FOLDER,
      studio: true,
      ...(f.size ? { size: f.size } : {}),
      ...(f.v ? { v: f.v } : {}),
      ...(ar ? { ar } : {}),
      ...(p?.hidden ? { hidden: true } : {}),
    };
  });
  return { ...data, sets, items: [...own, ...added] };
}

/** Whether two lists have the same photos, in the same order, with the same fields (nothing to save). */
export function samePhotos(a: PhotoData, b: PhotoData): boolean {
  return JSON.stringify([a.sets, a.items]) === JSON.stringify([b.sets, b.items]);
}

/** The sets the guests' link leaves out: the studio's choice, and "בחירת אלבום" on a gallery's first load. */
export function guestSetsOnFirstLoad(hidden: readonly string[] | undefined, data: PhotoData): string[] | null {
  const id = albumSetId(data);
  return id && !(hidden ?? []).includes(id) ? [...(hidden ?? []), id] : null;
}
