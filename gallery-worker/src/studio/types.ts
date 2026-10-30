import type { WatchFilm } from '../watch/types';

export interface StudioReview {
  name: string;
  score: number;
  text: string;
  when: string;
  source: 'mit4mit' | 'manual';
}

export interface StudioData {
  slug: string;
  studioName: string;
  logoUrl: string;
  accentColor: string;
  headline: string;
  about: string;
  phone: string;
  whatsapp: string;
  instagram: string;
  facebook: string;
  vimeo: string;
  youtube: string;
  films: WatchFilm[];
  mit4mitUrl: string;
  reviews: StudioReview[];
  /** Cloudflare Turnstile's public key for the quote form; '' = the form asks no human check (fix plan P10). */
  turnstileSiteKey?: string;
}
