import { afterEach, describe, expect, it, vi } from 'vitest';
import { listPhotos } from '../worker/photos';
import { resolveDropboxFolder } from '../worker/providers/dropbox';
import type { Env, Settings } from '../worker/types';

const FOLDER = 'https://www.dropbox.com/scl/fo/abc/def?rlkey=k&dl=0';
const settings = {
  dropbox: { appKey: 'k', appSecret: 's', refreshToken: 'r' },
  googleApiKey: '',
} as unknown as Settings;
const env = { KV: { get: async () => null, put: async () => undefined, delete: async () => undefined } } as unknown as Env;

type Handler = (path: string, body: any, headers: Record<string, string>) => unknown;

function fakeDropbox(handler: Handler) {
  const calls: { path: string; pathRoot?: string }[] = [];
  vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'T' });
    const path = url.replace('https://api.dropboxapi.com/2/', '');
    const headers = init.headers as Record<string, string>;
    calls.push({ path, pathRoot: headers['Dropbox-API-Path-Root'] });
    const out = handler(path, init.body ? JSON.parse(String(init.body)) : null, headers);
    if (out instanceof Response) return out;
    return Response.json(out);
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveDropboxFolder on real account shapes', () => {
  // Fix plan P65: a folder in the studio's own account makes no public link (no sharing/* call that creates or
  // reuses one); each film is kept by its file id and streamed with the studio's connection ('dropbox-own').
  const SHARING_WRITES = ['sharing/create_shared_link_with_settings', 'sharing/list_shared_links'];

  it('team account: retries from the team root when the link has no path; the film keeps the team root, no public link', async () => {
    const calls = fakeDropbox((path, body, headers) => {
      const team = Boolean(headers['Dropbox-API-Path-Root']);
      if (path === 'users/get_current_account') return { name: { display_name: 'Avira' }, root_info: { '.tag': 'team', root_namespace_id: '100', home_namespace_id: '200' } };
      if (path === 'sharing/get_shared_link_metadata') return team ? { '.tag': 'folder', name: 'רוני ורז', path_lower: '/clients/roni' } : { '.tag': 'folder', name: 'רוני ורז' };
      if (path === 'files/list_folder') return { entries: [{ '.tag': 'file', name: 'היילייטס.mp4', size: 10, path_lower: '/clients/roni/היילייטס.mp4', id: 'id:HL' }], cursor: '', has_more: false };
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const r = await resolveDropboxFolder(env, settings, FOLDER);
    expect(r.films).toHaveLength(1);
    expect(r.films[0]).toMatchObject({ provider: 'dropbox-own', fileId: 'id:HL', pathRoot: '100', tag: 'highlights', watchUrl: '', downloadUrl: '' });
    expect(r.films[0].sourceUrl).toBe('https://www.dropbox.com/scl/fo/abc/def?rlkey=k');
    expect(calls.find((c) => c.path === 'files/list_folder')?.pathRoot).toBe('{".tag":"root","root":"100"}');
    expect(calls.filter((c) => SHARING_WRITES.includes(c.path))).toEqual([]);
  });

  it('uses the folder id when there is no path; each film by its file id, never a public link', async () => {
    const calls = fakeDropbox((path, body) => {
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'F', id: 'id:FOLDER' };
      if (path === 'files/list_folder') {
        expect(body.path).toBe('id:FOLDER');
        return { entries: [{ '.tag': 'file', name: 'סרט.mp4', size: 5, id: 'id:FILE' }], cursor: '', has_more: false };
      }
      // An existing link (perhaps team-only or with a password) is never reused either.
      if (path === 'sharing/list_shared_links') return { links: [{ url: 'https://www.dropbox.com/scl/fi/y/b.mp4?rlkey=r2&dl=0' }] };
      throw new Error(`unexpected ${path}`);
    });
    const r = await resolveDropboxFolder(env, settings, FOLDER);
    expect(r.films[0]).toMatchObject({ provider: 'dropbox-own', fileId: 'id:FILE', tag: 'feature', sizeBytes: 5 });
    expect(r.films[0].pathRoot).toBeUndefined();
    expect(calls.filter((c) => SHARING_WRITES.includes(c.path))).toEqual([]);
  });

  it('team account: home path exists but is not listable, the team root works', async () => {
    const calls = fakeDropbox((path, body, headers) => {
      const team = Boolean(headers['Dropbox-API-Path-Root']);
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'team', root_namespace_id: '100', home_namespace_id: '200' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'רוני ורז', path_lower: '/לקוחות/רוני ורז', id: 'id:F' };
      if (path === 'files/list_folder') {
        if (!team) return new Response(JSON.stringify({ error_summary: 'path/not_found/', error: { '.tag': 'path', path: { '.tag': 'not_found' } } }), { status: 409 });
        return { entries: [{ '.tag': 'file', name: 'חופה.mp4', size: 7, path_lower: '/לקוחות/רוני ורז/חופה.mp4' }], cursor: '', has_more: false };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const r = await resolveDropboxFolder(env, settings, FOLDER);
    expect(r.films[0].tag).toBe('ceremony');
    expect(r.films[0]).toMatchObject({ provider: 'dropbox-own', fileId: '/לקוחות/רוני ורז/חופה.mp4', pathRoot: '100' });
    expect(calls.filter((c) => c.path === 'files/list_folder').map((c) => Boolean(c.pathRoot))).toEqual([false, false, true]);
  });

  it("someone else's folder: lists it through the public link and marks films for streaming through the site", async () => {
    fakeDropbox((path, body) => {
      if (path === 'users/get_current_account') return { name: { display_name: 'Daniel' }, root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'רוני ורז - 11.8.26 - אלה' };
      if (path === 'files/list_folder') {
        expect(body.shared_link.url).toBe('https://www.dropbox.com/scl/fo/abc/def?rlkey=k');
        return {
          entries: [
            { '.tag': 'file', name: 'היילייטס.mp4', size: 2460912400, path_lower: '/היילייטס.mp4' },
            { '.tag': 'file', name: 'סרט.mp4', size: 14935771682, path_lower: '/סרט.mp4' },
            { '.tag': 'file', name: 'cover.jpg', size: 10 },
          ],
          cursor: '',
          has_more: false,
        };
      }
      throw new Error(`unexpected ${path}`);
    });
    const r = await resolveDropboxFolder(env, settings, FOLDER);
    expect(r.folderName).toBe('רוני ורז - 11.8.26 - אלה');
    expect(r.films.map((f) => [f.provider, f.fileId, f.tag])).toEqual([
      ['dropbox-link', '/היילייטס.mp4', 'highlights'],
      ['dropbox-link', '/סרט.mp4', 'feature'],
    ]);
    expect(r.films[0].sourceUrl).toBe('https://www.dropbox.com/scl/fo/abc/def?rlkey=k');
  });

  it('password-protected or private links get a plain explanation', async () => {
    fakeDropbox((path) => {
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'F' };
      if (path === 'files/list_folder') return new Response(JSON.stringify({ error_summary: 'shared_link_access_denied/..' }), { status: 409 });
      throw new Error(`unexpected ${path}`);
    });
    await expect(resolveDropboxFolder(env, settings, FOLDER)).rejects.toThrow(/סיסמה|ציבורי/);
  });
});

