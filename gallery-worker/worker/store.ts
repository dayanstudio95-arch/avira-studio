// Where the films module keeps its data. Two implementations:
//  - SupabaseStore (store-supabase.ts): the StudioOS database, via the service role.
//  - MemoryStore  (store-memory.ts): in-memory, for unit tests and CLOUD_MOCK previews.
// Everything else in the Worker talks to this interface only.
import type { Album, AlbumTemplate } from '../shared/album';
import type { Design } from '../shared/design';
import type { Env, Film, Gallery, Lead, MusicTrack, PhotoData, PhotoItem, Review, StudioPage } from './types';

export type Access = 'ok' | 'read_only' | 'blocked';

/** The studio as the films module sees it. Branding comes from `tenants`. */
export interface TenantInfo {
  id: string;
  name: string;
  /** Name couples see: display_name_to_clients, else name. */
  displayName: string;
  logoUrl: string;
  phone: string;
  instagramUrl: string;
  facebookUrl: string;
  slug: string;
  accentColor: string;
  access: Access;
  /** The studio has the films module (bought, or on a live trial). */
  films: boolean;
  /** The studio has the photo galleries module. */
  photos: boolean;
  /**
   * films_studio_settings.access_version (P73, read with the studio by films_tenant_info): raised by
   * "disconnect every access"; cookies and preview tokens made under another number stop working. 0 = never.
   */
  accessVersion?: number;
}

/**
 * A gallery's face data as a guest's phone sees it (fix plan P68: without the list of scanned photos — the studio
 * reads that apart, facesDone).
 */
export interface FacesMeta {
  chunks: number;
  /** Photos scanned (and not hidden or removed since). */
  photos: number;
  faces: number;
  /** Raised on every change of what a guest downloads (ms; 0 = no face data): chunk addresses carry it. */
  version: number;
  /** addFacesChunk only: every photo of the chunk was scanned already, so nothing was added. */
  duplicate?: boolean;
}

/** One chunk for a guest (films_faces_chunk, 0136): the file's bytes and the photos in it a guest may get. */
export interface FaceChunkRead {
  bytes: Uint8Array;
  keys: string[];
  version: number;
}

/** Files to rewrite (films_faces_plan, 0136), each with the photos it keeps; `more` wait beyond the limit. */
export interface FacePlan {
  version: number;
  more: number;
  files: { name: string; keys: string[] }[];
}

/** A rewritten file in place of `old` (null bytes: nothing left in it); `faces` = faces it dropped. */
export interface FaceSwap {
  old: string;
  bytes: Uint8Array | null;
  keys: string[];
  faces: number;
}

/** Who searched: the couple's link, the guests' link, or the studio ("הסר אדם זה"). */
export type FaceSearchRole = 'couple' | 'guest' | 'studio';

export type AlbumDesignBank =
  | { ok: true; tenantId: string; orderId: string; readOnly: boolean; galleries: string[] }
  | { ok: false; reason: 'not_found' | 'revoked' | 'unavailable' | 'closed' };

export interface AlbumOrderState {
  crm: boolean;
  /** The studio's "extra page" price in its album catalog; null = none set (the couple cannot buy more pages yet, P53). */
  extraPagePrice?: number | null;
  /** The pages the studio includes in an album (album_pricing_settings, 0138); null = not set. */
  includedSpreads?: number | null;
  /** `spreads`: the pages the order was made for (designed_spread_count; P57: the Worker makes it again when they differ). */
  order?: { id: string; workflowStatus: string; paymentStatus: string; tokenHash: string | null; revoked: boolean; spreads?: number | null } | null;
}

/**
 * What an album save did (films_album_put, 0139): written (the new rev), or not — `conflict` (another tab or device
 * saved since the rev the writer read), `submitted` (a draft onto a sent album), `not_found` (no such gallery of this
 * studio); `current` is the saved copy then (null = none), so the couple's page shows it instead of overwriting it.
 */
export type AlbumWrite = { ok: true; rev: number } | { ok: false; reason: 'conflict' | 'submitted' | 'not_found'; current: Album | null };

/** The print shop's copy of an album (getPrintAlbum, P55): as it was sent, when, and whether it is open again. */
export interface PrintAlbum {
  album: Album | null;
  submittedAt: string;
  open: boolean;
}

/** How a save is checked: only onto `rev` (the copy the writer read; 0 = none yet), and with `draftOnly` never onto a sent album. */
export interface AlbumExpect {
  rev?: number;
  draftOnly?: boolean;
}

