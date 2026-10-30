import { useRef, useState } from 'react';
import { useDialog } from '../lib/dialog';
import { countPhotoDownload } from '../lib/events';
import { usePin } from '../watch/Locked';
import { CloseIcon, DownloadIcon } from '../watch/icons';
import type { PublicPhoto } from '../watch/types';
import { canStreamToDisk, downloadPhotosZip, type ZipProgress } from './zip';

export interface ZipGroup {
  id: string;
  label: string;
  items: PublicPhoto[];
}

const mb = (n: number) => (n / 1024 / 1024 >= 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)}GB` : `${Math.round(n / 1024 / 1024)}MB`);

/**
 * "Download several photos": which ones (the whole gallery, a set, the favourites…), which
 * quality, then one ZIP (or parts of one) made in the browser, with progress and a stop button.
 */
export function ZipDialog({ base, groups, name, cloud, onClose, query }: { base: string; groups: ZipGroup[]; name: string; cloud?: { url: string; label: string }; onClose: () => void; query?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const usable = groups.filter((g) => g.items.length > 0);
  const [group, setGroup] = useState(usable[0]?.id ?? '');
  const [quality, setQuality] = useState<'full' | 'small'>('full');
  const [prog, setProg] = useState<ZipProgress | null>(null);
  const [done, setDone] = useState<ZipProgress | null>(null);
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  const stop = () => {
    ctrl.current?.abort();
    ctrl.current = null;
    setProg(null);
  };
  useDialog(box, () => {
    stop();
    onClose();
  });
  const chosen = usable.find((g) => g.id === group);
  const ensurePin = usePin();

  const start = async () => {
    if (!chosen) return;
    // Full quality may need the studio's download code (asked once per device).
    if (quality === 'full' && !(await ensurePin())) return;
    setError('');
    setDone(null);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const r = await downloadPhotosZip({ items: chosen.items, base, quality, name: `${name} - ${chosen.label}`, signal: c.signal, onProgress: setProg, query });
      if (!c.signal.aborted) {
        setDone(r);
        if (r.done > r.failed) countPhotoDownload(base);
      }
    } catch (e) {
      // Closing the "save as" window is not an error.
      if ((e as Error).name !== 'AbortError' && !c.signal.aborted) setError('ההורדה לא הצליחה. בדקו את החיבור ונסו שוב.');
    } finally {
      ctrl.current = null;
      setProg(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={() => !prog && onClose()}>
      <div ref={box} className="modal zip-dialog" role="dialog" aria-modal="true" aria-labelledby="zip-title" onClick={(e) => e.stopPropagation()} data-testid="zip-dialog">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 id="zip-title" style={{ margin: 0 }}>
            הורדת תמונות
          </h2>
          <button type="button" className="pg-icon" onClick={() => (stop(), onClose())} aria-label="סגירה">
            <CloseIcon />
          </button>
        </div>
        {prog ? (
          <div className="zip-progress" role="status" data-testid="zip-progress">
            <progress max={prog.total} value={prog.done} />
            <span>
              {prog.done.toLocaleString('he-IL')} מתוך {prog.total.toLocaleString('he-IL')} תמונות · {mb(prog.bytes)}
              {!canStreamToDisk() && prog.part > 1 ? ` · חלק ${prog.part}` : ''}
            </span>
            <span className="zip-hint">אפשר להמשיך לגלול בגלריה. אל תסגרו את הדף עד שההורדה מסתיימת.</span>
            <button type="button" className="zip-btn ghost" onClick={stop}>
              עצירה
            </button>
          </div>
        ) : (
          <>
            <fieldset className="zip-choices">
              <legend>מה להוריד</legend>
              {usable.map((g) => (
                <label key={g.id}>
                  <input type="radio" name="zip-group" checked={group === g.id} onChange={() => setGroup(g.id)} />
                  <span>
                    {g.label} <span className="zip-n">({g.items.length.toLocaleString('he-IL')})</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset className="zip-choices">
              <legend>איכות</legend>
              <label>
                <input type="radio" name="zip-q" checked={quality === 'full'} onChange={() => setQuality('full')} data-testid="zip-full" />
                <span>
                  איכות מלאה <span className="zip-n">· הקבצים המקוריים, להדפסה ולשמירה</span>
                </span>
              </label>
              <label>
                <input type="radio" name="zip-q" checked={quality === 'small'} onChange={() => setQuality('small')} data-testid="zip-small" />
                <span>
                  איכות רגילה <span className="zip-n">· קבצים קטנים ומהירים, לטלפון ולרשתות</span>
                </span>
              </label>
            </fieldset>
            {!canStreamToDisk() && chosen && chosen.items.length > 150 && quality === 'full' && <p className="zip-hint">ההורדה תגיע בכמה קבצים (עד 500MB כל אחד). כדאי להוריד מהמחשב, בכרום.</p>}
            {done && (
              <p className="zip-done" role="status" data-testid="zip-done">
                ✓ ירדו {(done.done - done.failed).toLocaleString('he-IL')} תמונות{done.failed ? ` (${done.failed} לא הצליחו, אפשר לנסות שוב)` : ''}.
              </p>
            )}
            {error && <p className="zip-error">{error}</p>}
            <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
              <button type="button" className="zip-btn" onClick={start} disabled={!chosen} data-testid="zip-start">
                <DownloadIcon /> הורדה כקובץ ZIP
              </button>
              {cloud && (
                <a className="zip-btn ghost" href={cloud.url} target="_blank" rel="noopener" data-testid="zip-cloud">
                  {cloud.label}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
