// A photo gallery's look (like Pixieset's "Design"): cover style, fonts, colours and grid.
// Chosen per gallery in the admin, with a studio default for galleries that weren't styled.

export const COVERS = ['center', 'side', 'novel', 'vintage', 'frame', 'stripe', 'divider', 'journal', 'stamp', 'outline'] as const;
export const FONTS = ['sans', 'serif', 'modern', 'timeless', 'bold', 'subtle'] as const;
export const COLORS = ['light', 'gold', 'rose', 'terracotta', 'sand', 'olive', 'agave', 'sea', 'dark'] as const;

export type CoverStyle = (typeof COVERS)[number];
export type FontStyle = (typeof FONTS)[number];
export type ColorStyle = (typeof COLORS)[number];

export interface Design {
  cover: CoverStyle;
  font: FontStyle;
  color: ColorStyle;
  /** columns = photos keep their shape in columns ("Vertical"); rows = justified rows ("Horizontal"). */
  grid: 'columns' | 'rows';
  thumb: 'regular' | 'large';
  spacing: 'regular' | 'large';
  /** Top bar buttons: icons only, or icon and text. */
  nav: 'icons' | 'text';
}

/** How galleries looked before design settings existed. */
export const DEFAULT_DESIGN: Design = { cover: 'center', font: 'modern', color: 'light', grid: 'rows', thumb: 'regular', spacing: 'regular', nav: 'text' };

export const COVER_LABELS: Record<CoverStyle, string> = {
  center: 'מרכז',
  side: 'צד',
  novel: 'רומן',
  vintage: 'וינטג׳',
  frame: 'מסגרת',
  stripe: 'פסים',
  divider: 'חצוי',
  journal: 'יומן',
  stamp: 'בול',
  outline: 'קו מתאר',
};

/** Fonts that have Hebrew letters (Google Fonts), with a Latin companion for the studio line. */
export const FONT_STYLES: Record<FontStyle, { label: string; hint: string; family: string; weight: number; spacing: string; google: string }> = {
  sans: { label: 'נקי', hint: 'פונט ניטרלי', family: "'Assistant', system-ui, sans-serif", weight: 600, spacing: '0.02em', google: 'Assistant:wght@300;400;600;700' },
  serif: { label: 'קלאסי', hint: 'פונט עם סריפים', family: "'Frank Ruhl Libre', serif", weight: 400, spacing: '0.01em', google: 'Frank+Ruhl+Libre:wght@300;400;500' },
  modern: { label: 'מודרני', hint: 'פונט מתוחכם', family: "'Cormorant Garamond', 'Frank Ruhl Libre', serif", weight: 300, spacing: '0.02em', google: 'Cormorant+Garamond:wght@300;400;500' },
  timeless: { label: 'נצחי', hint: 'קליל ואוורירי', family: "'Bellefair', 'Frank Ruhl Libre', serif", weight: 400, spacing: '0.06em', google: 'Bellefair' },
  bold: { label: 'בולט', hint: 'פונט חזק', family: "'Secular One', 'Assistant', sans-serif", weight: 400, spacing: '0.03em', google: 'Secular+One' },
  subtle: { label: 'עדין', hint: 'מינימליסטי', family: "'Heebo', 'Assistant', sans-serif", weight: 200, spacing: '0.18em', google: 'Heebo:wght@200;300;400' },
};