/**
 * What protects a gallery's designed album (films_album_guards, 0135): the couple's album and its album order's
 * two statuses (albumGuard in galleries.ts decides). Galleries with neither are left out.
 */
export interface AlbumGuardState {
  album: 'draft' | 'submitted' | null;
  order: { workflowStatus: string; paymentStatus: string } | null;
}

/** A gallery the trash queue keeps for its album order (films_trash_candidates, 0135). */
export interface BlockedTrash {
  id: string;
  reason: 'album_paid' | 'album_order';
}

/** One line in the studio's audit log (audit_logs), written by the Worker for an action it takes (P71). */
export interface AuditEntry {
  tenantId: string;
  actorId: string;
  actorRole: string;
  table: string;
  recordId: string;
  changes: Record<string, unknown>;
}

/** Films-only settings (films_studio_settings). */
export interface FilmsStudio {
  defaultDays: number;
  /** null = built-in default terms. */
  termsText: string | null;
  contactLine: string;
  vimeo: string;
  youtube: string;
  headline: string;
  about: string;
  pageEnabled: boolean;
  mit4mitUrl?: string;
  showcase: StudioPage['showcase'];
  reviews: Review[];
  dropboxAccountName?: string;
  /** Photo galleries: photos with a Lightroom colour fill the set that colour stands for. */
  labelSetsOn?: boolean;
  /** Colour ('yellow', 'red'…) → set name. Missing colours use DEFAULT_LABEL_MAP. */
  labelMap?: Record<string, string>;
  /** Slideshow songs (at most 3) and the one galleries use unless they choose. */
  music?: MusicTrack[];
  musicDefault?: string;
  /** Page layouts the studio saved from inside an album (offered in all its albums). */
  albumLayouts?: AlbumTemplate[];
  /** The look of photo galleries that weren't styled on their own. */
  designDefault?: Design;
  /**
   * The mit4mit business bound to the studio (fix plan P71, 0135: one business, one studio — a clash is
   * MIT4MIT_TAKEN), the identity keys of the imported reviews the studio deleted, when it was bound and when the
   * platform operator approved it (only then are imported reviews on the public page).
   */
  mit4mitBizId?: string;
  mit4mitRemoved?: string[];
  mit4mitLinkedAt?: string;
  mit4mitApprovedAt?: string;
}

/** A couple's personal list ("התמונות של אופק"): photos apart from the favourites for the album. */
export interface PhotoList {
  id: string;
  name: string;
  keys: string[];
}

/** A signed-in member of a studio, from their Supabase session. */
export interface StudioUser {
  userId: string;
  tenantId: string;
  role: string;
  /** Filled by requireStudioAdmin: which gallery modules the studio has now. */
  films?: boolean;
  photos?: boolean;
  /**
   * Filled by requireStudioAdmin with `allowReadOnly` (fix plan P55): the studio's subscription is not active, so the
   * route may only lower exposure (close, trash, revoke, a new password…), never anything else.
   */
  readOnly?: boolean;
}

export interface Store {
  userFromToken(token: string): Promise<StudioUser | null>;

  getTenant(tenantId: string): Promise<TenantInfo | null>;
  tenantIdBySlug(slug: string): Promise<string | null>;
  /**
   * The studio that last gave up this address (tenant_slug_history, P73), for an address no studio has now:
   * its studio page redirects to the studio's new address and a lead sent there reaches that studio.
   */
  tenantIdByOldSlug(slug: string): Promise<string | null>;
  /**
   * Throws HttpError(400) when the slug is taken, invalid, kept for the studio that gave it up (a year:
   * SLUG_RESERVED) or changed 3 times in 30 days already (SLUG_CHANGES_LIMIT) — the database's trigger, 0134.
   */
  setSlug(tenantId: string, slug: string): Promise<void>;
  /** "Disconnect every access" (P73): raises the studio's access version (films_bump_access_version); the new one. */
  bumpAccessVersion(tenantId: string): Promise<number>;

  getFilmsStudio(tenantId: string): Promise<FilmsStudio>;
  /**
   * Writes only the fields given (creates the row when missing); undefined clears a field. A mit4mit business
   * another studio has: HttpError(409, MIT4MIT_TAKEN).
   */
  patchFilmsStudio(tenantId: string, fields: Partial<FilmsStudio>): Promise<void>;
  /** One line in the studio's audit log (audit_logs, service role). */
  audit(entry: AuditEntry): Promise<void>;

