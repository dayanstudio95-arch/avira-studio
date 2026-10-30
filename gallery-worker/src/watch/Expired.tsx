import { formatLongDate } from '../lib/format';
import { LogoMark } from './icons';
import type { WatchData } from './types';

export function Expired({ data }: { data: WatchData }) {
  return (
    <div className="screen screen-center">
      <div className="expired card" data-testid="expired">
        <div className="row" style={{ justifyContent: 'center', color: 'var(--gold)' }}>
          <LogoMark /> <span className="spaced">{data.studioName}</span>
        </div>
        <h1>הגלריה נסגרה</h1>
        <p className="muted">
          תקופת הזמינות של הגלריה של {data.coupleName} הסתיימה ב־{formatLongDate(data.expiresAt)}. {data.kind === 'photos' ? 'התמונות אינן זמינות' : 'הסרטים אינם זמינים'} יותר לצפייה או להורדה מהקישור הזה.
        </p>
        {data.contactLine && <p>{data.contactLine}</p>}
        {data.instagram && (
          <p>
            <a href={`https://instagram.com/${data.instagram}`} target="_blank" rel="noopener" className="insta">
              @{data.instagram}
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
