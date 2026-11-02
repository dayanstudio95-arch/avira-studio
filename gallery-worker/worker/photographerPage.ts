// A photographer's landing page (Avira, 2026-11-02, the owner's request; 0102): /photographer/<token>, sent to a couple
// who asks to see a photographer's work. His photo and words, the weddings he shot that the studio starred (each its
// teaser set, or the whole gallery when the studio opened it), and what couples said. Nothing on it leads to a couple's
// own gallery: a wedding is known here by its ref (a signature of the page and the gallery), never by the gallery's id,
// and only its chosen photos are served — no download, no hearts, no hidden photo, no set kept from the guests.
import { albumSetId } from './albumSet';
import { hmac } from './auth';
import { firstNames } from '../shared/names';
import { kindOf } from './galleries';
import type { Store } from './store';
import type { Gallery, PhotoData, PhotoItem } from './types';

export interface PhotographerPage {
  id: string;
  tenantId: string;
  staffName: string;
  displayName?: string;
  bio?: string;
  photoPath?: string;
  token: string;
  published: boolean;
  hiddenGalleries: string[];
  fullGalleries: string[];
}

export interface PhotographerTestimonial {
  id: string;
  body?: string;
  coupleName?: string;
  imagePath?: string;
  sort: number;
}

export const PHOTOGRAPHER_BUCKET = 'photographer-pages';
const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;
/** A wedding without a teaser set shows this many of its photos. */
export const NO_TEASER_PHOTOS = 40;

export const isPageToken = (t: string) => TOKEN.test(t);

const sameName = (a: string, b: string) => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/** A wedding's ref on one page: the gallery's id never leaves the Worker. */
export async function weddingRef(secret: string, pageId: string, galleryId: string): Promise<string> {
  return (await hmac(secret, `photographer|${pageId}|${galleryId}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
}

/** The page's weddings, newest first: starred photo galleries of this photographer (or the event's "צלם 1"), not hidden. */
export async function pageWeddings(store: Store, page: PhotographerPage): Promise<Gallery[]> {
  const hidden = new Set(page.hiddenGalleries);
  const starred = (await store.listGalleries(page.tenantId)).filter((g) => kindOf(g) === 'photos' && !g.deletedAt && g.studioFavorite === true && !hidden.has(g.id));
  const askEvents = starred.filter((g) => !g.photographer && g.eventId).map((g) => g.eventId!);
  const byEvent = askEvents.length ? await store.eventPhotographers(page.tenantId, askEvents) : {};
  return starred
    .filter((g) => sameName(g.photographer || (g.eventId ? byEvent[g.eventId] ?? '' : ''), page.staffName))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

/** "2026-10-19" → "אוקטובר 2026" ('' when the couple hid the date, or there is none). */
export function weddingMonth(g: Pick<Gallery, 'date' | 'hideDate'>): string {
  const m = /^(\d{4})-(\d{2})/.exec(g.date || '');
  return m && !g.hideDate ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '';
}

/** What a wedding shows here: its teaser set, or (opened by the studio) every photo the guests may see — never the price list. */
export function weddingPhotos(data: PhotoData | null, g: Pick<Gallery, 'guestHiddenSets'>, full: boolean): PhotoItem[] {
  if (!data) return [];
  // The price list ("בחירת אלבום", the studio's or the gallery's own copy) is never part of a portfolio.
  const off = new Set([...(g.guestHiddenSets ?? []), albumSetId(data)].filter(Boolean));
  const shown = data.items.filter((i) => !i.hidden && !i.studio && !(i.set && off.has(i.set)));
  if (full) return shown;
  const teaser = new Set(data.sets.filter((s) => s.name.replace(/\s+/g, ' ').trim() === 'טיזר').map((s) => s.id));
  const inTeaser = shown.filter((i) => i.set && teaser.has(i.set));
  return inTeaser.length ? inTeaser : shown.slice(0, NO_TEASER_PHOTOS);
}

/** A wedding as the page lists it: first names, the venue (unless the couple hid it), the month, the cover. */
export function weddingCard(g: Gallery, ref: string, full: boolean) {
  return { ref, names: firstNames(g.coupleName), venue: g.hideVenue ? '' : (g.venue ?? ''), month: weddingMonth(g), cover: g.coverKey ?? '', full };
}