  getGallery(id: string): Promise<Gallery | null>;
  getGalleryByGuestId(guestId: string): Promise<Gallery | null>;
  getGalleryByPrintToken(token: string): Promise<Gallery | null>;
  /**
   * Every gallery of the studio for its list, newest first, with the list's fields only (listView: no
   * password, download code, print token or guests' id), read page by page (fix plan P70).
   */
  listGalleries(tenantId: string): Promise<Gallery[]>;
  /** One page of that list (`offset` from the newest) and how many galleries the studio has in all. */
  pageGalleries(tenantId: string, limit: number, offset: number): Promise<{ galleries: Gallery[]; total: number }>;
  /** Every gallery of the studio in a few fields, for the hub's gallery link picker (newest first). */
  galleryOptions(tenantId: string): Promise<GalleryOption[]>;
  /** This studio's galleries among `ids`, in one read (at most 50; ids of another studio are left out). */
  getGalleries(tenantId: string, ids: string[]): Promise<Gallery[]>;
  /** A NEW gallery only (a plain insert: an existing id is an error, never overwritten). */
  putGallery(g: Gallery): Promise<void>;
  /** NEW galleries in one insert: all of them are saved, or none (P70: a list import). */
  putGalleries(list: Gallery[]): Promise<void>;
  /**
   * patchGallery for several of this studio's galleries in one write (P70), each while `only` holds;
   * the ids it wrote.
   */
  patchGalleries(tenantId: string, ids: string[], fields: GalleryFields, only?: GalleryGuard): Promise<string[]>;
  /**
   * Removes this studio's galleries among `ids` that are in the trash, in one request (their hearts, lists,
   * album… go with them and a linked gallery forgets the link: the database's foreign keys); the ids removed.
   */
  deleteGalleries(tenantId: string, ids: string[]): Promise<string[]>;
  /**
   * extendGallery for several galleries in one step (films_galleries_extend, 0133), each only while its
   * closing time is still `seen` (what the studio's screen showed) and it is not in the trash.
   */
  extendGalleries(tenantId: string, items: { id: string; seen: string }[], days: number): Promise<{ id: string; expiresAt: string; days: number }[]>;
  /** The galleries summary (films_dashboard, 0133; worker/dashboard.ts). */
  galleriesSummary(tenantId: string, kinds: { films: boolean; photos: boolean }): Promise<GalleriesSummary>;
  /**
   * Writes only the fields given (undefined clears one), only on this studio's gallery, and only
   * while every `only` guard still holds (null = that field is still empty). The saved gallery,
   * or null when it is gone, belongs to another studio or a guard failed.
   */
  patchGallery(tenantId: string, id: string, fields: GalleryFields, only?: GalleryGuard): Promise<Gallery | null>;
  deleteGallery(id: string): Promise<void>;
  /** 'guest_view': a view through the guests' link, counted apart from the couple's (P72). */
  countEvent(id: string, type: CountedEvent): Promise<void>;

  getSecret(tenantId: string, key: string): Promise<string | null>;
  /** null deletes. */
  setSecret(tenantId: string, key: string, value: string | null): Promise<void>;

  /**
   * Quote request from the studio page -> the hub's leads list + a bell notification, in one call
   * (films_insert_studio_lead, 0154). A lead of the same studio with the same phone (any spelling) in the last 30 days
   * is not written again and rings no second bell: `duplicate` (fix plan P10).
   */
  insertLead(tenantId: string, lead: Lead): Promise<{ duplicate: boolean }>;

