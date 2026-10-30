import type { FilmTag } from '../../shared/dropbox';

export interface WatchVersion {
  /** '4K', '1080p'… or '' when the file name carries no quality. */
  label: string;
  height: number;
  watchUrl: string;
  downloadUrl: string;
  sizeBytes: number;
  playable: boolean;
}

export interface WatchFilm {
  title: string;
  tag: FilmTag;
  /** The default (largest) version, kept for simple use. */
  watchUrl: string;
  downloadUrl: string;
  sizeBytes: number;
  playable: boolean;
  /** Ordered from the largest picture down. One entry when there is a single file. */
  versions: WatchVersion[];
  /** Chapters of a long film (seconds, title). */
  chapters?: { t: number; title: string }[];
}

export interface PhotoList {
  id: string;
  name: string;
  keys: string[];
}

export interface PublicPhoto {
  key: string;
  name: string;
  set: string;
  ar: number;
}

export interface PublicPhotos {
  sets: { id: string; name: string }[];
  items: PublicPhoto[];
  cover: string;
  /** Which point of the cover stays in view (percent). */
  coverPos?: { x: number; y: number };
  base: string;
  recommended: number;
  /** The slideshow song ('' = silent). */
  music?: string;
  /** Guests can find their photos with a selfie. */
  faceSearch?: boolean;
  /** The studio disconnected the Dropbox these photos are read through (P65). */
  cloudOff?: boolean;
  /** The gallery's look (cover, fonts, colours, grid). */
  design?: import('../../shared/design').Design;
}

export interface WatchData {
  id: string;
  kind?: 'films' | 'photos';
  photos?: PublicPhotos | null;
  favorites?: string[];
  /** Who hearted each photo ('' = no name). */
  favBy?: Record<string, string[]>;
  /** Photos the couple marked for Instagram. */
  insta?: string[];
  /** The couple's personal lists (not for the album). */
  lists?: PhotoList[];
  /** The couple's link, or the guests' link (view and download only). */
  role?: 'couple' | 'guest';
  /** The couple's photo gallery: the address to send to guests. */
  guestPath?: string;
  /** Behind a password: only the names came. */
  locked?: boolean;
  /** Full-quality downloads need the studio's code. */
  downloadLocked?: boolean;
  /** The same couple's other gallery (films ↔ photos), when the studio linked them. */
  linked?: { kind: 'films' | 'photos'; path: string } | null;
  coupleName: string;
  date: string;
  venue: string;
  expiresAt: string;
  daysLeft: number;
  expired: boolean;
  coverUrl: string;
  studioName: string;
  logoUrl: string;
  /** Studio accent, or '' for the gallery's own gold. */
  accentColor: string;
  /** The studio's current address in couple links. */
  slug?: string;
  termsText: string;
  contactLine: string;
  /** Studio's Instagram user name without @, or ''. */
  instagram: string;
  films: WatchFilm[];
  folderDownloadUrl: string;
  /** Which cloud "download all" goes to ('' when there is no folder). */
  folderProvider: '' | 'dropbox' | 'dropbox-link' | 'gdrive' | 'myairbridge' | 'pcloud';
}
