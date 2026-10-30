import { useEffect, useMemo, useRef, useState } from 'react';
import { Loading } from '../lib/Loading';
import { useLocation, useParams } from 'react-router-dom';
import { expandSearch, FACE_CONSENT, findPerson, keysFromHash, keysToHash, type Hit, type StoredPhoto } from '../../shared/faces';
import { api } from '../lib/api';
import { useBackCloses } from '../lib/dialog';
import { formatDate } from '../lib/format';
import { Grid, Lightbox } from '../photos/PhotoGallery';
import { ZipDialog } from '../photos/ZipDialog';
import { Locked, PinProvider } from '../watch/Locked';
import type { PublicPhoto, WatchData } from '../watch/types';
import { searchPhotos, startSearch } from './download';
import { getFaceEngine, toCanvas } from './engine';
import { measureFace, selfieProblem } from './quality';

type Stage = 'intro' | 'working' | 'results';

/**
 * /<studio>/<gallery>/me — a guest takes a selfie and the phone looks for them in the photos.
 * The selfie is read on the phone and never uploaded; only the gallery's face numbers come down (only of photos
 * still shown, after the consent, with a short token — fix plan P68). Camera only: no "choose a photo" (D06(3)).
 */
export function GuestPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const [data, setData] = useState<WatchData | null>(null);
  const [error, setError] = useState('');
  const [stage, setStage] = useState<Stage>('intro');
  const [agree, setAgree] = useState(false);
  const [status, setStatus] = useState('');
  const [found, setFound] = useState<string[]>(() => keysFromHash(location.hash));
  const [open, setOpen] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [zipping, setZipping] = useState(false);
  // "Maybe you too": found with the help of the sure matches. "Not me" removes a photo from both.
  const [maybe, setMaybe] = useState<string[]>([]);
  const [notMe, setNotMe] = useState<Set<string>>(new Set());
  // A selfie that looked weak: kept, so "search anyway" doesn't ask for it again.
  const [weak, setWeak] = useState<File | null>(null);
  const last = useRef<{ selfie: ArrayLike<number>; photos: StoredPhoto[]; hits: Hit[] } | null>(null);
  // The phone's Back button closes a photo instead of leaving the page.
  const closePhoto = useBackCloses(open !== null, () => setOpen(null));
  const [attempt, setAttempt] = useState(0);
  const [locked, setLocked] = useState<WatchData | null>(null);
  // Whether the studio has scanned the gallery (P68): no face data yet → no search, a message instead.
  const [readiness, setReadiness] = useState<{ ready: boolean; partial: boolean } | null>(null);

  useEffect(() => {
    api<WatchData>('GET', `/api/watch/${id}`)
      .then((d) => {
        if (d.expired) throw new Error('הגלריה נסגרה');
        if (d.locked) {
          setLocked(d);
          return;
        }
        setLocked(null);
        if (d.kind !== 'photos' || !d.photos?.faceSearch) throw new Error('החיפוש לפי פנים לא פעיל בגלריה הזו');
        setData(d);
        if (keysFromHash(location.hash).length) setStage('results');
        return api<{ ready: boolean; partial: boolean }>('GET', `/api/watch/${id}/faces`).then(setReadiness);
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, attempt]);

  const items = useMemo(() => {
    if (!data?.photos) return [] as PublicPhoto[];
    const mine = new Set(found);
    // In the gallery's order (the day's story), not by how sure the match is.
    return data.photos.items.filter((p) => mine.has(p.key) && !notMe.has(p.key));
  }, [data, found, notMe]);
  const maybeItems = useMemo(() => {
    if (!data?.photos) return [] as PublicPhoto[];
    const m = new Set(maybe);
    return data.photos.items.filter((p) => m.has(p.key) && !notMe.has(p.key));
  }, [data, maybe, notMe]);
  // Both lists together, for the lightbox, the ZIP and the personal link.
  const allMine = useMemo(() => [...items, ...maybeItems], [items, maybeItems]);
  useEffect(() => {
    if (stage === 'results' && allMine.length) window.history.replaceState(window.history.state, '', `${location.pathname}#${keysToHash(allMine.map((p) => p.key))}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMine, stage]);

  const hide = (key: string) => {
    const next = new Set(notMe);
    next.add(key);
    setNotMe(next);
    // Its face no longer helps: look again for "maybe" photos without it.
    const l = last.current;
    if (l && data?.photos) {
      const visible = new Set(data.photos.items.map((p) => p.key));
      setMaybe(expandSearch(l.selfie, l.photos, l.hits, next).map((h) => h.key).filter((k) => visible.has(k)));
    }
  };

  const search = async (file: File | undefined, anyway = false) => {
    if (!file || !data?.photos) return;
    setStage('working');
    setNotice('');
    setWeak(null);
    try {
      const engine = await getFaceEngine(setStatus);
      setStatus('מחפשים את הפנים בסלפי…');
      const canvas = await toCanvas(file, 900);
      const face = await engine.detectOne(canvas);
      if (!face) {
        setStage('intro');
        setNotice('לא מצאנו פנים בתמונה. נסו סלפי מקרוב, עם אור טוב, בלי משקפי שמש.');
        return;
      }
      const selfie = face instanceof Float32Array ? face : face.descriptor;
      // A weak selfie finds little: say what to fix before searching (or search anyway).
      if (!anyway && !(face instanceof Float32Array)) {
        const problem = selfieProblem(measureFace(canvas, face.box, face.score));
        if (problem) {
          setStage('intro');
          setNotice(problem);
          setWeak(file);
          return;
        }
      }
      setStatus(`משווים לכל ${data.photos.items.length.toLocaleString('he-IL')} התמונות…`);
      const started = await startSearch(id, FACE_CONSENT);
      setReadiness({ ready: started.ready, partial: started.partial });
      if (!started.ready) {
        setStage('intro');
        return;
      }
      const photos = await searchPhotos(id, started);
      const visible = new Set(data.photos.items.map((p) => p.key));
      const hits = findPerson(selfie, photos).filter((h) => visible.has(h.key));
      const keys = hits.map((h) => h.key);
      last.current = { selfie, photos, hits };
      setNotMe(new Set());
      setFound(keys);
      setMaybe(expandSearch(selfie, photos, hits).map((h) => h.key).filter((k) => visible.has(k)));
      setStage('results');
      if (keys.length === 0) setNotice('לא מצאנו אתכם בתמונות. נסו סלפי אחר: מקרוב, עם אור טוב, בלי משקפי שמש.');
    } catch (e) {
      setStage('intro');
      setNotice((e as Error).message);
    }
  };

  if (error)
    return (
      <div className="pg fm">
        <div className="fm-card">
          <p>{error}</p>
        </div>
      </div>
    );
  if (locked) return <Locked data={locked} onUnlocked={() => setAttempt((n) => n + 1)} light />;
  if (!data?.photos) return <Loading light />;

  const cover = data.photos.cover ? `${data.photos.base}/${data.photos.cover}?s=l` : '';
  const date = formatDate(data.date);
  // The link to send on is always the guests' one (never the couple's own link, which can heart,
  // choose and design the album); opened from the couple's link without a guests' link: none.
  const sharePath = data.role === 'guest' ? location.pathname : data.guestPath ? `${data.guestPath}/me` : '';
  const personalLink = sharePath ? `${window.location.origin}${sharePath}#${keysToHash(allMine.map((p) => p.key))}` : '';

  return (
    <PinProvider data={data} onUnlocked={() => setAttempt((n) => n + 1)}>
    <div className="pg fm" data-testid="guest-page">
      <header className="fm-head" style={{ backgroundImage: cover ? `url(${cover})` : undefined, backgroundPosition: data.photos.coverPos ? `${data.photos.coverPos.x}% ${data.photos.coverPos.y}%` : undefined }}>
        <div className="pg-cover-shade" />
        <div className="fm-head-text">
          <span>{data.studioName}</span>
          <h1>{data.coupleName}</h1>
          {date && <span>{date}</span>}
        </div>
      </header>

      {stage === 'intro' && (
        <section className="fm-card" data-testid="guest-intro">
          <h2>מצאו את עצמכם בתמונות</h2>
          <p>מצלמים סלפי, והטלפון מחפש אתכם בתמונות מהאירוע.</p>
          {readiness && !readiness.ready ? (
            <p className="fm-notice" data-testid="guest-not-ready">
              הסטודיו עוד מכין את החיפוש בגלריה הזו. נסו שוב מאוחר יותר.
            </p>
          ) : (
            <>
              {readiness?.partial && (
                <p className="fm-hint" data-testid="guest-partial">
                  הסטודיו עוד סורק חלק מהתמונות, כך שהחיפוש עדיין לא כולל את כולן.
                </p>
              )}
              <label className="fm-consent">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="guest-consent" />
                <span>
                  אני מסכים/ה שהטלפון שלי ישווה את הפנים שבסלפי שלי לפנים בתמונות מהאירוע, ואני מחפש/ת רק את עצמי. הסלפי נבדק רק על המכשיר שלי, לא נשמר ולא נשלח לשום מקום; נשמר רק שבוצע חיפוש. נתוני הפנים של הגלריה נמחקים כשהגלריה נסגרת. מי שלא רוצה שימצאו אותו בחיפוש יכול לבקש מהסטודיו להסיר אותו.
                </span>
              </label>
              <div className="fm-actions">
                <label className={`fm-btn${agree ? '' : ' off'}`}>
                  צילום סלפי
                  <input type="file" accept="image/*" capture="user" hidden disabled={!agree} onChange={(e) => search(e.target.files?.[0])} data-testid="guest-selfie" />
                </label>
              </div>
            </>
          )}
          {notice && <p className="fm-notice" data-testid="guest-notice">{notice}</p>}
          {weak && (
            <button type="button" className="fm-btn ghost" onClick={() => search(weak, true)} data-testid="guest-anyway">
              לחפש בכל זאת
            </button>
          )}
        </section>
      )}

      {stage === 'working' && (
        <section className="fm-card" data-testid="guest-working">
          <div className="fm-spinner" />
          <p>{status || 'רגע…'}</p>
        </section>
      )}

      {stage === 'results' && (
        <section className="fm-results">
          <div className="fm-card">
            <h2 data-testid="guest-count">{items.length ? `מצאנו אתכם ב-${items.length.toLocaleString('he-IL')} תמונות` : 'לא מצאנו אתכם בתמונות'}</h2>
            {notice && <p className="fm-notice">{notice}</p>}
            <div className="fm-actions">
              {items.length > 0 && personalLink && (
                <a className="fm-btn" href={`https://wa.me/?text=${encodeURIComponent(`התמונות שלי מהחתונה של ${data.coupleName}: ${personalLink}`)}`} target="_blank" rel="noopener" data-testid="guest-whatsapp">
                  שלחו לעצמכם בוואטסאפ
                </a>
              )}
              {items.length > 0 && (
                <button type="button" className="fm-btn ghost" onClick={() => setZipping(true)} data-testid="guest-zip">
                  הורדת כל התמונות שלי
                </button>
              )}
              <button
                type="button"
                className="fm-btn ghost"
                onClick={() => {
                  setFound([]);
                  setMaybe([]);
                  setNotMe(new Set());
                  window.history.replaceState(null, '', location.pathname);
                  setStage('intro');
                }}
              >
                סלפי אחר
              </button>
            </div>
            {items.length > 0 && <p className="fm-hint">לחצו על תמונה כדי לראות אותה בגדול ולהוריד. תמונה שאתם לא בה? "לא אני" מוציא אותה. הקישור בוואטסאפ פותח את התמונות שלכם בלי סלפי נוסף.</p>}
          </div>
          {items.length > 0 && <Grid items={items} base={data.photos.base} favs={new Set()} insta={new Set()} onOpen={setOpen} onHide={hide} />}
          {maybeItems.length > 0 && (
            <>
              <h3 className="fm-maybe" data-testid="guest-maybe">
                אולי גם אתם ({maybeItems.length.toLocaleString('he-IL')})
              </h3>
              <p className="fm-hint fm-maybe-hint">תמונות שבהן הפנים פחות ברורות (מהצד או מרחוק). מה שלא שלכם, מוציאים ב"לא אני".</p>
              <Grid items={maybeItems} base={data.photos.base} favs={new Set()} insta={new Set()} onOpen={(i) => setOpen(items.length + i)} onHide={hide} />
            </>
          )}
        </section>
      )}

      {zipping && <ZipDialog base={data.photos.base} name={`${data.coupleName} - התמונות שלי`} groups={[{ id: 'mine', label: 'התמונות שלי', items: allMine }]} onClose={() => setZipping(false)} />}
      {open !== null && <Lightbox items={allMine} index={open} base={data.photos.base} favs={new Set()} insta={new Set()} onClose={closePhoto} onMove={setOpen} />}
    </div>
    </PinProvider>
  );
}
