import type { FilmTag } from '../shared/dropbox';
import type { Provider } from '../shared/providers';

export interface Env {
  KV: KVNamespace;
  ASSETS: Fetcher;
  /** Set to a non-empty string in tests and local previews to fake every cloud. */
  CLOUD_MOCK?: string;
  /** StudioOS database (service role). Required in production; unset only under CLOUD_MOCK. */
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Platform-level Dropbox app (every studio connects its own account through it). */
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  /** Google API key with the Drive API enabled. Used server-side only. */
  GOOGLE_API_KEY?: string;
  /** Signs the Dropbox OAuth `state`. */
  FILMS_STATE_SECRET?: string;
  /**
   * Seals the studio's Dropbox refresh token in tenant_secrets (worker/secretBox.ts, fix plan P16). The SAME
   * value as the Supabase Edge Functions' secret of that name; set by tools/prod/set-tenant-secrets-key.mjs.
   * Never rotated.
   */
  TENANT_SECRETS_KEY?: string;
  /** The hub's public URL; the Dropbox callback returns there. */
  HUB_URL?: string;
  /** Requests one clean-up run may send (worker/cleanup.ts; 45 fits the free Workers plan). The nightly link check too. */
  CLEANUP_MAX_SUBREQUESTS?: string;
  /**
   * Cloudflare Turnstile on the studio page's quote form (fix plan P10): the public site key (a var, the same one the
   * hub's signup uses — tools/prod/public-config.json) and the secret (a Worker secret). Both set → the form asks;
   * either missing → it works without (the runbook says to set them).
   */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface CachedToken {
  token: string;
  /** Unix ms. */
  expiresAt: number;
  /** Which connection (hash of the refresh token) made it: a token from before a reconnect is not used. */
  refreshHash?: string;
}

export interface DropboxSettings {
  /** Platform-level app (Worker secrets). */
  appKey: string;
  appSecret: string;
  /** This studio's own connection (tenant_secrets.dropbox_refresh_token). */
  refreshToken?: string;
  accountName?: string;
  /** Cache key for access tokens: the studio's tenant id. */
  tokenOwnerId?: string;
}

/** One studio's settings as the providers and pages need them, assembled per request. */
export interface Settings {
  studioName: string;
  logoUrl: string;
  /** Studio accent color (hex) or '' to keep the gallery's own palette. */
  accentColor: string;
  defaultDays: number;
  termsText: string;
  contactLine: string;
  /** Instagram user name without @, so couples can tag the studio. */
  instagram: string;
  /** Studio contact for the public studio page (all optional). */
  phone: string;
  facebook: string;
  vimeo: string;
  youtube: string;
  /** Studio page texts. */
  headline: string;
  about: string;
  dropbox: DropboxSettings;
  /** Google Cloud API key with the Drive API enabled (platform-level). */
  googleApiKey: string;
}

export interface Film {
  title: string;
  tag: FilmTag;
  fileName: string;
  /** Which cloud the file lives in. Galleries saved before this field existed are Dropbox. */
  provider: Provider;
  /**
   * Dropbox: canonical share link. 'dropbox-own': Dropbox's file id (`id:…`, a path only when Dropbox gives none).
   * Drive: file id. MyAirBridge: the file's own URL.
   */
  fileId: string;
  /** 'dropbox-own' in a team account: the team root the file id is read from (Dropbox-API-Path-Root). */
  pathRoot?: string;
  /** MyAirBridge: when the share link stops working, as MyAirBridge said when the folder was read (ISO; P65). */
  providerExpiresAt?: string;
  /** Link the owner pasted or the cloud gave (shown in the admin). */
  sourceUrl: string;
  /** Kept for the admin preview; the couple's page recomputes both from provider + fileId. */
  watchUrl: string;
  downloadUrl: string;
  sizeBytes: number;
  playable: boolean;
  /** Chapters of a long film (seconds, title), typed by the studio. */
  chapters?: { t: number; title: string }[];
}

export interface Gallery {
  id: string;
  /** The studio (tenant) that owns it. */
  tenantId: string;
  /** Films (the films module) or photos (the photos module). Galleries from before are films. */
  kind?: 'films' | 'photos';
  /** Photo galleries: how many photos the couple sees. */
  photoCount?: number;
  /** The same couple's gallery of the other kind (films ↔ photos), linked by the studio. */
  linkedId?: string;
  /** Photo galleries: the slideshow song ('' = the studio's default, 'none' = silent, else a track id). */
  music?: string;
  /** Photo galleries: the guests' address (look and download only). */
  guestId?: string;
  /** Optional: nothing shows until it is typed. */
  password?: string;
  /** Optional: full-quality downloads need this code. */
  downloadPin?: string;
  /** The print shop's private link (/print/<token>), when the studio made one. */
  printToken?: string;
  /**
   * When the print link was made or last renewed (fix plan P55, 0140, films_galleries.print_token_created_at): it works
   * PRINT_LINK_DAYS from then (printLink.ts); cleared with the link (the database's trigger does the same).
   */
  printTokenAt?: string;
  /** In the trash since (ISO): links stop, restorable for 30 days, then removed for good. */
  deletedAt?: string;
  /** Photo galleries: the cover photo's key (a small picture of the couple in the studio's list). */
  coverKey?: string;
  /** Film galleries: a frame from one of the films, taken in the studio's browser (KV `thumb:<id>`), for the list. */
  hasThumb?: boolean;
  coupleName: string;
  /** Override for this couple only. Empty = the studio's current name from Settings. */
  studioName?: string;
  /** ISO yyyy-mm-dd (older galleries may hold free text). */
  date: string;
  /** Where the wedding was, shown under the date. */
  venue?: string;
  /**
   * The studio's event (the hub's events, crm studios) this gallery belongs to (fix plan P57): set from the hub's
   * gallery form only after the Worker checked the event is this studio's (the database checks it too, 0139). The
   * couple's album order joins that event's open order.
   */
  eventId?: string;
  days: number;
  createdAt: string;
  expiresAt: string;
  hasCover: boolean;
  folderUrl?: string;
  folderProvider?: Provider;
  films: Film[];
  /** Couple's views; views through the guests' link are counted apart (films_count_event 'guest_view'). */
  views: number;
  guestViews?: number;
  downloads: number;
  /** Goes up with every new cover, so its address changes and no old copy is shown (P72). */
  coverVersion?: number;
  /**
   * Photo galleries (fix plan P61, 0131; read only — putGallery and patchGallery never write them): the photo
   * list's version (films_photos.version, mirrored), and a number that goes up whenever what the public may see
   * can have changed (a photo hidden or shown again, the folder loaded). Every preview's edge-cache key has it.
   */
  photosVersion?: number;
  photosVisibleVersion?: number;
  /**
   * Photo galleries (fix plan P66, 0132; read only, like the two above): the list's generation (PhotoData.gen,
   * copied by the trigger on every whole save). Every photo address has it (`/api/photos/<id>/v<gen>/<key>`).
   */
  photosGen?: number;
  /**
   * Photo galleries (fix plan P68, 0136; read only): when face search was switched off because its face data was
   * deleted (closed, trash, clean-up). Cleared by the database when the studio switches it on again.
   */
  facesOffAt?: string;
}

export class HttpError extends Error {
  /**
   * `code`: a fixed word the hub can act on (e.g. 'album_submitted': ask, then send again with force). `extra`: more
   * fields of the answer (P57: the saved album with an album save's 409).
   */
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/** The studio's public page for new couples: /<slug>. Stored as `studio:<userId>`. */
export interface StudioPage {
  enabled: boolean;
  showcase: { folderUrl?: string; folderProvider?: Provider; films: Film[] };
  mit4mitUrl?: string;
  reviews: Review[];
  /**
   * The mit4mit business bound to the studio (fix plan P71, 0135): set on the first import, when the studio says
   * the page is its own; the address is locked from then on. Its imported reviews reach the public page only
   * after the platform operator approved it (`mit4mitApproved`).
   */
  mit4mitBizId?: string;
  mit4mitApproved?: boolean;
}

export interface Review {
  id: string;
  name: string;
  score: number;
  text: string;
  when: string;
  visible: boolean;
  source: 'mit4mit' | 'manual';
  /** An imported review's identity on mit4mit (reviewKeys): "id:<n>" when the page gives one (P71). */
  ext?: string;
  /** An imported review that the last import did not find on the page ('לא בעמוד האחרון', P71): kept. */
  stale?: boolean;
}

/** A couple asking for a quote. `lead:<userId>:<id>`, listed in `leads:index:<userId>`. */
export interface Lead {
  id: string;
  coupleName: string;
  phone: string;
  date: string;
  venue: string;
  guests: string;
  note: string;
  createdAt: string;
  status: 'new' | 'handled';
}

// ---------- photo galleries ----------

/** A slideshow song the studio uploaded (the file is in Storage: films-music/<tenant>/<id>). */
export interface MusicTrack {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface PhotoSet {
  id: string;
  name: string;
}

export interface PhotoItem {
  /** Stable short id (hash of where the file lives), used by hearts and URLs. */
  key: string;
  name: string;
  /** Where the file lives: Dropbox path (p:), path inside a shared link (l:), Drive file id (g:), pCloud file id (c:), demo file (m:). */
  ref: string;
  set?: string;
  /** Width / height, measured once from the preview. */
  ar?: number;
  hidden?: boolean;
  /** The cloud folder it came from (e.g. per photographer). Not a set unless named like one. */
  folder?: string;
  /** When it was taken (camera clock, ms), so several photographers' photos interleave in time. */
  t?: number;
  /** File size in bytes, when the cloud tells (to download the largest copy of a photo). */
  size?: number;
  /** Lightroom colour label written into the file ("red", "yellow"… or '' for none). */
  label?: string;
  /** Only on a folder just read, never saved: a Dropbox file kept by its id, as its path ref (P64). */
  alt?: string;
  /**
   * The file's version as its cloud tells it, hashed to 8 characters (fix plan P66): Dropbox rev + content_hash,
   * Drive (with the studio's key) modifiedTime + md5Checksum, pCloud hash + size. None for Drive without a key.
   * A changed version on a folder load: the shape and the time are read again, and the gallery's `gen` goes up.
   */
  v?: string;
}

/** A photo gallery's list (films_photos.data). */
export interface PhotoData {
  folderUrl: string;
  provider: 'dropbox' | 'dropbox-link' | 'gdrive' | 'pcloud' | 'mock';
  /** Team accounts: Dropbox path root the paths are relative to. */
  pathRoot?: string;
  /** false = keep the folder/file-name order instead of the time each photo was taken. */
  timeOrder?: boolean;
  /**
   * 2 = every capture time in the list was read from the file itself (fix plan P64). Before, a photo
   * without one got the time of the photo before it; "full quality" trusts saved times only at 2.
   */
  timesV?: 2;
  /** Which point of the cover photo stays in view (percent, 50/50 = centre). */
  coverPos?: { x: number; y: number };
  /**
   * The gallery's generation (fix plan P66): in every photo address (`/v<gen>/`), so a browser keeps a preview a
   * year and still never shows an old file. Changes only on a folder load that finds another link or a photo
   * whose file changed (nextGen). None = a list saved before (addresses say v0).
   */
  gen?: number;
  sets: PhotoSet[];
  items: PhotoItem[];
  cover?: string;
  /** Guest face search is on (the studio's switch). Off deletes the face data. */
  faceSearch?: boolean;
  /** The gallery's own look (cover, fonts, colours, grid); missing parts follow the studio default. */
  design?: Partial<import('../shared/design').Design>;
}
