import type { WatchFilm, WatchVersion } from './types';

type Conn = { effectiveType?: string; saveData?: boolean };

export function connection(): Conn {
  return ((navigator as unknown as { connection?: Conn }).connection ?? {}) as Conn;
}

/** True on data-saver or a slow link: start with a smaller quality. */
export function slowNetwork(): boolean {
  const c = connection();
  return Boolean(c.saveData) || c.effectiveType === '2g' || c.effectiveType === 'slow-2g' || c.effectiveType === '3g';
}

/** True only when a background clip would clearly be a waste (data-saver or 2G). "3g" still gets the clip. */
export function verySlowNetwork(): boolean {
  const c = connection();
  return Boolean(c.saveData) || c.effectiveType === '2g' || c.effectiveType === 'slow-2g';
}

const STORAGE = (galleryId: string) => `quality:${galleryId}`;

export function rememberQuality(galleryId: string, height: number): void {
  try {
    localStorage.setItem(STORAGE(galleryId), String(height));
  } catch {
    /* private mode */
  }
}

/** Which version to start with: remembered choice, else something the device and network can carry. */
export function pickVersion(film: WatchFilm, galleryId: string): number {
  const playable = film.versions.map((v, i) => ({ v, i })).filter((x) => x.v.playable);
  if (playable.length === 0) return 0;
  let remembered = 0;
  try {
    remembered = Number(localStorage.getItem(STORAGE(galleryId)) ?? 0);
  } catch {
    /* ignore */
  }
  if (remembered) {
    const exact = playable.find((x) => x.v.height === remembered);
    if (exact) return exact.i;
  }
  const phone = Math.max(window.screen.width, window.screen.height) < 1400;
  const cap = slowNetwork() ? 720 : phone ? 1080 : Infinity;
  // Versions are ordered large → small; take the first that fits under the cap, else the smallest.
  const fits = playable.find((x) => x.v.height === 0 || x.v.height <= cap);
  return (fits ?? playable[playable.length - 1]).i;
}

/** The cheapest clip for the hero background: lowest quality of highlights/teaser, else the smallest file. */
export function pickHeroClip(films: WatchFilm[]): WatchVersion | null {
  const all: { v: WatchVersion; preferred: boolean }[] = [];
  for (const f of films) for (const v of f.versions) if (v.playable && v.watchUrl) all.push({ v, preferred: f.tag === 'highlights' || f.tag === 'teaser' });
  if (all.length === 0) return null;
  const cost = (v: WatchVersion) => (v.height ? v.height * 1e12 : Number.MAX_SAFE_INTEGER / 4) + v.sizeBytes;
  all.sort((a, b) => Number(b.preferred) - Number(a.preferred) || cost(a.v) - cost(b.v));
  return all[0].v;
}
