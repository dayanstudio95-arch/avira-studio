// "דניאל וסבינה" → "דניאל & סבינה": the way couples' names look on invitations and on the gallery.
// Only a suggestion (P72, D15): the hub's gallery form offers it and the studio may keep the name as
// written; the server stores names exactly as they were sent.

/**
 * Family names that start with ו: "דניאל וייס" is one person, not "דניאל & ייס".
 * Written without niqqud; a word here is never read as "and".
 */
const VAV_SURNAMES = new Set([
  'וייס', 'ווייס', 'ויס', 'וולך', 'וקנין', 'ואקנין', 'ווזנה', 'וולף', 'וולפסון', 'ויינברג', 'וינברג', 'ויינר', 'וינר',
  'ויסמן', 'וקסלר', 'ויצמן', 'ויינשטיין', 'וינשטיין', 'ורטהיים', 'וגנר', 'וענונו', 'ויזל', 'ויסברג', 'ויינטראוב', 'וינטרוב',
  'וולוך', 'ווקנין', 'ויזר', 'וולפמן', 'וסרמן', 'ווסרמן',
]);

/** A word that may be "ו" + a name: not the first word, not a known family name, more than the ו itself. */
const joins = (word: string, i: number) => i > 0 && word.length > 1 && word.startsWith('ו') && !VAV_SURNAMES.has(word.replace(/[^א-ת]/g, ''));

/** The name with "&" in place of the joining ו; the name itself when there is nothing to change. */
export function withAmpersand(input: string): string {
  const name = input.replace(/\s+/g, ' ').trim();
  if (!name || name.includes('&')) return name;
  // Separate "ו": "דניאל ו סבינה"
  const loose = /^(.+?) ו (.+)$/.exec(name);
  if (loose) return `${loose[1]} & ${loose[2]}`;
  // Joined "ו": split before the last word that can carry it ("X ויקי ואלון" → before "ואלון",
  // "רונית ודניאל וייס" → before "ודניאל"). One ו goes, so "X וורד" → "X & ורד".
  const words = name.split(' ');
  let at = -1;
  words.forEach((w, i) => {
    if (joins(w, i)) at = i;
  });
  if (at < 0) return name;
  return `${words.slice(0, at).join(' ')} & ${[words[at].slice(1), ...words.slice(at + 1)].join(' ')}`;
}
