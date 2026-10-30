import { useEffect, useRef, useState } from 'react';
import { availabilityText } from '../lib/expiry';
import { formatDate } from '../lib/format';
import { InfoIcon, LogoMark, MuteIcon, PlayIcon, SoundIcon } from './icons';
import { pickHeroClip, verySlowNetwork } from './quality';
import type { WatchData } from './types';
import { InstallHint } from '../lib/InstallHint';

/** How much of the clip loops behind the title. After the first pass it plays from cache. */
const LOOP_SECONDS = 30;

export function Hero({ data, onWatch }: { data: WatchData; onWatch: () => void }) {
  const date = formatDate(data.date);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  // The clip's film is not there any more (P65): the cover stays, without a broken player behind the title.
  const [clipFailed, setClipFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const clip = !reducedMotion && !verySlowNetwork() ? pickHeroClip(data.films) : null;

  // Start only once enough is buffered, so the opening never stutters.
  useEffect(() => {
    const v = video.current;
    if (!v || !clip) return;
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      v.play().catch(() => {
        started = false;
      });
    };
    const onProgress = () => {
      try {
        if (v.buffered.length && v.buffered.end(0) - v.currentTime >= 6) start();
      } catch {
        /* ignore */
      }
    };
    const onTime = () => {
      if (v.currentTime >= LOOP_SECONDS) v.currentTime = 0;
    };
    v.addEventListener('canplaythrough', start);
    v.addEventListener('progress', onProgress);
    v.addEventListener('timeupdate', onTime);
    v.load();
    return () => {
      v.removeEventListener('canplaythrough', start);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('timeupdate', onTime);
    };
  }, [clip?.watchUrl]);

  return (
    <div className="hero">
      {data.coverUrl ? <div className="cover" style={{ backgroundImage: `url(${data.coverUrl})` }} /> : <div className="cover-fallback" />}
      {clip && !clipFailed && (
        <video
          ref={video}
          className={`cover-video${playing ? ' on' : ''}`}
          src={clip.watchUrl}
          muted={muted}
          loop
          playsInline
          preload="auto"
          onPlaying={() => setPlaying(true)}
          onError={() => {
            setClipFailed(true);
            setPlaying(false);
          }}
          data-testid="hero-video"
        />
      )}
      <div className="shade" />
      <div className="brand">
        {data.logoUrl ? <img src={data.logoUrl} alt={data.studioName} /> : <LogoMark />}
        <span className="spaced">{data.studioName}</span>
      </div>
      {clip && !clipFailed && playing && (
        <button type="button" className="sound" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'הפעל קול' : 'השתק'} data-testid="hero-sound">
          {muted ? <MuteIcon /> : <SoundIcon />}
        </button>
      )}
      <div className="content">
        <div className="spaced presents">{data.studioName} PRESENTS</div>
        <h1 data-testid="couple-name">{data.coupleName}</h1>
        {(date || data.venue) && (
          <div className="date">
            {date}
            {date && data.venue ? ' · ' : ''}
            {data.venue}
          </div>
        )}
        <button type="button" className="btn btn-white" onClick={onWatch} data-testid="watch">
          <PlayIcon /> צפייה בסרט
        </button>
        {data.linked?.kind === 'photos' && (
          <a className="btn" href={data.linked.path} data-testid="to-photos">
            לגלריית התמונות
          </a>
        )}
        <div className="availability" style={data.daysLeft <= 7 ? { color: 'var(--warn)' } : undefined}>
          <InfoIcon /> {availabilityText(data.expiresAt, data.expired)}
        </div>
        <InstallHint id={data.id} />
        <div className="credits">
          A CINEMATIC PRODUCTION BY <b>{data.studioName}</b> · FOR <b>{data.coupleName}</b>
          <br />
          PRIVATE SCREENING ROOM{date ? ` · ${date}` : ''}
          {data.instagram && (
            <>
              <br />
              <a href={`https://instagram.com/${data.instagram}`} target="_blank" rel="noopener" className="insta" data-testid="instagram">
                תייגו אותנו · @{data.instagram}
              </a>
            </>
          )}
          <br />
          <a href={`/accessibility?g=${data.id}`} className="a11y-link">
            הצהרת נגישות
          </a>
        </div>
      </div>
    </div>
  );
}
