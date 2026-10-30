// Reads the reviews shown on a studio's public mit4mit page (mit4mit.co.il/biz/<id>).
// Runs only when the studio presses "ייבא המלצות"; every review keeps a link back to mit4mit.

import { decodeEntities } from '../shared/entities';

// Legal decision 2026-10-02 (3): the declaration the studio confirms on its first import. It lives here, not in
// worker/index.ts, because the Worker's entry module may export only handlers (workerd refuses any other export).
export const MIT4MIT_DECLARATION = 'אני מאשר/ת שזה דף העסק של הסטודיו שלי ב-mit4mit, ושהעתקת ההמלצות והצגתן בדף הסטודיו הן באחריות הסטודיו בלבד';

export interface ImportedReview {
  name: string;
  /** 0–100 as mit4mit shows it ("100 מתוך 100"), or 0 when missing. */
  score: number;
  text: string;
  /** mit4mit's relative time, e.g. "לפני 9 שנים". */
  when: string;
  /** Who the review is (fix plan P71): mit4mit's own id for it ("id:<n>", its data-id) when the page has one. */
  ext?: string;
}

/** Reviews read from one page (mit4mit shows the latest ones there). */
const MAX = 20;

/** The business number of a mit4mit page address ("/biz/15100" → "15100"), or null. */
export function mit4mitBizId(input: string): string | null {
  const page = isMit4mitUrl(input);
  return page ? (/\/biz\/(\d{1,12})$/.exec(page)?.[1] ?? null) : null;
}

/**
 * A review's identity keys (fix plan P71): mit4mit's id when there is one, and always its name with the start of
 * its text (what reviews imported before P71 are known by). A review matches another when any key is shared.
 */
export function reviewKeys(r: { name: string; text: string; ext?: string }): string[] {
  const byText = `t:${r.name.trim()}|${r.text.trim().slice(0, 40)}`;
  return r.ext ? [r.ext, byText] : [byText];
}

export function isMit4mitUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    if (!/(^|\.)mit4mit\.co\.il$/.test(u.hostname)) return null;
    const m = /\/biz\/(\d+)/.exec(u.pathname);
    return m ? `https://www.mit4mit.co.il/biz/${m[1]}` : null;
  } catch {
    return null;
  }
}

function decode(s: string): string {
  return decodeEntities(s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function inner(block: string, cls: string): string {
  const m = new RegExp(`<(\\w+)[^>]*class="${cls}"[^>]*>([\\s\\S]*?)</\\1>`).exec(block);
  return m ? m[2] : '';
}

export function parseMit4mit(html: string): ImportedReview[] {
  const blocks = html.split(/(?=<div class="displayEngine_review displayEngine_element)/).slice(1);
  const out: ImportedReview[] = [];
  for (const b of blocks.slice(0, MAX)) {
    const id = /^<div class="displayEngine_review displayEngine_element[^"]*"[^>]*\sdata-id="(\d{1,20})"/.exec(b)?.[1];
    const name = decode(/itemprop="author"[\s\S]*?<span itemprop="name">([\s\S]*?)<\/span>/.exec(b)?.[1] ?? inner(b, 'userName'));
    const when = decode(/<div class="writeTime" itemprop="datePublished">([\s\S]*?)<\/div>/.exec(b)?.[1] ?? '');
    const score = Number(/(\d+)\s*מתוך\s*100/.exec(decode(inner(b, 'rankScore ?')) || decode(/class="rankScore"[^>]*>([\s\S]*?)<\/div>/.exec(b)?.[1] ?? ''))?.[1] ?? 0);
    // The text is split into a visible part and a "read more" part; join them without the "...".
    const textHtml = /<div class="reviewText"[^>]*>([\s\S]*?)<\/div>/.exec(b)?.[1] ?? '';
    const text = decode(textHtml.replace(/<span class="reviewTextDotDotDot">[\s\S]*?<\/span>/, ''));
    if (text) out.push({ name: name || 'זוג מאושר', score, text, when, ...(id ? { ext: `id:${id}` } : {}) });
  }
  return out;
}

/** Downloads and parses a mit4mit business page. Throws a readable Hebrew error. */
export async function fetchMit4mitReviews(url: string): Promise<ImportedReview[]> {
  const page = isMit4mitUrl(url);
  if (!page) throw new Error('זה לא נראה כמו קישור לדף עסק ב-mit4mit (צריך להיות בצורה mit4mit.co.il/biz/12345)');
  const res = await fetch(page, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StudioGallery/1.0; +reviews import requested by the business owner)', 'Accept-Language': 'he' },
  });
  if (!res.ok) throw new Error(`mit4mit לא אפשר לקרוא את הדף (קוד ${res.status}). אפשר להוסיף המלצות ידנית.`);
  const reviews = parseMit4mit(await res.text());
  if (reviews.length === 0) throw new Error('לא נמצאו המלצות בדף. אפשר להוסיף המלצות ידנית.');
  return reviews;
}
