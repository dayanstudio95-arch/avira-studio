import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../lib/dialog';
import { CloseIcon } from '../watch/icons';
import type { PublicPhoto } from '../watch/types';

const SPEEDS = [3, 5, 8];

/**
 * Full-screen slideshow: the photos one after another with a soft cross-fade, the studio's song
 * behind them (when there is one). Space pauses, arrows move, Esc closes. The controls fade away
 * while it plays and come back on a touch or mouse move.
 */
export function Slideshow({ items, base, music, title, onClose }: { items: PublicPhoto[]; base: string; music?: string; title: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(5);
  const [sound, setSound] = useState(Boolean(music));
  const [idle, setIdle] = useState(false);
  // Two layers: the photo on screen and the one fading in over it.
  const [layers, setLayers] = useState<[number, number]>([0, 0]);
  const [front, setFront] = useState<0 | 1>(0);
  const idleTimer = useRef(0);
  useDialog(box, onClose);

  const go = (i: number) => {
    const next = (i + items.length) % items.length;
    setIndex(next);
    setLayers((l) => (front === 0 ? [l[0], next] : [next, l[1]]));
    setFront((f) => (f === 0 ? 1 : 0));
  };

  // Next photo on a timer, once it has loaded. Avira fix (2026-10-30): the timer now really waits for the next photo
  // (at most 8 seconds more) — Studio Plan's only waited for the clock, so a slow line faded into an empty frame.
  useEffect(() => {
    if (!playing || items.length < 2) return;
    let stop = false;
    const nextItem = items[(index + 1) % items.length];
    const ready = new Promise<void>((resolve) => {
      if (!nextItem) return resolve();
      const img = new Image();
      img.onload = img.onerror = () => resolve();
      img.src = `${base}/${nextItem.key}?s=l`;
    });
    const t = window.setTimeout(async () => {
      await Promise.race([ready, new Promise((r) => window.setTimeout(r, 8000))]);
      if (!stop) go(index + 1);
    }, speed * 1000);
    return () => {
      stop = true;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, index, speed, items.length]);

  // The next two photos load ahead.
  useEffect(() => {
    for (const j of [1, 2]) {
      const p = items[(index + j) % items.length];
      if (p) new Image().src = `${base}/${p.key}?s=l`;
    }
  }, [index, items, base]);

  // Music follows play / pause and the sound switch.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    if (playing && sound) a.play().catch(() => setSound(false));
    else a.pause();
  }, [playing, sound]);

  // Keys, full screen, and the screen stays awake while it plays.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.key === 'ArrowLeft') go(index + 1);
      if (e.key === 'ArrowRight') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, front]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    box.current?.requestFullscreen?.().catch(() => {});
    let lock: { release: () => Promise<void> } | null = null;
    (navigator as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      document.body.style.overflow = '';
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      lock?.release().catch(() => {});
    };
  }, []);

  const wake = () => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setIdle(true), 2500);
  };
  useEffect(() => {
    wake();
    return () => window.clearTimeout(idleTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;
  return (
    <div ref={box} className={`slideshow${idle && playing ? ' idle' : ''}`} role="dialog" aria-modal="true" aria-label={`מצגת: ${title}`} onMouseMove={wake} onTouchStart={wake} tabIndex={-1} data-testid="slideshow">
      {layers.map((i, n) => {
        const p = items[i];
        return p ? <img key={n} src={`${base}/${p.key}?s=l`} alt="" className={`ss-img${front === n ? ' on' : ''}`} style={{ backgroundImage: `url(${base}/${p.key}?s=m)` }} /> : null;
      })}
      {music && <audio ref={audio} src={music} loop preload="auto" />}
      <div className="ss-top">
        <span className="ss-title">{title}</span>
        <span className="ss-count" data-testid="ss-count">
          {index + 1} / {items.length}
        </span>
        <button type="button" className="ss-btn" onClick={onClose} aria-label="סגירת המצגת" data-testid="ss-close">
          <CloseIcon />
        </button>
      </div>
      <div className="ss-controls">
        <button type="button" className="ss-btn" onClick={() => go(index - 1)} aria-label="התמונה הקודמת">
          ›
        </button>
        <button type="button" className="ss-btn ss-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'השהיה' : 'הפעלה'} data-testid="ss-play" data-autofocus>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="ss-btn" onClick={() => go(index + 1)} aria-label="התמונה הבאה" data-testid="ss-next">
          ‹
        </button>
        <label className="ss-speed">
          <span className="sr-only">מהירות</span>
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} שניות
              </option>
            ))}
          </select>
        </label>
        {music && (
          <button type="button" className={`ss-btn${sound ? ' on' : ''}`} onClick={() => setSound((v) => !v)} aria-pressed={sound} aria-label={sound ? 'השתקת המוזיקה' : 'הפעלת המוזיקה'} data-testid="ss-sound">
            ♪
          </button>
        )}
      </div>
    </div>
  );
}
