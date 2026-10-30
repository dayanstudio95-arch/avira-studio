import { useRef, useState } from 'react';
import { useDialog } from '../lib/dialog';
import { closingLabel } from '../lib/expiry';
import { PlayIcon } from './icons';
import type { WatchData } from './types';

export function Terms({ data, onEnter }: { data: WatchData; onEnter: () => void }) {
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const days = data.daysLeft;
  const what = data.kind === 'photos' ? 'התמונות' : 'הסרטים';
  return (
    <div className="screen screen-center">
      <div className="terms">
        {/* Avira fix: "חדר הקרנה" (a screening room) only for films. */}
        <span className="pill">{data.kind === 'photos' ? '✦ גלריה פרטית ✦' : '✦ חדר הקרנה פרטי ✦'}</span>
        <h1>ברוכים הבאים לגלריה הפרטית שלכם</h1>
        <p className="muted" style={{ margin: 0 }}>
          הגלריה מיועדת לצפייה ולשימוש אישי, בהתאם לתקנון השירות.
        </p>
        <div className="notice">
          <h2>⏳ {days <= 1 ? `הגישה לגלריה עד ${closingLabel(data.expiresAt)} בלבד` : `הגישה לגלריה ל־${days} ימים בלבד`}</h2>
          <p>
            כחלק ממדיניות האחסון של <b>{data.studioName}</b>, הגלריה זמינה למשך <b>{days} ימים בלבד ממועד קבלת הקישור</b>. אנו
            ממליצים בחום להוריד ולגבות את כל {what} בהקדם (במחשב האישי ובשירות ענן פרטי). בתום תקופת הזמינות הגישה לגלריה
            תסתיים ולא ניתן יהיה להוריד ממנה את {what}.
          </p>
        </div>
        <label className="agree">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="agree" />
          <span>
            קראתי ואני מאשר/ת את{' '}
            <button type="button" className="link" onClick={(e) => { e.preventDefault(); setShowTerms(true); }}>
              תקנון השירות
            </button>{' '}
            והבנתי שעליי לגבות את {what} באופן עצמאי.
          </span>
        </label>
        <button type="button" className="enter" disabled={!agreed} onClick={onEnter} data-testid="enter">
          <PlayIcon /> {data.kind === 'photos' ? 'כניסה לגלריה' : 'כניסה לצפייה בסרט'}
        </button>
      </div>
      {showTerms && <TermsText text={data.termsText} onClose={() => setShowTerms(false)} />}
    </div>
  );
}

function TermsText({ text, onClose }: { text: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useDialog(box, onClose);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={box} className="modal" role="dialog" aria-modal="true" aria-labelledby="terms-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="terms-title">תקנון השירות</h2>
        <div className="body">{text}</div>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn" onClick={onClose} data-autofocus>
            סגור
          </button>
        </div>
      </div>
    </div>
  );
}
