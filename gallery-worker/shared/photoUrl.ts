// A photo gallery's photo addresses (fix plan P66) — the one place they are built, for the Worker, the couple's
// pages and the hub (`@films-shared/photoUrl`). `v<gen>` is the gallery's generation (PhotoData.gen, mirrored
// in films_galleries.photos_gen): it changes when the folder's link or a photo's file changes, so a browser that
// keeps a preview for a year never shows an old file under a new one. Addresses without it (links shared
// before) still work; a browser keeps them a day.

/** Where a gallery's photos are: `<base>/<key>?s=m`. `id` is the address the viewer uses (couple or guests). */
export function photoBase(id: string, gen: number | undefined): string {
  return `/api/photos/${id}/v${versionOf(gen)}`;
}

/** The print shop's photos of an album (the print link). */
export function printPhotoBase(token: string, gen: number | undefined): string {
  return `/api/print/${token}/photo/v${versionOf(gen)}`;
}

/** One photo: a preview (m, md, l) or the original (full); `extra` = more query, e.g. `pt=…`. */
export function photoPath(id: string, gen: number | undefined, key: string, size: string, extra = ''): string {
  return `${photoBase(id, gen)}/${key}?s=${size}${extra ? `&${extra}` : ''}`;
}

/** The version part of an address ("v12") → 12; anything else → null (not an address of ours). */
export function askedVersion(part: string): number | null {
  return /^v\d{1,16}$/.test(part) ? Number(part.slice(1)) : null;
}

const versionOf = (gen: number | undefined) => (typeof gen === 'number' && Number.isFinite(gen) && gen > 0 ? Math.floor(gen) : 0);