  /** A photo gallery's list (null before the studio loaded a folder). */
  getPhotos(galleryId: string): Promise<PhotoData | null>;
  /** The list with its version (raised by the database on every save). */
  getPhotosVersioned(galleryId: string): Promise<{ data: PhotoData; version: number } | null>;
  /**
   * Saves the list only if its version is still `expected` (null = there was none yet); false when
   * someone saved first. Throws HttpError(404) when the gallery itself is gone. Without `expected`
   * it writes unconditionally (test seeding only; the Worker always passes it, see editPhotos).
   */
  savePhotos(tenantId: string, galleryId: string, data: PhotoData, expected?: number | null): Promise<boolean>;
  /**
   * One photo of this studio's gallery for the photo route (films_photo_item, 0131), instead of the whole list:
   * `data` holds the list's folder fields and, as its items, the photo and (`copies`) the photos that may be
   * copies of it for "full quality" (largestCopy picks). null = no such gallery for this studio, or no list;
   * `item` null = no photo with that key. `visibleVersion` is read with the photo (the edge-cache key for it).
   */
  getPhotoItem(tenantId: string, galleryId: string, key: string, opts?: { copies?: boolean }): Promise<PhotoItemRead | null>;
  /**
   * An edit written as what changed (films_photos_patch, 0131; diffPhotoData makes it): only while the version
   * is still `expected` ('conflict' otherwise); sets the photo count, the cover key and both versions.
   * null = no such gallery for this studio, or no list. Throws on a patch that doesn't fit the list.
   */
  patchPhotos(tenantId: string, galleryId: string, expected: number, diff: PhotoDiff): Promise<PatchedPhotos | 'conflict' | null>;
  /**
   * Who hearted each photo: { key: ['מאי', ''] } ('' = no name given), every heart (page by page), also of
   * photos no longer in the list (decision D16(3): kept; heartsFor shows only the list's photos).
   */
  listHearts(galleryId: string): Promise<Record<string, string[]>>;
  /** `who`'s heart on these photos, on or off: added in one write, taken off in groups of 200 (P70). */
  setHearts(tenantId: string, galleryId: string, keys: string[], on: boolean, who: string): Promise<void>;