describe('P64: a photo folder in the connected account', () => {
  const notFound = () => new Response(JSON.stringify({ error_summary: 'path/not_found/', error: { '.tag': 'path', path: { '.tag': 'not_found' } } }), { status: 409 });

  it('found only by its id: read by the id, folder by folder; every photo kept by its id, with its size', async () => {
    fakeDropbox((path, body) => {
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'רוני ורז', id: 'id:ROOT' };
      if (path === 'files/list_folder') {
        // Through the public link Dropbox does not find it (what happened before P64).
        if (body.shared_link) return notFound();
        if (body.path === 'id:ROOT')
          return {
            entries: [
              { '.tag': 'file', name: 'IMG_1.jpg', id: 'id:F1', size: 9_000_000 },
              { '.tag': 'folder', name: '02 התארגנות', id: 'id:SUB' },
              { '.tag': 'file', name: 'notes.txt', id: 'id:T' },
            ],
            cursor: '',
            has_more: false,
          };
        if (body.path === 'id:SUB') return { entries: [{ '.tag': 'file', name: 'IMG_2.jpg', id: 'id:F2', size: 8_000_000, path_lower: '/x/02 התארגנות/img_2.jpg' }], cursor: '', has_more: false };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const d = await listPhotos(env, settings, FOLDER, 'https://films.test');
    expect(d.provider).toBe('dropbox');
    expect(d.items.map((i) => [i.name, i.ref, i.folder ?? '', i.size])).toEqual([
      ['IMG_1.jpg', 'p:id:F1', '', 9_000_000],
      ['IMG_2.jpg', 'p:id:F2', '02 התארגנות', 8_000_000],
    ]);
    expect(d.items[1].alt).toBe('p:/x/02 התארגנות/img_2.jpg');
  });

  it('found by its path: one recursive listing; ids, sizes, the path it had, and the subfolder by position', async () => {
    fakeDropbox((path, body) => {
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'רוני', path_lower: '/clients/roni', id: 'id:ROOT' };
      if (path === 'files/list_folder' && !body.recursive) return { entries: [], cursor: '', has_more: false };
      if (path === 'files/list_folder') {
        expect(body.path).toBe('/clients/roni');
        return {
          entries: [
            { '.tag': 'file', name: 'A.jpg', id: 'id:A', size: 5, path_lower: '/clients/roni/a.jpg', path_display: '/Clients/Roni/A.jpg' },
            { '.tag': 'file', name: 'B.jpg', id: 'id:B', size: 6, path_lower: '/clients/roni/אילון/b.jpg', path_display: '/Clients/Roni/אילון/B.jpg' },
            { '.tag': 'file', name: 'C.jpg', size: 7, path_lower: '/clients/roni/אילון/c.jpg' },
          ],
          cursor: '',
          has_more: false,
        };
      }
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const d = await listPhotos(env, settings, FOLDER, 'https://films.test');
    expect(d.items.map((i) => [i.ref, i.folder ?? '', i.size, i.alt])).toEqual([
      ['p:id:A', '', 5, 'p:/clients/roni/a.jpg'],
      ['p:id:B', 'אילון', 6, 'p:/clients/roni/אילון/b.jpg'],
      ['p:/clients/roni/אילון/c.jpg', 'אילון', 7, undefined],
    ]);
  });

  it("someone else's folder: each photo keeps its size too", async () => {
    fakeDropbox((path, body) => {
      if (path === 'users/get_current_account') return { root_info: { '.tag': 'user', root_namespace_id: '5', home_namespace_id: '5' } };
      if (path === 'sharing/get_shared_link_metadata') return { '.tag': 'folder', name: 'F' };
      if (path === 'files/list_folder' && body.shared_link) return { entries: [{ '.tag': 'file', name: 'A.jpg', size: 1234 }], cursor: '', has_more: false };
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const d = await listPhotos(env, settings, FOLDER, 'https://films.test');
    expect(d.items.map((i) => [i.ref, i.size])).toEqual([['l:/A.jpg', 1234]]);
  });
});
