// HTML character codes in text read from other sites' pages (a Google Drive folder, a mit4mit page).
// One pass, so "&amp;lt;" stays "&lt;" (never decoded twice), and code points above U+FFFF (emoji)
// come out whole instead of as a broken half.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // Text, not layout: a no-break space reads as an ordinary one.
  nbsp: ' ',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201D',
  ldquo: '\u201C',
  hellip: '\u2026',
  ndash: '\u2013',
  mdash: '\u2014',
};

/** A real Unicode character (not 0, not half of a surrogate pair, not past U+10FFFF), or null. */
function char(cp: number): string | null {
  if (!Number.isInteger(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return null;
  return String.fromCodePoint(cp);
}

/** "&#128512; &amp; &#x5D0;&nbsp;&hellip;" → "😀 & א …". Unknown or out-of-range codes stay as written. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(?:#(\d{1,8})|#x([0-9a-f]{1,7})|([a-z]{2,8}));/gi, (whole, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (dec !== undefined) return char(Number(dec)) ?? whole;
    if (hex !== undefined) return char(parseInt(hex, 16)) ?? whole;
    return NAMED[(name ?? '').toLowerCase()] ?? whole;
  });
}
