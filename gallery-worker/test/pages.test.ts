// Fix plan P88-b: worker/pages.ts — the preview card a couple's or studio's link shows when shared
// (title, description, picture), the "add to home screen" manifest, and when neither is given: a
// gallery in the trash, a closed or blocked studio, a studio without the module, a disabled page.
// Only the studio's name ever appears. HTMLRewriter (a Cloudflare global) is replaced by a small
// stand-in that applies the same three edits to the text.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { manifestFor, pageKind, pageWithMeta } from '../worker/pages';
import { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const HTML = '<!doctype html><html><head><title>App</title><meta name="robots" content="noindex"></head><body></body></html>';

// Enough of HTMLRewriter for pages.ts: set a title, remove the robots tag, append to <head>.
class FakeRewriter {
  private handlers: [string, { element: (el: unknown) => void }][] = [];
  on(selector: string, h: { element: (el: unknown) => void }) {
    this.handlers.push([selector, h]);
    return this;
  }
  transform(res: Response): Response {
    const run = async () => {
      let html = await res.text();
      for (const [sel, h] of this.handlers) {
        const el = {
          setInnerContent: (t: string) => void (html = html.replace(/<title>[^<]*<\/title>/, `<title>${t.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>`)),
          remove: () => void (html = html.replace(/<meta name="robots"[^>]*>/, '')),
          append: (t: string) => void (html = html.replace('</head>', `${t}</head>`)),
        };
        if (sel === 'title' || sel === 'head' || (sel === 'meta[name="robots"]' && html.includes('name="robots"'))) h.element(el);
      }
      return html;
    };
    return new Response(new ReadableStream({ async start(c) { c.enqueue(new TextEncoder().encode(await run())); c.close(); } }), { headers: res.headers });
  }
}

const T = '00000000-0000-4000-8000-0000000000a1';
const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString();
const gallery = (id: string, over: Partial<Gallery> = {}): Gallery => ({
  id, tenantId: T, kind: 'films', coupleName: 'Noa & Tom', date: '2026-09-18', venue: 'Test hall', days: 30,
  createdAt: '2026-09-01T00:00:00.000Z', expiresAt: FUTURE, hasCover: true, films: [], views: 0, downloads: 0, coverVersion: 3, ...over,
});

let store: MemoryStore;
let env: Env;
const html = async (path: string) => {
  const res = await pageWithMeta(new Request(`https://films.test${path}`), env, store);
  return res && { text: await res.text(), cache: res.headers.get('Cache-Control') };
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).HTMLRewriter = FakeRewriter;
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).HTMLRewriter;
});

function setup() {
  store = new MemoryStore();
  store.seedTenant({ id: T, name: 'Studio Test', displayName: 'Studio Shown', slug: 'studio-test', logoUrl: 'https://cdn.test/logo.png' });
  env = { ...fakeEnv(), ASSETS: { fetch: async () => new Response(HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) } } as unknown as Env;
}

describe('pageKind', () => {
  it('a gallery under /watch or under the studio address, a studio page, or nothing', () => {
    expect(pageKind('/watch/0123456789abcdef')).toEqual({ gallery: '0123456789abcdef' });
    expect(pageKind('/studio-test/0123456789abcdef/')).toEqual({ gallery: '0123456789abcdef' });
    expect(pageKind('/studio-test')).toEqual({ studio: 'studio-test' });
    expect(pageKind('/studio-test/')).toEqual({ studio: 'studio-test' });
    for (const p of ['/', '/api', '/print', '/watch', '/assets', '/Studio', '/studio-test/xyz', '/watch/0123456789ABCDEF', '/a']) expect(pageKind(p), p).toBeNull();
  });
});

