import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useParams } from 'react-router-dom';
import type { FilmTag } from '../../shared/dropbox';
import { withAmpersand } from '../../shared/names';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { CameraGlyph, ChatIcon, CloseIcon, FacebookGlyph, LogoMark, PhoneIcon, PlayIcon, StarIcon, VimeoGlyph, YoutubeGlyph } from '../watch/icons';
import { pickHeroClip, pickVersion, verySlowNetwork } from '../watch/quality';
import type { WatchFilm } from '../watch/types';
import type { StudioData, StudioReview } from './types';
import { applyAccent } from '../lib/accent';

const ROWS: { title: string; tags: FilmTag[]; vertical?: boolean }[] = [
  { title: 'הייליטס', tags: ['highlights', 'teaser'] },
  { title: 'סרטים מלאים', tags: ['feature', 'ceremony'] },
  { title: 'רילס', tags: ['reels'], vertical: true },
  { title: 'עוד', tags: ['other'] },
];

function Socials({ d }: { d: StudioData }) {
  const items = [
    d.phone && { href: `tel:${d.phone.replace(/[^\d+]/g, '')}`, label: 'טלפון', icon: <PhoneIcon /> },
    d.whatsapp && { href: `https://wa.me/${d.whatsapp}`, label: 'וואטסאפ', icon: <ChatIcon /> },
    d.instagram && { href: `https://instagram.com/${d.instagram}`, label: 'אינסטגרם', icon: <CameraGlyph /> },
    d.facebook && { href: d.facebook, label: 'פייסבוק', icon: <FacebookGlyph /> },
    d.vimeo && { href: d.vimeo, label: 'Vimeo', icon: <VimeoGlyph /> },
    d.youtube && { href: d.youtube, label: 'יוטיוב', icon: <YoutubeGlyph /> },
  ].filter(Boolean) as { href: string; label: string; icon: ReactNode }[];
  if (items.length === 0) return null;
  return (
    <div className="socials" data-testid="socials">
      {items.map((it) => (
        <a key={it.label} href={it.href} target={it.href.startsWith('tel:') ? undefined : '_blank'} rel="noopener" aria-label={it.label} title={it.label}>
          {it.icon}
        </a>
      ))}
    </div>
  );
}

/** A still frame for the card, taken from the video itself (no thumbnails are stored). */
function Card({ film, vertical, onPlay }: { film: WatchFilm; vertical?: boolean; onPlay: () => void }) {
  const v = film.versions[film.versions.length - 1] ?? film.versions[0];
  return (
    <button type="button" className={`s-card${vertical ? ' vertical' : ''}`} onClick={onPlay} data-testid="studio-card">
      {v?.watchUrl && <video src={`${v.watchUrl}#t=3`} preload="metadata" muted playsInline tabIndex={-1} />}
      <span className="s-card-shade" />
      <span className="s-card-play">
        <PlayIcon />
      </span>
      <span className="s-card-title">{film.title}</span>
    </button>
  );
}

function Player({ film, onClose }: { film: WatchFilm; onClose: () => void }) {
  const idx = pickVersion(film, 'studio');
  const v = film.versions[idx] ?? film.versions[0];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  return (
    <div className="s-player" onClick={onClose} data-testid="studio-player">
      <div className="s-player-inner" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>{film.title}</h3>
          <button type="button" className="btn btn-gold btn-sm" onClick={onClose}>
            <CloseIcon /> סגור
          </button>
        </div>
        <video src={v.watchUrl} controls autoPlay playsInline className={film.tag === 'reels' ? 'vertical' : ''} />
      </div>
    </div>
  );
}

function Review({ r }: { r: StudioReview }) {
  const [open, setOpen] = useState(false);
  const long = r.text.length > 280;
  const stars = r.score > 0 ? Math.round(r.score / 20) : 5;
  return (
    <div className="s-review" data-testid="studio-review">
      <div className="s-stars" aria-label={`${stars} מתוך 5`}>
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={i < stars ? 'on' : ''}>
            <StarIcon />
          </span>
        ))}
      </div>
      <p>{long && !open ? `${r.text.slice(0, 280)}…` : r.text}</p>
      {long && (
        <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>
          {open ? 'הצג פחות' : 'קרא עוד'}
        </button>
      )}
      <div className="s-review-by">
        <b>{r.name}</b>
        {r.when && <span className="dim"> · {r.when}</span>}
      </div>
    </div>
  );
}

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id: string) => void;
};

