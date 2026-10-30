// Fix plan P88-b: worker/providers/gdrive.ts against a fake Google Drive API — a shared folder of
// films (every page of it), a single film, and each way Google says no, turned into a Hebrew message
// the studio can act on. The API key never ends up in a film's saved addresses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudContext } from '../worker/providers/context';
import { driveUrls, resolveDriveFile, resolveDriveFolder } from '../worker/providers/gdrive';
import type { Env, Settings } from '../worker/types';

const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const FILE = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654';
const ctx = (over: Partial<CloudContext> = {}): CloudContext => ({
  env: {} as Env,
  settings: { googleApiKey: 'TEST-KEY' } as Settings,
  origin: 'https://films.test',
  ...over,
});

type Answer = { status?: number; body: unknown };
function fakeDrive(answer: (url: URL) => Answer) {
  const calls: { url: URL; referer: string | null }[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, referer: new Headers(init?.headers).get('Referer') });
    const a = answer(url);
    return new Response(typeof a.body === 'string' ? a.body : JSON.stringify(a.body), { status: a.status ?? 200 });
  });
  return calls;
}
const file = (id: string, name: string, mimeType: string, size?: string) => ({ id, name, mimeType, ...(size ? { size } : {}) });

afterEach(() => vi.unstubAllGlobals());

describe('a shared folder', () => {
  it('lists every video on every page, skips folders and other files, and names the folder', async () => {
    const calls = fakeDrive((url) => {
      if (url.pathname.endsWith(`/files/${FOLDER}`)) return { body: file(FOLDER, 'Noa & Tom', 'application/vnd.google-apps.folder') };
      if (url.searchParams.get('pageToken') === 'p2') return { body: { files: [file('f3', 'חופה.mov', 'video/quicktime', '300')] } };
      return {
        body: {
          nextPageToken: 'p2',
          files: [file('f1', 'היילייטס.mp4', 'video/mp4', '100'), file('d1', 'raw', 'application/vnd.google-apps.folder'), file('p1', 'photo.jpg', 'image/jpeg', '5'), file('f2', 'clip', 'video/webm')],
        },
      };
    });
    const r = await resolveDriveFolder(ctx(), `https://drive.google.com/drive/folders/${FOLDER}?usp=sharing`);
    expect(r.folderName).toBe('Noa & Tom');
    expect(r.films.map((f) => f.fileId)).toEqual(['f1', 'f2', 'f3']);
    expect(r.films[0]).toMatchObject({ provider: 'gdrive', fileName: 'היילייטס.mp4', sizeBytes: 100, playable: true, watchUrl: '', sourceUrl: 'https://drive.google.com/file/d/f1/view' });
    expect(r.films[1]).toMatchObject({ sizeBytes: 0, playable: true }); // webm by its type, no size given
    expect(r.films[2].playable).toBe(false); // .mov is not played in the browser
    const list = calls.filter((c) => c.url.pathname.endsWith('/files'));
    expect(list).toHaveLength(2);
    expect(list[0].url.searchParams.get('q')).toBe(`'${FOLDER}' in parents and trashed = false`);
    expect(list[1].url.searchParams.get('pageToken')).toBe('p2');
    for (const c of calls) {
      expect(c.url.origin + '/').toBe('https://www.googleapis.com/');
      expect(c.url.searchParams.get('key')).toBe('TEST-KEY');
      expect(c.url.searchParams.get('supportsAllDrives')).toBe('true');
      expect(c.referer, 'the key is restricted to our site: say who we are').toBe('https://films.test/');
    }
    expect(JSON.stringify(r.films)).not.toContain('TEST-KEY');
  });
  it('a folder with no videos, a file link, or a file id behind a folder link are refused with a message', async () => {
    fakeDrive((url) => (url.pathname.endsWith('/files') ? { body: { files: [file('p1', 'photo.jpg', 'image/jpeg')] } } : { body: file(FOLDER, 'x', 'application/vnd.google-apps.folder') }));
    await expect(resolveDriveFolder(ctx(), `https://drive.google.com/drive/folders/${FOLDER}`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('לא נמצאו קבצי וידאו') });
    await expect(resolveDriveFolder(ctx(), `https://drive.google.com/file/d/${FILE}/view`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('לא לתיקייה') });
    fakeDrive(() => ({ body: file(FOLDER, 'a.mp4', 'video/mp4') }));
    await expect(resolveDriveFolder(ctx(), `https://drive.google.com/drive/folders/${FOLDER}`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('לא לתיקייה') });
  });
});

