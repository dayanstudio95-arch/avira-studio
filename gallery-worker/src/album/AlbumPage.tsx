import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { autoAlbum, FONTS_URL, type Album } from '../../shared/album';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';
import type { WatchData } from '../watch/types';
import { AlbumEditor } from './AlbumEditor';

/** The studio's album numbers (fix plan P53): its extra-page price and included pages, null when not set. */
type Ordering = { extraSpreadPrice: number | null; includedSpreads: number | null; status: string };

const ORDER_PENDING = 'ההזמנה עוד לא נפתחה. נסו שוב בעוד כמה דקות, או פנו לסטודיו.';

/**
 * The address of the album's order in the studio's portal. P57: when there is none yet (sending the album made it
 * only half way), the album is sent again — that makes the order; an album not sent yet stays as it is.
 */
async function orderUrl(id: string): Promise<string> {
  try {
    return (await api<{ url: string }>('GET', `/api/watch/${id}/album/order`)).url;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }
  const r = await api<{ orderPending?: boolean }>('POST', `/api/watch/${id}/album/submit`, {});
  if (r.orderPending) throw new Error(ORDER_PENDING);
  return (await api<{ url: string }>('GET', `/api/watch/${id}/album/order`)).url;
}

/** /<studio>/<gallery>/album: loads the gallery and the couple's draft (creating the first draft from their hearts). */
export function AlbumPage() {
  const { id = '', studio } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<WatchData | null>(null);
  const [album, setAlbum] = useState<Album | null>(null);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  // A studio with album orders: sending leads on to the order (product, cover, engraving, payment) in the studio's
  // album portal, and pages above the included ones cost the studio's own price (none set: no pages above them).
  // Otherwise "send" goes to the studio.
  const [ordering, setOrdering] = useState<Ordering | null>(null);
  // A closed gallery (P57): its album page leads on to the order when there is one ('' = none).
  const [closedOrder, setClosedOrder] = useState<string | null>(null);

  useEffect(() => {
    // The album fonts load only here, so the rest of the site stays light.
    if (!document.querySelector('link[data-album-fonts]')) {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = FONTS_URL;
      l.dataset.albumFonts = '1';
      document.head.appendChild(l);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // The studio, from the hub: its preview token becomes a cookie for this browser, and the address loses it.
        const pt = new URLSearchParams(window.location.search).get('pt');
        if (pt) window.history.replaceState(window.history.state, '', window.location.pathname);
        const d = await api<WatchData>('GET', `/api/watch/${id}${pt ? `?pt=${encodeURIComponent(pt)}` : ''}`);
        if (d.locked) throw new Error('הגלריה מוגנת בסיסמה. פתחו אותה קודם מהקישור שקיבלתם.');
        if (d.role === 'guest') throw new Error('עיצוב האלבום זמין רק בקישור של הזוג');
        if (d.expired) {
          // The order (product, cover, payment) lives on after the gallery closes.
          setClosedOrder(await orderUrl(id).catch(() => ''));
          return;
        }
        if (d.kind !== 'photos' || !d.photos) throw new Error('לגלריה הזו אין אלבום');
        setData(d);
        setFavs(new Set(d.favorites ?? []));
        const r = await api<{ album: Album | null; ordering?: Ordering | null }>('GET', `/api/watch/${id}/album`);
        setOrdering(r.ordering ?? null);
        if (r.album) setAlbum(r.album);
        else {
          // First visit: a draft from the hearts, in the order they appear in the gallery.
          const hearts = d.photos.items.filter((p) => (d.favorites ?? []).includes(p.key));
          const draft = autoAlbum(hearts, d.coupleName, formatDate(d.date));
          try {
            const saved = await api<{ album: Album }>('PUT', `/api/watch/${id}/album`, { album: draft, rev: 0 });
            setAlbum(saved.album);
          } catch (e) {
            // The partner opened it first: their draft is the album.
            const current = e instanceof ApiError && e.status === 409 ? (e.data?.album as Album | null | undefined) : undefined;
            if (!current) throw e;
            setAlbum(current);
          }
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  const favorite = async (key: string) => {
    const r = await api<{ favorites: string[] }>('POST', `/api/watch/${id}/fav`, { key, on: true });
    setFavs(new Set(r.favorites));
  };

  const goToOrder = async () => {
    window.location.assign(await orderUrl(id));
  };

  if (closedOrder !== null)
    return (
      <div className="screen screen-center">
        <div className="card center" data-testid="album-closed">
          <p>הגלריה נסגרה</p>
          {closedOrder && (
            <a className="btn btn-white" href={closedOrder} data-testid="closed-go-order">
              להמשך ההזמנה
            </a>
          )}
        </div>
      </div>
    );

  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">{error}</div>
      </div>
    );
  if (!data || !album) return <div className="screen screen-center muted">מכינים את האלבום…</div>;

  return (
    <AlbumEditor
      galleryId={id}
      coupleName={data.coupleName}
      dateText={formatDate(data.date)}
      base={data.photos!.base}
      photos={data.photos!.items}
      sets={data.photos!.sets}
      favorites={favs}
      onFavorite={favorite}
      initial={album}
      onBack={() => navigate(studio ? `/${studio}/${id}` : `/watch/${id}`)}
      ordering={ordering}
      onOrder={goToOrder}
    />
  );
}
