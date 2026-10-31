import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { downloadPhotosZip, type ZipProgress } from '../photos/zip';
import { DownloadIcon, LogoMark } from '../watch/icons';
import type { PublicPhoto } from '../watch/types';

interface ChoiceData {
  coupleName: string;
  studioName: string;
  date: string;
  doneAt: string;
  items: (PublicPhoto & { set: string })[];
  base: string;
}

/**
 * /choice/<token> (Avira, 2026-10-31; 0099): the photos the couple chose for their album, for the album designer, without
 * logging in — the link the album group on WhatsApp gets when the couple presses "סיימנו לבחור". All of them in full
 * quality as one ZIP (made in this browser), or their file names to filter by in Lightroom.
 */
export function ChoicePage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<ChoiceData | null>(null);
  const [error, setError] = useState('');
  const [prog, setProg] = useState<ZipProgress | null>(null);
  const [done, setDone] = useState<ZipProgress | null>(null);
  const [note, setNote] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => {
    api<ChoiceData>('GET', `/api/choice/${token}`)
      .then((d) => {
        setData(d);
        document.title = `${d.coupleName} · הבחירה לאלבום`;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);
  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">{error}</div>
      </div>
    );
  if (!data) return <div className="screen screen-center muted">טוען…</div>;

  const download = async () => {
    setDone(null);
    setNote('');
    const c = new AbortController();
    ctrl.current = c;
    try {
      const r = await downloadPhotosZip({ items: data.items, base: data.base, quality: 'full', name: `${data.coupleName} - הבחירה לאלבום`, signal: c.signal, onProgress: setProg });
      if (!c.signal.aborted) setDone(r);
    } catch (e) {
      if ((e as Error).name !== 'AbortError' && !c.signal.aborted) setNote('ההורדה לא הצליחה. בדקו את החיבור ונסו שוב.');
    } finally {
      ctrl.current = null;
      setProg(null);
    }
  };
  const copyNames = async () => {
    const names = data.items.map((i) => i.name.replace(/\.[^.]+$/, ''));
    try {
      await navigator.clipboard.writeText(names.join(', '));
      setNote(`הועתקו ${names.length.toLocaleString('he-IL')} שמות קבצים`);
    } catch {
      setNote('ההעתקה לא הצליחה');
    }
  };

  return (
    <div className="admin" dir="rtl" data-testid="choice-page">
      <header className="top">
        <span className="brand">
          <LogoMark /> {data.studioName}
        </span>
      </header>
      <h1>
        {data.coupleName} · {data.items.length === 1 ? 'תמונה אחת' : `${data.items.length.toLocaleString('he-IL')} תמונות`} לאלבום
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {[data.date && `חתונה: ${formatDate(data.date)}`, data.doneAt && `הזוג סיים לבחור ב-${new Date(data.doneAt).toLocaleDateString('he-IL')}`].filter(Boolean).join(' · ')}
      </p>
      <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {prog ? (
          <button type="button" className="btn" onClick={() => ctrl.current?.abort()} data-testid="choice-stop">
            עצירה ({prog.done.toLocaleString('he-IL')} מתוך {prog.total.toLocaleString('he-IL')})
          </button>
        ) : (
          <button type="button" className="btn btn-white" onClick={download} disabled={data.items.length === 0} data-testid="choice-download">
            <DownloadIcon /> הורדת כל התמונות (איכות מלאה)
          </button>
        )}
        <button type="button" className="btn" onClick={copyNames} disabled={data.items.length === 0} data-testid="choice-names">
          העתקת שמות הקבצים (ללייטרום)
        </button>
      </div>
      {done && (
        <p className="muted" data-testid="choice-done">
          ירדו {(done.done - done.failed).toLocaleString('he-IL')} תמונות{done.failed ? ` · ${done.failed} לא ירדו, אפשר לנסות שוב` : ''}
        </p>
      )}
      {note && <p className="muted">{note}</p>}
      {data.items.length === 0 ? (
        <div className="card center">הזוג עוד לא בחר תמונות.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }} data-testid="choice-grid">
          {data.items.map((p) => (
            <figure key={p.key} style={{ margin: 0 }} data-testid="choice-photo">
              <img src={`${data.base}/${p.key}?s=m`} alt={p.name} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, background: '#222' }} />
              <figcaption className="muted" style={{ fontSize: '0.72rem', marginTop: 2, direction: 'ltr', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