describe('the preview card of a gallery', () => {
  it("the couple's names, date and venue, the studio's name, the cover, and no caching", async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef'));
    const r = await html('/studio-test/0123456789abcdef');
    expect(r?.cache).toBe('no-store');
    expect(r?.text).toContain('<title>Noa &amp; Tom · 18.9.26 · Test hall</title>');
    expect(r?.text).toContain('<meta property="og:description" content="הסרטים מהחתונה · Studio Shown">');
    expect(r?.text).toContain('<meta property="og:image" content="https://films.test/api/cover/0123456789abcdef?v=3">');
    expect(r?.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(r?.text).toContain('<link rel="manifest" href="/api/manifest/0123456789abcdef">');
    expect(r?.text).toContain('<link rel="apple-touch-icon" href="https://cdn.test/logo.png">');
    expect(r?.text).toContain('name="robots"');
  });
  it("the couple's own studio name for this gallery wins", async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { studioName: 'Other name' }));
    expect((await html('/watch/0123456789abcdef'))?.text).toContain('content="הסרטים מהחתונה · Other name"');
  });
  it('a gallery behind a password shows no picture', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { password: 'secret' }));
    const r = await html('/watch/0123456789abcdef');
    expect(r?.text).not.toContain('og:image');
    expect(r?.text).toContain('<meta name="twitter:card" content="summary">');
  });
  it('a photo gallery: the cover photo saved with the gallery, without reading its photo list (P62)', async () => {
    setup();
    // cover_key: written with every save of the list (coverOf) and filled for older galleries by 0130.
    await store.putGallery(gallery('0123456789abcdef', { kind: 'photos', hasCover: false, coverKey: 'bbbbbbbb' }));
    const items = [{ key: 'aaaaaaaa', name: 'a.jpg', ref: 'm:/a', hidden: true }, { key: 'bbbbbbbb', name: 'b.jpg', ref: 'm:/b' }];
    await store.savePhotos(T, '0123456789abcdef', { folderUrl: '', provider: 'mock', sets: [], items, cover: 'aaaaaaaa', gen: 7 } as never);
    const lists = vi.spyOn(store, 'getPhotos');
    const settings = vi.spyOn(store, 'getSecret');
    const r = await html('/watch/0123456789abcdef');
    // With the list's generation (P66), from the gallery row: a new file is a new address for WhatsApp too.
    expect(r?.text).toContain('content="https://films.test/api/photos/0123456789abcdef/v7/bbbbbbbb?s=md"');
    expect(r?.text).toContain('גלריית התמונות · Studio Shown');
    expect(lists, 'no photo list is read for a card').not.toHaveBeenCalled();
    expect(settings, 'no settings are read for a card').not.toHaveBeenCalled();
    // No cover saved (an empty gallery): a card without a picture.
    await store.patchGallery(T, '0123456789abcdef', { coverKey: undefined });
    expect((await html('/watch/0123456789abcdef'))?.text).not.toContain('og:image');
  });
  it("the guests' link shows the same card", async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { kind: 'photos', guestId: 'fedcba9876543210' }));
    expect((await html('/watch/fedcba9876543210'))?.text).toContain('<title>Noa &amp; Tom · 18.9.26 · Test hall</title>');
  });
  it('a closed gallery says so, with no picture', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { expiresAt: '2026-01-01T00:00:00.000Z' }));
    const r = await html('/watch/0123456789abcdef');
    expect(r?.text).toContain('<meta property="og:description" content="הגלריה נסגרה">');
    expect(r?.text).not.toContain('og:image');
  });
  it('no card: a gallery in the trash, an unknown one, a blocked studio, a studio without the module', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { deletedAt: '2026-09-20T00:00:00.000Z' }));
    await store.putGallery(gallery('1123456789abcdef', { kind: 'photos' }));
    await store.putGallery(gallery('2123456789abcdef'));
    expect(await html('/watch/0123456789abcdef')).toBeNull();
    expect(await html('/watch/ffffffffffffffff')).toBeNull();
    store.seedTenant({ id: T, photos: false });
    expect(await html('/watch/1123456789abcdef')).toBeNull();
    expect(await html('/watch/2123456789abcdef')).not.toBeNull();
    store.seedTenant({ id: T, access: 'blocked' });
    expect(await html('/watch/2123456789abcdef')).toBeNull();
    store.seedTenant({ id: T, access: 'read_only' });
    expect(await html('/watch/2123456789abcdef'), 'read-only studios still show their galleries').not.toBeNull();
  });
  it('no card when the page itself is not HTML', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef'));
    env = { ...env, ASSETS: { fetch: async () => new Response('x', { headers: { 'Content-Type': 'text/plain' } }) } } as unknown as Env;
    expect(await html('/watch/0123456789abcdef')).toBeNull();
  });
  it('quotes and tags in names are escaped', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { coupleName: 'A "B" <C>', studioName: 'S&S' }));
    const r = await html('/watch/0123456789abcdef');
    expect(r?.text).toContain('content="A &quot;B&quot; &lt;C&gt; · 18.9.26 · Test hall"');
    expect(r?.text).toContain('· S&amp;S"');
  });
});

