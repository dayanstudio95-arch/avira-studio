// The Google Drive helper's work (Avira, 2026-11-02; 0101): a starred gallery stays out of the trash, its star moves
// its Drive folder into "גלריות מועדפים" and back (a quick change of mind cancels instead), and a gallery removed for
// good sends its folder to the Drive trash — only a Drive folder, and only one no other gallery reads.
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { driveFolderId, queueDriveTrash } from '../worker/driveTasks';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import type { Env, Gallery } from '../worker/types';
import { fakeEnv } from './fake-kv';

const env = { ...fakeEnv(), CLOUD_MOCK: '1', HUB_URL: 'https://hub.example' } as unknown as Env;
const DRIVE = (id: string) => `https://drive.google.com/drive/folders/${id}`;

let n = 0;
async function setup() {
  n++;
  const tid = `00000000-0000-4000-8000-${(0xd1000 + n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `drive-${n}`, photos: true });
  const studio = { Authorization: `Bearer test:u-d-${n}:${tid}:owner`, Origin: 'https://hub.example', 'Content-Type': 'application/json' };
  const call = (method: string, path: string, data?: unknown) =>
    worker.fetch(new Request(`https://films.test${path}`, { method, headers: studio, body: data === undefined ? undefined : JSON.stringify(data) }), env);
  let i = 0;
  const gallery = async (over: Partial<Gallery> = {}) => {
    i++;
    const id = `d1${n.toString(16).padStart(2, '0')}${i.toString(16).padStart(12, '0')}`;
    await store.putGallery({ id, tenantId: tid, kind: 'photos', coupleName: `זוג ${i}`, date: '2026-10-19', films: [], createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), days: 30, hasCover: false, views: 0, downloads: 0, folderProvider: 'gdrive', folderUrl: DRIVE(`folder${n}x${i}abcdefgh`), ...over } as Gallery);
    return id;
  };
  const tasks = (galleryId: string) => store.driveTasks.filter((t) => t.galleryId === galleryId).map((t) => `${t.kind}:${t.status}${t.parentId ? `:${t.parentId}` : ''}`);
  return { tid, store, call, gallery, tasks };
}

describe('the Drive folder of a gallery', () => {
  it('only Drive folders', () => {
    expect(driveFolderId({ folderProvider: 'gdrive', folderUrl: DRIVE('18SdKiTWZ1CJsdm4gSjH71xFAqhICDKK0') })).toBe('18SdKiTWZ1CJsdm4gSjH71xFAqhICDKK0');
    expect(driveFolderId({ folderProvider: 'dropbox-link', folderUrl: 'https://www.dropbox.com/scl/fo/x/y' })).toBeNull();
    expect(driveFolderId({ folderProvider: 'gdrive' })).toBeNull();
  });
});

describe('the star and the Drive folder', () => {
  it('starred: into "גלריות מועדפים"; unstarred before it moved: cancelled, nothing to move back', async () => {
    const { call, gallery, tasks } = await setup();
    const id = await gallery();
    expect((await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: true })).status).toBe(200);
    expect(tasks(id)).toEqual(['to_favorites:pending']);
    await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: false });
    expect(tasks(id)).toEqual(['to_favorites:cancelled']);
    // The same star again (nothing changed) writes nothing.
    await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: false });
    expect(tasks(id)).toEqual(['to_favorites:cancelled']);
  });

  it('moved before (the helper noted where from): unstarred → back there; starred again before that → cancelled', async () => {
    const { call, gallery, tasks } = await setup();
    const id = await gallery({ studioFavorite: true, drivePrevParent: 'octoberFolder123' });
    await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: false });
    expect(tasks(id)).toEqual(['restore:pending:octoberFolder123']);
    await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: true });
    expect(tasks(id)).toEqual(['restore:cancelled:octoberFolder123']);
  });

  it('a Dropbox gallery has no Drive work', async () => {
    const { call, gallery, tasks } = await setup();
    const id = await gallery({ folderProvider: 'dropbox-link', folderUrl: 'https://www.dropbox.com/scl/fo/x/y?rlkey=k' });
    await call('PUT', `/api/admin/galleries/${id}`, { studioFavorite: true });
    expect(tasks(id)).toEqual([]);
  });
});

describe('a starred gallery stays out of the trash', () => {
  it('one at a time and in a batch', async () => {
    const { call, gallery } = await setup();
    const starred = await gallery({ studioFavorite: true });
    const plain = await gallery();
    const one = await call('DELETE', `/api/admin/galleries/${starred}`);
    expect(one.status).toBe(409);
    expect(await one.json()).toMatchObject({ code: 'starred' });
    const batch = (await (await call('POST', '/api/admin/galleries/batch', { ids: [starred, plain], action: 'trash' })).json()) as { done: number; skipped: { id: string; reason: string }[] };
    expect(batch.skipped).toEqual([{ id: starred, reason: 'starred' }]);
    expect(batch.done).toBe(1);
  });
});

describe('removed for good → the Drive trash', () => {
  it('from the trash, one or many; a folder another gallery reads stays; a Dropbox folder is never touched', async () => {
    const { store, call, gallery, tasks } = await setup();
    const a = await gallery();
    const b = await gallery();
    const shared = await gallery();
    const sharer = await gallery({ folderUrl: (await store.getGallery(shared))!.folderUrl });
    const dropbox = await gallery({ folderProvider: 'dropbox-link', folderUrl: 'https://www.dropbox.com/scl/fo/z/w?rlkey=k' });
    for (const id of [a, b, shared, dropbox]) expect((await call('DELETE', `/api/admin/galleries/${id}`)).status).toBe(200);
    // In the trash: nothing yet (it may be restored).
    expect([a, b, shared, dropbox].flatMap(tasks)).toEqual([]);
    expect((await call('DELETE', `/api/admin/galleries/${a}?forever=1`)).status).toBe(200);
    expect(tasks(a)).toEqual(['trash:pending']);
    await call('POST', '/api/admin/galleries/batch', { ids: [b, shared, dropbox], action: 'purge' });
    expect(tasks(b)).toEqual(['trash:pending']);
    expect(tasks(shared)).toEqual([]);
    expect(tasks(dropbox)).toEqual([]);
    expect(await store.getGallery(sharer)).not.toBeNull();
  });

  it('two galleries of one folder removed together: the folder goes once', async () => {
    const { store, gallery } = await setup();
    const x = await gallery();
    const y = await gallery({ folderUrl: (await store.getGallery(x))!.folderUrl });
    const gx = (await store.getGallery(x))!;
    const gy = (await store.getGallery(y))!;
    await store.deleteGalleries(gx.tenantId, [x, y]);
    expect(await queueDriveTrash(store, [gx, gy])).toBe(1);
  });
});
