import { createContext, useCallback, useContext, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../lib/api';
import { useDialog } from '../lib/dialog';
import { LogoMark } from './icons';
import type { WatchData } from './types';

/** A gallery behind a password: the names, one field, and nothing else until it's right. */
export function Locked({ data, onUnlocked, light = false }: { data: WatchData; onUnlocked: () => void; light?: boolean }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('POST', `/api/watch/${data.id}/unlock`, { code });
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`locked${light ? ' light' : ''}`} data-testid="locked">
      <form className="locked-card" onSubmit={submit}>
        <div className="locked-brand">
          {data.logoUrl ? <img src={data.logoUrl} alt={data.studioName} /> : <LogoMark />}
          <span>{data.studioName}</span>
        </div>
        <h1>{data.coupleName}</h1>
        <p>הגלריה פרטית. הקלידו את הסיסמה שקיבלתם מהזוג או מהסטודיו.</p>
        <label className="sr-only" htmlFor="gallery-password">
          סיסמה
        </label>
        <input id="gallery-password" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoFocus placeholder="סיסמה" data-testid="gallery-password" />
        {error && (
          <p className="locked-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={!code.trim() || busy} data-testid="gallery-unlock">
          כניסה
        </button>
      </form>
    </div>
  );
}

/** Asks for the download code (once per device) before a full-quality download. */
type EnsurePin = () => Promise<boolean>;
const PinContext = createContext<EnsurePin>(async () => true);

export function usePin(): EnsurePin {
  return useContext(PinContext);
}

export function PinProvider({ data, onUnlocked, children }: { data: WatchData; onUnlocked: () => void; children: ReactNode }) {
  const [asking, setAsking] = useState(false);
  const waiting = useRef<((ok: boolean) => void) | null>(null);
  const [open, setOpen] = useState(!data.downloadLocked);
  const ensure = useCallback<EnsurePin>(() => {
    if (open) return Promise.resolve(true);
    setAsking(true);
    return new Promise<boolean>((resolve) => (waiting.current = resolve));
  }, [open]);
  const done = (ok: boolean) => {
    setAsking(false);
    if (ok) {
      setOpen(true);
      onUnlocked();
    }
    waiting.current?.(ok);
    waiting.current = null;
  };
  return (
    <PinContext.Provider value={ensure}>
      {children}
      {asking && <PinDialog id={data.id} onDone={done} />}
    </PinContext.Provider>
  );
}

function PinDialog({ id, onDone }: { id: string; onDone: (ok: boolean) => void }) {
  const box = useRef<HTMLFormElement>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  useDialog(box, () => onDone(false));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('POST', `/api/watch/${id}/pin`, { code });
      onDone(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <div className="modal-backdrop pin-backdrop" onClick={() => onDone(false)}>
      <form ref={box} className="modal who-dialog" role="dialog" aria-modal="true" aria-labelledby="pin-title" onClick={(e) => e.stopPropagation()} onSubmit={submit} data-testid="pin-dialog">
        <h2 id="pin-title" style={{ margin: 0 }}>
          קוד הורדה
        </h2>
        <p style={{ margin: 0, color: '#6c675e' }}>להורדה באיכות מלאה צריך את הקוד שקיבלתם מהסטודיו. מקלידים פעם אחת, והמכשיר זוכר.</p>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="הקוד" autoComplete="off" data-autofocus data-testid="pin-code" />
        {error && (
          <p className="zip-error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="submit" className="zip-btn" disabled={!code.trim()} data-testid="pin-save">
            אישור
          </button>
          <button type="button" className="zip-btn ghost" onClick={() => onDone(false)}>
            ביטול
          </button>
        </div>
      </form>
    </div>
  );
}