  /** The couple's album for a photo gallery (null before they start), with its `rev`. */
  getAlbum(galleryId: string): Promise<Album | null>;
  /**
   * Saves the album (its `rev` is never stored inside it). With `expect`, only onto that rev and/or only onto a draft
   * (fix plan P57, films_album_put); without, whatever is there (tests).
   */
  putAlbum(tenantId: string, galleryId: string, album: Album, expect?: AlbumExpect): Promise<AlbumWrite>;
  /**
   * The album as the couple SENT it (fix plan P55, 0140: films_albums.print_data, kept by the database on every write
   * of a sent album) — what the print shop gets — and whether the album is open for the couple again (`open`: the
   * print link is paused). null = no album yet; `album` null = never sent.
   */
  getPrintAlbum(galleryId: string): Promise<PrintAlbum | null>;
  /** Albums the couples sent (films_albums status 'submitted'), newest first. */
  listSubmittedAlbums(tenantId: string): Promise<{ galleryId: string; submittedAt: string }[]>;
  /**
   * Galleries in the trash since before `iso`, taken in turns between studios, those that failed
   * before last (films_trash_candidates, 0105). `total` = how many are waiting in all. P71 (0135): galleries whose
   * album order keeps them come apart, in `blocked` (at most 50) and `blockedTotal`, never in `ids`.
   */
  trashCandidates(iso: string, limit: number): Promise<{ ids: string[]; total: number; blocked?: BlockedTrash[]; blockedTotal?: number }>;
  /**
   * The album and album order of this studio's galleries among `ids`, in one read (films_album_guards, 0135);
   * galleries with neither are not in the answer.
   */
  albumGuards(tenantId: string, ids: string[]): Promise<Record<string, AlbumGuardState>>;
  /** Removing it from the trash failed: it goes to the end of the queue. */
  markPurgeFailed(galleryId: string): Promise<void>;
  /** Old rate-limit rows of the films Worker (nightly). */
  sweepRateHits(): Promise<void>;
  /** One row in films_cleanup_runs (0105). */
  recordCleanupRun(run: CleanupRun): Promise<void>;
  /** Requests this store has sent so far (Cloudflare counts them per run: the clean-up's budget). */
  callCount(): number;
  /** Guest face search (0081): what was uploaded for a gallery (one read, no list of photos). */
  facesMeta(galleryId: string): Promise<FacesMeta>;
  /** The photos scanned (films_faces_done_keys, 0136): the studio's scan page. */
  facesDone(galleryId: string): Promise<string[]>;
  /** Whether face search is on, read alone (not the whole photo list, P68). */
  faceSearchOn(galleryId: string): Promise<boolean>;
  /**
   * Stores one chunk of face numbers (private bucket) and records it; a chunk whose photos were all scanned already
   * is not added (`duplicate`) and its file is deleted.
   */
  addFacesChunk(tenantId: string, galleryId: string, bytes: Uint8Array, keys: string[], faces: number): Promise<FacesMeta>;
  /** Chunk n (from 0): its bytes as stored and the photos a guest may get from it. null = none. */
  facesChunk(galleryId: string, n: number): Promise<FaceChunkRead | null>;
  /**
   * Photos hidden or gone from the folder (films_faces_remove, 0136): out of what guests download at once, their
   * files marked for rewriting (rewriteFaceFiles in faces.ts). How many were removed.
   */
  removeFaceKeys(galleryId: string, keys: string[]): Promise<{ removed: number; version: number }>;
  /** Files to rewrite: the marked ones (keys null) or those holding these photos, at most `limit`. */
  facePlan(galleryId: string, keys: string[] | null, limit: number): Promise<FacePlan>;
  /** A face file's bytes (null = gone). */
  faceFile(name: string): Promise<Uint8Array | null>;
  /**
   * Rewritten files in place of the old ones: the new files are stored, swapped in one call (films_faces_swap, only
   * while the old file is still listed; the version goes up), then the old files deleted. The swapped old names.
   */
  swapFaceFiles(galleryId: string, swaps: FaceSwap[]): Promise<string[]>;
  /** Galleries with files to rewrite, for the clean-up (films_faces_dirty_candidates); those that failed before last. */
  faceDirtyCandidates(limit: number): Promise<{ ids: string[]; total: number }>;
  /** One guest search, with the consent ticked (films_face_searches, 0136): no selfie, no address. */
  logFaceSearch(tenantId: string, galleryId: string, role: FaceSearchRole, consent: string): Promise<void>;
  /**
   * Every face number of a gallery: the files, then the record. `searchOff` also switches face search
   * off in the gallery when there was face data (decision D06(2): guests never see an empty search; a gallery never
   * scanned keeps its switch) and marks the gallery (`facesOffAt`, 0136: the studio is told on extend and restore).
   */
  deleteFaces(galleryId: string, opts?: { searchOff?: boolean }): Promise<void>;
  /** Galleries that have face data, in id order (tests). */
  faceGalleryIds(): Promise<string[]>;
  /** Which of these galleries have face data (a films_faces record), in one read. */
  faceGalleriesAmong(ids: string[]): Promise<string[]>;
  /**
   * The galleries whose face data must go, chosen by the database (films_faces_cleanup_candidates,
   * 0105), with the reason; those that failed before last. `total` = how many are waiting in all.
   */
  faceCleanupCandidates(opts: { maxAgeDays: number; graceDays: number; limit: number }): Promise<{ items: FaceCleanupCandidate[]; total: number }>;
  /** Deleting its face data failed: it goes to the end of the queue. */
  markFaceCleanupFailed(galleryId: string): Promise<void>;
  /** The hub's album order for a designed album (0080): whether the studio has album orders (crm), its extra-page price, the order. */
  albumOrderState(galleryId: string): Promise<AlbumOrderState>;
  /**
   * The couple's album portal asks for the photos of the studio's sketch (work order item 42, port B10; 0173
   * films_album_design_bank): by the SHA-256 of the portal link — the order (not revoked), a studio that is not
   * suspended and has `photos`, a design open to the couple → its studio, order and gallery ids; else why not.
   */
  albumDesignBank(tokenHash: string): Promise<AlbumDesignBank>;
  /**
   * The couple sent their album: make or refresh its order (and notify the studio); P57: it may join the studio's open
   * order of the gallery's event (`joined`). null = the studio has no album orders.
   */
  albumOrderFromDesign(galleryId: string, spreads: number, tokenHash: string): Promise<{ id: string; workflowStatus: string; created: boolean; joined?: boolean } | null>;
  /**
   * The studio accepts the page count of an album the couple sent again after paying (P55, 0140,
   * films_album_order_confirm_spreads): the order is set to `spreads`. null = the gallery has no album order.
   */
  confirmAlbumSpreads(galleryId: string, spreads: number): Promise<{ id: string; spreads: number; before: number | null } | null>;
  /** The clean-up (P55): print links past their `days` go (films_print_links_expire). How many. */
  expirePrintLinks(days: number): Promise<number>;
  /**
   * The clean-up (P55, decision D17(3)): the public galleries of studios cancelled more than `graceDays` (at least 30)
   * ago close and their print links go (films_close_lapsed_studios). Called only from the clean-up.
   */
  closeLapsedStudios(graceDays: number): Promise<{ studios: number; galleries: number; printLinks: number }>;
  /** Whether an event (the hub's events) is this studio's (P57: a gallery is linked only to its own studio's event). */
  eventInStudio(tenantId: string, eventId: string): Promise<boolean>;

