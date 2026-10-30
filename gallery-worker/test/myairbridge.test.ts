import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAB_LINK_GONE, parseMultistatus, resolveMabFolder } from '../worker/providers/myairbridge';
import type { CloudContext } from '../worker/providers';

// Shape taken from the MyAirBridge API documentation (d: = DAV:, m: = their namespace).
const XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:m="https://xml.myairbridge.cloud/ns">
  <d:response>
    <d:href>/dav/folder/abc/</d:href>
    <m:node-url>https://api.myairbridge.com/n/abc</m:node-url>
    <d:propstat><d:prop>
      <d:displayname>רוני ורז - 11.8.26</d:displayname>
      <d:resourcetype><d:collection/></d:resourcetype>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/folder/abc/Highlights%20Final.mp4</d:href>
    <m:node-url>https://api.myairbridge.com/n/f1</m:node-url>
    <d:propstat><d:prop>
      <d:displayname>Highlights Final.mp4</d:displayname>
      <d:getcontentlength>2460912400</d:getcontentlength>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/folder/abc/Tom%20&amp;%20Jerry.mov</d:href>
    <d:propstat><d:prop>
      <d:getcontentlength>100</d:getcontentlength>
      <d:resourcetype/>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

describe('MyAirBridge PROPFIND parsing', () => {
  const entries = parseMultistatus(XML, 'https://www.myairbridge.com/dav/folder/abc/');
  it('reads the folder itself first', () => {
    expect(entries[0]).toMatchObject({ name: 'רוני ורז - 11.8.26', isFolder: true });
  });
  it('reads files with size and prefers node-url', () => {
    expect(entries[1]).toMatchObject({ name: 'Highlights Final.mp4', size: 2460912400, isFolder: false, url: 'https://api.myairbridge.com/n/f1' });
  });
  it('falls back to href for the url and the name, decoding entities', () => {
    expect(entries[2].isFolder).toBe(false);
    expect(entries[2].name).toBe('Tom & Jerry.mov');
    expect(entries[2].url).toBe('https://www.myairbridge.com/dav/folder/abc/Tom%20&%20Jerry.mov');
  });
});

// Fix plan P65: an expired or removed transfer is said plainly, its page is never a file list, and the share's end
// date (when MyAirBridge gives one) is kept on each film for the studio's editor and the nightly check.
describe('MyAirBridge links that end', () => {
  const ctx = { env: {}, settings: {}, origin: 'https://site' } as unknown as CloudContext;
  afterEach(() => vi.unstubAllGlobals());

  it('a page, a 404 or an empty answer is "not valid or expired", not an empty folder', async () => {
    for (const res of [
      () => new Response('<html><body>This transfer has expired</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
      () => new Response('', { status: 404 }),
      () => new Response('<?xml version="1.0"?><error/>', { status: 207, headers: { 'Content-Type': 'application/xml' } }),
    ]) {
      vi.stubGlobal('fetch', async () => res());
      await expect(resolveMabFolder(ctx, 'https://mab.to/abc')).rejects.toThrow(MAB_LINK_GONE);
    }
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(resolveMabFolder(ctx, 'https://mab.to/abc')).rejects.toThrow('לא זמין כרגע');
  });

  it("keeps the share's end date on each film", async () => {
    const withExpiry = XML.replace('<d:displayname>רוני ורז - 11.8.26</d:displayname>', '<d:displayname>רוני ורז - 11.8.26</d:displayname><m:expiration-date>2026-11-01T10:00:00Z</m:expiration-date>');
    vi.stubGlobal('fetch', async () => new Response(withExpiry, { status: 207, headers: { 'Content-Type': 'application/xml' } }));
    const r = await resolveMabFolder(ctx, 'https://mab.to/abc');
    expect(r.films.map((f) => f.providerExpiresAt)).toEqual(['2026-11-01T10:00:00.000Z', '2026-11-01T10:00:00.000Z']);
    vi.stubGlobal('fetch', async () => new Response(XML, { status: 207, headers: { 'Content-Type': 'application/xml' } }));
    expect((await resolveMabFolder(ctx, 'https://mab.to/abc')).films[0].providerExpiresAt).toBeUndefined();
  });
});
