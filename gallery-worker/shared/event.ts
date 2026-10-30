// Reads "couple date venue" from free text: a pasted list of events, or a cloud folder's name.

export interface EventLine {
  coupleName: string;
  /** ISO yyyy-mm-dd, or '' when the line has no date. */
  date: string;
  venue: string;
}

// Year first ("2026-06-14", what the hub and date pickers write) is tried before day first
// ("14/6/26"). A date must not be part of a longer number ("123/4/56", "14/6/2026123"): the
// character before it is captured instead of using a lookbehind, which older Safari (the hub's
// browsers) can't parse.
const ISO_RE = /(^|\D)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/;
const DMY_RE = /(^|\D)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;

interface Found {
  /** Where the date itself starts and ends in the text. */
  start: number;
  end: number;
  /** ISO yyyy-mm-dd, or '' when it looks like a date but isn't one (31/2, 40/13). */
  iso: string;
}

/** A day that really exists (so 31/2 and 29/2/2027 are not dates). */
function isoIf(year: number, month: number, day: number): string {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return '';
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function findDate(text: string): Found | null {
  const iso = ISO_RE.exec(text);
  if (iso) {
    const start = iso.index + iso[1].length;
    return { start, end: iso.index + iso[0].length, iso: isoIf(Number(iso[2]), Number(iso[3]), Number(iso[4])) };
  }
  const m = DMY_RE.exec(text);
  if (!m) return null;
  const year = Number(m[4]) + (m[4].length === 2 ? 2000 : 0);
  return { start: m.index + m[1].length, end: m.index + m[0].length, iso: isoIf(year, Number(m[3]), Number(m[2])) };
}

/** A real day written as yyyy-mm-dd (what the gallery keeps). */
export function isIsoDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return Boolean(m && isoIf(Number(m[1]), Number(m[2]), Number(m[3])));
}

/** "14/6/26", "11.8.26", "4-6-2026", "2026-06-14" → "2026-06-14". Anything else (31/2 too) → ''. */
export function parseDate(text: string): string {
  return findDate(text)?.iso ?? '';
}

/** Trims separators people type between the parts: " - ", "|", ",", stray dots. */
function tidy(s: string): string {
  return s.replace(/^[\s\-–—|,.:]+/, '').replace(/[\s\-–—|,.:]+$/, '').replace(/\s+/g, ' ').trim();
}

export function parseEventLine(line: string): EventLine {
  const found = findDate(line);
  if (!found) return { coupleName: tidy(line), date: '', venue: '' };
  const before = tidy(line.slice(0, found.start));
  const after = line.slice(found.end);
  if (before) return { coupleName: before, date: found.iso, venue: tidy(after) };
  // The date first ("14.6.26 רוני ורז - אלה"): the names come after it, then the venue.
  const [names, ...rest] = tidy(after).split(/\s[-–—|]\s|\|/);
  return { coupleName: tidy(names), date: found.iso, venue: tidy(rest.join(' - ')) };
}

/** One event per line; blank lines and exact repeats are dropped. */
export function parseEventList(text: string): EventLine[] {
  const seen = new Set<string>();
  const out: EventLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const key = line.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parseEventLine(line));
  }
  return out;
}
