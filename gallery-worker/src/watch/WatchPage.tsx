import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { applyAccent } from '../lib/accent';
import { countEvent, countViewOnce } from '../lib/events';
import { Loading, Offline } from '../lib/Loading';
import { PhotoGallery } from '../photos/PhotoGallery';
import { Cinema } from './Cinema';
import { Expired } from './Expired';
import { Hero } from './Hero';
import { Locked, PinProvider } from './Locked';
import { Terms } from './Terms';
import type { WatchData } from './types';

type Screen = 'terms' | 'hero' | 'cinema';

function accepted(id: string): boolean {
  try {
    return Boolean(localStorage.getItem(`terms:${id}`) || sessionStorage.getItem(`terms:${id}`));
  } catch {
    return false;
  }
}

export function WatchPage() {
  const { id = '', studio = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<WatchData | null>(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Accepting the terms is remembered on this device (and recorded for the studio).
  const [screen, setScreen] = useState<Screen>(() => (accepted(id) ? 'hero' : 'terms'));

  useEffect(() => {
    setOffline(false);
    // "Open as the couple" from the studio's screens: a one-time preview token in the address.
    // The site turns it into a cookie for this browser, and the address loses it.
    const pt = new URLSearchParams(window.location.search).get('pt');
    if (pt) {
      const clean = new URL(window.location.href);
      clean.searchParams.delete('pt');
      window.history.replaceState(window.history.state, '', `${clean.pathname}${clean.search}${clean.hash}`);
    }
    api<WatchData>('GET', `/api/watch/${id}${pt ? `?pt=${encodeURIComponent(pt)}` : ''}`)
      .then((d) => {
        // Old or mistyped studio part of the link: show the studio's current address.
        if (studio && d.slug && studio !== d.slug) navigate(`/${d.slug}/${id}`, { replace: true });
        applyAccent(d.accentColor);
        setData(d);
        document.title = `${d.coupleName} · ${d.studioName}`;
      })
      .catch((e: Error) => {
        // "Not found" only when the server says so; a dropped connection or a hiccup can be retried.
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) setError(e.message);
        else setOffline(true);
      });
  }, [id, studio, navigate, attempt]);

  const enter = () => {
    try {
      localStorage.setItem(`terms:${id}`, '1');
    } catch {
      /* private mode */
    }
    api('POST', `/api/watch/${id}/terms`).catch(() => {});
    setScreen('hero');
  };
  const watch = () => {
    setScreen('cinema');
    countEvent(id, 'view');
  };
  const download = () => countEvent(id, 'download');
  // The studio's design screen shows the gallery in a frame: straight to the photos, and not a view.
  const preview = /[?&]preview=1/.test(window.location.search) && window.self !== window.top;
  // A photo gallery counts one view per visit, once its photos show (the couple's or the guests' link;
  // the server leaves out the studio and anyone without the password).
  const photosShown = Boolean(data && !data.expired && !data.locked && data.kind === 'photos' && data.photos?.items.length && (screen !== 'terms' || preview));
  useEffect(() => {
    if (photosShown && !preview) countViewOnce(id);
  }, [photosShown, preview, id]);

  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>הקישור לא נמצא</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  if (offline) return <Offline onRetry={() => setAttempt((n) => n + 1)} />;
  if (!data) return <Loading />;
  if (data.expired) return <Expired data={data} />;
  const reload = () => setAttempt((n) => n + 1);
  if (data.locked) return <Locked data={data} onUnlocked={reload} light={data.kind === 'photos'} />;
  if (screen === 'terms' && !preview) return <Terms data={data} onEnter={enter} />;
  if (data.kind === 'photos') {
    if (!data.photos || data.photos.items.length === 0) {
      return (
        <div className="screen screen-center">
          <div className="card center muted">התמונות יעלו לכאן בקרוב.</div>
        </div>
      );
    }
    return (
      <PinProvider data={data} onUnlocked={reload}>
        <PhotoGallery data={data} preview={preview} />
      </PinProvider>
    );
  }
  if (screen === 'hero') return <Hero data={data} onWatch={watch} />;
  return (
    <PinProvider data={data} onUnlocked={reload}>
      <Cinema data={data} onClose={() => setScreen('hero')} onDownload={download} />
    </PinProvider>
  );
}
