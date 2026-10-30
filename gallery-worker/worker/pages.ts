// The page itself (index.html) for couple and studio links, with the couple's names and cover
// written into it. WhatsApp, Facebook and iMessage read these tags to show a preview card when a
// link is shared; the React app sets the same title again once it runs.
// Also: a small "app" description per gallery, so "Add to home screen" opens the right gallery
// with the studio's own logo as its icon. Ported from the Avira films app (2026-09-26); the logo
// is the tenant's logo URL, and only the studio's name ever appears (never the platform's).
import { coverPath } from './covers';
import { photoPath } from '../shared/photoUrl';
import { viewerGallery } from './access';
import { isExpired, kindOf } from './galleries';
import { studioNameOf } from './settings';
import { getStudioPage } from './studio';
import type { Store, TenantInfo } from './store';
import type { Env, Gallery } from './types';

interface Meta {
  title: string;
  description: string;
  image?: string;
  /** The studio page should appear in search results; couples' galleries never. */
  index?: boolean;
  manifest?: string;
  appTitle?: string;
  icon?: string;
}

const GALLERY_PATH = /^\/(?:watch|[^/]+)\/([a-f0-9]{16})\/?$/;
const STUDIO_PATH = /^\/([a-z0-9][a-z0-9-]{1,40})\/?$/;
/** First path parts that are the app's own pages, never a studio. */
const RESERVED = new Set(['watch', 'accessibility', 'print', 'api', 'assets', 'demo', 'models']);

/** The studio behind a public page, or null when it is suspended or lacks the module (films or photos). */
async function liveTenant(store: Store, tenantId: string, module: 'films' | 'photos' = 'films'): Promise<TenantInfo | null> {
  const t = await store.getTenant(tenantId);
  return t && t.access !== 'blocked' && t[module] ? t : null;
}

/**
 * The card's picture: the gallery's cover, or a photo gallery's cover photo — the key saved with the
 * gallery (cover_key, P62), so a shared link never reads the photo list.
 */
function coverFor(g: Gallery, id: string): string | undefined {
  if (g.hasCover) return coverPath(id, g);
  // 1024px: sharp in a preview card and light enough for WhatsApp to fetch.
  if (kindOf(g) === 'photos' && g.coverKey) return photoPath(id, g.photosGen, g.coverKey, 'md');
  return undefined;
}

async function galleryMeta(store: Store, id: string): Promise<Meta | null> {
  // The couple's id or the guests' id (the card never shows the other one).
  const found = await viewerGallery(store, id);
  if (!found) return null;
  const g: Gallery = found.g;
  const tenant = await liveTenant(store, g.tenantId, kindOf(g));
  if (!tenant) return null;
  // The studio's name comes with the studio (no settings read for a card).
  const studio = g.studioName || studioNameOf(tenant);
  const app = { manifest: `/api/manifest/${id}`, appTitle: g.coupleName, icon: tenant.logoUrl || '/favicon.svg' };
  if (isExpired(g)) return { title: `${g.coupleName} · ${studio}`, description: 'הגלריה נסגרה', ...app };
  const when = [shortDate(g.date), g.venue].filter(Boolean).join(' · ');
  return {
    title: `${g.coupleName}${when ? ` · ${when}` : ''}`,
    description: `${kindOf(g) === 'photos' ? 'גלריית התמונות' : 'הסרטים מהחתונה'} · ${studio}`,
    // A gallery behind a password shows no photo in the preview.
    image: g.password ? undefined : coverFor(g, id),
    ...app,
  };
}

async function studioMeta(store: Store, tenantId: string): Promise<Meta | null> {
  const tenant = await liveTenant(store, tenantId);
  if (!tenant) return null;
  const page = await getStudioPage(store, tenant.id);
  if (!page.enabled) return null;
  const films = await store.getFilmsStudio(tenant.id);
  return {
    title: studioNameOf(tenant),
    description: (films.headline || films.about || 'צילום ווידאו לחתונות').slice(0, 180),
    image: tenant.logoUrl || undefined,
    index: true,
  };
}

