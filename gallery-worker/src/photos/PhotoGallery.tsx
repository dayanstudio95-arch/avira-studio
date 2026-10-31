// The couple's photo gallery. Ported from the Avira films app (2026-09-26/27; selection, personal
// lists and design on 2026-09-27). Not here yet (a later phase): guest face search.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { countPhotoDownload } from '../lib/events';
import { availabilityText, closingLabel } from '../lib/expiry';
import { formatDate } from '../lib/format';
import { InstallHint } from '../lib/InstallHint';
import { CloseIcon, DownloadIcon, LogoMark } from '../watch/icons';
import type { PhotoList, PublicPhoto, WatchData } from '../watch/types';
import { useDialog } from '../lib/dialog';
import { usePin } from '../watch/Locked';
import { cleanDesign, columnsLayout, DEFAULT_DESIGN, designVars, FONT_STYLES, gridMetrics, type Design } from '../../shared/design';
import { justify } from './justify';
import { Slideshow } from './Slideshow';
import { ZipDialog, type ZipGroup } from './ZipDialog';
import { heartState, instaRecord, instaState, type FavState } from './favState';
import { PROVIDER_NAMES } from '../../shared/providers';

/**
 * The server takes at most 500 photos per request (worker/index.ts `visibleKeys`). Avira fix (2026-10-30): a bigger
 * choice ("בחירת כל 2,000" → ♥ / Instagram / a list) goes in parts, one after the other — Studio Plan sent it in one
 * request and got "עד 500 תמונות בכל פעם". Each answer carries the whole state, so the last one is the result.
 */
const PER_REQUEST = 500;
async function inParts<T>(keys: string[], send: (part: string[]) => Promise<T>): Promise<T> {
  let last = await send(keys.slice(0, PER_REQUEST));
  for (let i = PER_REQUEST; i < keys.length; i += PER_REQUEST) last = await send(keys.slice(i, i + PER_REQUEST));
  return last;
}

const ALL = '__all';
/** The photos in no set, in a gallery that has sets (there is no "everything" tab then). */
const OTHER = '__other';
const INSTA = '__insta';
const FAV = '__fav';
/** A personal list's tab: "list:<id>". */
const LIST = 'list:';
/** In full screen the first list is key 3, the next 4… up to 9. */
const LIST_KEY = 3;

function Heart({ on }: { on: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      {on ? (
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.6 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z" />
      ) : (
        <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.6 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.6 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21zm0-2.4c2.1-1.4 6.2-4.5 7.6-7.6 1-2.3-.3-4.5-2.5-4.5-1.6 0-2.6 1-3.3 2.2L12 11.2l-1.8-2.5C9.5 7.5 8.5 6.5 6.9 6.5c-2.2 0-3.5 2.2-2.5 4.5 1.4 3.1 5.5 6.2 7.6 7.6z" />
      )}
    </svg>
  );
}

function favMessage(n: number, rec: number): { level: 'under' | 'reached' | 'over'; text: string } {
  if (n > rec) return { level: 'over', text: `בחרתם ${n} · מעבר ל-${rec} תמונות ייתכן חיוב בדפים נוספים` };
  if (n === rec) return { level: 'reached', text: `בחרתם ${n} · הגעתם להמלצה לאלבום` };
  return { level: 'under', text: `בחרתם ${n} · מומלץ ${rec} לאלבום` };
}

function Chevron({ dir }: { dir: 'prev' | 'next' }) {
  // Right to left: "previous" points right, "next" points left.
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === 'prev' ? 'M9 5l7 7-7 7' : 'M15 5l-7 7 7 7'} />
    </svg>
  );
}

/**
 * The full-screen photo, with pinch and double-tap zoom on phones (double-click on computers).
 * While zoomed in, a finger moves the photo instead of moving to the next one.
 */
function ZoomImage({ src, preview, ar, alt, onZoomed }: { src: string; preview: string; ar: number; alt: string; onZoomed: (zoomed: boolean) => void }) {
  const img = useRef<HTMLImageElement>(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const [moving, setMoving] = useState(false);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ d: number; s: number; x: number; y: number; px: number; py: number } | null>(null);
  const lastTap = useRef({ t: 0, x: 0, y: 0 });
  const zoomed = z.s > 1.01;
  useEffect(() => onZoomed(zoomed), [zoomed, onZoomed]);

  /** Keeps the enlarged photo covering its frame (no empty space at the edges). */
  const fit = (s: number, x: number, y: number) => {
    const el = img.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    const mx = (w * (s - 1)) / 2;
    const my = (h * (s - 1)) / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  /** Zoom in on a point (screen coordinates), or back out. */
  const toggleAt = (cx: number, cy: number) => {
    if (zoomed) return setZ({ s: 1, x: 0, y: 0 });
    const r = img.current!.getBoundingClientRect();
    const s = 2.5;
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    setZ(fit(s, -dx * (s - 1), -dy * (s - 1)));
  };
  const distance = () => {
    const [a, b] = [...points.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  };

  return (
    <img
      ref={img}
      src={src}
      alt={alt}
      className="pg-lb-img"
      draggable={false}
      style={{
        backgroundImage: `url(${preview})`,
        aspectRatio: String(ar),
        width: `min(94vw, calc(84dvh * ${ar}))`,
        height: 'auto',
        transform: `translate(${z.x}px, ${z.y}px) scale(${z.s})`,
        transition: moving ? 'none' : 'transform 0.2s ease',
        cursor: zoomed ? 'grab' : 'zoom-in',
        touchAction: 'none',
      }}
      onDoubleClick={(e) => toggleAt(e.clientX, e.clientY)}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        setMoving(true);
        if (points.current.size === 2) {
          start.current = { d: distance(), s: z.s, x: z.x, y: z.y, px: 0, py: 0 };
          return;
        }
        if (e.pointerType === 'touch') {
          const now = Date.now();
          const last = lastTap.current;
          if (now - last.t < 300 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30) {
            toggleAt(e.clientX, e.clientY);
            lastTap.current = { t: 0, x: 0, y: 0 };
            return;
          }
          lastTap.current = { t: now, x: e.clientX, y: e.clientY };
        }
        start.current = { d: 0, s: z.s, x: z.x, y: z.y, px: e.clientX, py: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!points.current.has(e.pointerId) || !start.current) return;
        points.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const st = start.current;
        if (points.current.size >= 2 && st.d) {
          const s = Math.max(1, Math.min(4, (st.s * distance()) / st.d));
          setZ(fit(s, (st.x * s) / st.s, (st.y * s) / st.s));
        } else if (points.current.size === 1 && zoomed) {
          setZ(fit(z.s, st.x + e.clientX - st.px, st.y + e.clientY - st.py));
        }
      }}
      onPointerUp={(e) => {
        points.current.delete(e.pointerId);
        const left = [...points.current.values()][0];
        start.current = left ? { d: 0, s: z.s, x: z.x, y: z.y, px: left.x, py: left.y } : null;
        if (!left) setMoving(false);
        if (z.s < 1.05) setZ({ s: 1, x: 0, y: 0 });
      }}
      onPointerCancel={(e) => {
        points.current.delete(e.pointerId);
        if (points.current.size === 0) setMoving(false);
      }}
      data-testid="lb-img"
    />
  );
}

