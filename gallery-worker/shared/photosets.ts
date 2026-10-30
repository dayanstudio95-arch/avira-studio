// The studio's own sets, in the order the couple sees them. A cloud folder becomes one of these
// only when its name says so ("02 התארגנות"); other folders (per photographer, "טופ1"…) are just folders.
export const PRESET_SETS = ['טיזר', 'התארגנות', 'צילומי חוץ', 'משפחות', 'אולם', 'טקס חופה', 'מסיבה', 'בחירת אלבום'] as const;

const norm = (s: string) => s.replace(/[\s_\-.]+/g, ' ').trim();

/** The preset a folder name refers to, or '' ("02_צילומי-חוץ" → "צילומי חוץ"; "מאי ואופק 1" → ""). */
export function presetForFolder(folder: string): string {
  const n = norm(folder.replace(/^\s*\d+\s*[-_.)]*\s*/, ''));
  return PRESET_SETS.find((p) => n === p || n.includes(p)) ?? '';
}

/** "טופ1", "top 2", "2top", "מאי ואופק טופ2"… — the folders that hold the teaser photos. */
export function isTopFolder(name: string): boolean {
  return /(^|[\s_-])\d*\s*(טופ|top)\s*\d*$/i.test(name.trim());
}

/**
 * Photos per call when the studio's screen reads capture times (`…/photos/dates`, fix plan P62, sizes
 * P64). A call may send about 50 requests in all on the free plan; each photo can cost up to:
 * Dropbox 2 (Dropbox busy → asked once more), Drive with a key 2 (a redirect), Drive without a key 4
 * (Google's download page redirects), pCloud 4 (the file's address, the file; an address that expired
 * early → both again). With the call's own requests (sign-in check, studio, gallery, Dropbox token)
 * the worst case stays under 50 — P62's 30 Dropbox / 12 pCloud went past it (test/supabase-calls).
 */
export const DATES_BATCH: Record<string, number> = { dropbox: 20, 'dropbox-link': 20, gdrive: 20, 'gdrive-nokey': 10, pcloud: 8 };

/**
 * The size for a gallery's cloud. Drive without the studio's Google API key reads fewer; the studio's
 * screen doesn't know about the key, so it asks with the larger size and the Worker answers the rest
 * as `skipped` together with its `batch` size, which the screen then uses.
 */
export function datesBatchSize(provider: string | undefined, opts: { googleApiKey?: boolean } = {}): number {
  if (provider === 'gdrive' && opts.googleApiKey === false) return DATES_BATCH['gdrive-nokey'];
  return DATES_BATCH[provider ?? ''] ?? 20;
}