describe('a single film', () => {
  it('reads its name, size and type', async () => {
    const calls = fakeDrive(() => ({ body: file(FILE, 'סרט החתונה.mp4', 'video/mp4', '2048') }));
    const f = await resolveDriveFile(ctx(), `https://drive.google.com/file/d/${FILE}/view?usp=drive_link`);
    expect(f).toMatchObject({ fileId: FILE, fileName: 'סרט החתונה.mp4', sizeBytes: 2048, playable: true, watchUrl: '' });
    expect(f.downloadUrl).toContain('drive.usercontent.google.com');
    expect(calls[0].url.searchParams.get('fields')).toBe('id,name,mimeType,size');
  });
  it('a folder link in the film field is refused, before and after asking Google', async () => {
    await expect(resolveDriveFile(ctx(), `https://drive.google.com/drive/folders/${FOLDER}`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('זה קישור לתיקייה') });
    fakeDrive(() => ({ body: file(FILE, 'folder', 'application/vnd.google-apps.folder') }));
    await expect(resolveDriveFile(ctx(), `https://drive.google.com/file/d/${FILE}/view`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('זה קישור לתיקייה') });
  });
});

describe("Google's refusals become a message the studio can act on", () => {
  const attempt = (status: number, body: string) => {
    fakeDrive(() => ({ status, body }));
    return resolveDriveFile(ctx(), `https://drive.google.com/file/d/${FILE}/view`).catch((e: { status: number; message: string }) => e);
  };
  it('not shared / not found', async () => expect(await attempt(404, '{}')).toMatchObject({ status: 400, message: expect.stringContaining('כל מי שיש לו את הקישור') }));
  it('the Drive API is off in the key\'s project', async () => expect(await attempt(403, 'Google Drive API has not been used in project 1 before or it is disabled')).toMatchObject({ message: expect.stringContaining('לא מופעל') }));
  it('a bad or restricted key', async () => expect(await attempt(403, 'Requests from referer https://x are blocked. API_KEY_HTTP_REFERRER_BLOCKED')).toMatchObject({ message: expect.stringContaining('מפתח גוגל לא תקין') }));
  it('anything else: the status and the start of the answer', async () => expect(await attempt(500, 'backend error')).toMatchObject({ status: 400, message: expect.stringContaining('(500): backend error') }));
  it('no key saved: a message, and no request at all', async () => {
    const calls = fakeDrive(() => ({ body: {} }));
    await expect(resolveDriveFile(ctx({ settings: { googleApiKey: '' } as Settings }), `https://drive.google.com/file/d/${FILE}/view`)).rejects.toMatchObject({ status: 400, message: expect.stringContaining('מפתח גוגל') });
    expect(calls).toHaveLength(0);
  });
});

describe('preview mode and addresses', () => {
  it('CLOUD_MOCK answers without Google', async () => {
    const calls = fakeDrive(() => ({ body: {} }));
    const r = await resolveDriveFolder(ctx({ env: { CLOUD_MOCK: '1' } as Env }), `https://drive.google.com/drive/folders/${FOLDER}`);
    expect(r.films).toHaveLength(3);
    expect((await resolveDriveFile(ctx({ env: { CLOUD_MOCK: '1' } as Env }), `https://drive.google.com/file/d/${FILE}/view`)).fileId).toBe(FILE);
    expect(calls).toHaveLength(0);
  });
  it('a watch address only with a key; the download address never carries it', () => {
    expect(driveUrls(FILE, '').watchUrl).toBe('');
    expect(driveUrls(FILE, 'K').watchUrl).toContain('key=K');
    expect(driveUrls(FILE, 'K').downloadUrl).not.toContain('key=');
  });
});
