// Chapters in a long film ("12:30 חופה"), typed by the studio one per line, and resume points.

export interface Chapter {
  /** Seconds from the start. */
  t: number;
  title: string;
}

const MAX_CHAPTERS = 40;

/** "1:02:03" / "12:30" / "90" → seconds, or null. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.length > 1 && n.slice(1).some((x) => x > 59)) return null;
  return n.reduce((sum, x) => sum * 60 + x, 0);
}

/** 3723 → "1:02:03", 750 → "12:30". */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The studio's lines ("12:30 חופה", "חופה 12:30", "12:30 - חופה") → chapters in time order. Bad lines are skipped. */
export function parseChapters(text: string): Chapter[] {
  const out: Chapter[] = [];
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{1,3}(?::\d{1,2}){0,2})\s*[-–—.:]?\s*(.+)$/.exec(line) ?? /^(.+?)\s*[-–—]?\s*(\d{1,3}(?::\d{1,2}){1,2})$/.exec(line);
    if (!m) continue;
    const [time, title] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const t = parseTime(time);
    const name = title.trim().slice(0, 60);
    if (t === null || !name) continue;
    out.push({ t, title: name });
  }
  return cleanChapters(out);
}

export function chaptersText(chapters: Chapter[] | undefined): string {
  return (chapters ?? []).map((c) => `${formatTime(c.t)} ${c.title}`).join('\n');
}

/** Whatever came from the browser → safe chapters (numbers, short titles, at most 40, sorted, no repeats). */
export function cleanChapters(input: unknown): Chapter[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  const out: Chapter[] = [];
  for (const c of input) {
    const t = Math.floor(Number((c as Chapter)?.t));
    const title = String((c as Chapter)?.title ?? '').trim().slice(0, 60);
    if (!Number.isFinite(t) || t < 0 || t > 86_400 || !title || seen.has(t)) continue;
    seen.add(t);
    out.push({ t, title });
  }
  return out.sort((a, b) => a.t - b.t).slice(0, MAX_CHAPTERS);
}

/** The chapter playing at a moment (or -1 before the first). */
export function chapterAt(chapters: Chapter[], seconds: number): number {
  let at = -1;
  chapters.forEach((c, i) => {
    if (c.t <= seconds) at = i;
  });
  return at;
}

/** A place worth offering "continue from here": past the first half-minute, and not in the last one. */
export function worthResuming(seconds: number, duration: number): boolean {
  return seconds > 30 && (!Number.isFinite(duration) || duration <= 0 || seconds < duration - 30);
}