  /** A gallery's personal lists, oldest first. */
  listLists(galleryId: string): Promise<PhotoList[]>;
  /**
   * The list of this name gets `list.keys` (added at the end), or a new list with `list.id` is made,
   * at most MAX_LISTS per gallery ('too_many'). The studio comes from the gallery. null = no gallery.
   */
  createList(galleryId: string, list: PhotoList): Promise<PhotoList | 'too_many' | null>;
  /** Adds (on) or removes keys in one step, so two marks at once both stay. null = no such list. */
  toggleList(galleryId: string, listId: string, keys: string[], on: boolean): Promise<PhotoList | null>;
  /** Only the name. Throws HttpError(400) when another list of the gallery has it. null = no such list. */
  renameList(galleryId: string, listId: string, name: string): Promise<PhotoList | null>;
  deleteList(galleryId: string, listId: string): Promise<void>;

  /** Photos the couple marked for Instagram, in the order they were marked (every mark, page by page). */
  listInsta(galleryId: string): Promise<string[]>;
  /** Marks these photos, or takes the marks off: one write, or groups of 200 (P70). */
  setInstaMany(tenantId: string, galleryId: string, keys: string[], on: boolean): Promise<void>;

  /** Slideshow song files (private storage). getMusic forwards Range; null when missing. */
  putMusic(tenantId: string, id: string, bytes: ArrayBuffer, type: string): Promise<void>;
  getMusic(tenantId: string, id: string, range: string | null): Promise<Response | null>;
  deleteMusic(tenantId: string, id: string): Promise<void>;

  /**
   * Counts one hit in `key`; false when `max` hits already happened in the window (rate_hit, 0154). When the count
   * cannot be read it answers true (a couple is never blocked by a hiccup) — or throws with `failClosed` (the studio
   * page's lead form, fix plan P10: the caller answers 503).
   */
  hit(key: string, max: number, windowSeconds: number, opts?: { failClosed?: boolean }): Promise<boolean>;
  /**
   * Wrong passwords or codes in `key` during the window, after counting one more when `add`
   * (films_rate_count, migration 0104). Throws when it can't tell: the caller refuses then.
   */
  failures(key: string, windowSeconds: number, add: boolean): Promise<number>;
  /** A bell notification for the studio's managers in the hub. */
  notifyStudio(tenantId: string, n: { type: string; title: string; body: string }): Promise<void>;
  /**
   * An email to the studio's active owners through the platform's own mail (the films-link-alert function, which
   * sends only from the verified sender of fix plan P11-b): 'sent', 'skipped' (no verified sender, or no owner email)
   * or 'failed'. Never throws. The bell is written apart and first (notifyStudio).
   */
  emailStudio(tenantId: string, mail: StudioMail): Promise<'sent' | 'skipped' | 'failed'>;
  /** What stops when the studio disconnects Dropbox (films_dropbox_impact, 0153; P65). */
  dropboxImpact(tenantId: string): Promise<DropboxImpact>;
  /**
   * The nightly link check's next open film galleries (films_link_check_candidates, 0153; P65): after `after` in id
   * order (from `start` inclusive when given), at most `limit`, only studios couples can reach.
   */
  filmCheckCandidates(opts: { after?: string; start?: string; limit: number }): Promise<FilmCheckGallery[]>;

  /** The couple accepted the gallery terms (hashes only, no raw IP). */
  recordTermsAccept(a: TermsAccept): Promise<void>;
  /** Counted by the database (films_terms_summary, 0133), never read row by row. */
  termsAccepts(galleryId: string): Promise<TermsSummary>;
}

/** What the gallery link picker needs of a gallery. */
export interface GalleryOption {
  id: string;
  kind: 'films' | 'photos';
  coupleName: string;
  date: string;
  deletedAt?: string;
}

/** One gallery in the summary's lists. */
export interface GalleryBrief {
  id: string;
  coupleName: string;
  kind: 'films' | 'photos';
  date: string;
  daysLeft: number;
  views: number;
  downloads: number;
  /** Its closing time as saved: the extend dialog sends it back (films_galleries_extend extends only while it holds). */
  expiresAt: string;
}

export interface GalleriesSummary {
  open: number;
  closed: number;
  trash: number;
  closing: GalleryBrief[];
  mostViewed: GalleryBrief[];
  albumsSent: { galleryId: string; coupleName: string; submittedAt: string }[];
}

