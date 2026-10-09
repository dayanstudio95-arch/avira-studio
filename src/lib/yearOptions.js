// The year pickers (2026-10-09, the owner's request: "support the future up to 2050, but keep
// the list short"). Every page used to hard-code 2025–2030, so from 2031 the current year
// wasn't even in its own picker. Now: last year, this year and 4 ahead (6 years — the same
// short list as before), plus any year that already has events, plus the one selected —
// never past LAST_YEAR. Pure — tested in scripts/test-whatsapp-bot.mjs PART 45.
export const FIRST_YEAR = 2020;
export const LAST_YEAR = 2050;

export function yearOptions({ dates = [], selected = null, before = 1, after = 4, now = new Date() } = {}) {
  const cur = now.getFullYear();
  const set = new Set();
  for (let y = cur - before; y <= cur + after; y++) set.add(y);
  for (const d of dates) {
    const y = Number(String(d || "").slice(0, 4));
    if (y) set.add(y);
  }
  if (selected) set.add(Number(selected));
  return [...set].filter((y) => y >= FIRST_YEAR && y <= LAST_YEAR).sort((a, b) => a - b);
}