/** "2026-09-18" → "18.9.26" (as the couple's page shows it). */
function shortDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return m ? `${Number(m[3])}.${Number(m[2])}.${m[1].slice(2)}` : (value ?? '');
}

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Where a page lives: a couple's gallery, a studio page, or neither. */
export function pageKind(pathname: string): { gallery: string } | { studio: string } | null {
  const g = GALLERY_PATH.exec(pathname);
  if (g) return { gallery: g[1] };
  const st = STUDIO_PATH.exec(pathname);
  if (st && !RESERVED.has(st[1])) return { studio: st[1] };
  return null;
}

/**
 * An address a studio gave up (P73) that no studio has now: its page moves to the studio's new address — a
 * temporary redirect (302), since after a year another studio may take the old one. null = not such an address.
 */
async function movedStudio(store: Store, slug: string, url: URL): Promise<Response | null> {
  const tenantId = await store.tenantIdByOldSlug(slug);
  const tenant = tenantId ? await liveTenant(store, tenantId) : null;
  if (!tenant?.slug || tenant.slug === slug) return null;
  return new Response(null, { status: 302, headers: { Location: `/${tenant.slug}${url.search}`, 'Cache-Control': 'no-store' } });
}

/** index.html for this address, with the right preview tags; null when the address is not a couple's or a studio's. */
export async function pageWithMeta(request: Request, env: Env, store: Store): Promise<Response | null> {
  const url = new URL(request.url);
  const kind = pageKind(url.pathname);
  if (!kind) return null;
  let meta: Meta | null;
  if ('gallery' in kind) meta = await galleryMeta(store, kind.gallery);
  else {
    const tenantId = await store.tenantIdBySlug(kind.studio);
    if (!tenantId) return movedStudio(store, kind.studio, url);
    meta = await studioMeta(store, tenantId);
  }
  if (!meta) return null;
  const page = await env.ASSETS.fetch(new Request(new URL('/', url).toString(), { headers: request.headers }));
  if (!page.ok || !(page.headers.get('Content-Type') ?? '').includes('text/html')) return null;
  const abs = (p: string) => new URL(p, url).toString();
  const tags = [
    `<meta name="description" content="${esc(meta.description)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    `<meta property="og:url" content="${esc(url.origin + url.pathname)}">`,
    `<meta property="og:locale" content="he_IL">`,
    meta.image ? `<meta property="og:image" content="${esc(abs(meta.image))}">` : '',
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}">`,
    meta.manifest ? `<link rel="manifest" href="${esc(meta.manifest)}">` : '',
    meta.icon ? `<link rel="apple-touch-icon" href="${esc(abs(meta.icon))}">` : '',
    meta.appTitle ? `<meta name="apple-mobile-web-app-title" content="${esc(meta.appTitle)}">` : '',
    meta.appTitle ? `<meta name="apple-mobile-web-app-capable" content="yes">` : '',
  ].filter(Boolean);
  const out = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(meta.title) })
    .on('meta[name="robots"]', { element: (el) => void (meta.index ? el.remove() : null) })
    .on('head', { element: (el) => void el.append(tags.join(''), { html: true }) })
    .transform(page);
  const headers = new Headers(out.headers);
  // The tags depend on the gallery (name, cover): never kept by the browser or on the way.
  headers.set('Cache-Control', 'no-store');
  return new Response(out.body, { status: 200, headers });
}

/**
 * "Add to home screen": opens this gallery full screen, named after the couple, with the studio's logo.
 * The browser keeps it 5 minutes (P62): it asks for it with every page load, and it changes rarely.
 */
export async function manifestFor(store: Store, id: string): Promise<Response | null> {
  const found = await viewerGallery(store, id);
  if (!found) return null;
  const g = found.g;
  const tenant = await liveTenant(store, g.tenantId, kindOf(g));
  if (!tenant) return null;
  const light = kindOf(g) === 'photos';
  const path = tenant.slug ? `/${tenant.slug}/${id}` : `/watch/${id}`;
  const icons = tenant.logoUrl ? [{ src: tenant.logoUrl, sizes: 'any', purpose: 'any' }] : [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }];
  const body = {
    name: `${g.coupleName} · ${g.studioName || studioNameOf(tenant)}`,
    short_name: g.coupleName.slice(0, 24),
    id: path,
    start_url: path,
    scope: path,
    display: 'standalone',
    dir: 'rtl',
    lang: 'he',
    background_color: light ? '#ffffff' : '#0a0a0b',
    theme_color: light ? '#ffffff' : '#0b0b0c',
    icons,
  };
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'private, max-age=300' } });
}
