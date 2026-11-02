import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { CloseIcon, LogoMark } from '../watch/icons';

interface Wedding {
  ref: string;
  names: string;
  venue: string;
  month: string;
  cover: string;
  full: boolean;
}

interface PageData {
  name: string;
  bio: string;
  photoUrl: string;
  studioName: string;
  logoUrl: string;
  whatsapp: string;
  weddings: Wedding[];
  testimonials: { id: string; body: string; coupleName: string; imageUrl: string }[];
}

interface WeddingData {
  names: string;
  venue: string;
  month: string;
  full: boolean;
  items: { key: string; ar: number }[];
  base: string;
}

const line = (w: { venue: string; month: string }) => [w.venue, w.month].filter(Boolean).join(' · ');

/**
 * /photographer/<token> (Avira, 2026-11-02, the owner's request; 0102): a photographer's page for a couple who asked to
 * see his work — his photo and words, the weddings he shot (each its teaser, or the whole gallery when the studio opened
 * it), what couples said, and a WhatsApp button to the studio. Looking only: no download, no hearts.
 */
export function PhotographerPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ w: Wedding; d: WeddingData | null } | null>(null);
  const [photo, setPhoto] = useState<number | null>(null);
  const [shot, setShot] = useState('');
  const swipe = useRef(0);
  // Next / previous in full screen (RTL: the next photo is to the left).
  const step = (d: number) => {
    const n = open?.d?.items.length ?? 0;
    if (n) setPhoto((p) => (p === null ? p : (p + d + n) % n));
  };

  useEffect(() => {
    api<PageData>('GET', `/api/photographer/${token}`)
      .then((d) => {
        setData(d);
        document.title = `${d.name} · ${d.studioName}`;
      })
      .catch((e: Error) => setError(e.message));
  }, [token]);

  const openWedding = (w: Wedding) => {
    setOpen({ w, d: null });
    window.scrollTo({ top: 0 });
    api<WeddingData>('GET', `/api/photographer/${token}/w/${w.ref}`)
      .then((d) => setOpen({ w, d }))
      .catch((e: Error) => {
        setOpen(null);
        setError(e.message);
      });
  };

  useEffect(() => {
    if (photo === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPhoto(null);
      if (e.key === 'ArrowLeft') step(1);
      if (e.key === 'ArrowRight') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photo, open]);

  if (error)
    return (
      <div className="screen screen-center">
        <div className="card center">{error}</div>
      </div>
    );
  if (!data) return <div className="screen screen-center muted">טוען…</div>;

  const wa = data.whatsapp ? `https://wa.me/${data.whatsapp}?text=${encodeURIComponent(`היי, ראיתי את העבודות של ${data.name} ואשמח לשמוע פרטים 😊`)}` : '';
  const items = open?.d?.items ?? [];

  return (
    <div dir="rtl" style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)' }} data-testid="photographer-page">
      <header style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '1rem', color: 'var(--gold)', letterSpacing: '0.2em', fontSize: '0.8rem' }}>
        {data.logoUrl ? <img src={data.logoUrl} alt="" style={{ height: 28 }} /> : <LogoMark />} {data.studioName}
      </header>

      {!open && (
        <>
          <section style={{ textAlign: 'center', padding: '1rem 1.25rem 2rem', maxWidth: 560, margin: '0 auto' }}>
            {data.photoUrl && <img src={data.photoUrl} alt={data.name} style={{ width: 120, height: 120, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--gold-dim)' }} data-testid="pp-photo" />}
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '2rem', margin: '0.75rem 0 0.25rem' }} data-testid="pp-name">
              {data.name}
            </h1>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              צלם · {data.studioName}
            </div>
            {data.bio && <p style={{ lineHeight: 1.8, marginTop: '1rem', whiteSpace: 'pre-line' }}>{data.bio}</p>}
          </section>

          {data.weddings.length > 0 && (
            <section style={{ maxWidth: 1100, margin: '0 auto', padding: '0 1rem 2rem' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '1.4rem', textAlign: 'center', margin: '0 0 1rem' }}>חתונות שצילמתי</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {data.weddings.map((w) => (
                  <button key={w.ref} type="button" onClick={() => openWedding(w)} style={{ textAlign: 'right', background: 'var(--panel)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, overflow: 'hidden', color: 'inherit', padding: 0 }} data-testid="pp-wedding">
                    <div style={{ aspectRatio: '4 / 3', background: '#1a1917' }}>{w.cover && <img src={w.cover} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
                    <div style={{ padding: '0.6rem 0.8rem' }}>
                      <div style={{ fontWeight: 600 }}>{w.names}</div>
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{line(w)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {data.testimonials.length > 0 && (
            <section style={{ maxWidth: 760, margin: '0 auto', padding: '0 1rem 2rem' }} data-testid="pp-testimonials">
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '1.4rem', textAlign: 'center', margin: '0 0 1rem' }}>מה הזוגות אומרים</h2>
              <div style={{ display: 'grid', gap: 10 }}>
                {data.testimonials.map((t) => (
                  <figure key={t.id} style={{ margin: 0, background: 'var(--panel)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 12, padding: '0.9rem 1rem' }}>
                    {t.body && <blockquote style={{ margin: 0, lineHeight: 1.8, whiteSpace: 'pre-line' }}>"{t.body}"</blockquote>}
                    {t.imageUrl && (
                      <button type="button" onClick={() => setShot(t.imageUrl)} style={{ background: 'none', border: 0, padding: 0, marginTop: t.body ? 8 : 0, cursor: 'zoom-in' }} aria-label="הגדלת צילום המסך">
                        <img src={t.imageUrl} alt="ההודעה מהזוג" loading="lazy" style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 8, display: 'block' }} />
                      </button>
                    )}
                    {t.coupleName && <figcaption className="muted" style={{ marginTop: 6, fontSize: '0.85rem' }}>— {t.coupleName}</figcaption>}
                  </figure>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {open && (
        <section style={{ maxWidth: 1200, margin: '0 auto', padding: '0 1rem 2rem' }} data-testid="pp-wedding-view">
          <button type="button" className="btn btn-sm" onClick={() => setOpen(null)} style={{ marginBottom: 12 }} data-testid="pp-back">
            → חזרה לכל החתונות
          </button>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 400, fontSize: '1.6rem', margin: '0 0 0.25rem' }}>{open.w.names}</h2>
          <div className="muted" style={{ marginBottom: 12 }}>
            {line(open.w)}
            {open.d && !open.d.full && ' · תמונות נבחרות'}
          </div>
          {!open.d ? (
            <div className="muted">טוען…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
              {items.map((p, i) => (
                <button key={p.key} type="button" onClick={() => setPhoto(i)} style={{ padding: 0, border: 0, background: '#1a1917', borderRadius: 6, overflow: 'hidden', aspectRatio: '1', cursor: 'zoom-in' }} data-testid="pp-photo-cell">
                  <img src={`${open.d!.base}/${p.key}?s=m`} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onContextMenu={(e) => e.preventDefault()} />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {wa && (
        <div style={{ position: 'sticky', bottom: 0, padding: '0.75rem', display: 'flex', justifyContent: 'center', background: 'linear-gradient(transparent, var(--bg) 40%)' }}>
          <a href={wa} target="_blank" rel="noopener" className="btn" style={{ background: '#25d366', borderColor: '#25d366', color: '#0a0a0b' }} data-testid="pp-whatsapp">
            לתיאום שיחה עם {data.studioName} בוואטסאפ
          </a>
        </div>
      )}

      {photo !== null && open?.d && items[photo] && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setPhoto(null)}
          onTouchStart={(e) => (swipe.current = e.touches[0].clientX)}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - swipe.current;
            if (Math.abs(dx) > 40) step(dx > 0 ? 1 : -1);
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 90, background: '#0c0b0a', display: 'grid', placeItems: 'center' }}
        >
          <img src={`${open.d.base}/${items[photo].key}?s=l`} alt="" style={{ maxWidth: '94vw', maxHeight: '88dvh', objectFit: 'contain' }} onContextMenu={(e) => e.preventDefault()} />
          <button type="button" className="pg-icon" onClick={() => setPhoto(null)} style={{ position: 'absolute', top: 12, left: 12 }} aria-label="סגירה">
            <CloseIcon />
          </button>
          <span className="muted" dir="ltr" style={{ position: 'absolute', top: 18, right: 16, fontSize: '0.85rem' }}>
            {photo + 1} / {items.length}
          </span>
          {items.length > 1 && (
            <>
              <button type="button" className="pg-icon" onClick={(e) => (e.stopPropagation(), step(-1))} style={{ position: 'absolute', top: '50%', right: 8, fontSize: '1.6rem' }} aria-label="הקודמת" data-testid="pp-prev">
                ›
              </button>
              <button type="button" className="pg-icon" onClick={(e) => (e.stopPropagation(), step(1))} style={{ position: 'absolute', top: '50%', left: 8, fontSize: '1.6rem' }} aria-label="הבאה" data-testid="pp-next">
                ‹
              </button>
            </>
          )}
        </div>
      )}

      {shot && (
        <div role="dialog" aria-modal="true" onClick={() => setShot('')} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.9)', display: 'grid', placeItems: 'center' }}>
          <img src={shot} alt="ההודעה מהזוג" style={{ maxWidth: '94vw', maxHeight: '90dvh' }} />
        </div>
      )}
    </div>
  );
}