/** Background, surface, text, muted text, lines, accent. */
export const COLOR_STYLES: Record<ColorStyle, { label: string; bg: string; surface: string; ink: string; muted: string; line: string; accent: string }> = {
  light: { label: 'בהיר', bg: '#ffffff', surface: '#f4f3f1', ink: '#1f1d1a', muted: '#6c675e', line: '#ece8e1', accent: '#2f2d2a' },
  gold: { label: 'זהב', bg: '#fbf8f2', surface: '#f4eee2', ink: '#2b261d', muted: '#6d6452', line: '#ebe3d2', accent: '#a08650' },
  rose: { label: 'ורוד', bg: '#fbf6f5', surface: '#f5ebe9', ink: '#2e2322', muted: '#735f5d', line: '#eeddda', accent: '#9e6e6b' },
  terracotta: { label: 'טרקוטה', bg: '#fbf7f3', surface: '#f3e9e0', ink: '#2e241d', muted: '#735f50', line: '#ecdccd', accent: '#9a6440' },
  sand: { label: 'חול', bg: '#faf7f5', surface: '#efe9e5', ink: '#2b2622', muted: '#6d655d', line: '#e6ddd6', accent: '#8f7c68' },
  olive: { label: 'זית', bg: '#f8f8f5', surface: '#eeeee8', ink: '#24261f', muted: '#62655a', line: '#e0e1d8', accent: '#79805a' },
  agave: { label: 'אגבה', bg: '#f6f8f7', surface: '#e9efec', ink: '#1f2523', muted: '#5c6763', line: '#dce5e1', accent: '#5f8576' },
  sea: { label: 'ים', bg: '#f7f7f9', surface: '#ebebf0', ink: '#212229', muted: '#62646f', line: '#dfe0e7', accent: '#6a6c85' },
  dark: { label: 'כהה', bg: '#141414', surface: '#1f1f1f', ink: '#f2efe9', muted: '#a9a39a', line: '#2f2f2f', accent: '#d9d4ca' },
};

const pick = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Whatever came from the browser → a valid design (unknown values fall back). */
export function cleanDesign(input: unknown, base: Design = DEFAULT_DESIGN): Design {
  const d = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    cover: pick(COVERS, d.cover, base.cover),
    font: pick(FONTS, d.font, base.font),
    color: pick(COLORS, d.color, base.color),
    grid: pick(['columns', 'rows'] as const, d.grid, base.grid),
    thumb: pick(['regular', 'large'] as const, d.thumb, base.thumb),
    spacing: pick(['regular', 'large'] as const, d.spacing, base.spacing),
    nav: pick(['icons', 'text'] as const, d.nav, base.nav),
  };
}

/** The gallery's own choices over the studio's default over the built-in look. */
export function effectiveDesign(gallery: unknown, studio: unknown): Design {
  return cleanDesign(gallery, cleanDesign(studio));
}

/** CSS variables for a colour style (set on the gallery's root element). */
export function designVars(d: Design): Record<string, string> {
  const c = COLOR_STYLES[d.color];
  const f = FONT_STYLES[d.font];
  return {
    '--pg-bg': c.bg,
    '--pg-surface': c.surface,
    '--pg-ink': c.ink,
    '--pg-muted': c.muted,
    '--pg-line': c.line,
    '--pg-accent': c.accent,
    '--pg-title-font': f.family,
    '--pg-title-weight': String(f.weight),
    '--pg-title-spacing': f.spacing,
  };
}

/** Grid sizes for a width: row height (rows) or number of columns (columns), and the gap. */
export function gridMetrics(d: Pick<Design, 'grid' | 'thumb' | 'spacing'>, width: number): { target: number; columns: number; gap: number } {
  const phone = width < 600;
  const tablet = width < 1100;
  const large = d.thumb === 'large';
  const gap = d.spacing === 'large' ? (phone ? 10 : 22) : phone ? 4 : 8;
  const target = large ? (phone ? 260 : tablet ? 340 : 420) : phone ? 170 : tablet ? 240 : 300;
  const columns = large ? (phone ? 1 : tablet ? 2 : 3) : phone ? 2 : tablet ? 3 : 4;
  return { target, columns, gap };
}

/** Columns layout ("Vertical"): each photo goes to the shortest column; right to left. */
export function columnsLayout(ars: number[], width: number, columns: number, gap: number): { x: number; y: number; w: number; h: number }[] {
  const cols = Math.max(1, columns);
  const w = Math.max(1, (width - gap * (cols - 1)) / cols);
  const heights = new Array(cols).fill(0);
  return ars.map((ar) => {
    let c = 0;
    for (let i = 1; i < cols; i++) if (heights[i] < heights[c] - 0.5) c = i;
    const h = w / (ar || 1.5);
    const box = { x: width - (c + 1) * w - c * gap, y: heights[c], w, h };
    heights[c] += h + gap;
    return box;
  });
}
