import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { WatchData } from '../watch/types';
import { LogoMark } from '../watch/icons';
import { findPerson } from '../../shared/faces';
import { searchPhotos, startSearch } from './download';
import { getFaceEngine, toCanvas } from './engine';
import { indexFaces, type FaceProgress } from './faceIndex';

function etaText(sec: number): string {
  if (sec < 60) return 'פחות מדקה';
  const m = Math.round(sec / 60);
  return m < 60 ? `עוד כ-${m} דק׳` : `עוד כ-${Math.floor(m / 60)} שע׳ ו-${m % 60} דק׳`;
}

/**
 * /<studio>/<gallery>/faces: the studio's browser searches the gallery's photos for faces and
 * uploads only the numbers. Opened from the hub with the studio's preview token (the films site
 * turns it into a studio cookie), so the photos and the face models load from this site.
 * Stopping keeps what was done; opening it again continues from there.
 */
export function StudioFaces() {
  const { id = '' } = useParams();
  const [data, setData] = useState<WatchData | null>(null);
  const [scan, setScan] = useState<{ keys: string[]; done: string[]; faces: number; base: string } | null>(null);
  const [prog, setProg] = useState<FaceProgress | null>(null);
  const [error, setError] = useState('');
  const [finished, setFinished] = useState(false);
  // Photos the last run could not scan (not recorded: running again tries them).
  const [failed, setFailed] = useState(0);
  const [person, setPerson] = useState('');
  const abort = useRef<AbortController | null>(null);

  const load = async () => {
    const r = await api<{ keys: string[]; done: string[]; faces: number; base: string }>('GET', `/api/watch/${id}/faces/scan`);
    setScan(r);
    return r;
  };

  const start = async (s = scan) => {
    if (!s || abort.current) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError('');
    setFailed(0);
    try {
      const p = await indexFaces({ galleryId: id, base: s.base, keys: s.keys, alreadyDone: new Set(s.done), onProgress: (x) => (setProg(x), setFailed(x.failed)), signal: ctrl.signal });
      setFailed(p.failed);
      if (!ctrl.signal.aborted && !p.failed) setFinished(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      abort.current = null;
      setProg(null);
      await load().catch(() => {});
    }
  };

  /**
   * "הסר אדם זה" (a guest asked the studio, D06(4)): a photo of the person → the faces that match leave the face
   * data (the photos stay, and their other faces).
   */
  const removePerson = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setPerson('מחפש את האדם בתמונות…');
    try {
      const engine = await getFaceEngine();
      const face = await engine.detectOne(await toCanvas(file, 900));
      if (!face) throw new Error('לא נמצאו פנים בתמונה. בחרו תמונה ברורה של האדם.');
      const selfie = face instanceof Float32Array ? face : face.descriptor;
      const s = await startSearch(id);
      if (!s.ready) throw new Error('אין עדיין נתוני פנים בגלריה.');
      const hits = findPerson(selfie, await searchPhotos(id, s));
      if (!hits.length) {
        setPerson('האדם לא נמצא בנתוני הפנים של הגלריה.');
        return;
      }
      if (!window.confirm(`האדם נמצא ב-${hits.length.toLocaleString('he-IL')} תמונות. למחוק את נתוני הפנים שלו מהגלריה? התמונות עצמן נשארות, ואורחים לא ימצאו אותו בחיפוש.`)) {
        setPerson('');
        return;
      }
      let left = hits.map((h) => ({ key: h.key, face: h.face }));
      for (let round = 0; left.length && round < 50; round++) left = (await api<{ remaining: typeof left }>('POST', `/api/watch/${id}/faces/remove`, { faces: left })).remaining;
      setPerson(`✓ נתוני הפנים של האדם נמחקו מ-${hits.length.toLocaleString('he-IL')} תמונות.`);
      await load().catch(() => {});
    } catch (e) {
      setPerson('');
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const pt = new URLSearchParams(window.location.search).get('pt');
        if (pt) window.history.replaceState(window.history.state, '', window.location.pathname);
        const d = await api<WatchData>('GET', `/api/watch/${id}${pt ? `?pt=${encodeURIComponent(pt)}` : ''}`);
        setData(d);
        document.title = `${d.coupleName} · סריקת פנים`;
        const s = await load();
        // Opened with the "scan" button: begin at once.
        if (s.keys.some((k) => !s.done.includes(k))) start(s);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!data || !scan)
    return (
      <div className="screen screen-center">
        <div className="card center">{error || 'טוען…'}</div>
      </div>
    );

  const done = new Set(scan.done);
  const left = scan.keys.filter((k) => !done.has(k)).length;
  return (
    <div className="admin" dir="rtl" data-testid="studio-faces">
      <header className="top">
        <span className="brand">
          <LogoMark /> {data.studioName}
        </span>
      </header>
      <h1>סריקת פנים · {data.coupleName}</h1>
      <div className="card stack">
        <p className="muted">
          המחשב שלכם עובר על התמונות ושומר לכל פנים רק מספרים (לא תמונה). התמונות לא נשלחות לשום חברה חיצונית. השאירו את הלשונית פתוחה עד הסוף; אם זה נעצר, פתיחה מחדש ממשיכה מאותו מקום.
        </p>
        {prog ? (
          <>
            <div className="scan" data-testid="face-progress">
              <div className="scan-bar" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
              <span>
                {prog.status ||
                  `מחפש פנים ${prog.done.toLocaleString('he-IL')}/${prog.total.toLocaleString('he-IL')} · ${prog.faces.toLocaleString('he-IL')} פנים חדשות${prog.eta ? ` · ${etaText(prog.eta)}` : ''}`}
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-sm" onClick={() => abort.current?.abort()} data-testid="face-stop">
                עצירה
              </button>
            </div>
          </>
        ) : left > 0 ? (
          <div className="row">
            <span className="warn" data-testid="face-left">
              נסרקו {(scan.keys.length - left).toLocaleString('he-IL')} מתוך {scan.keys.length.toLocaleString('he-IL')} תמונות.
              {failed > 0 && ` ${failed.toLocaleString('he-IL')} תמונות לא נסרקו, הריצו שוב.`}
            </span>
            <button type="button" className="btn btn-sm btn-gold" onClick={() => start()} data-testid="face-scan">
              {done.size ? 'המשך סריקה' : 'סריקת פנים'}
            </button>
          </div>
        ) : (
          <span className="ok" data-testid="face-ready">
            ✓ כל התמונות נסרקו · נמצאו {scan.faces.toLocaleString('he-IL')} פנים{finished ? '. אפשר לסגור את הלשונית.' : ''}
          </span>
        )}
        {error && <p className="warn">{error}</p>}
      </div>
      {done.size > 0 && !prog && (
        <div className="card stack" data-testid="face-person">
          <b>הסרת אדם מהחיפוש</b>
          <p className="muted">אורח ביקש שלא ימצאו אותו בחיפוש לפי פנים? בחרו תמונה ברורה שלו (למשל תמונה מהגלריה). הפנים שתואמות לו יימחקו מנתוני הפנים של הגלריה; התמונות עצמן נשארות.</p>
          <div className="row">
            <label className="btn btn-sm">
              הסר אדם זה
              <input type="file" accept="image/*" hidden onChange={(e) => removePerson(e.target.files?.[0])} data-testid="face-remove-person" />
            </label>
            {person && <span data-testid="face-person-status">{person}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
