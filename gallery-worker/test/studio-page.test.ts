// The studio page's showcase films (P72): every film but MyAirBridge's plays through the studio's
// own route, never a gallery route with an empty gallery id (that was a 404 for Drive and Dropbox).
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Film } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('clip', { headers: { 'Content-Type': 'video/mp4' } }) } } as unknown as Env;
const call = (path: string) => worker.fetch(new Request(`https://films.test${path}`), env);

const film = (provider: Film['provider'] | undefined, title: string, fileId: string): Film =>
  ({ title, tag: 'other', fileName: `${title}.mp4`, provider, fileId, sourceUrl: fileId, watchUrl: '', downloadUrl: '', sizeBytes: 1, playable: true }) as Film;

describe('studio page showcase films', () => {
  it('Drive, Dropbox (also without a provider), shared folders and pCloud play; MyAirBridge opens at its own address', async () => {
    const tid = '00000000-0000-4000-8000-00000000a720';
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id: tid, slug: 'showcase-studio' });
    const films = [
      film('gdrive', 'drive', '1AbCdEfGhIjKlMnOp'),
      film('dropbox', 'dropbox', 'https://www.dropbox.com/scl/fi/abc/a.mp4?rlkey=k'),
      film(undefined, 'old', 'https://www.dropbox.com/scl/fi/def/b.mp4?rlkey=k'),
      film('dropbox-link', 'friend', '/c.mp4'),
      film('pcloud', 'pcloud', 'https://u.pcloud.link/publink/show?code=XYZ#123'),
      film('myairbridge', 'mab', 'https://mab.to/abc123'),
    ];
    await store.patchFilmsStudio(tid, { pageEnabled: true, showcase: { films } });

    const page = (await (await call('/api/studio/showcase-studio')).json()) as { films: { title: string; watchUrl: string }[] };
    const urls = Object.fromEntries(page.films.map((f) => [f.title, f.watchUrl]));
    expect(urls.mab).toBe('https://mab.to/abc123');
    for (const [title, i] of [['drive', 0], ['dropbox', 1], ['old', 2], ['friend', 3], ['pcloud', 4]] as const) {
      expect(urls[title]).toBe(`/api/studio/showcase-studio/film/${i}`);
      expect((await call(urls[title])).status).toBe(200);
    }
    for (const u of Object.values(urls)) expect(u).not.toContain('/api/watch//');
    // MyAirBridge and a film that isn't there never stream through the studio route.
    expect((await call('/api/studio/showcase-studio/film/5')).status).toBe(404);
    expect((await call('/api/studio/showcase-studio/film/9')).status).toBe(404);
  });
});
