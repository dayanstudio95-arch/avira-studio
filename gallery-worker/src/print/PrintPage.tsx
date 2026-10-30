import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Album } from '../../shared/album';
import { api } from '../lib/api';
import { LogoMark } from '../watch/icons';
import { PrintExport } from './PrintExport';

/** /print/<token>: the print shop downloads the album's spreads without logging in. */
export function PrintPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<{ coupleName: string; studioName: string; album: Album; base: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ coupleName: string; studioName: string; album: Album; base: string }>('GET', `/api/print/${token}`)
      .then((d) => {
        setData(d);
        document.title = `${d.coupleName} · הורדה לדפוס`;
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
  return (
    <div className="admin" dir="rtl">
      <header className="top">
        <span className="brand">
          <LogoMark /> {data.studioName}
        </span>
      </header>
      <h1>הורדת אלבום לדפוס</h1>
      <PrintExport
        album={data.album}
        coupleName={data.coupleName}
        source={{ full: (k) => `${data.base}/${k}?s=full`, fallback: (k) => `${data.base}/${k}?s=l` }}
        intro="הקבצים נבנים עכשיו במחשב שלכם מהתמונות המקוריות. זה לוקח כמה שניות לכל דף. השאירו את הדף פתוח עד הסוף."
      />
    </div>
  );
}
