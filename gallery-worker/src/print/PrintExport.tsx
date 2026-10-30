import { useEffect, useMemo, useRef, useState } from 'react';
import { albumPrice, albumSize, emptySlots, usedPhotos, type Album } from '../../shared/album';
import { parsePageRange, spreadFileName } from '../../shared/print';
import { canRenderFullSize, loadAlbumFonts, renderSpread, type PhotoSource } from './render';

type Row = { n: number; state: 'wait' | 'photos' | 'saving' | 'done' | 'error'; detail?: string; lowRes?: number };

interface DirHandle {
  getFileHandle: (name: string, o: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/** Renders every spread at print size and saves the files. Used by the studio and by the print shop link. */
export function PrintExport({ album, coupleName, source, intro }: { album: Album; coupleName: string; source: PhotoSource; intro?: string }) {
  const size = albumSize(album.size);
  const [range, setRange] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState('');
  const stop = useRef(false);
  const pages = useMemo(() => parsePageRange(range, album.spreads.length), [range, album.spreads.length]);
  const supported = useMemo(() => canRenderFullSize(size.spreadPx[0], size.spreadPx[1]), [size]);
  const canPickFolder = typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
  const price = albumPrice(album);
  const empty = emptySlots(album);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const setRow = (n: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.n === n ? { ...x, ...patch } : x)));

  const run = async (mode: 'folder' | 'files') => {
    setMessage('');
    let dir: DirHandle | null = null;
    if (mode === 'folder') {
      try {
        dir = await (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // the studio closed the folder picker
      }
    }
    stop.current = false;
    setRunning(true);
    setRows(pages.map((n) => ({ n, state: 'wait' })));
    await loadAlbumFonts(album);
    let ok = 0;
    for (const n of pages) {
      if (stop.current) break;
      const spread = album.spreads[n - 1];
      setRow(n, { state: 'photos', detail: 'מוריד תמונות מקוריות…' });
      try {
        const res = await renderSpread(spread, album, source, (d, t) => setRow(n, { detail: `תמונות ${d}/${t}` }));
        setRow(n, { state: 'saving', detail: 'שומר…' });
        const name = spreadFileName(coupleName, n);
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(res.blob);
          await w.close();
        } else {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(res.blob);
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
        }
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(res.blob);
        });
        setRow(n, { state: 'done', detail: `${name} · ${(res.blob.size / 1024 / 1024).toFixed(1)} MB`, lowRes: res.lowRes.length });
        ok++;
      } catch (e) {
        setRow(n, { state: 'error', detail: (e as Error).message });
      }
    }
    setRunning(false);
    setMessage(stop.current ? `נעצר אחרי ${ok} דפים.` : `הסתיים: ${ok} מתוך ${pages.length} דפים נשמרו${dir ? ' בתיקייה שבחרת' : ' בתיקיית ההורדות'}.`);
  };

  const lowResTotal = rows.reduce((n, r) => n + (r.lowRes ?? 0), 0);

  return (
    <div className="stack" data-testid="print-export">
      {intro && <p className="muted" style={{ margin: 0 }}>{intro}</p>}
      <div className="card stack">
        <div className="row" style={{ gap: '1.4rem' }}>
          <span>
            <b>{coupleName}</b>
          </span>
          <span>
            {size.label} <bdi dir="ltr">{size.dims}</bdi> ס״מ
          </span>
          <span data-testid="print-pages">{album.spreads.length} דפים</span>
          <span>{usedPhotos(album).size} תמונות</span>
          {price.extraSpreads > 0 && <span className="warn">{price.extraSpreads} דפים נוספים</span>}
          {album.status !== 'submitted' && <span className="warn">שימו לב: הזוג עוד לא לחץ "סיימתי"</span>}
          {empty > 0 && <span className="muted">{empty} משבצות ריקות</span>}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          כל דף נשמר כקובץ JPEG אחד של שני עמודים: <bdi dir="ltr">{size.spreadPx[0]}×{size.spreadPx[1]}</bdi> פיקסלים ב-{size.dpi} DPI, מהתמונות המקוריות באיכות מלאה. שמות הקבצים: "{spreadFileName(coupleName, 1)}", "{spreadFileName(coupleName, 2)}"…
        </p>
        {!supported && <div className="error">הדפדפן או המכשיר הזה לא יכול לבנות קובץ בגודל הזה. פתחו את הדף בכרום במחשב.</div>}
        <div className="row">
          <label className="row" style={{ gap: '0.5rem' }}>
            דפים:
            <input value={range} onChange={(e) => setRange(e.target.value)} placeholder="הכל (או למשל 1-5, 8)" dir="ltr" style={{ width: 170, background: 'rgba(255,255,255,0.05)', color: 'var(--text)', border: '1px solid var(--panel-border)', borderRadius: 8, padding: '0.45rem 0.6rem' }} data-testid="print-range" />
          </label>
          <span className="muted">{pages.length} דפים ייבנו</span>
        </div>
        <div className="row">
          {canPickFolder && (
            <button type="button" className="btn btn-white" disabled={running || !supported || pages.length === 0} onClick={() => run('folder')} data-testid="print-folder">
              שמירה לתיקייה במחשב
            </button>
          )}
          <button type="button" className={`btn${canPickFolder ? '' : ' btn-white'}`} disabled={running || !supported || pages.length === 0} onClick={() => run('files')} data-testid="print-files">
            הורדה קובץ אחר קובץ
          </button>
          {running && (
            <button type="button" className="btn btn-danger" onClick={() => (stop.current = true)}>
              עצירה
            </button>
          )}
        </div>
        {canPickFolder && <span className="hint">מומלץ "שמירה לתיקייה": בוחרים תיקייה פעם אחת והקבצים נכתבים אליה ישר. בהורדה קובץ אחר קובץ הדפדפן עשוי לשאול פעם אחת אם לאשר הורדת כמה קבצים.</span>}
        {message && <div className="ok" data-testid="print-message">{message}</div>}
        {lowResTotal > 0 && <div className="warn">ב-{lowResTotal} תמונות הדפדפן לא הצליח לקרוא את המקור (למשל קובץ HEIC), ונעשה שימוש בגרסה מוקטנת. כדאי להחליף אותן ל-JPG בתיקייה ולהוריד שוב את הדפים האלה.</div>}
      </div>

      {rows.length > 0 && (
        <div className="print-grid">
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="table" data-testid="print-rows">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n} data-testid="print-row" data-state={r.state}>
                    <td style={{ width: '4rem' }}>דף {r.n}</td>
                    <td>
                      {r.state === 'done' ? <span className="ok">✓</span> : r.state === 'error' ? <span className="error">✗</span> : r.state === 'wait' ? <span className="dim">ממתין</span> : <span className="warn">⋯</span>}
                    </td>
                    <td className={r.state === 'error' ? 'error' : 'muted'}>
                      {r.detail}
                      {r.lowRes ? <span className="warn"> · {r.lowRes} בגרסה מוקטנת</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview && (
            <div className="stack" style={{ gap: '0.3rem' }}>
              <span className="hint">הדף האחרון שנבנה:</span>
              <img src={preview} alt="" className="print-preview" data-testid="print-preview" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
