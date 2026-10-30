// The studio's accent color on the couple's pages. Empty = keep the gallery's own
// gold palette (a studio that never picked a color in the hub).
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lighten([r, g, b]: [number, number, number], amount: number): string {
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function applyAccent(hex: string | undefined | null): void {
  const rgb = hex ? hexToRgb(hex) : null;
  const root = document.documentElement.style;
  if (!rgb) {
    root.removeProperty('--gold');
    root.removeProperty('--gold-2');
    root.removeProperty('--gold-dim');
    return;
  }
  root.setProperty('--gold', `rgb(${rgb.join(', ')})`);
  root.setProperty('--gold-2', lighten(rgb, 0.25));
  root.setProperty('--gold-dim', `rgba(${rgb.join(', ')}, 0.16)`);
}
