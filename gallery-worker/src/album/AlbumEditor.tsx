import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { touchDrag } from './touchDrag';
import {
  COVER_TEMPLATES,
  FONTS,
  TEMPLATES,
  MAX_TEXT_LENGTH,
  MAX_TEXTS,
  albumPrice,
  albumSize,
  canSplitSlot,
  changeTemplate,
  emptySlots,
  extraSpreadTemplate,
  isCustomId,
  newId,
  registerTemplates,
  removeSlot,
  splitSlot,
  splitSpread,
  storyAlbum,
  template,
  usedPhotos,
  type Album,
  type AlbumSpread,
  type AlbumTemplate,
  type AlbumText,
  type SlotFill,
} from '../../shared/album';
import { api, ApiError } from '../lib/api';
import type { PublicPhoto } from '../watch/types';
import { SpreadView, readSlotRef, type Selection } from './SpreadView';

interface Props {
  galleryId: string;
  coupleName: string;
  /** The wedding date as shown on the opening spread. */
  dateText: string;
  base: string;
  photos: PublicPhoto[];
  /** The gallery's sets (טיזר, התארגנות…), to pick photos by set. */
  sets: { id: string; name: string }[];
  favorites: Set<string>;
  onFavorite: (key: string) => Promise<void>;
  initial: Album;
  onBack: () => void;
  /** Set when the studio takes orders on the site: after "done" the couple continues to cover, engraving and payment. */
  ordering?: { extraSpreadPrice: number | null; includedSpreads: number | null; status: string } | null;
  /** Goes on to the order (sending the album again when its order is missing); a thrown error is shown in the editor. */
  onOrder?: () => Promise<void> | void;
}

/** How long the editor waits after the last change before it saves (one save at a time — fix plan P57). */
const SAVE_DELAY = 2000;

type SaveState = 'saved' | 'saving' | 'error';
type Modal = '' | 'layout' | 'addPage' | 'submit' | 'auto' | 'keys' | 'savePreset';
type Where = { s: number; i: number };

const emptyFill = (): SlotFill => ({ photo: '', zoom: 1, cx: 0.5, cy: 0.5 });
const HISTORY = 100;

