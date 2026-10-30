import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { chapterAt, formatTime, worthResuming } from '../../shared/chapters';
import { TAGS } from '../../shared/dropbox';
import { PROVIDER_NAMES } from '../../shared/providers';
import { availabilityText } from '../lib/expiry';
import { formatBytes, formatDate } from '../lib/format';
import { CloseIcon, CloudIcon, DownloadIcon, GearIcon, ListIcon, PlayIcon } from './icons';
import { usePin } from './Locked';
import { pickVersion, rememberQuality } from './quality';
import type { WatchData, WatchFilm } from './types';

export function Cinema({ data, onClose, onDownload }: { data: WatchData; onClose: () => void; onDownload: (e: React.MouseEvent) => void }) {
  const firstPlayable = Math.max(0, data.films.findIndex((f) => f.playable));
  const [index, setIndex] = useState(firstPlayable);
  const film: WatchFilm | undefined = data.films[index];
  const [vIdx, setVIdx] = useState(() => (film ? pickVersion(film, data.id) : 0));
  const [menuOpen, setMenuOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  // When the couple switches quality mid-film, continue from the same second.
  const resumeAt = useRef<{ time: number; play: boolean } | null>(null);
  const quality = useRef<HTMLDivElement>(null);
  // Where they stopped last time (this device), offered once when a film opens.
  const [offer, setOffer] = useState<number | null>(null);
  const [chapter, setChapter] = useState(-1);
  const savedAt = useRef(0);
  const resumeKey = film ? `resume:${data.id}:${film.title}` : '';
  const chapters = film?.chapters ?? [];
  // Downloads may need the studio's code first; after it's typed the links come back.
  const ensurePin = usePin();
  const guarded = (e: React.MouseEvent) => {
    if (data.downloadLocked) {
      e.preventDefault();
      e.stopPropagation();
      void ensurePin();
      return;
    }
    onDownload(e);
  };

  // Films the cloud no longer has (P65): found when the player fails and our own address says so.
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  const version = film?.versions[vIdx] ?? film?.versions[0];
  const isGone = Boolean(version?.watchUrl && gone.has(version.watchUrl));
  const canPlay = Boolean(version?.playable && version?.watchUrl) && !isGone;

  // The player failed: is it the film itself (gone from the studio's cloud) or this browser? Our address answers
  // 502 / 404 / 400 when the cloud lost the file; anything else keeps the player's own message.
  const onPlayerError = async () => {
    const src = version?.watchUrl;
    if (!src || gone.has(src)) return;
    try {
      const res = await fetch(src, { headers: { Range: 'bytes=0-0' } });
      void res.body?.cancel().catch(() => {});
      if (res.status === 400 || res.status === 404 || res.status === 502) setGone((prev) => new Set(prev).add(src));
    } catch {
      /* offline: the player says it */
    }
  };
  const choices = film ? film.versions.map((v, i) => ({ v, i })).filter((x) => x.v.playable && x.v.watchUrl) : [];
  const bigger = film && version ? film.versions.find((v) => v.height > version.height) : undefined;

  const pick = (i: number) => {
    resumeAt.current = null;
    setOffer(null);
    setChapter(-1);
    setIndex(i);
    setVIdx(pickVersion(data.films[i], data.id));
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const switchVersion = (i: number) => {
    const v = video.current;
    resumeAt.current = { time: v?.currentTime ?? 0, play: Boolean(v && !v.paused) };
    if (film) rememberQuality(data.id, film.versions[i].height);
    setVIdx(i);
    setMenuOpen(false);
  };

  useEffect(() => {
    const v = video.current;
    if (!v || !canPlay) return;
    const pending = resumeAt.current;
    resumeAt.current = null;
    const onMeta = () => {
      if (pending && pending.time > 0) v.currentTime = pending.time;
      if (!pending || pending.play) v.play().catch(() => {});
      if (!pending) {
        let stored = 0;
        try {
          stored = Number(localStorage.getItem(resumeKey) ?? 0);
        } catch {
          stored = 0;
        }
        setOffer(worthResuming(stored, v.duration) ? stored : null);
      }
    };
    v.addEventListener('loadedmetadata', onMeta, { once: true });
    v.load();
    return () => v.removeEventListener('loadedmetadata', onMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version?.watchUrl, canPlay]);

  // Remember the place every few seconds (on this device only); the chapter list follows the film.
  const onTime = () => {
    const v = video.current;
    if (!v) return;
    if (chapters.length) {
      const c = chapterAt(chapters, v.currentTime);
      if (c !== chapter) setChapter(c);
    }
    if (Math.abs(v.currentTime - savedAt.current) < 5) return;
    savedAt.current = v.currentTime;
    try {
      if (worthResuming(v.currentTime, v.duration)) localStorage.setItem(resumeKey, String(Math.floor(v.currentTime)));
      else localStorage.removeItem(resumeKey);
    } catch {
      /* private mode */
    }
  };
  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => {});
    setOffer(null);
  };

  // The quality menu closes with Esc or a tap outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!quality.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [menuOpen]);

  return (
    <div className="screen cinema">
      <div className="topbar">
        <div className="now">
          {film && <span className="badge">{TAGS[film.tag].badge}</span>}
          <span>
            {data.coupleName}
            {film ? ` · ${film.title}` : ''}
          </span>
        </div>
        <button type="button" className="btn btn-gold btn-sm" onClick={onClose} data-testid="close">
          <CloseIcon /> סגור
        </button>
      </div>

      {data.daysLeft <= 7 && <div className="warnline">⚠ הגלריה נסגרת בקרוב — {availabilityText(data.expiresAt, data.expired)}. מומלץ להוריד את כל הסרטים עכשיו.</div>}

      <div className="layout">
        <div>
          <div className={`player${film?.tag === 'reels' ? ' vertical' : ''}`}>
            {canPlay ? (
              <video ref={video} src={version!.watchUrl} controls autoPlay playsInline preload="auto" poster={data.coverUrl || undefined} onTimeUpdate={onTime} onError={() => void onPlayerError()} onEnded={() => {
                try {
                  localStorage.removeItem(resumeKey);
                } catch {
                  /* private mode */
                }
              }} data-testid="player" />
            ) : isGone ? (
              <div className="noplay" role="alert" data-testid="film-gone">
                <p>הסרט כבר לא זמין אצל ספק האחסון, פנו לסטודיו.</p>
                {version?.downloadUrl && (
                  <a className="btn btn-gold" href={version.downloadUrl} target="_blank" rel="noopener" onClick={guarded}>
                    <DownloadIcon /> לנסות להוריד את הסרט · {formatBytes(version.sizeBytes)}
                  </a>
                )}
              </div>
            ) : (
              <div className="noplay">
                <p>{film ? 'הסרט הזה זמין להורדה בלבד (הפורמט לא נתמך לצפייה בדפדפן).' : 'אין סרטים בגלריה עדיין.'}</p>
                {film && version && (
                  <a className="btn btn-gold" href={version.downloadUrl} target="_blank" rel="noopener" onClick={guarded}>
                    <DownloadIcon /> הורדת הסרט · {formatBytes(version.sizeBytes)}
                  </a>
                )}
              </div>
            )}
          </div>
          {offer !== null && canPlay && (
            <div className="resume" role="status" data-testid="resume">
              <span>עצרתם בפעם הקודמת ב-{formatTime(offer)}</span>
              <button type="button" className="btn btn-gold btn-sm" onClick={() => seek(offer)} data-testid="resume-go">
                להמשיך מ-{formatTime(offer)}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => setOffer(null)}>
                מההתחלה
              </button>
            </div>
          )}
          {chapters.length > 0 && canPlay && (
            <nav className="chapters" aria-label="פרקים בסרט" data-testid="chapter-list">
              {chapters.map((c, i) => (
                <button type="button" key={c.t} className={i === chapter ? 'on' : ''} aria-current={i === chapter ? 'true' : undefined} onClick={() => seek(c.t)} data-testid="chapter">
                  <span className="dim" dir="ltr">
                    {formatTime(c.t)}
                  </span>
                  {c.title}
                </button>
              ))}
            </nav>
          )}
          {film && version && (
            <div className="under">
              <div className="title">
                <span className="badge">{TAGS[film.tag].badge}</span>
                <h2>{film.title}</h2>
                <span className="dim" style={{ direction: 'ltr' }}>
                  ({index + 1}/{data.films.length})
                </span>
              </div>
              <div className="row" style={{ gap: '0.5rem' }}>
                {choices.length > 1 && (
                  <div className="quality" ref={quality}>
                    <button type="button" className="btn btn-sm" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen} data-testid="quality">
                      <GearIcon /> איכות · {version.label || 'מקור'}
                    </button>
                    {menuOpen && (
                      <div className="menu" data-testid="quality-menu">
                        {choices.map(({ v, i }) => (
                          <button type="button" key={i} className={i === vIdx ? 'active' : ''} onClick={() => switchVersion(i)}>
                            <span>{v.label || 'מקור'}</span>
                            <span className="dim">{formatBytes(v.sizeBytes)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <a className="btn btn-gold" href={version.downloadUrl} target="_blank" rel="noopener" onClick={guarded} data-testid="download-current">
                  <DownloadIcon /> הורדת סרט{version.label ? ` ${version.label}` : ''} · {formatBytes(version.sizeBytes)}
                </a>
              </div>
              <div className="meta">
                <span>
                  {data.coupleName} · {formatDate(data.date)} · {data.studioName}
                  {data.instagram && (
                    <>
                      {' · '}
                      <a href={`https://instagram.com/${data.instagram}`} target="_blank" rel="noopener" className="insta">
                        @{data.instagram}
                      </a>
                    </>
                  )}
                </span>
                {bigger ? (
                  <a href={bigger.downloadUrl} target="_blank" rel="noopener" onClick={guarded} className="dim" data-testid="download-bigger">
                    הורדת גרסת {bigger.label} · {formatBytes(bigger.sizeBytes)}
                  </a>
                ) : (
                  <span>{availabilityText(data.expiresAt, data.expired)}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <aside className="side">
          <div className="head">
            <h3>
              <ListIcon /> סרטים והארכיון
            </h3>
            <div className="row" style={{ gap: '0.4rem' }}>
              {data.folderDownloadUrl && (
                <a className="btn btn-sm" href={data.folderDownloadUrl} target="_blank" rel="noopener" onClick={guarded} data-testid="download-all">
                  <CloudIcon /> הורדת הכל {/^[A-Za-z]/.test(PROVIDER_NAMES[data.folderProvider || 'dropbox']) ? 'מ-' : 'מ'}{PROVIDER_NAMES[data.folderProvider || 'dropbox'].replace(' (דרך האתר)', '')}
                </a>
              )}
              <span className="count">{data.films.length}</span>
            </div>
          </div>
          {data.films.map((f, i) => (
            <div
              key={i}
              className={`film${i === index ? ' active' : ''}`}
              onClick={() => pick(i)}
              role="button"
              tabIndex={0}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`${f.title}${i === index ? ' (מתנגן עכשיו)' : ''}`}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  pick(i);
                }
              }}
              data-testid="film-row"
            >
              <span className="play">
                <PlayIcon />
              </span>
              <div className="info">
                <div className="t">
                  <span>{f.title}</span>
                  <span className="badge">{TAGS[f.tag].badge}</span>
                </div>
                <div className="s">
                  {f.versions.length > 1 ? f.versions.map((v) => v.label || 'מקור').join(' · ') : formatBytes(f.sizeBytes)}
                  {!f.playable && ' · להורדה בלבד'}
                </div>
              </div>
              <a
                className="btn btn-sm dl"
                href={f.downloadUrl}
                target="_blank"
                rel="noopener"
                onClick={(e) => {
                  e.stopPropagation();
                  guarded(e);
                }}
              >
                <DownloadIcon /> הורדה
              </a>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