describe("the studio page's card", () => {
  it('only when the page is on: the studio name, its headline, its logo, and indexable', async () => {
    setup();
    expect(await html('/studio-test')).toBeNull();
    await store.patchFilmsStudio(T, { pageEnabled: true, headline: 'Weddings, filmed' });
    const r = await html('/studio-test');
    expect(r?.text).toContain('<title>Studio Shown</title>');
    expect(r?.text).toContain('<meta name="description" content="Weddings, filmed">');
    expect(r?.text).toContain('<meta property="og:image" content="https://cdn.test/logo.png">');
    expect(r?.text, 'a studio page may be indexed').not.toContain('name="robots"');
    expect(r?.text).not.toContain('rel="manifest"');
  });
  it('no card for an unknown address or a studio without films', async () => {
    setup();
    await store.patchFilmsStudio(T, { pageEnabled: true });
    expect(await html('/no-such-studio')).toBeNull();
    store.seedTenant({ id: T, films: false });
    expect(await html('/studio-test')).toBeNull();
  });
});

describe('the home-screen manifest', () => {
  it("named after the couple and the studio, opening the gallery under the studio's address, with its logo", async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef'));
    const res = await manifestFor(store, '0123456789abcdef');
    expect(res?.headers.get('Content-Type')).toContain('application/manifest+json');
    // Asked for with every page load; the browser keeps it 5 minutes (P62).
    expect(res?.headers.get('Cache-Control')).toBe('private, max-age=300');
    const m = await res!.json();
    expect(m).toMatchObject({
      name: 'Noa & Tom · Studio Shown', short_name: 'Noa & Tom', start_url: '/studio-test/0123456789abcdef', scope: '/studio-test/0123456789abcdef',
      display: 'standalone', dir: 'rtl', lang: 'he', background_color: '#0a0a0b', icons: [{ src: 'https://cdn.test/logo.png', sizes: 'any', purpose: 'any' }],
    });
  });
  it('a photo gallery is light; no logo → the default icon; no studio address → /watch', async () => {
    setup();
    store.seedTenant({ id: T, logoUrl: '', slug: '' });
    await store.putGallery(gallery('0123456789abcdef', { kind: 'photos' }));
    const m = (await (await manifestFor(store, '0123456789abcdef'))!.json()) as { background_color: string; start_url: string; icons: { src: string }[] };
    expect(m.background_color).toBe('#ffffff');
    expect(m.start_url).toBe('/watch/0123456789abcdef');
    expect(m.icons[0].src).toBe('/favicon.svg');
  });
  it('none for a gallery in the trash or a blocked studio', async () => {
    setup();
    await store.putGallery(gallery('0123456789abcdef', { deletedAt: '2026-09-20T00:00:00.000Z' }));
    await store.putGallery(gallery('1123456789abcdef'));
    expect(await manifestFor(store, '0123456789abcdef')).toBeNull();
    store.seedTenant({ id: T, access: 'blocked' });
    expect(await manifestFor(store, '1123456789abcdef')).toBeNull();
  });
});