/**
 * The fields the galleries list reads (fix plan P70): never the password, the download code, the print token or
 * the guests' id, nor the folder, the song or the photo versions. SupabaseStore selects these columns only.
 */
export const GALLERY_LIST_FIELDS = [
  'id', 'tenantId', 'kind', 'coupleName', 'studioName', 'date', 'venue', 'days', 'createdAt', 'expiresAt', 'hasCover', 'films',
  'photoCount', 'linkedId', 'deletedAt', 'coverKey', 'hasThumb', 'views', 'guestViews', 'downloads', 'coverVersion', 'photosGen',
  // The hub event the gallery belongs to (the album sketch editor finds the event's photos by it — port B9).
  'eventId',
] as const satisfies readonly (keyof Gallery)[];

/** A gallery as the list reads it (MemoryStore's copy of SupabaseStore's column list). */
export function listView(g: Gallery): Gallery {
  const out: Record<string, unknown> = {};
  for (const k of GALLERY_LIST_FIELDS) if (g[k] !== undefined) out[k] = g[k];
  return out as unknown as Gallery;
}

/** Hearts or marks are taken off this many photos per request (the keys go in the address). */
export const KEYS_PER_DELETE = 200;

export interface PhotoItemRead {
  data: PhotoData;
  item: PhotoItem | null;
  version: number;
  visibleVersion: number;
}

/** The top-level fields of a photo list an edit may change (films_photos_patch refuses any other). */
export const PHOTO_EDIT_FIELDS = ['sets', 'cover', 'timeOrder', 'coverPos', 'faceSearch', 'design', 'timesV'] as const;
export type PhotoEditField = (typeof PHOTO_EDIT_FIELDS)[number];

/** An edit of a photo list as what changed (diffPhotoData): whole photos by key, the order, the edit fields (null = removed). */
export interface PhotoDiff {
  items: Record<string, PhotoItem>;
  /** Every key in the new order; null = the order did not change. */
  order: string[] | null;
  fields: Partial<Record<PhotoEditField, unknown>>;
}

export interface PatchedPhotos {
  version: number;
  photoCount: number;
  coverKey: string | null;
  visibleVersion: number;
}

export type FaceCleanupReason = 'gone' | 'trashed' | 'closed' | 'off' | 'too_old' | 'studio_ended' | 'orphan_files';
export interface FaceCleanupCandidate {
  galleryId: string;
  reason: FaceCleanupReason;
}

/** What one clean-up run did (films_cleanup_runs). */
export interface CleanupRun {
  facesRemoved: number;
  purged: number;
  errors: { step: string; id?: string; error: string }[];
  pendingFaces: number;
  pendingTrash: number;
  subrequests: number;
  /** Why it stopped early: 'budget' or 'time' (null = everything waiting was done). */
  stopped: string | null;
  /** Galleries in the trash past their 30 days kept for their album order (P71): skipped and reported. */
  blocked?: number;
}

export interface TermsAccept {
  tenantId: string;
  galleryId: string;
  termsHash: string;
  ipHash: string;
  userAgent: string;
  /** Through the couple's link or the guests' (records from before 0104 have neither). */
  role: 'couple' | 'guest';
  /** The id in the address that was opened (the couple's or the guests'). */
  linkId: string;
}

/**
 * What the studio sees: the couple's acceptances (how many, first and last, ISO, '' when never),
 * apart from guests' ones and older records that don't say who accepted.
 */
export interface TermsSummary {
  count: number;
  first: string;
  last: string;
  guests: number;
  unknown: number;
}

/** The studio's summary from the acceptances, oldest first. */
export function termsSummary(rows: { acceptedAt: string; role: string | null }[]): TermsSummary {
  const couple = rows.filter((r) => r.role === 'couple');
  return {
    count: couple.length,
    first: couple[0]?.acceptedAt ?? '',
    last: couple[couple.length - 1]?.acceptedAt ?? '',
    guests: rows.filter((r) => r.role === 'guest').length,
    unknown: rows.filter((r) => r.role !== 'couple' && r.role !== 'guest').length,
  };
}

export const DROPBOX_SECRET = 'dropbox_refresh_token';

/** An alert mailed to a studio's owners (P65: a film the nightly check found broken). Plain text, no addresses. */
export interface StudioMail {
  kind: 'films_link_broken';
  galleryId: string;
  coupleName: string;
  /** The films' titles, as the studio named them. */
  films: string[];
}

