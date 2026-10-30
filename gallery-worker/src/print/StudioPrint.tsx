import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Album } from '../../shared/album';
import { photoBase } from '../../shared/photoUrl';
import { api } from '../lib/api';
import type { WatchData } from '../watch/types';
import { LogoMark } from '../watch/icons';
import { PrintExport } from './PrintExport';

/**
 * /<studio>/<gallery>/print: the studio downloads the album's spreads at print size. Opened from
 * the hub with the studio's preview token (the films site turns it into a studio cookie), so the
 * originals come through even behind a download code, for hidden photos, and after the gallery
 * closed. Ported from the Avira films app's admin AlbumPrint (the print-shop link lives in the hub).
 */
export function StudioPrint() {
  const { id = '' } = useParams();
  const [data, setData] = useState<WatchData | null>(null);
  const [album, setAlbum] = useState<Album | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const pt = new URLSearchParams(window.location.search).get('pt');
        if (pt) window.history.replaceState(window.history.state, '', window.location.pathname);
        const d = await api<WatchData>('GET', `/api/watch/${id}${pt ? `?pt=${encodeURIComponent(pt)}` : ''}`);
        if (d.locked) throw new Error('הדף הזה נפתח מתוך המערכת של הסטודיו (הורדה לדפוס).');
        setData(d);
        document.title = `${d.coupleName} · הורדה לדפוס`;
        // Studio only: the server refuses a couple's or a guest's browser (U1).
        const r = await api<{ album: Album | null }>('GET', `/api/watch/${id}/print`);
        setAlbum(r.album);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">{error}</div>
      </div>
    );
  if (!data || album === undefined) return <div className="screen screen-center muted">טוען…</div>;
  // The photos' addresses as the gallery gives them (with its generation, P66).
  const base = data.photos?.base ?? photoBase(id, undefined);
  return (
    <div className="admin" dir="rtl">
      <header className="top">
        <span className="brand">
          <LogoMark /> {data.studioName}
        </span>
      </header>
      <h1>הורדה לדפוס · {data.coupleName}</h1>
      {!album ? (
        <div className="card center muted">לזוג עוד אין אלבום.</div>
      ) : (
        <PrintExport album={album} coupleName={data.coupleName} source={{ full: (k) => `${base}/${k}?s=full`, fallback: (k) => `${base}/${k}?s=l` }} />
      )}
    </div>
  );
}