export function AlbumEditor({ galleryId, coupleName, dateText, base, photos, sets, favorites, onFavorite, initial, onBack, ordering, onOrder }: Props) {
  const [album, setAlbum] = useState<Album>(initial);
  const albumRef = useRef(album);
  albumRef.current = album;
  // Layouts made in this album must be known before its pages are drawn.
  registerTemplates(album.custom);

  const [current, setCurrent] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [moving, setMoving] = useState<Where | null>(null);
  const [bankTab, setBankTab] = useState<string>('fav');
  const [hideUsed, setHideUsed] = useState(false);
  const [bigBank, setBigBank] = useState(false);
  const [save, setSave] = useState<SaveState>('saved');
  const [modal, setModal] = useState<Modal>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [studioLayouts, setStudioLayouts] = useState<AlbumTemplate[]>([]);
  const [canSaveStudio, setCanSaveStudio] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [autoSource, setAutoSource] = useState<string>('fav');
  const timer = useRef<number | undefined>(undefined);
  // P57: the copy the server has (its rev), the change waiting to be saved, and the saves in a row (one at a time).
  const revRef = useRef<number>(initial.rev ?? 0);
  const pending = useRef<Album | null>(null);
  const tookServer = useRef(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const past = useRef<Album[]>([]);
  const future = useRef<Album[]>([]);
  const lastPush = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [, setHistoryTick] = useState(0);

  const size = albumSize(album.size);
  const locked = album.status === 'submitted';
  const ars = useMemo(() => new Map(photos.map((p) => [p.key, p.ar])), [photos]);
  const used = useMemo(() => usedPhotos(album), [album]);
  const spread = album.spreads[current];
  // The studio's own numbers (fix plan P53): the pages it includes and its price for one more. A studio with album
  // orders but no extra-page price cannot sell more pages yet (D17(1)): the couple designs up to the included pages.
  // Without album orders there is no price at all (the album just goes to the studio).
  const included = ordering?.includedSpreads ?? size.baseSpreads;
  const pagePrice = ordering?.extraSpreadPrice ?? null;
  const price = albumPrice(album, pagePrice, ordering?.includedSpreads ?? null);
  const empty = emptySlots(album);
  const orderStarted = Boolean(ordering?.status && ordering.status !== 'draft');
  const pricedPages = pagePrice !== null && pagePrice > 0;
  const pagesCapped = Boolean(ordering) && pagePrice === null;
  const atMaxPages = album.spreads.length >= size.maxSpreads;
  const canAddPage = !atMaxPages && (!pagesCapped || album.spreads.length < included);
  const noMorePages = atMaxPages
    ? `באלבום אפשר עד ${size.maxSpreads} דפים.`
    : `הסטודיו עוד לא קבע מחיר לדף נוסף, אז אפשר עד ${included} דפים. לדפים נוספים פנו לסטודיו.`;
  const goOrder = async () => {
    try {
      await onOrder?.();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? '' : n)), 2600);
  };

  // The studio's saved layouts (offered in all its albums); saving there needs the studio's login.
  useEffect(() => {
    api<{ layouts: AlbumTemplate[]; canSave: boolean }>('GET', `/api/watch/${galleryId}/layouts`)
      .then((r) => {
        registerTemplates(r.layouts);
        setStudioLayouts(r.layouts);
        setCanSaveStudio(r.canSave);
      })
      .catch(() => {});
  }, [galleryId]);

  /**
   * Another tab or device saved first (or sent the album): its copy is shown, never overwritten (P57). The change
   * made here since is dropped — the couple is told.
   */
  const takeServer = (current: Album) => {
    tookServer.current = true;
    window.clearTimeout(timer.current);
    pending.current = null;
    revRef.current = current.rev ?? 0;
    past.current = [];
    future.current = [];
    albumRef.current = current;
    setAlbum(current);
    setCurrent((c) => Math.min(c, Math.max(0, current.spreads.length - 1)));
    setSelection(null);
    setCropIndex(null);
    setSave('saved');
    setNotice(current.status === 'submitted' ? 'האלבום נשלח לסטודיו ממכשיר אחר.' : 'האלבום עודכן ממכשיר אחר. מוצגת הגרסה העדכנית.');
  };

  /** Saves the waiting change, if any: one save at a time, each on the rev the previous one got. */
  const saveOne = async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      const r = await api<{ album: Album }>('PUT', `/api/watch/${galleryId}/album`, { album: next, rev: revRef.current });
      revRef.current = r.album.rev ?? revRef.current + 1;
      if (!pending.current) setSave('saved');
    } catch (e) {
      const current = e instanceof ApiError && e.status === 409 ? (e.data?.album as Album | null | undefined) : undefined;
      if (current) {
        takeServer(current);
        return;
      }
      // Kept for the next try (the next change, or "send"), unless a newer change is already waiting.
      pending.current = pending.current ?? next;
      setSave('error');
      setError(e instanceof ApiError ? e.message : 'השמירה נכשלה. בדקו את החיבור לאינטרנט.');
      throw e;
    }
  };
  /** Saves now (after any save already running); resolves when the album on the server is this page's. */
  const saveNow = () => {
    window.clearTimeout(timer.current);
    const run = queue.current.then(saveOne);
    queue.current = run.catch(() => {});
    return run;
  };
  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  // Autosave a moment after the last change.
  const persist = useCallback((next: Album) => {
    pending.current = next;
    window.clearTimeout(timer.current);
    setSave('saving');
    timer.current = window.setTimeout(() => void saveNowRef.current().catch(() => {}), SAVE_DELAY);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /**
   * Every change goes through here, so it can be undone. Changes with the same `group` in quick
   * succession (dragging inside a slot, a zoom slider, typing) count as one step.
   */
  const update = (fn: (a: Album) => Album, group = '') => {
    if (locked) return;
    const prev = albumRef.current;
    const next = { ...fn(prev), updatedAt: new Date().toISOString() };
    const now = Date.now();
    const merge = group && lastPush.current.key === group && now - lastPush.current.at < 1200;
    if (!merge) {
      past.current = [...past.current, prev].slice(-HISTORY);
      future.current = [];
    }
    lastPush.current = { key: group, at: now };
    albumRef.current = next;
    setAlbum(next);
    persist(next);
    setHistoryTick((n) => n + 1);
  };
  const undo = () => {
    if (locked || past.current.length === 0) return;
    const prev = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    future.current = [albumRef.current, ...future.current].slice(0, HISTORY);
    lastPush.current = { key: '', at: 0 };
    albumRef.current = prev;
    setAlbum(prev);
    persist(prev);
    setCurrent((c) => Math.min(c, prev.spreads.length - 1));
    setSelection(null);
    setCropIndex(null);
    setHistoryTick((n) => n + 1);
  };
  const redo = () => {
    if (locked || future.current.length === 0) return;
    const next = future.current[0];
    future.current = future.current.slice(1);
    past.current = [...past.current, albumRef.current].slice(-HISTORY);
    lastPush.current = { key: '', at: 0 };
    albumRef.current = next;
    setAlbum(next);
    persist(next);
    setCurrent((c) => Math.min(c, next.spreads.length - 1));
    setSelection(null);
    setCropIndex(null);
    setHistoryTick((n) => n + 1);
  };

  const updateSpread = (i: number, fn: (s: AlbumSpread) => AlbumSpread, group = '') => update((a) => ({ ...a, spreads: a.spreads.map((s, j) => (j === i ? fn(s) : s)) }), group);

  /** Keeps a custom layout inside the album once a page uses it (so the album prints on its own). */
  const withLayout = (a: Album, t: AlbumTemplate): Album => (isCustomId(t.id) && !(a.custom ?? []).some((c) => c.id === t.id) ? { ...a, custom: [...(a.custom ?? []), t] } : a);

  const goTo = (i: number) => {
    // albumRef: right after adding a page, the new length is already there.
    const n = Math.max(0, Math.min(albumRef.current.spreads.length - 1, i));
    setCurrent(n);
    setSelection(null);
    setCropIndex(null);
  };

  /** Puts a photo from the bank in a slot; if it was already used elsewhere, it moves (each photo appears once). */
  const place = (slot: number, key: string, page = current) => {
    update((a) => {
      const spreads = a.spreads.map((s) => ({ ...s, fills: s.fills.map((f) => (f.photo === key ? emptyFill() : f)) }));
      spreads[page] = { ...spreads[page], fills: spreads[page].fills.map((f, i) => (i === slot ? { photo: key, zoom: 1, cx: 0.5, cy: 0.5 } : f)) };
      return { ...a, spreads };
    });
    if (!favorites.has(key)) onFavorite(key).catch(() => {});
  };

  /** Moves a photo between two slots (any pages); a photo already there moves back to where the first came from. */
  const moveFill = (from: Where, to: Where) => {
    if (from.s === to.s && from.i === to.i) return;
    update((a) => {
      const spreads = a.spreads.map((s) => ({ ...s, fills: [...s.fills] }));
      const src = spreads[from.s]?.fills[from.i];
      const dst = spreads[to.s]?.fills[to.i];
      if (!src || !dst || !src.photo) return a;
      spreads[to.s].fills[to.i] = { ...src, zoom: 1, cx: 0.5, cy: 0.5 };
      spreads[from.s].fills[from.i] = dst.photo ? { ...dst, zoom: 1, cx: 0.5, cy: 0.5 } : emptyFill();
      return { ...a, spreads };
    });
  };

  /** A photo dropped on a page in the strip goes to that page's first empty slot. */
  const dropOnPage = (page: number, e: DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/photo');
    const from = readSlotRef(e);
    if (key) dropKeyOnPage(page, key);
    else if (from) dropKeyOnPage(page, '', from);
  };
  const dropKeyOnPage = (page: number, key: string, from?: { s: number; i: number } | null) => {
    if (locked) return;
    const firstEmpty = album.spreads[page].fills.findIndex((f) => !f.photo);
    if (firstEmpty < 0) {
      flash('אין משבצת ריקה בדף הזה. פתחו אותו וגררו על תמונה כדי להחליף.');
      return;
    }
    if (key) place(firstEmpty, key, page);
    else if (from) moveFill(from, { s: page, i: firstEmpty });
    flash(`התמונה עברה לדף ${page === 0 ? 'הפתיחה' : page + 1}`);
  };

  const selectSlot = (sel: Selection) => {
    // Move mode: the next slot clicked (on any page) receives the photo.
    if (moving && sel?.kind === 'slot') {
      moveFill(moving, { s: current, i: sel.index });
      setMoving(null);
      setSelection(sel);
      return;
    }
    if (cropIndex !== null && (sel?.kind !== 'slot' || sel.index !== cropIndex)) setCropIndex(null);
    setSelection(sel);
  };

  const selectedFill = selection?.kind === 'slot' ? spread?.fills[selection.index] : undefined;
  const selectedText = selection?.kind === 'text' ? spread?.texts.find((t) => t.id === selection.id) : undefined;
  const setFill = (i: number, fill: SlotFill, group = '') => updateSpread(current, (s) => ({ ...s, fills: s.fills.map((f, j) => (j === i ? fill : f)) }), group);
  const setText = (t: AlbumText) => updateSpread(current, (s) => ({ ...s, texts: s.texts.map((x) => (x.id === t.id ? t : x)) }), `text:${t.id}`);

  const addText = () => {
    if (spread.texts.length >= MAX_TEXTS) {
      flash(`אפשר עד ${MAX_TEXTS} טקסטים בדף.`);
      return;
    }
    const panel = template(spread.template).panels[0];
    const t: AlbumText = { id: newId('t'), text: 'הטקסט שלכם', x: panel ? panel.x + panel.w / 2 : 0.75, y: panel ? panel.y + panel.h / 2 : 0.5, size: 0.035, font: 'Assistant', color: '#2b2b2b', weight: 400, italic: false, spacing: 0.1, align: 'center' };
    updateSpread(current, (s) => ({ ...s, texts: [...s.texts, t] }));
    setSelection({ kind: 'text', id: t.id });
  };

  /** A new empty page at a position (0 = before everything after the opening). */
  const insertPage = (at: number) => {
    if (!canAddPage) {
      setModal('');
      flash(noMorePages);
      return;
    }
    const t = template(extraSpreadTemplate());
    const s: AlbumSpread = { id: newId('s'), template: t.id, fills: t.slots.map(emptyFill), texts: [] };
    const pos = Math.max(1, Math.min(album.spreads.length, at));
    update((a) => ({ ...a, spreads: [...a.spreads.slice(0, pos), s, ...a.spreads.slice(pos)] }));
    goTo(pos);
    setModal('');
    flash(album.spreads.length >= included && pricedPages ? `נוסף דף (+${pagePrice} ₪)` : 'נוסף דף');
  };

  const splitPage = () => {
    if (!canAddPage) {
      flash(noMorePages);
      return;
    }
    if (current === 0 || spread.fills.filter((f) => f.photo).length < 2) {
      flash('אפשר לחלק דף שיש בו לפחות שתי תמונות (לא את דף הפתיחה).');
      return;
    }
    const [a1, b1] = splitSpread(spread, ars, size);
    update((a) => ({ ...a, spreads: [...a.spreads.slice(0, current), a1, b1, ...a.spreads.slice(current + 1)] }));
    flash('הדף חולק לשניים');
  };

  const removePage = (i: number) => {
    if (i === 0) return;
    const photosOn = album.spreads[i].fills.filter((f) => f.photo).length;
    if (photosOn && !window.confirm(`למחוק את הדף? ${photosOn} התמונות שבו יחזרו לבנק.`)) return;
    update((a) => ({ ...a, spreads: a.spreads.filter((_, j) => j !== i) }));
    goTo(Math.max(0, i - 1));
  };

  const movePage = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (i === 0 || j < 1 || j >= album.spreads.length) return; // the opening spread stays first
    update((a) => {
      const spreads = [...a.spreads];
      [spreads[i], spreads[j]] = [spreads[j], spreads[i]];
      return { ...a, spreads };
    });
    setCurrent(j);
  };

  const applyLayout = (tp: AlbumTemplate) => {
    update((a) => {
      const withT = withLayout(a, tp);
      return { ...withT, spreads: withT.spreads.map((s, j) => (j === current ? changeTemplate(s, tp.id, ars, size) : s)) };
    });
    setModal('');
    setSelection(null);
    setCropIndex(null);
  };

  /** Split or remove the selected slot: the page gets its own copy of the layout. */
  const reshape = (kind: 'side' | 'stack' | 'remove') => {
    if (selection?.kind !== 'slot') return;
    const idx = selection.index;
    const t = template(spread.template);
    if (kind === 'remove') {
      if (t.slots.length <= 1) return;
      const { template: nt } = removeSlot(t, idx);
      update((a) => {
        const withT = withLayout(a, nt);
        return { ...withT, spreads: withT.spreads.map((s, j) => (j === current ? { ...s, template: nt.id, fills: s.fills.filter((_, k) => k !== idx) } : s)) };
      });
      setSelection(null);
      return;
    }
    if (!canSplitSlot(t, idx, kind)) {
      flash('המשבצת קטנה מדי לחלוקה, או שבדף כבר יש את מספר המשבצות המרבי.');
      return;
    }
    const nt = splitSlot(t, idx, kind);
    update((a) => {
      const withT = withLayout(a, nt);
      return { ...withT, spreads: withT.spreads.map((s, j) => (j === current ? { ...s, template: nt.id, fills: [...s.fills.slice(0, idx + 1), emptyFill(), ...s.fills.slice(idx + 1)] } : s)) };
    });
  };

  const savePreset = async () => {
    const t = template(spread.template);
    const name = presetName.trim() || `פריסה ${studioLayouts.length + (album.custom ?? []).filter((c) => c.name).length + 1}`;
    const preset: AlbumTemplate = { ...t, id: isCustomId(t.id) ? t.id : `c_${newId('').replace(/[^A-Za-z0-9]/g, '')}`, uses: 0, name };
    registerTemplates([preset]);
    if (canSaveStudio) {
      try {
        const r = await api<{ layouts: AlbumTemplate[] }>('POST', `/api/watch/${galleryId}/layouts`, { layout: preset });
        setStudioLayouts(r.layouts);
        flash(`הפריסה "${name}" נשמרה לכל האלבומים של הסטודיו`);
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      update((a) => ({ ...a, custom: [...(a.custom ?? []).filter((c) => c.id !== preset.id), preset] }));
      flash(`הפריסה "${name}" נשמרה באלבום הזה`);
    }
    setPresetName('');
    setModal('');
  };

  const removeStudioPreset = async (id: string) => {
    if (!window.confirm('למחוק את הפריסה מהרשימה השמורה? דפים שכבר משתמשים בה לא ישתנו.')) return;
    const r = await api<{ layouts: AlbumTemplate[] }>('POST', `/api/watch/${galleryId}/layouts`, { remove: id });
    setStudioLayouts(r.layouts);
  };

  // ---------- the automatic design, by the story ----------
  const setsWithPhotos = sets.map((s) => ({ ...s, n: photos.filter((p) => p.set === s.id).length })).filter((s) => s.n > 0);
  const sourcePhotos = (src: string) => (src === 'fav' ? photos.filter((p) => favorites.has(p.key)) : src === 'sets' ? photos.filter((p) => p.set) : photos.filter((p) => p.set === src));
  const buildAuto = () => {
    const chosen = sourcePhotos(autoSource);
    if (chosen.length === 0) {
      setError('אין תמונות במקור שבחרתם.');
      return;
    }
    const built = storyAlbum(chosen.map((p) => ({ key: p.key, ar: p.ar, set: p.set })), sets, coupleName, dateText, album.size);
    // Keep the names the couple already wrote on the opening spread.
    const oldTexts = album.spreads[0]?.texts ?? [];
    if (oldTexts.length && built.spreads[0]) built.spreads[0] = { ...built.spreads[0], texts: oldTexts };
    update((a) => ({ ...a, spreads: built.spreads }));
    goTo(0);
    setModal('');
    flash('העיצוב נבנה אוטומטית. אפשר לבטל עם ↶ (Cmd+Z).');
  };

  const submit = async () => {
    try {
      tookServer.current = false;
      await saveNow();
      // The album changed on another device meanwhile: the couple sees that copy first, and sends it themselves.
      if (tookServer.current) return setModal('');
      const r = await api<{ album: Album; orderPending?: boolean; removed?: number }>('POST', `/api/watch/${galleryId}/album/submit`, { rev: revRef.current });
      revRef.current = r.album.rev ?? revRef.current;
      albumRef.current = r.album;
      setAlbum(r.album);
      setModal('');
      if (r.removed) flash(`${r.removed} תמונות שהסטודיו הסתיר הוצאו מהאלבום.`);
      // P57: the album is sent even when its order could not be made yet; "להמשך ההזמנה" tries again.
      if (r.orderPending) setError('האלבום נשלח לסטודיו. ההזמנה עוד לא נפתחה — לחצו "להמשך ההזמנה" בעוד רגע.');
      else if (ordering && onOrder) await goOrder();
    } catch (e) {
      const current = e instanceof ApiError && e.status === 409 ? (e.data?.album as Album | null | undefined) : undefined;
      if (current) {
        takeServer(current);
        setModal('');
        return;
      }
      setError((e as Error).message);
    }
  };

  // ---------- keyboard ----------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      if (typing) return;
      e.preventDefault();
      redo();
      return;
    }
    if (typing || mod || e.altKey) return;
    if (e.key === 'Escape') {
      if (modal) setModal('');
      else if (moving) setMoving(null);
      else if (cropIndex !== null) setCropIndex(null);
      else setSelection(null);
      return;
    }
    if (modal) return;
    const slotSel = selection?.kind === 'slot' ? selection.index : -1;
    switch (e.key) {
      case 'ArrowLeft': // Hebrew album: left = the next page
      case 'PageDown':
        e.preventDefault();
        goTo(current + 1);
        return;
      case 'ArrowRight':
      case 'PageUp':
        e.preventDefault();
        goTo(current - 1);
        return;
      case 'Home':
        goTo(0);
        return;
      case 'End':
        goTo(album.spreads.length - 1);
        return;
      case 'Tab': {
        e.preventDefault();
        const n = spread.fills.length;
        const next = slotSel < 0 ? 0 : (slotSel + (e.shiftKey ? n - 1 : 1)) % n;
        setSelection({ kind: 'slot', index: next });
        setCropIndex(null);
        return;
      }
      case '?':
        setModal('keys');
        return;
    }
    if (locked) return;
    const k = e.key.toLowerCase();
    if ((e.key === 'Delete' || e.key === 'Backspace') && slotSel >= 0 && selectedFill?.photo) {
      e.preventDefault();
      setFill(slotSel, emptyFill());
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedText) {
      e.preventDefault();
      updateSpread(current, (s) => ({ ...s, texts: s.texts.filter((x) => x.id !== selectedText.id) }));
      setSelection(null);
    } else if (k === 'l' || k === 'ך') setModal('layout');
    else if (k === 'n' || k === 'מ') insertPage(current + 1);
    else if (k === 'd' || k === 'ג') splitPage();
    else if ((k === 'x' || k === 'ס') && slotSel >= 0 && selectedFill?.photo) {
      setMoving({ s: current, i: slotSel });
      flash('בחרו משבצת יעד, בכל דף (החצים מחליפים דף). Esc לביטול.');
    } else if (e.key === 'Enter' && slotSel >= 0 && selectedFill?.photo) setCropIndex(cropIndex === slotSel ? null : slotSel);
    else if ((e.key === '+' || e.key === '=') && slotSel >= 0 && selectedFill?.photo) setFill(slotSel, { ...selectedFill, zoom: Math.min(3, selectedFill.zoom + 0.1) }, `zoom:${current}:${slotSel}`);
    else if (e.key === '-' && slotSel >= 0 && selectedFill?.photo) setFill(slotSel, { ...selectedFill, zoom: Math.max(1, selectedFill.zoom - 0.1) }, `zoom:${current}:${slotSel}`);
    else if (e.key === '0' && slotSel >= 0 && selectedFill?.photo) setFill(slotSel, { ...selectedFill, zoom: 1, cx: 0.5, cy: 0.5 });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- the photo bank ----------
  const bank = photos
    .filter((p) => (bankTab === 'fav' ? favorites.has(p.key) || used.has(p.key) : bankTab === 'all' ? true : p.set === bankTab))
    .filter((p) => !hideUsed || !used.has(p.key));

  if (!spread) return null;
  const savedLayouts = [...studioLayouts, ...(album.custom ?? []).filter((c) => c.name && !studioLayouts.some((s) => s.id === c.id))];

  return (
    <div className="album-editor" data-testid="album-editor">
      <header className="ae-bar">
        <button type="button" className="btn btn-sm" onClick={onBack}>
          → לגלריה
        </button>
        <div className="ae-title">
          <b>האלבום של {coupleName}</b>
          <span className="dim">
            {size.label} <bdi dir="ltr">{size.dims}</bdi> ס״מ
          </span>
        </div>
        {!locked && (
          <div className="row" style={{ gap: '0.3rem' }}>
            <button type="button" className="btn btn-sm" onClick={undo} disabled={past.current.length === 0} title="ביטול פעולה (Cmd+Z)" data-testid="undo">
              ↶ ביטול
            </button>
            <button type="button" className="btn btn-sm" onClick={redo} disabled={future.current.length === 0} title="חזרה על פעולה (Cmd+Shift+Z)" data-testid="redo">
              ↷ חזרה
            </button>
          </div>
        )}
        <div className="ae-stats" data-testid="album-stats">
          <span>
            {album.spreads.length} דפים{price.extraSpreads > 0 && pricedPages && <b className="warn"> · {price.extraSpreads} נוספים (+{price.extraCost} ₪)</b>}
          </span>
          <span>
            {used.size} תמונות · מומלץ {size.recommendedPhotos}
          </span>
          <span className={save === 'error' ? 'error' : 'dim'} data-testid="save-state">
            {locked ? 'נשלח לסטודיו' : save === 'saving' ? 'שומר…' : save === 'saved' ? '✓ נשמר' : 'לא נשמר'}
          </span>
        </div>
        <div className="row" style={{ gap: '0.4rem' }}>
          <button type="button" className="btn btn-sm" onClick={() => setModal('keys')} title="קיצורי מקלדת (?)" data-testid="show-keys">
            ⌨
          </button>
          {!locked && (
            <>
              <button type="button" className="btn btn-sm btn-gold" onClick={() => setModal('auto')} data-testid="auto-build">
                ✦ בנייה אוטומטית
              </button>
              <button type="button" className="btn btn-sm" onClick={() => (atMaxPages ? flash(noMorePages) : setModal('addPage'))} disabled={atMaxPages} title={atMaxPages ? noMorePages : undefined} data-testid="add-page">
                + דף
              </button>
              <button type="button" className="btn btn-sm btn-white" onClick={() => setModal('submit')} data-testid="submit-album">
                סיימתי, שלחו לסטודיו
              </button>
            </>
          )}
        </div>
      </header>

      {locked && (
        <div className="ae-locked" data-testid="album-locked">
          האלבום נשלח לסטודיו{album.submittedAt ? ` ב-${new Date(album.submittedAt).toLocaleDateString('he-IL')}` : ''}. לשינויים פנו לסטודיו.
          {ordering && onOrder && (
            <button type="button" className="btn btn-sm btn-white" style={{ marginInlineStart: '0.8rem' }} onClick={goOrder} data-testid="go-order">
              {orderStarted ? 'צפייה בהזמנה' : 'להמשך ההזמנה: כריכה ותשלום'}
            </button>
          )}
        </div>
      )}
      {moving && (
        <div className="ae-moving" data-testid="moving-banner">
          בחרו משבצת יעד לתמונה (אפשר לעבור דף עם החצים או ברצועה למטה).
          <button type="button" className="btn btn-sm" onClick={() => setMoving(null)}>
            ביטול (Esc)
          </button>
        </div>
      )}
      {notice && (
        <div className="ae-notice" role="status" data-testid="notice">
          {notice}
        </div>
      )}

      <div className={`ae-main${bigBank ? ' big-bank' : ''}`}>
        <aside className="ae-bank" data-testid="bank">
          <div className="chips">
            <button type="button" className={`chip${bankTab === 'fav' ? ' active' : ''}`} onClick={() => setBankTab('fav')} data-testid="bank-fav">
              ♥ המועדפים <span className="n">{favorites.size}</span>
            </button>
            <button type="button" className={`chip${bankTab === 'all' ? ' active' : ''}`} onClick={() => setBankTab('all')} data-testid="bank-all">
              כל התמונות <span className="n">{photos.length}</span>
            </button>
            {setsWithPhotos.map((s) => (
              <button key={s.id} type="button" className={`chip${bankTab === s.id ? ' active' : ''}`} onClick={() => setBankTab(s.id)} data-testid="bank-set" data-set={s.id}>
                {s.name} <span className="n">{s.n}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'space-between', gap: '0.4rem' }}>
            <label className="row" style={{ gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={hideUsed} onChange={(e) => setHideUsed(e.target.checked)} /> להסתיר תמונות בשימוש
            </label>
            <button type="button" className="btn btn-sm" onClick={() => setBigBank((b) => !b)} title="גודל התמונות בבנק">
              {bigBank ? 'תמונות קטנות' : 'תמונות גדולות'}
            </button>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            גררו תמונה למשבצת (בטלפון: לחיצה ארוכה ואז גרירה), או לחצו על משבצת ואז על תמונה. אפשר לגרור גם לדף ברצועה למטה.
          </p>
          <div className="ae-bank-grid">
            {bank.map((p) => (
              <button
                type="button"
                key={p.key}
                className={`bank-photo${used.has(p.key) ? ' used' : ''}`}
                draggable={!locked}
                onDragStart={(e) => e.dataTransfer.setData('text/photo', p.key)}
                onClick={() => selection?.kind === 'slot' && !locked && place(selection.index, p.key)}
                {...touchDrag(`${base}/${p.key}?s=m`, (t) => (t.slot !== undefined ? place(t.slot, p.key) : t.page !== undefined && dropKeyOnPage(t.page, p.key)), locked)}
                title={used.has(p.key) ? 'כבר באלבום. גרירה תעביר אותה לכאן.' : p.name}
                data-testid="bank-photo"
                data-key={p.key}
              >
                <img src={`${base}/${p.key}?s=m`} alt="" loading="lazy" draggable={false} />
                {used.has(p.key) && <span className="used-mark">✓ בשימוש</span>}
              </button>
            ))}
            {bank.length === 0 && <span className="muted" style={{ gridColumn: '1 / -1' }}>אין תמונות כאן.</span>}
          </div>
        </aside>

        <section className="ae-stage">
          <div className="ae-spread-head">
            <b data-testid="spread-number">
              {current === 0 ? 'דף הפתיחה' : `דף ${current + 1}`}
              {current >= included && pricedPages && <span className="warn"> · דף נוסף (+{pagePrice} ₪)</span>}
            </b>
            {!locked && (
              <div className="row" style={{ gap: '0.4rem' }}>
                <button type="button" className="btn btn-sm" onClick={() => setModal('layout')} title="L" data-testid="change-layout">
                  החלפת פריסה
                </button>
                {current === 0 && (
                  <button type="button" className="btn btn-sm" onClick={addText} data-testid="add-text">
                    + טקסט
                  </button>
                )}
                {current > 0 && (
                  <>
                    <button type="button" className="btn btn-sm" onClick={splitPage} disabled={atMaxPages} title={atMaxPages ? noMorePages : 'D'} data-testid="split-page">
                      חלוקת הדף לשניים
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => movePage(current, -1)} disabled={current <= 1} title="הזזה קדימה">
                      ›
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => movePage(current, 1)} disabled={current >= album.spreads.length - 1} title="הזזה אחורה">
                      ‹
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removePage(current)} data-testid="remove-page">
                      מחיקת הדף
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <SpreadView
            spread={spread}
            sizeKey={album.size}
            ars={ars}
            base={base}
            editable={!locked}
            selection={selection}
            onSelect={selectSlot}
            onFill={(i, f) => setFill(i, f, `pan:${current}:${i}`)}
            onDropPhoto={(i, key) => place(i, key)}
            onMove={(from, to) => moveFill(from, { s: current, i: to })}
            onText={setText}
            spreadIndex={current}
            cropIndex={cropIndex}
            onCrop={setCropIndex}
            moving={Boolean(moving)}
          />
          <p className="hint center" style={{ margin: '0.4rem 0 0' }}>
            גרירה של תמונה מעבירה אותה למשבצת אחרת · לחיצה כפולה על תמונה מאפשרת להזיז אותה בתוך המשבצת · הקו המקווקו הוא הקפל
          </p>

          {!locked && selectedFill && selection?.kind === 'slot' && (
            <div className="ae-tools" data-testid="slot-tools">
              {selectedFill.photo ? (
                <>
                  <label className="row" style={{ gap: '0.5rem' }}>
                    זום
                    <input type="range" min={1} max={3} step={0.02} value={selectedFill.zoom} onChange={(e) => setFill(selection.index, { ...selectedFill, zoom: Number(e.target.value) }, `zoom:${current}:${selection.index}`)} data-testid="zoom" />
                  </label>
                  <button type="button" className={`btn btn-sm${cropIndex === selection.index ? ' btn-gold' : ''}`} onClick={() => setCropIndex(cropIndex === selection.index ? null : selection.index)} title="Enter" data-testid="crop-mode">
                    {cropIndex === selection.index ? 'סיום מיקום' : 'מיקום בתוך המשבצת'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setFill(selection.index, { ...selectedFill, zoom: 1, cx: 0.5, cy: 0.5 })}>
                    איפוס
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => { setMoving({ s: current, i: selection.index }); flash('בחרו משבצת יעד, בכל דף. Esc לביטול.'); }} title="X" data-testid="move-photo">
                    העברה למשבצת אחרת
                  </button>
                  <button type="button" className="btn btn-sm btn-danger" onClick={() => setFill(selection.index, emptyFill())} title="Delete" data-testid="remove-photo">
                    הוצאת התמונה
                  </button>
                </>
              ) : (
                <span className="hint">משבצת ריקה: לחצו על תמונה בבנק כדי לשים אותה כאן.</span>
              )}
              <span className="ae-tools-sep" />
              <button type="button" className="btn btn-sm" onClick={() => reshape('side')} disabled={!canSplitSlot(template(spread.template), selection.index, 'side')} data-testid="split-side" title="מחלק את המשבצת לשתיים, זו ליד זו">
                ◫ פיצול לרוחב
              </button>
              <button type="button" className="btn btn-sm" onClick={() => reshape('stack')} disabled={!canSplitSlot(template(spread.template), selection.index, 'stack')} data-testid="split-stack" title="מחלק את המשבצת לשתיים, אחת מעל השנייה">
                ⊟ פיצול לגובה
              </button>
              <button type="button" className="btn btn-sm" onClick={() => reshape('remove')} disabled={template(spread.template).slots.length <= 1} data-testid="remove-slot">
                מחיקת המשבצת
              </button>
              <button type="button" className="btn btn-sm btn-gold" onClick={() => setModal('savePreset')} data-testid="save-preset">
                ★ שמירת הפריסה
              </button>
            </div>
          )}

          {!locked && selectedText && (
            <div className="ae-tools text-tools" data-testid="text-tools">
              <textarea value={selectedText.text} onChange={(e) => setText({ ...selectedText, text: e.target.value })} rows={2} maxLength={MAX_TEXT_LENGTH} data-testid="text-value" />
              <select value={selectedText.font} onChange={(e) => setText({ ...selectedText, font: e.target.value })} data-testid="text-font">
                {FONTS.map((f) => (
                  <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                    {f.label}
                  </option>
                ))}
              </select>
              <label className="row" style={{ gap: '0.3rem' }}>
                גודל
                <input type="range" min={0.012} max={0.14} step={0.001} value={selectedText.size} onChange={(e) => setText({ ...selectedText, size: Number(e.target.value) })} data-testid="text-size" />
              </label>
              <input type="color" value={selectedText.color} onChange={(e) => setText({ ...selectedText, color: e.target.value })} title="צבע" data-testid="text-color" />
              <div className="chips">
                {(
                  [
                    [300, 'דק'],
                    [400, 'רגיל'],
                    [600, 'בינוני'],
                    [700, 'מודגש'],
                  ] as [AlbumText['weight'], string][]
                ).map(([w, label]) => (
                  <button type="button" key={w} className={`chip${selectedText.weight === w ? ' active' : ''}`} onClick={() => setText({ ...selectedText, weight: w })}>
                    {label}
                  </button>
                ))}
                <button type="button" className={`chip${selectedText.italic ? ' active' : ''}`} onClick={() => setText({ ...selectedText, italic: !selectedText.italic })}>
                  <i>נטוי</i>
                </button>
              </div>
              <label className="row" style={{ gap: '0.3rem' }}>
                ריווח
                <input type="range" min={0} max={0.6} step={0.01} value={selectedText.spacing} onChange={(e) => setText({ ...selectedText, spacing: Number(e.target.value) })} />
              </label>
              <div className="chips">
                {(['right', 'center', 'left'] as const).map((a) => (
                  <button type="button" key={a} className={`chip${selectedText.align === a ? ' active' : ''}`} onClick={() => setText({ ...selectedText, align: a })}>
                    {a === 'right' ? 'ימין' : a === 'center' ? 'מרכז' : 'שמאל'}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => {
                  updateSpread(current, (s) => ({ ...s, texts: s.texts.filter((x) => x.id !== selectedText.id) }));
                  setSelection(null);
                }}
              >
                מחיקת הטקסט
              </button>
              <span className="hint">גררו את הטקסט על הדף כדי להזיז אותו.</span>
            </div>
          )}
          {error && <div className="error">{error}</div>}
        </section>
      </div>

      <nav className="ae-strip" data-testid="strip">
        {album.spreads.map((s, i) => (
          <div key={s.id} className="ae-strip-item">
            <button
              type="button"
              className={`ae-thumb${i === current ? ' on' : ''}`}
              onClick={() => goTo(i)}
              onDragOver={(e) => !locked && e.preventDefault()}
              onDrop={(e) => dropOnPage(i, e)}
              data-drop-page={locked ? undefined : i}
              data-testid="strip-item"
            >
              <SpreadView spread={s} sizeKey={album.size} ars={ars} base={base} editable={false} mini />
              <span>
                {i === 0 ? 'פתיחה' : i + 1}
                {i >= included ? ' +' : ''}
              </span>
            </button>
            {!locked && (
              <button type="button" className="ae-insert" onClick={() => insertPage(i + 1)} title="הוספת דף כאן" data-testid="insert-page">
                +
              </button>
            )}
          </div>
        ))}
      </nav>

      {modal === 'layout' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal ae-layouts" onClick={(e) => e.stopPropagation()} data-testid="layout-picker">
            <h2>בחירת פריסה לדף</h2>
            <p className="muted">התמונות שכבר בדף יסודרו בפריסה החדשה לפי הסדר. אם יש פחות משבצות, התמונות הנוספות יחזרו לבנק.</p>
            {savedLayouts.length > 0 && (
              <div className="stack" style={{ gap: '0.4rem' }}>
                <b>★ הפריסות השמורות</b>
                <div className="ae-layout-grid">
                  {savedLayouts.map((tp) => (
                    <div key={tp.id} className="ae-saved">
                      <button type="button" className={`ae-layout${tp.id === spread.template ? ' on' : ''}`} onClick={() => applyLayout(tp)} data-testid="saved-layout">
                        <LayoutIcon t={tp} />
                      </button>
                      <span>
                        {tp.name}
                        {canSaveStudio && studioLayouts.some((x) => x.id === tp.id) && (
                          <button type="button" className="linkish" onClick={() => removeStudioPreset(tp.id)} title="מחיקה מהרשימה">
                            ×
                          </button>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {groupByCount(current === 0 ? [...COVER_TEMPLATES, ...TEMPLATES.filter((x) => !x.panels.length)] : TEMPLATES.filter((x) => !x.panels.length)).map(([n, list]) => (
              <div key={n} className="stack" style={{ gap: '0.4rem' }}>
                <b>{n} תמונות</b>
                <div className="ae-layout-grid">
                  {list.map((tp) => (
                    <button type="button" key={tp.id} className={`ae-layout${tp.id === spread.template ? ' on' : ''}`} onClick={() => applyLayout(tp)} data-testid="layout-option" data-slots={tp.slots.length}>
                      <LayoutIcon t={tp} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal === 'savePreset' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="preset-modal">
            <h2>שמירת הפריסה של הדף</h2>
            <div style={{ maxWidth: 360 }}>
              <LayoutIcon t={template(spread.template)} />
            </div>
            <p className="muted">{canSaveStudio ? 'הפריסה תישמר ותופיע בכל האלבומים של הסטודיו, תחת "הפריסות השמורות".' : 'הפריסה תישמר באלבום הזה, תחת "הפריסות השמורות".'}</p>
            <div className="field">
              <label htmlFor="preset-name">שם לפריסה</label>
              <input id="preset-name" value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="למשל: 3 אנכיות ופנורמה" autoFocus onKeyDown={(e) => e.key === 'Enter' && savePreset()} data-testid="preset-name" />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn" onClick={() => setModal('')}>
                ביטול
              </button>
              <button type="button" className="btn btn-white" onClick={savePreset} data-testid="preset-save">
                שמירה
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'auto' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="auto-modal">
            <h2>בנייה אוטומטית של האלבום</h2>
            <p>
              דף הפתיחה: 1–2 תמונות מ"צילומי חוץ" עם השמות. אחריו הדפים לפי הסדר: <b>התארגנות, צילומי חוץ, משפחות, טקס חופה, אולם, מסיבה</b>. כל דף מסט אחד, והתמונות מתחלקות על {size.baseSpreads} הדפים של האלבום, עם פריסות שמתאימות לצורת התמונות.
            </p>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <b>מאיזה תמונות?</b>
              <label className="row" style={{ gap: '0.5rem' }}>
                <input type="radio" name="auto-src" checked={autoSource === 'fav'} onChange={() => setAutoSource('fav')} /> המועדפים ({favorites.size})
              </label>
              <label className="row" style={{ gap: '0.5rem' }}>
                <input type="radio" name="auto-src" checked={autoSource === 'sets'} onChange={() => setAutoSource('sets')} data-testid="auto-src-sets" /> כל התמונות שמשויכות לסטים ({photos.filter((p) => p.set).length})
              </label>
              {setsWithPhotos.map((s) => (
                <label key={s.id} className="row" style={{ gap: '0.5rem' }}>
                  <input type="radio" name="auto-src" checked={autoSource === s.id} onChange={() => setAutoSource(s.id)} /> רק מהסט "{s.name}" ({s.n})
                </label>
              ))}
            </div>
            <p className="warn">העיצוב הנוכחי יוחלף. אם לא אהבתם, "↶ ביטול" (Cmd+Z) מחזיר אותו.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setModal('')}>
                ביטול
              </button>
              <button type="button" className="btn btn-white" onClick={buildAuto} data-testid="auto-confirm">
                בנייה
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'keys' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="keys-modal">
            <h2>קיצורי מקלדת</h2>
            <table className="ae-keys">
              <tbody>
                {(
                  [
                    ['← / →', 'הדף הבא / הקודם'],
                    ['Home / End', 'דף הפתיחה / הדף האחרון'],
                    ['Tab', 'המשבצת הבאה (Shift+Tab: הקודמת)'],
                    ['Enter', 'מיקום התמונה בתוך המשבצת (גם לחיצה כפולה)'],
                    ['+ / −', 'זום לתמונה המסומנת'],
                    ['0', 'איפוס הזום והמיקום'],
                    ['Delete', 'הוצאת התמונה מהמשבצת'],
                    ['X', 'העברת התמונה למשבצת אחרת (גם בדף אחר)'],
                    ['L', 'החלפת פריסה'],
                    ['N', 'דף חדש אחרי הדף הזה'],
                    ['D', 'חלוקת הדף לשניים'],
                    ['Cmd+Z', 'ביטול פעולה'],
                    ['Cmd+Shift+Z', 'חזרה על פעולה'],
                    ['Esc', 'ביטול בחירה / העברה / חלון'],
                    ['?', 'החלון הזה'],
                  ] as [string, string][]
                ).map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <kbd>{k}</kbd>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modal === 'addPage' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="add-page-modal">
            <h2>להוסיף דף לאלבום?</h2>
            <p>
              האלבום כולל {included} דפים ({included * 2} עמודים).{pricedPages && <b> כל דף נוסף הוא תוספת של {pagePrice} ₪.</b>}
            </p>
            {price.extraSpreads > 0 && pricedPages && <p className="muted">כבר הוספתם {price.extraSpreads} דפים (+{price.extraCost} ₪).</p>}
            {!canAddPage && (
              <p className="warn" data-testid="add-page-capped">
                {noMorePages}
              </p>
            )}
            <p className="muted">טיפ: ה-"+" שבין הדפים ברצועה למטה מוסיף דף בדיוק במקום שבחרתם.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setModal('')}>
                ביטול
              </button>
              <button type="button" className="btn btn-white" onClick={() => insertPage(album.spreads.length)} disabled={!canAddPage} data-testid="confirm-add-page">
                {pricedPages ? `הוספת דף (+${pagePrice} ₪)` : 'הוספת דף'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modal === 'submit' && (
        <div className="modal-backdrop" onClick={() => setModal('')}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="submit-modal">
            <h2>לשלוח את האלבום לסטודיו?</h2>
            <ul className="steps">
              <li>
                {album.spreads.length} דפים, {used.size} תמונות.
              </li>
              {price.extraSpreads > 0 && pricedPages && (
                <li className="warn">
                  {price.extraSpreads} דפים נוספים: תוספת של {price.extraCost} ₪.
                </li>
              )}
              {empty > 0 && <li className="warn">יש עוד {empty} משבצות ריקות. אפשר לשלוח גם ככה, והסטודיו ישלים.</li>}
            </ul>
            <p className="muted">אחרי השליחה לא אפשר לשנות לבד. אם תרצו שינוי, הסטודיו יפתח לכם את האלבום מחדש.</p>
            {ordering && <p>בשלב הבא בוחרים מוצר, כריכה, חריטה ותוספות, ומשלמים.</p>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setModal('')}>
                עוד לא
              </button>
              <button type="button" className="btn btn-white" onClick={submit} data-testid="confirm-submit">
                {ordering ? 'שליחה והמשך להזמנה' : 'שליחה לסטודיו'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function groupByCount(list: typeof TEMPLATES): [number, typeof TEMPLATES][] {
  const m = new Map<number, typeof TEMPLATES>();
  for (const t of list) m.set(t.slots.length, [...(m.get(t.slots.length) ?? []), t]);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

/** A small drawing of a layout (for the picker). */
function LayoutIcon({ t }: { t: AlbumTemplate }) {
  return (
    <svg viewBox="0 0 160 60" aria-hidden="true">
      <rect x="0" y="0" width="160" height="60" fill="#fff" />
      {t.panels.map((p, i) => (
        <rect key={`p${i}`} x={p.x * 160} y={p.y * 60} width={p.w * 160} height={p.h * 60} fill="#f6efe0" />
      ))}
      {t.slots.map((r, i) => (
        <rect key={i} x={r.x * 160 + 0.6} y={r.y * 60 + 0.6} width={Math.max(1, r.w * 160 - 1.2)} height={Math.max(1, r.h * 60 - 1.2)} fill="#b9c7d8" />
      ))}
      <line x1="80" y1="0" x2="80" y2="60" stroke="#c0392b" strokeWidth="0.6" strokeDasharray="2 2" />
    </svg>
  );
}