/** What depends on the studio's Dropbox connection (P65). */
export interface DropboxImpact {
  /** Open photo galleries read through the connection. */
  photoGalleries: number;
  /** Films in open film galleries streamed with it, and how many galleries hold them. */
  films: number;
  filmGalleries: number;
}

/** An open film gallery for the nightly link check (P65). */
export interface FilmCheckGallery {
  id: string;
  tenantId: string;
  coupleName: string;
  films: Film[];
}

/** Personal lists per gallery (also enforced by films_photo_list_create, migration 0103). */
export const MAX_LISTS = 20;
export const LIST_NAME_TAKEN = 'כבר יש רשימה בשם הזה';

/** Gallery fields patchGallery may write: never the id, studio, kind, creation time, the counters or the photo versions. */
export type GalleryFields = Partial<Omit<Gallery, 'id' | 'tenantId' | 'kind' | 'createdAt' | 'views' | 'downloads' | 'guestViews' | 'photosVersion' | 'photosVisibleVersion' | 'photosGen' | 'facesOffAt'>>;
export type CountedEvent = 'view' | 'download' | 'guest_view';
/** patchGallery writes only while these still hold: a value, or null = still empty. */
/** setSlug's refusals (P73, the trigger on tenants in 0134): the same words from both stores. */
export const SLUG_TAKEN = 'הכתובת הזו כבר תפוסה';
export const SLUG_INVALID = 'כתובת לא תקינה: אותיות באנגלית קטנות, ספרות ומקף, 3-40 תווים';
export const SLUG_RESERVED = 'הכתובת שמורה לסטודיו אחר';
export const SLUG_CHANGES_LIMIT = 'אפשר לשנות את הכתובת עד 3 פעמים ב-30 יום. נסו שוב בהמשך.';
/** How long an address a studio gave up stays its own, and how many changes a studio may make in 30 days. */
export const SLUG_KEPT_DAYS = 365;
export const SLUG_CHANGES_PER_30_DAYS = 3;
/** A mit4mit business page is one studio's (the unique index of 0135). */
export const MIT4MIT_TAKEN = 'דף העסק הזה ב-mit4mit כבר מקושר לסטודיו אחר. אם זה הדף שלכם, פנו אלינו.';

export type GalleryGuard = Partial<Record<'guestId' | 'printToken' | 'linkedId' | 'deletedAt', string | null>>;

const GALLERY_WRITABLE: (keyof GalleryFields)[] = [
  'coupleName', 'studioName', 'date', 'venue', 'days', 'expiresAt', 'hasCover', 'folderUrl', 'folderProvider', 'films',
  'photoCount', 'linkedId', 'music', 'guestId', 'password', 'downloadPin', 'printToken', 'printTokenAt', 'deletedAt', 'coverKey', 'hasThumb',
  'coverVersion', 'eventId',
];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What the studio really changed between the copy it read and the edited one (a removed value stays, as undefined). */
export function galleryChanges(before: Gallery, after: Gallery): GalleryFields {
  const out: Record<string, unknown> = {};
  for (const k of GALLERY_WRITABLE) if (!same(before[k], after[k])) out[k] = after[k];
  return out as GalleryFields;
}

export function studioChanges(before: FilmsStudio, after: FilmsStudio): Partial<FilmsStudio> {
  const out: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof FilmsStudio>) if (!same(before[k], after[k])) out[k] = after[k];
  return out as Partial<FilmsStudio>;
}

export function defaultFilmsStudio(): FilmsStudio {
  return {
    defaultDays: 30,
    termsText: null,
    contactLine: '',
    vimeo: '',
    youtube: '',
    headline: '',
    about: '',
    pageEnabled: false,
    showcase: { films: [] },
    reviews: [],
  };
}

let memoryStore: Store | null = null;

/**
 * The store for this request. Supabase whenever it is configured; the in-memory
 * store only when it is not AND CLOUD_MOCK is on (tests, local previews), so a
 * misconfigured production Worker fails loudly instead of silently using memory.
 */
export async function storeFor(env: Env): Promise<Store> {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    const { SupabaseStore } = await import('./store-supabase');
    return new SupabaseStore(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  }
  if (env.CLOUD_MOCK) {
    if (!memoryStore) {
      const { MemoryStore } = await import('./store-memory');
      memoryStore = new MemoryStore();
    }
    return memoryStore;
  }
  throw new Error('films worker: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
}