/**
 * Cloudflare's human check on the quote form (fix plan P10), shown only when the studio page sends a site key — the
 * same service as the hub's signup. Returns the current token ('' until solved, and again after it expires) and a
 * reset for after a refused send.
 */
function useTurnstile(siteKey: string, box: RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState('');
  const widget = useRef<string | null>(null);
  useEffect(() => {
    if (!siteKey || !box.current) return undefined;
    const w = window as unknown as { turnstile?: TurnstileApi };
    const render = () => {
      if (!w.turnstile || widget.current !== null || !box.current) return;
      widget.current = w.turnstile.render(box.current, {
        sitekey: siteKey,
        language: 'he',
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(''),
        'error-callback': () => setToken(''),
      });
    };
    if (w.turnstile) render();
    else {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (widget.current !== null) w.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, box]);
  const reset = () => {
    const w = window as unknown as { turnstile?: TurnstileApi };
    if (widget.current !== null) w.turnstile?.reset(widget.current);
    setToken('');
  };
  return { token, reset };
}

function LeadForm({ d }: { d: StudioData }) {
  const [f, setF] = useState({ coupleName: '', phone: '', date: '', venue: '', guests: '', note: '', website: '' });
  const siteKey = d.turnstileSiteKey || '';
  const turnstileBox = useRef<HTMLDivElement>(null);
  const human = useTurnstile(siteKey, turnstileBox);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<null | { coupleName: string; date: string; venue: string; guests: string }>(null);
  // "X וY" → "X & Y" once, when the field is left; a couple who changes it back keeps their own way.
  const [ampDone, setAmpDone] = useState(false);
  const amp = () => {
    if (ampDone) return;
    const next = withAmpersand(f.coupleName);
    if (next !== f.coupleName.replace(/\s+/g, ' ').trim()) {
      setAmpDone(true);
      setF((x) => ({ ...x, coupleName: next }));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (siteKey && !human.token) {
      setError('רגע — סמנו את האימות למטה ואז שלחו.');
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ lead: { coupleName: string; date: string; venue: string; guests: string } }>('POST', `/api/studio/${d.slug}/lead`, { ...f, turnstileToken: human.token });
      setSent(r.lead);
    } catch (err) {
      setError((err as Error).message);
      // A Turnstile token is good for one check: a refused send needs a new one.
      if (siteKey) human.reset();
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    const text = [
      `היי ${d.studioName}, השארנו פרטים בדף שלכם:`,
      `${sent.coupleName}`,
      sent.date && `תאריך: ${formatDate(sent.date)}`,
      sent.venue && `אולם: ${sent.venue}`,
      sent.guests && `מוזמנים: ${sent.guests}`,
      'נשמח לשמוע על זמינות והצעת מחיר 🙏',
    ]
      .filter(Boolean)
      .join('\n');
    return (
      <div className="s-sent" data-testid="lead-sent">
        <h3>תודה! הפרטים נשלחו ל{d.studioName}</h3>
        <p className="muted">נחזור אליכם בהקדם עם זמינות והצעת מחיר.</p>
        {d.whatsapp && (
          <a className="btn btn-gold" href={`https://wa.me/${d.whatsapp}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener" data-testid="lead-whatsapp">
            <ChatIcon /> שלחו גם בוואטסאפ
          </a>
        )}
      </div>
    );
  }

  return (
    <form className="s-form" onSubmit={submit} data-testid="lead-form">
      <div className="grid-2">
        <div className="field">
          <label>שמות הזוג *</label>
          <input value={f.coupleName} onChange={(e) => setF({ ...f, coupleName: e.target.value })} onBlur={amp} required autoComplete="off" data-testid="lead-names" />
        </div>
        <div className="field">
          <label>טלפון *</label>
          <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required type="tel" dir="ltr" autoComplete="tel" data-testid="lead-phone" />
        </div>
        <div className="field">
          <label>תאריך האירוע</label>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="lead-date" />
        </div>
        <div className="field">
          <label>אולם</label>
          <input value={f.venue} onChange={(e) => setF({ ...f, venue: e.target.value })} data-testid="lead-venue" />
        </div>
        <div className="field">
          <label>כמות מוזמנים</label>
          <input value={f.guests} onChange={(e) => setF({ ...f, guests: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" data-testid="lead-guests" />
        </div>
        <div className="field">
          <label>משהו שחשוב לכם שנדע</label>
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} data-testid="lead-note" />
        </div>
      </div>
      {/* Left empty by people; bots fill it. */}
      <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" aria-hidden="true" />
      {siteKey && <div ref={turnstileBox} className="s-turnstile" data-testid="lead-turnstile" />}
      {error && <div className="error">{error}</div>}
      <button className="btn btn-white" disabled={busy} data-testid="lead-submit">
        {busy ? 'שולח…' : 'שלחו לסטודיו לבדיקת זמינות והצעת מחיר'}
      </button>
    </form>
  );
}

export function StudioPage() {
  const { studio = '' } = useParams();
  const [d, setD] = useState<StudioData | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<WatchFilm | null>(null);
  const [heroOn, setHeroOn] = useState(false);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api<StudioData>('GET', `/api/studio/${studio}`)
      .then((x) => {
        applyAccent(x.accentColor);
        setD(x);
        document.title = x.studioName;
      })
      .catch((e: Error) => setError(e.message));
  }, [studio]);

  const clip = useMemo(() => {
    if (!d) return null;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    return reduced || verySlowNetwork() ? null : pickHeroClip(d.films);
  }, [d]);

  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400 }}>{error}</h1>
        </div>
      </div>
    );
  if (!d) return <div className="screen screen-center muted">טוען…</div>;

  const toForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth' });

  return (
    <div className="studio" data-testid="studio-page">
      <section className="s-hero">
        <div className="cover-fallback" />
        {clip && (
          <video className={`cover-video${heroOn ? ' on' : ''}`} src={clip.watchUrl} autoPlay muted loop playsInline preload="auto" onPlaying={() => setHeroOn(true)} data-testid="studio-hero-video" />
        )}
        <div className="shade" />
        <div className="s-hero-content">
          <div className="brand-line">
            {d.logoUrl ? <img src={d.logoUrl} alt={d.studioName} /> : <LogoMark />}
            <span className="spaced">{d.studioName}</span>
          </div>
          <h1>{d.headline || d.studioName}</h1>
          {d.about && <p className="about">{d.about}</p>}
          <div className="row" style={{ justifyContent: 'center', gap: '0.75rem' }}>
            <button type="button" className="btn btn-white" onClick={toForm} data-testid="studio-cta">
              בדיקת זמינות והצעת מחיר
            </button>
          </div>
          <Socials d={d} />
        </div>
      </section>

      {ROWS.map((row) => {
        const films = d.films.filter((f) => row.tags.includes(f.tag));
        if (films.length === 0) return null;
        return (
          <section className="s-row" key={row.title} data-testid="studio-row">
            <h2>{row.title}</h2>
            <div className="s-row-track">
              {films.map((f, i) => (
                <Card key={`${f.title}-${i}`} film={f} vertical={row.vertical} onPlay={() => setPlaying(f)} />
              ))}
            </div>
          </section>
        );
      })}

      {d.reviews.length > 0 && (
        <section className="s-section" data-testid="studio-reviews">
          <h2>מה זוגות כותבים עלינו</h2>
          <div className="s-reviews">
            {d.reviews.map((r, i) => (
              <Review key={i} r={r} />
            ))}
          </div>
          {d.mit4mitUrl && (
            <a className="insta" href={d.mit4mitUrl} target="_blank" rel="noopener" data-testid="studio-mit4mit">
              כל ההמלצות עלינו ב-mit4mit ←
            </a>
          )}
        </section>
      )}

      <section className="s-section" ref={formRef} id="contact">
        <h2>בדיקת זמינות והצעת מחיר</h2>
        <p className="muted">השאירו פרטים ונחזור אליכם בהקדם.</p>
        <LeadForm d={d} />
      </section>

      <footer className="s-footer">
        <div className="brand-line">
          <LogoMark />
          <span className="spaced">{d.studioName}</span>
        </div>
        {d.phone && (
          <a href={`tel:${d.phone.replace(/[^\d+]/g, '')}`} dir="ltr" className="s-phone" data-testid="studio-phone">
            {d.phone}
          </a>
        )}
        <Socials d={d} />
        <a href={`/accessibility?s=${studio}`} className="s-a11y">
          הצהרת נגישות
        </a>
      </footer>

      {playing && <Player film={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}