export function Lightbox({
  items,
  index,
  base,
  favs,
  onFav,
  insta,
  onInsta,
  onClose,
  onMove,
  label,
  showOriginal = true,
  lists,
}: {
  items: PublicPhoto[];
  index: number;
  base: string;
  favs: Set<string>;
  /** Hearts and Instagram marks are the couple's; a guest's view leaves them out. */
  onFav?: (key: string) => void;
  insta: Set<string>;
  onInsta?: (key: string) => void;
  onClose: () => void;
  onMove: (i: number) => void;
  /** What a screen reader says for the photo. */
  label?: (item: PublicPhoto, i: number) => string;
  /** The "original photo" link (hidden while a download code is needed). */
  showOriginal?: boolean;
  /** Personal lists: list N is key N+3 (3–9); 0 makes a new list with this photo. */
  lists?: { items: { id: string; name: string; keys: string[] }[]; toggle: (listId: string, key: string) => void; create: (key: string) => void };
}) {
  const p = items[index];
  const box = useRef<HTMLDivElement>(null);
  const touch = useRef<number | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const next = useCallback(() => onMove(Math.min(items.length - 1, index + 1)), [index, items.length, onMove]);
  const prev = useCallback(() => onMove(Math.max(0, index - 1)), [index, onMove]);
  useDialog(box, onClose);
  // Keys: arrows move; 1 = favourites, 2 = Instagram, 3–9 = personal lists, 0 = a new list.
  const keyed = useRef({ onFav, onInsta, lists, key: p?.key });
  keyed.current = { onFav, onInsta, lists, key: p?.key };
  const showing = Boolean(p);
  useEffect(() => {
    // Nothing to show: no keys and no locked page (the page scrolls again).
    if (!showing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Hebrew reads right to left: the left arrow moves forward.
      if (e.key === 'ArrowLeft') next();
      if (e.key === 'ArrowRight') prev();
      const k = keyed.current;
      if (!k.key) return;
      if (e.key === '1' && k.onFav) k.onFav(k.key);
      if (e.key === '2' && k.onInsta) k.onInsta(k.key);
      if (k.lists && /^[3-9]$/.test(e.key)) {
        const l = k.lists.items[Number(e.key) - LIST_KEY];
        // No list on this number yet: make one (the first time, 3 does this).
        if (l) k.lists.toggle(l.id, k.key);
        else if (Number(e.key) - LIST_KEY === k.lists.items.length) k.lists.create(k.key);
      }
      if (k.lists && e.key === '0') k.lists.create(k.key);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [next, prev, showing]);
  useEffect(() => {
    // Preload the neighbours so moving feels instant.
    for (const j of [index + 1, index - 1]) if (items[j]) new Image().src = `${base}/${items[j].key}?s=l`;
  }, [index, items, base]);
  if (!p) return null;
  const name = label ? label(p, index) : `תמונה ${index + 1} מתוך ${items.length}`;
  return (
    <div
      ref={box}
      className="pg-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      tabIndex={-1}
      data-testid="lightbox"
      onTouchStart={(e) => (touch.current = e.touches.length === 1 && !zoomed ? e.touches[0].clientX : null)}
      onTouchEnd={(e) => {
        if (touch.current === null || zoomed) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 50) (dx > 0 ? next : prev)();
        touch.current = null;
      }}
    >
      <div className="pg-lb-top">
        <span className="pg-lb-count" data-testid="lb-count" aria-hidden="true">
          {index + 1} / {items.length}
        </span>
        <div className="pg-lb-actions">
          {onFav && (
            <button type="button" className={`pg-icon${favs.has(p.key) ? ' on' : ''}`} onClick={() => onFav(p.key)} aria-label="אהבתי" aria-pressed={favs.has(p.key)} data-testid="lb-fav">
              <Heart on={favs.has(p.key)} />
            </button>
          )}
          {onInsta && (
            <button type="button" className={`pg-icon${insta.has(p.key) ? ' on' : ''}`} onClick={() => onInsta(p.key)} aria-label="לאינסטגרם" aria-pressed={insta.has(p.key)} title="לאינסטגרם" data-testid="lb-insta">
              <InstaIcon on={insta.has(p.key)} />
            </button>
          )}
          <DownloadMenu key={p.key} base={base} photo={p} />
          {showOriginal && (
            <a className="pg-lb-link" href={`${base}/${p.key}?s=full`} target="_blank" rel="noopener">
              תמונה מקורית
            </a>
          )}
          <button type="button" className="pg-icon" onClick={onClose} aria-label="סגירה" data-testid="lb-close" data-autofocus>
            <CloseIcon />
          </button>
        </div>
      </div>
      {/* The small preview (already loaded in the grid) shows at once, until the large one arrives. */}
      <ZoomImage key={p.key} src={`${base}/${p.key}?s=l`} preview={`${base}/${p.key}?s=m`} ar={p.ar || 1.5} alt={name} onZoomed={setZoomed} />
      {lists && (
        <div className="pg-lb-lists" role="group" aria-label="רשימות אישיות" data-testid="lb-lists">
          {lists.items.map((l, i) => {
            const has = l.keys.includes(p.key);
            return (
              <button type="button" key={l.id} className={`pg-lb-list${has ? ' on' : ''}`} onClick={() => lists.toggle(l.id, p.key)} aria-pressed={has} data-testid="lb-list">
                {i + LIST_KEY <= 9 && <kbd>{i + LIST_KEY}</kbd>}
                {has ? '★' : '☆'} {l.name}
              </button>
            );
          })}
          <button type="button" className="pg-lb-list new" onClick={() => lists.create(p.key)} data-testid="lb-list-new">
            <kbd>0</kbd>+ רשימה חדשה
          </button>
        </div>
      )}
      {(onFav || onInsta) && (
        <div className="pg-lb-keys" aria-hidden="true">
          {onFav && <span><kbd>1</kbd> מועדפים</span>}
          {onInsta && <span><kbd>2</kbd> אינסטגרם</span>}
          {lists && <span><kbd dir="ltr">{lists.items.length > 1 ? `3–${Math.min(9, lists.items.length + LIST_KEY - 1)}` : '3'}</kbd> {lists.items.length > 1 ? 'רשימות' : 'רשימה אישית'}</span>}
          {lists && <span><kbd>0</kbd> רשימה חדשה</span>}
        </div>
      )}
      {index > 0 && !zoomed && (
        <button type="button" className="pg-lb-nav prev" onClick={prev} aria-label="התמונה הקודמת">
          <Chevron dir="prev" />
        </button>
      )}
      {index < items.length - 1 && !zoomed && (
        <button type="button" className="pg-lb-nav next" onClick={next} aria-label="התמונה הבאה" data-testid="lb-next">
          <Chevron dir="next" />
        </button>
      )}
    </div>
  );
}

/** Galleries this big draw only the rows near the screen (thousands of photos stay smooth on phones). */
const WINDOW_FROM = 200;
/** How far above and below the screen rows are kept ready, in pixels. */
const BUFFER = 1600;

export function Grid({
  items,
  base,
  favs,
  insta,
  onOpen,
  onFav,
  onInsta,
  label,
  names,
  mine,
  onHide,
  picking = false,
  picked,
  onPick,
  design,
}: {
  items: PublicPhoto[];
  base: string;
  favs: Set<string>;
  insta: Set<string>;
  onOpen: (i: number) => void;
  onFav?: (key: string) => void;
  onInsta?: (key: string) => void;
  /** What a screen reader says for a photo (default: "תמונה 3 מתוך 120"). */
  label?: (item: PublicPhoto, i: number) => string;
  /** Who hearted a photo ("מאי, אמא"), shown on it. */
  names?: (key: string) => string;
  /** Hearted by this visitor (for screen readers). */
  mine?: (key: string) => boolean;
  /** "Not me" (guest face search): take a photo out of the results. */
  onHide?: (key: string) => void;
  /** Choosing several photos: a tap picks instead of opening (Shift picks a range). */
  picking?: boolean;
  picked?: Set<string>;
  onPick?: (i: number, range: boolean) => void;
  /** Grid style, photo size and spacing from the gallery's design. */
  design?: Pick<Design, 'grid' | 'thumb' | 'spacing'>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const metrics = gridMetrics(design ?? DEFAULT_DESIGN, width);
  const { target, gap } = metrics;
  // "Columns": each photo keeps its shape in a column; otherwise justified rows.
  const cols = design?.grid === 'columns';
  const rows = useMemo(() => (cols ? [] : justify(items, width, target, gap)), [cols, items, width, target, gap]);
  const boxes = useMemo(() => (cols && width > 0 ? columnsLayout(items.map((i) => i.ar || 1.5), width, metrics.columns, gap) : []), [cols, items, width, metrics.columns, gap]);
  // Where each row sits, and the index of its first photo.
  const layout = useMemo(() => {
    let top = 0;
    let first = 0;
    return rows.map((row) => {
      const h = row[0]?.height ?? 0;
      const at = { row, top, h, first };
      top += h + gap;
      first += row.length;
      return at;
    });
  }, [rows, gap]);
  const height = cols ? boxes.reduce((m, b) => Math.max(m, b.y + b.h), 0) : layout.length ? layout[layout.length - 1].top + layout[layout.length - 1].h : 0;
  const windowed = items.length > WINDOW_FROM;

  // The part of the grid near the screen (in steps, so scrolling doesn't redraw on every pixel).
  const [view, setView] = useState({ from: 0, to: 3000 });
  useEffect(() => {
    if (!windowed) return;
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = el.getBoundingClientRect().top;
      const from = Math.floor(Math.max(0, -top - BUFFER) / 400) * 400;
      const to = Math.ceil((-top + window.innerHeight + BUFFER) / 400) * 400;
      setView((v) => (v.from === from && v.to === to ? v : { from, to }));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [windowed, height]);

  const renderCell = (item: PublicPhoto, i: number, w: number, h: number, extra: CSSProperties = {}) => {
    const src = `${base}/${item.key}`;
    return (
          <div className={`pg-cell${picking && picked?.has(item.key) ? ' picked' : ''}`} key={item.key} style={{ width: w, height: h, ...extra }} data-testid="pg-photo">
            <button
              type="button"
              className="pg-open"
              onClick={(e) => (picking ? onPick?.(i, e.shiftKey) : onOpen(i))}
              aria-label={label ? label(item, i) : `תמונה ${i + 1} מתוך ${items.length}`}
              aria-pressed={picking ? Boolean(picked?.has(item.key)) : undefined}
            >
              {/* A sharper copy for sharp screens and big cells; the browser picks. */}
              {/* A photo that did not load (no preview from the cloud, P66) shows a quiet mark, not an endless shimmer. */}
              <img src={`${src}?s=m`} srcSet={`${src}?s=m 640w, ${src}?s=md 1024w`} sizes={`${Math.ceil(w)}px`} alt="" loading="lazy" decoding="async" onLoad={(e) => e.currentTarget.classList.add('in')} onError={(e) => e.currentTarget.classList.add('broken')} />
            </button>
            {picking && (
              <span className="pg-check" aria-hidden="true">
                ✓
              </span>
            )}
            {onFav && !picking && (
              <button type="button" className={`pg-heart${favs.has(item.key) ? ' on' : ''}`} onClick={() => onFav(item.key)} aria-label="אהבתי" aria-pressed={mine ? mine(item.key) : favs.has(item.key)} data-testid="pg-heart">
                <Heart on={favs.has(item.key)} />
              </button>
            )}
            {onInsta && !picking && (
              <button type="button" className={`pg-insta${insta.has(item.key) ? ' on' : ''}`} onClick={() => onInsta(item.key)} aria-label="לאינסטגרם" aria-pressed={insta.has(item.key)} title="לאינסטגרם" data-testid="pg-insta">
                <InstaIcon on={insta.has(item.key)} />
              </button>
            )}
            {onHide && (
              <button type="button" className="pg-notme" onClick={() => onHide(item.key)} aria-label="זה לא אני, להוציא את התמונה" data-testid="pg-notme">
                לא אני
              </button>
            )}
            {names && names(item.key) && (
              <span className="pg-who" data-testid="pg-who">
                ♥ {names(item.key)}
              </span>
            )}
          </div>
    );
  };
  const shownRows = windowed ? layout.filter((r) => r.top + r.h >= view.from && r.top <= view.to) : layout;
  if (cols) {
    const visible = boxes.map((b, i) => ({ b, i })).filter(({ b }) => !windowed || (b.y + b.h >= view.from && b.y <= view.to));
    return (
      <div className="pg-grid cols" ref={ref} data-testid="pg-grid" style={{ position: 'relative', height }}>
        {visible.map(({ b, i }) => renderCell(items[i], i, b.w, b.h, { position: 'absolute', left: b.x, top: b.y }))}
      </div>
    );
  }
  return (
    <div className="pg-grid" ref={ref} data-testid="pg-grid" style={windowed ? { position: 'relative', height } : undefined}>
      {shownRows.map(({ row, top, first }) => (
        <div className="pg-row" key={top} style={windowed ? { gap, position: 'absolute', top, insetInline: 0 } : { gap, marginBottom: gap }}>
          {row.map(({ item, width: w, height: h }, j) => renderCell(item, first + j, w, h))}
        </div>
      ))}
    </div>
  );
}

const TAB_WORD: Record<string, string> = { [FAV]: 'favorites', [INSTA]: 'instagram', [OTHER]: 'more' };

type TabPhotos = { sets: { id: string }[]; items: { key: string; set: string }[] };

/**
 * Where the couple's page opens (Avira, 2026-10-31, the owner's request): on the first set — there is no "everything"
 * tab; photos in no set get their own tab ("תמונות נוספות") at the end. A gallery without sets shows everything.
 */
const homeTab = (photos: TabPhotos) => photos.sets[0]?.id ?? ALL;

function tabFromUrl(photos: TabPhotos): string {
  const q = new URLSearchParams(window.location.search);
  const v = q.get('set');
  if (!v) {
    // A link to one photo without its set (made before there were only sets): the photo's own set.
    const p = photos.items.find((i) => i.key === q.get('photo'));
    return p ? p.set || (photos.sets.length ? OTHER : ALL) : homeTab(photos);
  }
  if (v === 'favorites') return FAV;
  if (v === 'instagram') return INSTA;
  if (v === 'more') return photos.sets.length ? OTHER : ALL;
  if (v.startsWith(LIST)) return v;
  return photos.sets.some((x) => x.id === v) ? v : homeTab(photos);
}

/** Puts the open set and photo in the address; `push` adds a Back step (opening a photo). */
function writeUrl(tab: string, photo: string, push: boolean) {
  const u = new URL(window.location.href);
  if (tab === ALL) u.searchParams.delete('set');
  else u.searchParams.set('set', TAB_WORD[tab] ?? tab);
  if (photo) u.searchParams.set('photo', photo);
  else u.searchParams.delete('photo');
  const next = `${u.pathname}${u.search}${u.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}` && !push) return;
  if (push) window.history.pushState({ ...(window.history.state ?? {}), photo }, '', next);
  else window.history.replaceState(window.history.state, '', next);
}

/** What can be downloaded together: the set that's open first, then everything, then the favourites. */
function zipGroups(items: PublicPhoto[], sets: { id: string; name: string }[], tab: string, favs: Set<string>, list: PhotoList | null): ZipGroup[] {
  const groups: ZipGroup[] = [];
  if (list) {
    const inList = new Set(list.keys);
    groups.push({ id: LIST + list.id, label: `הרשימה "${list.name}"`, items: items.filter((p) => inList.has(p.key)) });
  }
  const set = sets.find((x) => x.id === tab);
  if (set) groups.push({ id: set.id, label: `הסט "${set.name}"`, items: items.filter((p) => p.set === set.id) });
  if (favs.size) groups.push({ id: FAV, label: 'המועדפים', items: items.filter((p) => favs.has(p.key)) });
  groups.push({ id: ALL, label: 'כל הגלריה', items });
  if (tab === FAV) groups.unshift(groups.splice(groups.findIndex((g) => g.id === FAV), 1)[0]);
  return groups;
}

/** "Which list?" — pick one of the couple's lists or name a new one ("התמונות של אופק"). */
function ListDialog({ lists, count, fresh = false, onChoose, onClose }: { lists: PhotoList[]; count: number; fresh?: boolean; onChoose: (c: { id?: string; name?: string }) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  const [name, setName] = useState('');
  useDialog(box, onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        ref={box}
        className="modal who-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onChoose({ name });
        }}
        data-testid="list-dialog"
      >
        <h2 id="list-title" style={{ margin: 0 }}>
          {fresh ? 'רשימה אישית חדשה' : count > 1 ? `${count.toLocaleString('he-IL')} תמונות לאיזו רשימה?` : 'לאיזו רשימה?'}
        </h2>
        <p style={{ margin: 0, color: '#6c675e' }}>רשימה אישית, למשל "התמונות של אופק" או "לשלוח לסבתא". היא לא נכנסת לאלבום, ואפשר להוריד אותה בבת אחת.</p>
        {lists.length > 0 && (
          <div className="who-chips">
            {lists.map((l) => (
              <button type="button" key={l.id} onClick={() => onChoose({ id: l.id })} data-testid="list-choice">
                ☆ {l.name} ({l.keys.length})
              </button>
            ))}
          </div>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם לרשימה חדשה" maxLength={40} data-autofocus data-testid="list-name" />
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="zip-btn" disabled={!name.trim()} data-testid="list-create">
            יצירת רשימה
          </button>
          <button type="button" className="zip-btn ghost" onClick={onClose}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}

/** "Who's choosing?" — so the favourites can show who hearted what (and the album still uses them all). */
function WhoDialog({ names, current, onChoose, onClose }: { names: string[]; current: string; onChoose: (name: string) => void; onClose: () => void }) {
  const box = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(current);
  useDialog(box, onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        ref={box}
        className="modal who-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="who-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onChoose(name);
        }}
        data-testid="who-dialog"
      >
        <h2 id="who-title" style={{ margin: 0 }}>
          מי מסמן?
        </h2>
        <p style={{ margin: 0, color: '#6c675e' }}>כך תראו מי בחר כל תמונה (למשל הכלה, החתן או אמא). כל הלבבות נכנסים לאלבום.</p>
        {names.length > 0 && (
          <div className="who-chips">
            {names.map((n) => (
              <button type="button" key={n} onClick={() => onChoose(n)}>
                {n}
              </button>
            ))}
          </div>
        )}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="השם שלכם" maxLength={30} data-autofocus data-testid="who-name" />
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="zip-btn" disabled={!name.trim()} data-testid="who-save">
            שמירה
          </button>
          <button type="button" className="zip-btn ghost" onClick={() => onChoose('')} data-testid="who-skip">
            בלי שם
          </button>
        </div>
      </form>
    </div>
  );
}

/** Small line icons for the top bar (shown alone when the design says "icons only"). */
const ICONS = {
  face: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm-7 9a7 7 0 0 1 14 0',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7',
  share: 'M18 8a3 3 0 1 0-3-3M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  check: 'M4 4h16v16H4zM8 12l3 3 5-6',
  play: 'M8 5l11 7-11 7z',
};

function Ico({ d }: { d: string }) {
  return (
    <svg className="pg-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Pixieset-style photo gallery for the couple. */
export function PhotoGallery({ data, preview = false }: { data: WatchData; preview?: boolean }) {
  const photos = data.photos!;
  // The gallery's look. In the studio's design screen (preview) changes arrive live from the page around it.
  const [designLive, setDesignLive] = useState<Design | null>(null);
  useEffect(() => {
    if (!preview) return;
    // The design screen is in the studio's app (another address), so any page around us may send a
    // look; it is only ever a look (cleaned to known choices), shown here and never saved.
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && e.data?.type === 'pg-design') setDesignLive(cleanDesign(e.data.design));
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'pg-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [preview]);
  const design: Design = designLive ?? photos.design ?? DEFAULT_DESIGN;
  // Fonts other than the page's own load only when chosen.
  useEffect(() => {
    const f = FONT_STYLES[design.font];
    const id = `font-${design.font}`;
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
    document.head.appendChild(link);
  }, [design.font]);
  // Hearts per person: who is hearting on this device (asked once), and who hearted each photo.
  // What the server said plus the taps on their way (favState: an old answer never overwrites a new one).
  const hearts = useRef<FavState<string[]> | null>(null);
  if (!hearts.current) hearts.current = heartState({ ...Object.fromEntries((data.favorites ?? []).map((k) => [k, ['']])), ...(data.favBy ?? {}) });
  const [favBy, setFavBy] = useState<Record<string, string[]>>(() => hearts.current!.view());
  const favs = useMemo(() => new Set(Object.keys(favBy)), [favBy]);
  const [who, setWho] = useState<string | null>(() => {
    try {
      return localStorage.getItem(`fav-who:${data.id}`);
    } catch {
      return null;
    }
  });
  // Waiting for "who is choosing?": the photos to heart once the name is in ([] = only change the name).
  const [asking, setAsking] = useState<{ keys: string[]; bulk: boolean } | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [zipping, setZipping] = useState(false);
  // Personal lists ("התמונות של אופק"); in full screen list N is key N+3.
  const [lists, setLists] = useState<PhotoList[]>(() => data.lists ?? []);
  // Choosing several photos: a tap picks, the bar below acts on all of them.
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lastPick = useRef<number | null>(null);
  // Photos waiting for a list to be chosen or made.
  const [listAsk, setListAsk] = useState<{ keys: string[]; fresh: boolean } | null>(null);
  const [zipPicked, setZipPicked] = useState(false);
  // Guests (their own link) look and download; hearts, Instagram marks and the album are the couple's.
  const guest = data.role === 'guest';
  const shareGuests = async () => {
    const url = `${window.location.origin}${data.guestPath}`;
    const text = `התמונות מהחתונה של ${data.coupleName}`;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setError('הקישור לאורחים הועתק. אפשר להדביק אותו בקבוצת הוואטסאפ.');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError(`הקישור לאורחים: ${url}`);
    }
  };
  const marks = useRef<FavState<boolean> | null>(null);
  if (!marks.current) marks.current = instaState(data.insta ?? []);
  const [instaMap, setInstaMap] = useState<Record<string, boolean>>(() => marks.current!.view());
  const insta = useMemo(() => new Set(Object.keys(instaMap)), [instaMap]);
  // Answers that came back out of order: read hearts and marks again, once (a second call waits for it).
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const refreshMarks = async () => {
    if (refreshing.current) {
      refreshAgain.current = true;
      return;
    }
    refreshing.current = true;
    try {
      do {
        refreshAgain.current = false;
        const h = hearts.current!.begin({});
        const m = marks.current!.begin({});
        try {
          const r = await api<WatchData>('GET', `/api/watch/${data.id}`);
          hearts.current!.answer(h, r.favBy ?? {});
          marks.current!.answer(m, instaRecord(r.insta ?? []));
        } catch {
          hearts.current!.fail(h);
          marks.current!.fail(m);
        }
        setFavBy(hearts.current!.view());
        setInstaMap(marks.current!.view());
      } while (refreshAgain.current);
    } finally {
      refreshing.current = false;
    }
  };
  // The open set and photo live in the address (?set=…&photo=…): links to a photo work, and the
  // phone's Back button closes a photo instead of leaving the gallery.
  const [tab, setTabState] = useState<string>(() => tabFromUrl(photos));
  // The open photo, by its key (not its place in the list: the list changes under it, e.g. a heart
  // taken off in the favourites). `open` is where it is now in `shown`.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [entered, setEntered] = useState(() => preview || /[?&](set|photo)=/.test(window.location.search));
  const pushed = useRef(false);
  const [error, setError] = useState('');
  const galleryRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  // A failed heart shows for a few seconds, then goes away.
  useEffect(() => {
    if (!error) return;
    const t = window.setTimeout(() => setError(''), 4000);
    return () => window.clearTimeout(t);
  }, [error]);

  const shown = useMemo(() => {
    if (tab === FAV) return photos.items.filter((p) => favs.has(p.key) && (person === null || (favBy[p.key] ?? ['']).includes(person)));
    if (tab === INSTA) return photos.items.filter((p) => insta.has(p.key));
    if (tab === ALL) return photos.items;
    if (tab === OTHER) return photos.items.filter((p) => !p.set);
    if (tab.startsWith(LIST)) {
      const inList = new Set(lists.find((l) => l.id === tab.slice(LIST.length))?.keys ?? []);
      return photos.items.filter((p) => inList.has(p.key));
    }
    return photos.items.filter((p) => p.set === tab);
  }, [tab, photos.items, favs, insta, person, favBy, lists]);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const lastOpen = useRef(0);
  const found = openKey === null ? -1 : shown.findIndex((p) => p.key === openKey);
  if (found >= 0) lastOpen.current = found;
  // The open photo left the list: its neighbour takes its place; nothing left: the full screen closes.
  const open = openKey === null ? null : found >= 0 ? found : shown.length ? Math.min(lastOpen.current, shown.length - 1) : null;

  const setTab = (t: string) => {
    setTabState(t);
    writeUrl(t, '', false);
    setPicked(new Set());
    lastPick.current = null;
  };
  const home = homeTab(photos);
  // The studio sorted while the page was open: sets appeared (no "everything" tab any more), or the last photo in no
  // set went into one (no "more photos" tab).
  const tabGone = (tab === ALL && photos.sets.length > 0) || (tab === OTHER && !photos.items.some((p) => !p.set));
  useEffect(() => {
    if (tabGone && openKey === null) setTab(home);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabGone, openKey, home]);
  const pick = (i: number, range: boolean) => {
    const next = new Set(picked);
    if (range && lastPick.current !== null) {
      const [a, b] = [Math.min(lastPick.current, i), Math.max(lastPick.current, i)];
      for (let j = a; j <= b; j++) if (shown[j]) next.add(shown[j].key);
    } else {
      const key = shown[i].key;
      if (next.has(key)) next.delete(key);
      else next.add(key);
    }
    lastPick.current = i;
    setPicked(next);
  };
  const stopPicking = () => {
    setPicking(false);
    setPicked(new Set());
    lastPick.current = null;
  };
  const openAt = (i: number) => {
    const key = shown[i]?.key ?? '';
    if (!key) return;
    setOpenKey(key);
    writeUrl(tab, key, !pushed.current);
    pushed.current = true;
  };
  const moveTo = (i: number) => {
    const key = shown[i]?.key;
    if (!key) return;
    setOpenKey(key);
    writeUrl(tab, key, false);
  };
  const closePhoto = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      setOpenKey(null);
      writeUrl(tab, '', false);
    }
  };
  const closeRef = useRef(closePhoto);
  closeRef.current = closePhoto;
  useEffect(() => {
    if (openKey === null || found >= 0) return;
    if (open === null) closeRef.current();
    else {
      setOpenKey(shown[open].key);
      writeUrl(tab, shown[open].key, false);
    }
  }, [openKey, found, open, shown, tab]);
  // Back / forward: follow the address.
  useEffect(() => {
    const onPop = () => {
      const q = new URLSearchParams(window.location.search);
      const key = q.get('photo');
      setTabState(tabFromUrl(photos));
      if (!key) {
        pushed.current = false;
        setOpenKey(null);
      } else {
        setOpenKey(shownRef.current.some((x) => x.key === key) ? key : null);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [photos.sets]);
  // A link straight to one photo opens it.
  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('photo');
    if (!key) return;
    if (shown.some((x) => x.key === key)) setOpenKey(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const setNames = useMemo(() => new Map(photos.sets.map((x) => [x.id, x.name])), [photos.sets]);
  const photoLabel = (item: PublicPhoto, i: number) => `תמונה ${i + 1} מתוך ${shown.length}${setNames.get(item.set) ? ` · ${setNames.get(item.set)}` : ''}`;

  /** The first heart asks who is choosing (one tap to skip); later hearts go straight through. */
  const toggleFav = (key: string) => {
    if (who === null) setAsking({ keys: [key], bulk: false });
    else heart(key, who);
  };
  /** Many photos at once (from the selection): all get this person's heart, or all lose it. */
  const heartMany = async (keys: string[], on: boolean, me: string) => {
    if (keys.length === 0) return;
    const now = hearts.current!.view();
    const changes: Record<string, string[]> = {};
    for (const key of keys) {
      const people = (now[key] ?? []).filter((x) => x !== me);
      changes[key] = on ? [...people, me] : people;
    }
    const seq = hearts.current!.begin(changes);
    setFavBy(hearts.current!.view());
    try {
      const r = await inParts(keys, (part) => api<{ favorites: string[]; favBy: Record<string, string[]> }>('POST', `/api/watch/${data.id}/fav`, { keys: part, on, who: me }));
      const { refresh } = hearts.current!.answer(seq, r.favBy ?? {});
      setFavBy(hearts.current!.view());
      if (refresh) refreshMarks();
      setError(on ? `${keys.length.toLocaleString('he-IL')} תמונות נוספו למועדפים` : `${keys.length.toLocaleString('he-IL')} תמונות הוסרו מהמועדפים`);
    } catch (e) {
      // The server may have saved part of it (P70: many photos in a few writes): read what it has now,
      // instead of putting back what this page remembered.
      hearts.current!.fail(seq);
      setFavBy(hearts.current!.view());
      setError((e as Error).message);
      refreshMarks();
    }
  };
  const favPicked = (on: boolean) => {
    const keys = [...picked];
    if (who === null && on) setAsking({ keys, bulk: true });
    else heartMany(keys, on, who ?? '');
    stopPicking();
  };
  /** Marks many photos (the selection) or, with `many` false, the one photo tapped (no message). */
  const instaMany = async (keys: string[], on: boolean, many = true) => {
    const seq = marks.current!.begin(Object.fromEntries(keys.map((k) => [k, on])));
    setInstaMap(marks.current!.view());
    try {
      const r = many
        ? await inParts(keys, (part) => api<{ insta: string[] }>('POST', `/api/watch/${data.id}/insta`, { keys: part, on }))
        : await api<{ insta: string[] }>('POST', `/api/watch/${data.id}/insta`, { key: keys[0], on });
      const { refresh } = marks.current!.answer(seq, instaRecord(r.insta));
      setInstaMap(marks.current!.view());
      if (refresh) refreshMarks();
      if (many) setError(on ? `${keys.length.toLocaleString('he-IL')} תמונות סומנו לאינסטגרם` : `${keys.length.toLocaleString('he-IL')} תמונות הוסרו מאינסטגרם`);
    } catch (e) {
      marks.current!.fail(seq);
      setInstaMap(marks.current!.view());
      setError((e as Error).message);
      refreshMarks();
    }
  };

  /** Adds photos to a list (or takes them out). */
  const listPhotos = async (listId: string, keys: string[], on: boolean) => {
    const before = lists;
    setLists(lists.map((l) => (l.id !== listId ? l : { ...l, keys: on ? [...new Set([...l.keys, ...keys])] : l.keys.filter((k) => !keys.includes(k)) })));
    try {
      const r = await inParts(keys, (part) => api<{ lists: PhotoList[] }>('PUT', `/api/watch/${data.id}/lists/${listId}`, { keys: part, on }));
      setLists(r.lists);
    } catch (e) {
      setLists(before);
      setError((e as Error).message);
    }
  };
  /** Keys 3–9 / ☆ in full screen: this photo in or out of that list. */
  const toggleInList = (listId: string, key: string) => {
    const l = lists.find((x) => x.id === listId);
    if (l) listPhotos(listId, [key], !l.keys.includes(key));
  };
  const chooseList = async (choice: { id?: string; name?: string }) => {
    const keys = listAsk?.keys ?? [];
    setListAsk(null);
    try {
      if (choice.id) {
        if (keys.length) await listPhotos(choice.id, keys, true);
        const name = lists.find((l) => l.id === choice.id)?.name ?? '';
        if (keys.length) setError(`${keys.length.toLocaleString('he-IL')} תמונות נוספו לרשימה "${name}"`);
      } else if (choice.name) {
        // A new list is made with the first 500; the rest are added to it in parts.
        const r = await api<{ id: string; lists: PhotoList[] }>('POST', `/api/watch/${data.id}/lists`, { name: choice.name, keys: keys.slice(0, PER_REQUEST) });
        let all = r.lists;
        if (keys.length > PER_REQUEST) all = (await inParts(keys.slice(PER_REQUEST), (part) => api<{ lists: PhotoList[] }>('PUT', `/api/watch/${data.id}/lists/${r.id}`, { keys: part, on: true }))).lists;
        setLists(all);
        setError(`נוצרה הרשימה "${choice.name.trim()}"${keys.length ? ` עם ${keys.length.toLocaleString('he-IL')} תמונות` : ''}`);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const openList = tab.startsWith(LIST) ? lists.find((l) => l.id === tab.slice(LIST.length)) ?? null : null;
  const renameOpenList = async () => {
    if (!openList) return;
    const name = window.prompt('שם חדש לרשימה:', openList.name);
    if (!name?.trim()) return;
    try {
      setLists((await api<{ lists: PhotoList[] }>('PUT', `/api/watch/${data.id}/lists/${openList.id}`, { name })).lists);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteOpenList = async () => {
    if (!openList || !window.confirm(`למחוק את הרשימה "${openList.name}"? התמונות עצמן נשארות בגלריה.`)) return;
    try {
      setLists((await api<{ lists: PhotoList[] }>('DELETE', `/api/watch/${data.id}/lists/${openList.id}`)).lists);
      setTab(home);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const chooseWho = (name: string) => {
    const clean = name.replace(/\s+/g, ' ').trim().slice(0, 30);
    setWho(clean);
    try {
      localStorage.setItem(`fav-who:${data.id}`, clean);
    } catch {
      /* private mode */
    }
    const a = asking;
    setAsking(null);
    if (a?.keys.length) {
      if (a.bulk) heartMany(a.keys, true, clean);
      else heart(a.keys[0], clean);
    }
  };
  const heart = async (key: string, me: string) => {
    // Feels instant; the server confirms right after (hearts.answer keeps only the newest answer).
    const people = hearts.current!.view()[key] ?? [];
    const on = !people.includes(me);
    const rest = people.filter((x) => x !== me);
    const seq = hearts.current!.begin({ [key]: on ? [...rest, me] : rest });
    setFavBy(hearts.current!.view());
    try {
      const r = await api<{ favorites: string[]; favBy: Record<string, string[]> }>('POST', `/api/watch/${data.id}/fav`, { key, on, who: me });
      const { refresh } = hearts.current!.answer(seq, r.favBy ?? {});
      setFavBy(hearts.current!.view());
      if (refresh) refreshMarks();
    } catch (e) {
      // The server may have saved part of it (P70: many photos in a few writes): read what it has now,
      // instead of putting back what this page remembered.
      hearts.current!.fail(seq);
      setFavBy(hearts.current!.view());
      setError((e as Error).message);
      refreshMarks();
    }
  };
  // The people who hearted, for the favourites filter ('' = without a name).
  const people = useMemo(() => {
    const all = new Set<string>();
    for (const key of favs) for (const w of favBy[key] ?? ['']) all.add(w);
    return [...all].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'he')));
  }, [favs, favBy]);
  const named = people.some((p) => p !== '');
  const namesOf = (key: string) => (favBy[key] ?? []).filter(Boolean).join(', ');
  const mine = (key: string) => (favBy[key] ?? (favs.has(key) ? [''] : [])).includes(who ?? '');

  /** A few photos the couple would like the studio to post on Instagram. */
  const toggleInsta = (key: string) => instaMany([key], !marks.current!.view()[key], false);

  const enter = () => {
    setEntered(true);
    requestAnimationFrame(() => galleryRef.current?.scrollIntoView({ behavior: 'smooth' }));
  };
  // Opened from a link to a set or a photo: straight to the photos.
  useEffect(() => {
    if (entered && !preview) requestAnimationFrame(() => galleryRef.current?.scrollIntoView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msg = favMessage(favs.size, photos.recommended);
  const date = formatDate(data.date);

  return (
    <div className={`pg${preview ? ' preview' : ''}`} data-testid="photo-gallery" data-nav={design.nav} data-color={design.color} style={designVars(design) as CSSProperties}>
      <section
        className={`pg-cover cv-${design.cover}`}
        style={{ '--cv-img': photos.cover ? `url(${photos.base}/${photos.cover}?s=l)` : 'none', '--cv-pos': photos.coverPos ? `${photos.coverPos.x}% ${photos.coverPos.y}%` : 'center' } as CSSProperties}
        data-testid="pg-cover"
      >
        <div className="cv-img" />
        <div className="pg-cover-shade" />
        <div className="pg-cover-content">
          <div className="pg-brand">
            {data.logoUrl ? <img src={data.logoUrl} alt={data.studioName} /> : <LogoMark />}
            <span>{data.studioName}</span>
          </div>
          <h1 data-testid="pg-title">{data.coupleName}</h1>
          {(date || data.venue) && (
            <div className="pg-date">
              {date}
              {date && data.venue ? ' · ' : ''}
              {data.venue}
            </div>
          )}
          <button type="button" className="pg-enter" onClick={enter} data-testid="pg-enter">
            צפייה בגלריה
          </button>
          {data.linked?.kind === 'films' && (
            <a className="pg-enter pg-enter-ghost" href={data.linked.path} data-testid="to-films">
              לסרטים שלכם
            </a>
          )}
        </div>
      </section>

      <div ref={galleryRef} className="pg-body" style={{ display: entered ? undefined : 'none' }}>
        <header className="pg-bar">
          <div className="pg-bar-title">
            <b>{data.coupleName}</b>
            <span>{data.studioName}</span>
          </div>
          <nav className="pg-tabs" data-testid="pg-tabs">
            {photos.sets.length === 0 && (
              <button type="button" className={tab === ALL ? 'on' : ''} onClick={() => setTab(ALL)}>
                הכל
              </button>
            )}
            {photos.sets.map((s) => (
              <button type="button" key={s.id} className={tab === s.id ? 'on' : ''} onClick={() => setTab(s.id)} data-testid="pg-tab">
                {s.name}
              </button>
            ))}
            {photos.sets.length > 0 && photos.items.some((p) => !p.set) && (
              <button type="button" className={tab === OTHER ? 'on' : ''} onClick={() => setTab(OTHER)} data-testid="pg-other-tab">
                תמונות נוספות
              </button>
            )}
            {!guest &&
              lists.map((l) => (
                <button type="button" key={l.id} className={`pg-list-tab${tab === LIST + l.id ? ' on' : ''}`} onClick={() => setTab(LIST + l.id)} data-testid="pg-list-tab">
                  ☆ {l.name} <span className="n">{l.keys.length}</span>
                </button>
              ))}
          </nav>
          <div className="pg-bar-actions">
            {!guest && (
              <>
                <button type="button" className={`pg-fav-tab${tab === FAV ? ' on' : ''}`} onClick={() => setTab(tab === FAV ? home : FAV)} data-testid="pg-fav-tab">
                  <Heart on={favs.size > 0} /> <span data-testid="pg-fav-count">{favs.size}</span>
                </button>
                <button type="button" className={`pg-fav-tab${tab === INSTA ? ' on' : ''}`} onClick={() => setTab(tab === INSTA ? home : INSTA)} title="התמונות שסימנתם לאינסטגרם" data-testid="pg-insta-tab">
                  <InstaIcon on={insta.size > 0} /> <span data-testid="pg-insta-count">{insta.size}</span>
                </button>
              </>
            )}
            {photos.faceSearch && (guest || data.guestPath) && (
              // Through the guests' link, so what is shared from there never carries the couple's link.
              <Link className="pg-download" to={`${guest ? location.pathname.replace(/\/$/, '') : data.guestPath}/me`} title="מצאו את התמונות שלי" data-testid="pg-find-me">
                <Ico d={ICONS.face} />
                <span className="t">מצאו את התמונות שלי</span>
              </Link>
            )}
            {data.linked?.kind === 'films' && (
              <a className="pg-download" href={data.linked.path} title="הסרטים" data-testid="to-films-bar">
                <Ico d={ICONS.film} />
                <span className="t">הסרטים</span>
              </a>
            )}
            {!guest && (
              <Link className="pg-download pg-album" to={`${location.pathname.replace(/\/$/, '')}/album`} title="עיצוב האלבום" data-testid="pg-album">
                <Ico d={ICONS.book} />
                <span className="t">עיצוב האלבום</span>
              </Link>
            )}
            {!guest && data.guestPath && (
              <button type="button" className="pg-download pg-share" onClick={shareGuests} title="שתפו עם האורחים" data-testid="pg-share-guests">
                <Ico d={ICONS.share} />
                <span className="t">שתפו עם האורחים</span>
              </button>
            )}
            <button type="button" className={`pg-download${picking ? ' on' : ''}`} onClick={() => (picking ? stopPicking() : setPicking(true))} aria-pressed={picking} title="בחירת כמה תמונות" data-testid="pg-pick">
              <Ico d={ICONS.check} />
              <span className="t">{picking ? 'סיום בחירה' : 'בחירה'}</span>
            </button>
            <button type="button" className="pg-download" onClick={() => setShow(true)} disabled={shown.length === 0} title="מצגת" data-testid="pg-slideshow">
              <Ico d={ICONS.play} />
              <span className="t">מצגת</span>
            </button>
            <button type="button" className="pg-download" onClick={() => setZipping(true)} title="הורדה" data-testid="pg-download-all">
              <DownloadIcon /> <span className="t">הורדה</span>
            </button>
          </div>
        </header>
        <div className={`pg-expiry${data.daysLeft <= 7 ? ' warn' : ''}`} role={data.daysLeft <= 7 ? 'alert' : undefined} data-testid="pg-expiry">
          {data.daysLeft <= 7
            ? `⚠ הגלריה נסגרת ${closingLabel(data.expiresAt)}. הורידו עכשיו את התמונות שתרצו לשמור.`
            : `הגלריה ${availabilityText(data.expiresAt, data.expired).replace('זמין', 'פתוחה')}`}
        </div>
        {photos.cloudOff && (
          <div className="pg-expiry warn" role="alert" data-testid="pg-cloud-off">
            התמונות לא זמינות כרגע: החיבור של הסטודיו לאחסון התמונות נותק. פנו לסטודיו.
          </div>
        )}
        <InstallHint id={data.id} light />
        {!guest && data.guestPath && <p className="guest-note">הקישור הזה אישי לכם (לבחירת תמונות ולאלבום). לאורחים שלחו את "שתפו עם האורחים".</p>}

        {openList && (
          <div className="pg-list-head" data-testid="pg-list-head">
            <b>☆ {openList.name}</b>
            <span>{openList.keys.length.toLocaleString('he-IL')} תמונות · רשימה אישית, לא נכנסת לאלבום</span>
            <button type="button" className="pg-me" onClick={renameOpenList}>
              שינוי שם
            </button>
            <button type="button" className="pg-me" onClick={deleteOpenList} data-testid="pg-list-delete">
              מחיקת הרשימה
            </button>
          </div>
        )}
        {picking && <p className="pg-pick-hint">לחצו על התמונות שתרצו לבחור. במחשב: Shift+לחיצה בוחרת טווח.</p>}
        {tab === FAV && named && (
          <div className="pg-people" role="group" aria-label="של מי הלבבות" data-testid="pg-people">
            <button type="button" className={person === null ? 'on' : ''} onClick={() => setPerson(null)}>
              כולם
            </button>
            {people.map((p) => (
              <button type="button" key={p || '-'} className={person === p ? 'on' : ''} onClick={() => setPerson(p)} data-testid="pg-person">
                {p || 'ללא שם'}
              </button>
            ))}
          </div>
        )}
        {tab === FAV && shown.length === 0 && person !== null ? (
          <p className="pg-empty">אין כאן לבבות.</p>
        ) : tab === FAV && shown.length === 0 ? (
          <p className="pg-empty">עוד לא סימנתם תמונות. לחצו על הלב שעל התמונה כדי להוסיף אותה לבחירה שלכם.</p>
        ) : openList && shown.length === 0 ? (
          <p className="pg-empty">הרשימה ריקה. בחרו תמונות ("בחירה" למעלה) והוסיפו אותן, או לחצו 3 בזמן צפייה בתמונה.</p>
        ) : tab === INSTA && shown.length === 0 ? (
          <p className="pg-empty">כאן יופיעו התמונות שתרצו שנעלה לאינסטגרם. לחצו על סמל המצלמה שעל תמונה כדי לסמן אותה.</p>
        ) : (
          <>
            {tab === INSTA && <p className="pg-empty">סימנתם {insta.size} תמונות לאינסטגרם. הסטודיו רואה את הבחירה שלכם.</p>}
            <Grid
              items={shown}
              base={photos.base}
              favs={favs}
              insta={insta}
              onOpen={openAt}
              onFav={guest ? undefined : toggleFav}
              onInsta={guest ? undefined : toggleInsta}
              label={photoLabel}
              names={tab === FAV && named ? namesOf : undefined}
              mine={mine}
              picking={picking}
              picked={picked}
              onPick={pick}
              design={design}
            />
          </>
        )}

        <footer className="pg-foot">
          <a href={`/accessibility?g=${data.id}`}>הצהרת נגישות</a>
        </footer>
        {picking && (
          <div className="pg-selbar" role="toolbar" aria-label="פעולות על התמונות שנבחרו" data-testid="pg-selbar">
            <b data-testid="pg-picked">{picked.size ? `נבחרו ${picked.size.toLocaleString('he-IL')}` : 'בחרו תמונות'}</b>
            <button type="button" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((p) => p.key)))} data-testid="pg-pick-all">
              {picked.size === shown.length && shown.length > 0 ? 'ביטול הכל' : `בחירת כל ${shown.length.toLocaleString('he-IL')}`}
            </button>
            {picked.size > 0 && (
              <>
                {!guest && tab !== FAV && (
                  <button type="button" className="gold" onClick={() => favPicked(true)} data-testid="pg-picked-fav">
                    ♥ למועדפים
                  </button>
                )}
                {!guest && tab === FAV && (
                  <button type="button" onClick={() => favPicked(false)} data-testid="pg-picked-unfav">
                    הסרה מהמועדפים
                  </button>
                )}
                {!guest && (
                  <button type="button" onClick={() => (instaMany([...picked], tab !== INSTA), stopPicking())} data-testid="pg-picked-insta">
                    {tab === INSTA ? 'הסרה מאינסטגרם' : '📷 לאינסטגרם'}
                  </button>
                )}
                {!guest && !openList && (
                  <button type="button" onClick={() => (setListAsk({ keys: [...picked], fresh: false }), stopPicking())} data-testid="pg-picked-list">
                    ☆ לרשימה…
                  </button>
                )}
                {!guest && openList && (
                  <button type="button" onClick={() => (listPhotos(openList.id, [...picked], false), stopPicking())} data-testid="pg-picked-unlist">
                    הסרה מהרשימה
                  </button>
                )}
                <button type="button" onClick={() => setZipPicked(true)} data-testid="pg-picked-zip">
                  <DownloadIcon /> הורדה
                </button>
              </>
            )}
            <button type="button" className="ghost" onClick={stopPicking}>
              סיום
            </button>
          </div>
        )}
        <div className={`pg-favbar ${msg.level}`} data-testid="pg-favbar" hidden={guest || picking}>
          <Heart on /> {msg.text}
          {who !== null && (
            <button type="button" className="pg-me" onClick={() => setAsking({ keys: [], bulk: false })} data-testid="pg-me">
              {who ? `מסמנים בשם ${who} · החלפה` : 'מי מסמן?'}
            </button>
          )}
        </div>
        {error && (
          <div className="pg-toast" role="status" data-testid="pg-toast">
            {error}
          </div>
        )}
      </div>

      {listAsk !== null && <ListDialog lists={listAsk.fresh ? [] : lists} count={listAsk.keys.length} fresh={listAsk.fresh} onChoose={chooseList} onClose={() => setListAsk(null)} />}
      {zipPicked && (
        <ZipDialog
          base={photos.base}
          name={data.coupleName}
          onClose={() => {
            setZipPicked(false);
            stopPicking();
          }}
          groups={[{ id: 'picked', label: 'התמונות שבחרתם', items: shown.filter((p) => picked.has(p.key)) }]}
        />
      )}
      {asking !== null && <WhoDialog names={people.filter(Boolean)} current={who ?? ''} onChoose={chooseWho} onClose={() => setAsking(null)} />}
      {show && <Slideshow items={shown} base={photos.base} music={photos.music} title={data.coupleName} onClose={() => setShow(false)} />}
      {zipping && (
        <ZipDialog
          base={photos.base}
          name={data.coupleName}
          onClose={() => setZipping(false)}
          groups={zipGroups(photos.items, photos.sets, tab, favs, openList)}
          cloud={data.folderDownloadUrl ? { url: data.folderDownloadUrl, label: `הכל מ${/^[A-Za-z]/.test(PROVIDER_NAMES[data.folderProvider || 'dropbox']) ? '-' : ''}${PROVIDER_NAMES[data.folderProvider || 'dropbox'].replace(' (דרך האתר)', '')}` } : undefined}
        />
      )}
      {open !== null && (
        <Lightbox
          items={shown}
          index={open}
          base={photos.base}
          favs={favs}
          onFav={guest ? undefined : toggleFav}
          insta={insta}
          onInsta={guest ? undefined : toggleInsta}
          onClose={closePhoto}
          onMove={moveTo}
          label={photoLabel}
          showOriginal={!data.downloadLocked}
          lists={guest ? undefined : { items: lists, toggle: toggleInList, create: (key) => setListAsk({ keys: [key], fresh: true }) }}
        />
      )}
    </div>
  );
}

/** Small copy for WhatsApp and social networks: long side 2048px. */
const SMALL_SIDE = 2048;

async function smallCopy(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, SMALL_SIDE / Math.max(bmp.width, bmp.height));
  if (scale === 1 && blob.type === 'image/jpeg') {
    bmp.close();
    return blob;
  }
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const small = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  bmp.close();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(small, 0, 0);
  small.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('jpeg'))), 'image/jpeg', 0.9));
}

/** Phones that can hand a photo to the system's share sheet ("Save Image" puts it in the photo gallery). */
function canSaveToPhone(): boolean {
  try {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    return coarse && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([new Uint8Array([0])], 'x.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * "Download" asks which quality: the original (full size, from the cloud) or a small copy for
 * WhatsApp and social networks. On phones the photo is prepared and then saved to the phone's
 * gallery through the share sheet ("Save Image"); on computers it downloads as a file.
 */
function DownloadMenu({ base, photo }: { base: string; photo: PublicPhoto }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'' | 'preparing' | 'ready' | 'error'>('');
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  const phone = useMemo(canSaveToPhone, []);
  const stem = photo.name.replace(/\.[^.]+$/, '');

  const ensurePin = usePin();
  const choose = async (quality: 'full' | 'small') => {
    if (quality === 'full' && !(await ensurePin())) return;
    setProblem('');
    // Computer + original: the browser's own download (fast, no memory used). First one byte, to
    // know it will work: a failed download opened as a page would leave the gallery (P72).
    if (!phone && quality === 'full') {
      setState('preparing');
      const url = `${base}/${photo.key}?s=full`;
      const probe = await fetch(url, { headers: { Range: 'bytes=0-0' }, credentials: 'same-origin' }).catch(() => null);
      if (!probe || !probe.ok) {
        // 403: the server says why (the download code); anything else: try again.
        const said = probe?.status === 403 ? ((await probe.json().catch(() => null)) as { error?: string } | null)?.error : '';
        setProblem(said || '');
        setState('error');
        return;
      }
      await probe.body?.cancel().catch(() => {});
      const a = document.createElement('a');
      a.href = `${url}&dl=1`;
      a.download = photo.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      countPhotoDownload(base);
      setState('');
      setOpen(false);
      return;
    }
    setState('preparing');
    try {
      const r = await fetch(`${base}/${photo.key}?s=${quality === 'full' ? 'full' : 'l'}`);
      if (!r.ok) throw new Error(String(r.status));
      let blob = await r.blob();
      if (quality === 'small') blob = await smallCopy(blob);
      const name = quality === 'small' ? `${stem}-small.jpg` : photo.name;
      countPhotoDownload(base);
      if (phone) {
        setFile(new File([blob], name, { type: 'image/jpeg' }));
        setState('ready');
      } else {
        saveBlob(blob, name);
        setState('');
        setOpen(false);
      }
    } catch {
      setState('error');
    }
  };

  const saveToPhone = async () => {
    if (!file) return;
    try {
      // Must run straight from the tap: iPhone only opens the share sheet from a user action.
      await navigator.share({ files: [file] });
      setOpen(false);
      setState('');
      setFile(null);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') saveBlob(file, file.name);
    }
  };

  return (
    <div className="pg-dl">
      <button type="button" className="pg-icon" onClick={() => setOpen((o) => !o)} aria-label="הורדה" aria-expanded={open} data-testid="lb-download">
        <DownloadIcon />
      </button>
      {open && (
        <div className="pg-dl-menu" role="menu" data-testid="download-menu">
          {state === 'ready' ? (
            <>
              <button type="button" className="pg-dl-main" onClick={saveToPhone} data-testid="save-to-phone">
                שמירה בגלריה של הטלפון
              </button>
              <span className="pg-dl-hint">בחלון שנפתח בחרו "שמירת תמונה" (Save Image).</span>
            </>
          ) : state === 'preparing' ? (
            <span className="pg-dl-hint">מכינים את התמונה…</span>
          ) : (
            <>
              <button type="button" onClick={() => choose('full')} data-testid="download-full">
                <b>איכות מלאה</b>
                <span>הקובץ המקורי, להדפסה ולשמירה</span>
              </button>
              <button type="button" onClick={() => choose('small')} data-testid="download-small">
                <b>איכות רגילה</b>
                <span>קובץ קטן ומהיר, לוואטסאפ ולרשתות</span>
              </button>
              {state === 'error' && (
                <span className="pg-dl-hint error" data-testid="download-error">
                  {problem || 'ההורדה לא הצליחה. נסו שוב.'}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function InstaIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" fill={on ? 'currentColor' : 'none'} fillOpacity={on ? 0.25 : 0} />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
