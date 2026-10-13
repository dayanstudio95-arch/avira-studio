// Links in a chat message (2026-10-13, the owner's request): split text into plain parts
// and links. Only http(s) — "www.x" gets https://; anything else (javascript:, mailto:…)
// stays text. Trailing punctuation stays text ("…site.co.il)." → the link without ").").
// Pure — PART 58.
const URL_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi;

export function linkifyParts(text) {
  const s = String(text || "");
  const out = [];
  let last = 0;
  for (const m of s.matchAll(URL_RE)) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]}'"״׳]+$/);
    if (trail) url = url.slice(0, -trail[0].length);
    if (!url || /^(https?:\/\/|www\.)$/i.test(url)) continue;
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ href: /^https?:\/\//i.test(url) ? url : `https://${url}`, text: url });
    last = m.index + url.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
