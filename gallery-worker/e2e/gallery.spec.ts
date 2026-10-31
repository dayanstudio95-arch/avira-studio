// End-to-end: the films Worker under CLOUD_MOCK with the in-memory store.
// Studios manage galleries from the StudioOS hub; here that is done straight
// through the admin API with a test session token. The couple's and the new
// couple's (studio) pages are driven in a real browser.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { readJpegInfo } from '../shared/print';
import { encodeChunk } from '../shared/faces';
// Layouts, read directly (the test runner can't import the JSON through shared/album.ts).
const LAYOUTS = JSON.parse(readFileSync(new URL('../shared/album-templates.json', import.meta.url), 'utf8')) as { templates: { id: string; slots: { x: number; y: number; w: number; h: number }[] }[] };
const template = (id: string) => LAYOUTS.templates.find((t) => t.id === id) ?? LAYOUTS.templates[0];

const STUDIO = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const OWNER = { Authorization: `Bearer test:owner1:${STUDIO}:owner` };
const OTHER_OWNER = { Authorization: `Bearer test:owner2:${OTHER}:owner` };
const FOLDER = 'https://www.dropbox.com/scl/fo/hjecwtz48w4x4cn9fzhhc/APatafn2WmVp90e3_ta1Wvo?rlkey=rt210l0oiiavsf9cple3u8hb7&st=fqtfhm2d&dl=0';

test.describe.configure({ mode: 'serial' });

async function seedStudio(request: APIRequestContext, data: Record<string, unknown>) {
  const r = await request.post('/api/__test/tenant', { data });
  expect(r.ok()).toBeTruthy();
}

let galleryId = '';

test('setup: two studios', async ({ request }) => {
  await seedStudio(request, {
    id: STUDIO,
    name: 'סטודיו של חבר',
    slug: 'friend',
    instagramUrl: 'https://instagram.com/friend.studio',
    phone: '050-1234567',
  });
  await seedStudio(request, { id: OTHER, name: 'סטודיו אחר', slug: 'other' });
});

test('the admin API needs a StudioOS session of a studio admin', async ({ request }) => {
  expect((await request.get('/api/admin/galleries')).status()).toBe(401);
  expect((await request.get('/api/admin/galleries', { headers: { Authorization: 'Bearer nope' } })).status()).toBe(401);
  const crew = { Authorization: `Bearer test:p1:${STUDIO}:photographer` };
  expect((await request.get('/api/admin/galleries', { headers: crew })).status()).toBe(403);
  expect((await request.get('/api/admin/galleries', { headers: OWNER })).status()).toBe(200);
  // The old password/cookie endpoints are gone.
  for (const path of ['/api/admin/setup', '/api/admin/login', '/api/admin/users', '/api/admin/site', '/api/join']) {
    expect((await request.post(path, { data: {} })).status()).toBe(404);
  }
});

test('an admin loads a Dropbox folder and creates a gallery', async ({ request }) => {
  const folder = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: FOLDER } })).json();
  expect(folder.films).toHaveLength(5);
  const g = await (
    await request.post('/api/admin/galleries', {
      headers: OWNER,
      data: { coupleName: 'רוני & רז', date: '2026-08-11', venue: 'אלה', folderUrl: FOLDER, films: folder.films },
    })
  ).json();
  expect(g.id).toMatch(/^[a-f0-9]{16}$/);
  expect(g.tenantId).toBe(STUDIO);
  galleryId = g.id;

  // Another studio can't see or touch it.
  expect((await request.get(`/api/admin/galleries/${galleryId}`, { headers: OTHER_OWNER })).status()).toBe(404);
  expect((await request.put(`/api/admin/galleries/${galleryId}`, { headers: OTHER_OWNER, data: { coupleName: 'x' } })).status()).toBe(404);
  expect(await (await request.get('/api/admin/galleries', { headers: OTHER_OWNER })).json()).toEqual([]);
});

test('the couple sees terms, hero and cinema; every link is ours', async ({ page }) => {
  await page.goto(`/friend/${galleryId}`);
  const enter = page.getByTestId('enter');
  await expect(enter).toBeDisabled();
  await page.getByTestId('agree').check();
  await enter.click();

  await expect(page.getByTestId('couple-name')).toHaveText('רוני & רז');
  await expect(page.getByText('סטודיו של חבר PRESENTS')).toBeVisible();
  await expect(page.getByText('11.8.26 · אלה').first()).toBeVisible();
  await expect(page.getByText('זמין לעוד 30 ימים')).toBeVisible();
  await expect(page.getByTestId('instagram')).toHaveAttribute('href', 'https://instagram.com/friend.studio');
  await expect.poll(() => page.getByTestId('hero-video').evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(0.5);
  expect(await page.getByTestId('hero-video').getAttribute('src')).toMatch(new RegExp(`^/api/watch/${galleryId}/film/\\d+$`));
  await page.getByTestId('watch').click();

  // Two sizes of the highlights become one film with a quality menu → 4 rows, not 5.
  await expect(page.getByTestId('film-row')).toHaveCount(4);
  const player = page.getByTestId('player');
  const startSrc = (await player.getAttribute('src'))!;
  expect(startSrc).toMatch(new RegExp(`^/api/watch/${galleryId}/film/\\d+$`));
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.5);

  // Quality menu: switch and keep the position.
  await page.getByTestId('quality').click();
  const menu = page.getByTestId('quality-menu');
  await expect(menu).toContainText('4K');
  await expect(menu).toContainText('1080p');
  const before = await player.evaluate((v: HTMLVideoElement) => v.currentTime);
  const current = (await page.getByTestId('download-current').textContent()) ?? '';
  const other = current.includes('4K') ? '1080p' : '4K';
  await menu.getByRole('button', { name: new RegExp(other) }).click();
  await expect(player).not.toHaveAttribute('src', startSrc);
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThanOrEqual(before - 0.5);
  await expect(page.getByTestId('download-current')).toContainText(other);

  // Downloads and "download all" go through our site, never straight to Dropbox.
  expect(await page.getByTestId('download-current').getAttribute('href')).toMatch(new RegExp(`^/api/watch/${galleryId}/film/\\d+\\?dl=1$`));
  expect(await page.getByTestId('download-all').getAttribute('href')).toBe(`/api/watch/${galleryId}/all`);

  // The MOV film is download-only.
  await page.getByTestId('film-row').nth(2).click();
  await expect(page.getByText('להורדה בלבד (הפורמט לא נתמך')).toBeVisible();

  // Terms are remembered for the session; close returns to the hero.
  await page.getByTestId('close').click();
  await expect(page.getByTestId('watch')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('watch')).toBeVisible();

  const data = await (await page.request.get(`/api/watch/${galleryId}`)).json();
  expect(data.films).toHaveLength(4);
  expect(data.studioName).toBe('סטודיו של חבר');
  expect(data.films[0].versions.map((v: { label: string }) => v.label)).toEqual(['4K', '1080p']);
  expect(JSON.stringify(data)).not.toContain('dropbox.com');
  expect(JSON.stringify(data)).not.toContain('dropboxusercontent');
});

test('an old or wrong studio part of the link still opens, at the studio\'s current address', async ({ page, request }) => {
  expect((await (await request.get(`/api/watch/${galleryId}`)).json()).slug).toBe('friend');
  await page.goto(`/old-name/${galleryId}`);
  await expect(page).toHaveURL(new RegExp(`/friend/${galleryId}$`));
  await expect(page.getByTestId('enter')).toBeVisible();
});

test('a closed gallery hides every link and refuses to stream; extending reopens it', async ({ page, request }) => {
  const r = await request.put(`/api/admin/galleries/${galleryId}`, { headers: OWNER, data: { expiresAt: '2026-01-01T00:00:00.000Z' } });
  expect(r.ok()).toBeTruthy();

  const closed = await (await request.get(`/api/watch/${galleryId}`)).json();
  expect(closed.expired).toBe(true);
  expect(closed.films).toEqual([]);
  expect(closed.folderDownloadUrl).toBe('');
  expect((await request.get(`/api/watch/${galleryId}/film/0`)).status()).toBe(410);
  expect((await request.get(`/api/watch/${galleryId}/all`)).status()).toBe(410);

  await page.goto(`/watch/${galleryId}`);
  await expect(page.getByTestId('expired')).toContainText('הגלריה נסגרה');

  const ext = await request.post(`/api/admin/galleries/${galleryId}/extend`, { headers: OWNER, data: { days: 10 } });
  expect(ext.ok()).toBeTruthy();
  const reopened = await (await request.get(`/api/watch/${galleryId}`)).json();
  expect(reopened.expired).toBe(false);
  expect(reopened.daysLeft).toBe(10);
  expect(reopened.films).toHaveLength(4);
});

test('films stream with Range support', async ({ request }) => {
  const head = await request.head(`/api/watch/${galleryId}/film/0`);
  expect(head.status()).toBe(200);
  expect(head.headers()['content-type']).toContain('video/mp4');
  const part = await request.get(`/api/watch/${galleryId}/film/0`, { headers: { Range: 'bytes=0-99' } });
  expect([200, 206]).toContain(part.status());
});

test('Google Drive: the key stays on the server', async ({ request }) => {
  const folder = await (
    await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing' } })
  ).json();
  expect(folder.provider).toBe('gdrive');
  expect(JSON.stringify(folder)).not.toContain('AIza');
  const g = await (
    await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'נועה & איתי', folderUrl: folder.folderUrl, films: folder.films } })
  ).json();
  const pub = await (await request.get(`/api/watch/${g.id}`)).json();
  expect(pub.films.map((f: { tag: string }) => f.tag)).toEqual(['highlights', 'ceremony', 'feature']);
  expect(JSON.stringify(pub)).not.toContain('AIza');
  expect(JSON.stringify(pub)).not.toContain('googleapis.com');
  expect(pub.films[1].watchUrl).toBe(`/api/watch/${g.id}/film/1`);
  // Drive's own folder page stays the "download all" (it zips there).
  expect(pub.folderDownloadUrl).toBe('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv');
});

test('MyAirBridge links stay direct (they cannot be proxied)', async ({ request }) => {
  const folder = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: 'https://mab.to/AbC123xyz' } })).json();
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'מאב', folderUrl: folder.folderUrl, films: folder.films } })).json();
  const pub = await (await request.get(`/api/watch/${g.id}`)).json();
  expect(pub.folderProvider).toBe('myairbridge');
  const teaser = pub.films.find((f: { title: string }) => /טיזר|Teaser/i.test(f.title)) ?? pub.films[0];
  expect(teaser.watchUrl).toMatch(/^https:\/\/mock\.myairbridge\.com\//);
});

test('bulk import and settings', async ({ request }) => {
  const created = await (
    await request.post('/api/admin/galleries/bulk', { headers: OWNER, data: { items: [{ coupleName: 'א & ב', date: '2027-01-01' }, { coupleName: 'ג & ד' }] } })
  ).json();
  expect(created).toHaveLength(2);
  expect((await request.post('/api/admin/galleries/bulk', { headers: OWNER, data: { items: [{ coupleName: '' }] } })).status()).toBe(400);

  const put = await request.put('/api/admin/settings', { headers: OWNER, data: { defaultDays: 45, contactLine: 'לשאלות: 050-1234567' } });
  expect(put.ok()).toBeTruthy();
  const s = await put.json();
  expect(s.defaultDays).toBe(45);
  expect(s.slug).toBe('friend');
  expect(JSON.stringify(s)).not.toContain('AIza');
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'ה & ו' } })).json();
  expect(g.days).toBe(45);

  // Slugs: taken and reserved ones are refused.
  expect((await request.put('/api/admin/settings', { headers: OWNER, data: { slug: 'other' } })).status()).toBe(400);
  expect((await request.put('/api/admin/settings', { headers: OWNER, data: { slug: 'admin' } })).status()).toBe(400);
});

test('an unpaid studio keeps serving couples but cannot change anything; a suspended one serves nobody', async ({ request }) => {
  await seedStudio(request, { id: STUDIO, access: 'read_only' });
  expect((await request.get('/api/admin/galleries', { headers: OWNER })).status()).toBe(200);
  expect((await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'ז' } })).status()).toBe(402);
  expect((await request.get(`/api/watch/${galleryId}`)).status()).toBe(200);

  await seedStudio(request, { id: STUDIO, access: 'blocked' });
  expect((await request.get('/api/admin/galleries', { headers: OWNER })).status()).toBe(403);
  expect((await request.get(`/api/watch/${galleryId}`)).status()).toBe(404);
  expect((await request.get(`/api/watch/${galleryId}/film/0`)).status()).toBe(404);

  await seedStudio(request, { id: STUDIO, access: 'ok' });
});

test('studio page: films, reviews, contact, and a lead that reaches the hub', async ({ page, request }) => {
  // Disabled by default.
  expect((await request.get('/api/studio/friend')).status()).toBe(404);

  const folder = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: FOLDER } })).json();
  await request.put('/api/admin/settings', { headers: OWNER, data: { headline: 'סרטי חתונה מהלב' } });
  const saved = await request.put('/api/admin/studio', {
    headers: OWNER,
    data: {
      enabled: true,
      mit4mitUrl: 'https://www.mit4mit.co.il/biz/15100',
      showcase: { folderUrl: FOLDER, films: folder.films },
      reviews: [{ name: 'נועה & איתי', text: 'הסרט הכי מרגש שראינו. ממליצים בחום!', score: 100, visible: true, source: 'manual' }],
    },
  });
  expect(saved.ok()).toBeTruthy();

  await page.goto('/friend');
  await expect(page.getByRole('heading', { name: 'סרטי חתונה מהלב' })).toBeVisible();
  const rows = page.getByTestId('studio-row');
  await expect(rows.first()).toContainText('הייליטס');
  await expect(page.getByTestId('studio-review')).toContainText('הסרט הכי מרגש שראינו');
  await expect(page.getByTestId('studio-mit4mit')).toHaveAttribute('href', 'https://www.mit4mit.co.il/biz/15100');
  await expect(page.getByTestId('studio-phone')).toHaveText('050-1234567');
  await expect(page.getByTestId('socials').first().locator('a[href="https://wa.me/972501234567"]')).toHaveCount(1);

  // Leave details.
  await page.getByTestId('studio-cta').click();
  await page.getByTestId('lead-names').fill('שני ועומר');
  await page.getByTestId('lead-phone').fill('052-7654321');
  await page.getByTestId('lead-date').fill('2027-05-20');
  await page.getByTestId('lead-venue').fill('חוות רונית');
  await page.getByTestId('lead-guests').fill('350');
  await page.getByTestId('lead-submit').click();
  await expect(page.getByTestId('lead-sent')).toContainText('תודה');

  // It lands in the hub's leads (here: the in-memory store), for this studio only.
  const leads = await (await request.get('/api/__test/leads')).json();
  expect(leads[0]).toMatchObject({ tenantId: STUDIO, lead: { coupleName: 'שני & עומר', venue: 'חוות רונית', guests: '350', date: '2027-05-20' } });

  // Spam protection: honeypot, missing phone, and the 6th lead within the hour.
  const post = (data: object) => request.post('/api/studio/friend/lead', { data });
  expect((await post({ coupleName: 'בוט', phone: '0501234567', website: 'http://spam' })).status()).toBe(400);
  expect((await post({ coupleName: 'בלי טלפון', phone: '' })).status()).toBe(400);
  for (let i = 0; i < 4; i++) expect((await post({ coupleName: `זוג ${i}`, phone: '0501234567' })).status()).toBe(200);
  expect((await post({ coupleName: 'עוד אחד', phone: '0501234567' })).status()).toBe(429);

  // Turning the page off hides it again.
  await request.put('/api/admin/studio', { headers: OWNER, data: { enabled: false } });
  await page.goto('/friend');
  await expect(page.getByText('הדף לא פעיל')).toBeVisible();
});

test('the hub may call the admin API from its own origin (CORS)', async ({ request }) => {
  const pre = await request.fetch('/api/admin/galleries', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5273', 'Access-Control-Request-Method': 'GET' } });
  expect(pre.status()).toBe(204);
  expect(pre.headers()['access-control-allow-origin']).toBe('http://localhost:5273');
  expect(pre.headers()['access-control-allow-headers']).toContain('Authorization');
});

test('Dropbox connect is finished by the signed-in admin who started it', async ({ request }) => {
  // The callback never finishes the connection itself; it hands the code back to the hub.
  const cb = await request.get('/api/admin/dropbox/callback?code=abc&state=forged', { maxRedirects: 0 });
  expect(cb.status()).toBe(302);
  expect(cb.headers()['location']).toContain('dropbox=error');
  // A forged or foreign state is refused at /finish.
  const r = await request.post('/api/admin/dropbox/finish', { headers: OWNER, data: { code: 'abc', state: 'forged' } });
  expect(r.status()).toBe(400);
});


// ---------- ported from the Avira films app, phase 1 (docs/port-from-avira-films.md) ----------

test('pCloud: a film gallery from a pCloud link plays through our site', async ({ request }) => {
  const PCLOUD = 'https://u.pcloud.link/publink/show?code=XZtestFolder123456';
  const resolved = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: PCLOUD } })).json();
  expect(resolved.provider).toBe('pcloud');
  expect(resolved.films.map((f: { title: string; provider: string }) => [f.title, f.provider])).toEqual([
    ['Highlights', 'pcloud'],
    ['Full Film', 'pcloud'],
  ]);
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'נועה & איתי', date: '2026-10-01', folderUrl: PCLOUD, films: resolved.films } })).json();
  expect(g.folderProvider).toBe('pcloud');
  const view = await (await request.get(`/api/watch/${g.id}`)).json();
  // pCloud films play through our site (seeking and downloads work, the link stays private, closing stops them).
  expect(view.films[0].watchUrl).toBe(`/api/watch/${g.id}/film/0`);
  const clip = await request.get(view.films[0].watchUrl, { headers: { Range: 'bytes=0-99' } });
  expect([200, 206]).toContain(clip.status());
  // A film edited in the browser to point elsewhere is refused.
  const bad = await request.put(`/api/admin/galleries/${g.id}`, { headers: OWNER, data: { films: [{ ...resolved.films[0], provider: 'pcloud', fileId: 'https://evil.example/x#1' }] } });
  expect(bad.status()).toBe(400);
});

test('films: the studio types chapters, the couple jumps between them', async ({ browser, request }) => {
  const folder = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: FOLDER } })).json();
  const films = folder.films.map((f: { tag: string }, i: number) => (i === 0 ? { ...f, chapters: [{ t: 0, title: 'התארגנות' }, { t: 2, title: 'חופה' }, { t: 2, title: 'כפול' }] } : f));
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'פרקים & זמנים', films, folderUrl: FOLDER } })).json();
  expect(g.films[0].chapters).toEqual([
    { t: 0, title: 'התארגנות' },
    { t: 2, title: 'חופה' },
  ]);
  const pub = await (await request.get(`/api/watch/${g.id}`)).json();
  const withChapters = pub.films.findIndex((f: { chapters: unknown[] }) => f.chapters.length === 2);
  expect(withChapters).toBeGreaterThanOrEqual(0);

  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  await couple.goto(`/friend/${g.id}`);
  await couple.getByTestId('agree').check();
  await couple.getByTestId('enter').click();
  await couple.getByTestId('watch').click();
  // Film rows work from the keyboard.
  await couple.getByTestId('film-row').nth(withChapters).focus();
  await couple.keyboard.press('Enter');
  await expect(couple.getByTestId('chapter')).toHaveCount(2);
  await couple.getByTestId('chapter').nth(1).click();
  await expect.poll(() => couple.getByTestId('player').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThanOrEqual(1.9);
});

test('couple experience: WhatsApp preview, home screen, terms record, accessibility, no-connection retry', async ({ browser, request }) => {
  // What WhatsApp sees: the couple, the date and venue, and "add to home screen" details.
  const html = await (await request.get(`/friend/${galleryId}`)).text();
  expect(html).toContain('<meta property="og:title" content="רוני &amp; רז · 11.8.26 · אלה">');
  expect(html).toContain('<title>רוני &amp; רז · 11.8.26 · אלה</title>');
  expect(html).toContain('סטודיו של חבר');
  expect(html).toContain('noindex'); // couples' galleries stay out of search results
  expect(html).toContain(`rel="manifest" href="/api/manifest/${galleryId}"`);
  const manifest = await (await request.get(`/api/manifest/${galleryId}`)).json();
  expect(manifest.short_name).toBe('רוני & רז');
  expect(manifest.start_url).toBe(`/friend/${galleryId}`);
  // Other addresses are the plain page.
  expect(await (await request.get('/watch/0000000000000000')).text()).not.toContain('og:title');
  expect(await (await request.get('/accessibility')).text()).not.toContain('og:title');

  // The couple accepted the terms earlier in this run: the studio sees when.
  const g = await (await request.get(`/api/admin/galleries/${galleryId}`, { headers: OWNER })).json();
  expect(g.terms.count).toBeGreaterThanOrEqual(1);
  expect(Date.parse(g.terms.first)).toBeGreaterThan(Date.now() - 3600_000);

  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  // No connection at first: a clear message and "try again", not "link not found".
  await couple.route(`**/api/watch/${galleryId}`, (route) => route.abort('internetdisconnected'));
  await couple.goto(`/friend/${galleryId}`);
  await expect(couple.getByTestId('offline')).toBeVisible();
  await couple.unroute(`**/api/watch/${galleryId}`);
  await couple.getByTestId('retry').click();
  await expect(couple.getByTestId('agree')).toBeVisible();
  // The terms window closes with Esc.
  await couple.getByRole('button', { name: 'תקנון השירות' }).first().click();
  await expect(couple.getByRole('dialog')).toBeVisible();
  await couple.keyboard.press('Escape');
  await expect(couple.getByRole('dialog')).toHaveCount(0);

  // The accessibility statement, with the studio's own name and contact.
  await couple.goto(`/accessibility?g=${galleryId}`);
  await expect(couple.getByTestId('accessibility')).toContainText('הצהרת נגישות');
  await expect(couple.getByTestId('accessibility')).toContainText('סטודיו של חבר');
  await expect(couple.getByTestId('accessibility')).toContainText('050-1234567');
});

test('the studio page is indexed and previewed with the studio name (only while it is on)', async ({ request }) => {
  await request.put('/api/admin/studio', { headers: OWNER, data: { enabled: true } });
  const html = await (await request.get('/friend')).text();
  expect(html).toContain('<meta property="og:title" content="סטודיו של חבר">');
  expect(html).not.toContain('noindex');
  expect(await (await request.get('/no-such-studio')).text()).not.toContain('og:title');
  await request.put('/api/admin/studio', { headers: OWNER, data: { enabled: false } });
  expect(await (await request.get('/friend')).text()).not.toContain('og:title');
});

test('safety: broken addresses are refused and answers carry nosniff', async ({ request }) => {
  expect((await request.get('/api/watch/%E0%A4%A')).status()).toBe(400);
  const r = await request.get(`/api/watch/${galleryId}`);
  expect(r.headers()['x-content-type-options']).toBe('nosniff');
  // Terms can only be recorded for a real, open gallery.
  expect((await request.post('/api/watch/0000000000000000/terms')).status()).toBe(404);
});

// ---------- phase 2: photo galleries (API) ----------

let photoId = '';

test('photos: a studio loads a folder into a photo gallery; sets come from folder names', async ({ request }) => {
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'שיר & עומר', date: '2026-07-01' } })).json();
  expect(g.kind).toBe('photos');
  photoId = g.id;
  const loaded = await (await request.post(`/api/admin/galleries/${photoId}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  expect(loaded.items).toHaveLength(30);
  const set = (name: string) => loaded.sets.find((s: { name: string }) => s.name === name)?.id;
  expect(loaded.items.filter((i: { set: string }) => i.set === set('התארגנות'))).toHaveLength(10);
  expect(loaded.previewToken).toBeTruthy();
  expect((await (await request.get(`/api/admin/galleries/${photoId}`, { headers: OWNER })).json()).photoCount).toBe(30);
  // MyAirBridge is for films only.
  const mab = await request.post(`/api/admin/galleries/${photoId}/photos/load`, { headers: OWNER, data: { url: 'https://mab.to/abcdef12' } });
  expect(mab.status()).toBe(400);
  // Another studio can't read or change it.
  expect((await request.get(`/api/admin/galleries/${photoId}/photos`, { headers: OTHER_OWNER })).status()).toBe(404);
});

test('photos: the couple sees what the studio shows; hidden photos stay hidden, also by address', async ({ request }) => {
  const admin = await (await request.get(`/api/admin/galleries/${photoId}/photos`, { headers: OWNER })).json();
  const [first, second] = admin.items;
  const edited = await (await request.put(`/api/admin/galleries/${photoId}/photos`, { headers: OWNER, data: { items: { [second.key]: { hidden: true } }, cover: first.key } })).json();
  expect(edited.items.find((i: { key: string }) => i.key === second.key).hidden).toBe(true);

  const view = await (await request.get(`/api/watch/${photoId}`)).json();
  expect(view.kind).toBe('photos');
  expect(view.photos.items).toHaveLength(29);
  expect(JSON.stringify(view.photos)).not.toContain('m:/'); // no file locations
  expect(view.photos.cover).toBe(first.key);
  const img = await request.get(`/api/photos/${photoId}/${first.key}?s=m`);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/');
  const dl = await request.get(`/api/photos/${photoId}/${first.key}?s=full&dl=1`);
  expect(dl.headers()['content-disposition']).toContain('IMG_');
  // Hidden: 404 for everyone, except the studio's own screens (preview token).
  expect((await request.get(`/api/photos/${photoId}/${second.key}?s=m`)).status()).toBe(404);
  expect((await request.get(`/api/photos/${photoId}/${second.key}?s=m&pt=${encodeURIComponent(admin.previewToken)}`)).status()).toBe(200);
  expect((await request.get(`/api/photos/${photoId}/${second.key}?s=m&pt=forged`)).status()).toBe(404);
});

test('photos: hearts by name; only shown photos; the studio sees who hearted what', async ({ request }) => {
  const view = await (await request.get(`/api/watch/${photoId}`)).json();
  const [a, b] = view.photos.items;
  await request.post(`/api/watch/${photoId}/fav`, { data: { key: a.key, on: true, who: 'מאי' } });
  await request.post(`/api/watch/${photoId}/fav`, { data: { key: a.key, on: true, who: 'אמא' } });
  const r = await (await request.post(`/api/watch/${photoId}/fav`, { data: { key: b.key, on: true } })).json();
  expect(r.favorites).toEqual([a.key, b.key]);
  expect(r.favBy[a.key]).toEqual(['מאי', 'אמא']);
  const admin = await (await request.get(`/api/admin/galleries/${photoId}/photos`, { headers: OWNER })).json();
  expect(admin.favBy[b.key]).toEqual(['']);
  // A hidden photo or a made-up key can't be hearted.
  const hidden = admin.items.find((i: { hidden?: boolean }) => i.hidden);
  expect((await request.post(`/api/watch/${photoId}/fav`, { data: { key: hidden.key, on: true } })).status()).toBe(404);
  expect((await request.post(`/api/watch/${photoId}/fav`, { data: { key: 'zzzz', on: true } })).status()).toBe(404);
  // Not on a film gallery.
  expect((await request.post(`/api/watch/${galleryId}/fav`, { data: { key: a.key, on: true } })).status()).toBe(404);
});

test('photos: the couple\'s films and photos link to each other', async ({ request }) => {
  const linked = await (await request.put(`/api/admin/galleries/${photoId}/link`, { headers: OWNER, data: { linkedId: galleryId } })).json();
  expect(linked.linkedId).toBe(galleryId);
  expect((await (await request.get(`/api/watch/${galleryId}`)).json()).linked).toEqual({ kind: 'photos', path: `/friend/${photoId}` });
  expect((await (await request.get(`/api/watch/${photoId}`)).json()).linked).toEqual({ kind: 'films', path: `/friend/${galleryId}` });
  // Two galleries of the same kind can't be linked.
  const films2 = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'ז' } })).json();
  expect((await request.put(`/api/admin/galleries/${galleryId}/link`, { headers: OWNER, data: { linkedId: films2.id } })).status()).toBe(400);
  // Deleting one side unlinks the other.
  await request.delete(`/api/admin/galleries/${films2.id}`, { headers: OWNER });
});

test('photos: the module decides; films-only and photos-only studios each get their own', async ({ request }) => {
  await seedStudio(request, { id: STUDIO, films: true, photos: false });
  expect((await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'x' } })).status()).toBe(402);
  expect((await request.get(`/api/watch/${photoId}`)).status()).toBe(404);
  expect((await request.get(`/api/admin/galleries/${photoId}/photos`, { headers: OWNER })).status()).toBe(402);
  // And the film gallery stops showing the link to photos the studio no longer has.
  expect((await (await request.get(`/api/watch/${galleryId}`)).json()).linked).toBeNull();

  await seedStudio(request, { id: STUDIO, films: false, photos: true });
  expect((await request.get(`/api/watch/${galleryId}`)).status()).toBe(404);
  expect((await request.get(`/api/watch/${photoId}`)).status()).toBe(200);
  expect((await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName: 'x' } })).status()).toBe(402);
  expect((await request.get('/api/admin/studio', { headers: OWNER })).status()).toBe(402);

  await seedStudio(request, { id: STUDIO, films: true, photos: true });
});

test('photos: the WhatsApp card shows the cover photo', async ({ request }) => {
  const html = await (await request.get(`/friend/${photoId}`)).text();
  expect(html).toContain('<meta property="og:title" content="שיר &amp; עומר · 1.7.26">');
  // With the gallery's generation (P66): a new file is a new address for WhatsApp too.
  const gen = (await (await request.get(`/api/admin/galleries/${photoId}/photos`, { headers: OWNER })).json()).gen;
  expect(gen).toBeGreaterThan(0);
  expect(html).toMatch(new RegExp(`og:image" content="https?://[^/"]+/api/photos/${photoId}/v${gen}/[0-9a-f]{8}\\?s=md"`));
  expect(html).toContain('גלריית התמונות');
});

// ---------- phase 2b: the couple's photo gallery (browser) ----------

test('photos: the couple browses sets, opens photos, hearts by name, downloads; Back closes a photo', async ({ browser, request }) => {
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'נועה & איתי', date: '2026-06-28', venue: 'גן הפקאן' } })).json();
  const loaded = await (await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items: { [loaded.items[29].key]: { hidden: true } }, cover: loaded.items[2].key } });

  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } })).newPage();
  await couple.goto(`/friend/${g.id}`);
  await expect(couple.getByTestId('enter')).toContainText('כניסה לגלריה');
  await couple.getByTestId('agree').check();
  await couple.getByTestId('enter').click();
  await expect(couple.getByTestId('pg-title')).toHaveText('נועה & איתי');
  await expect(couple.getByTestId('pg-cover')).toHaveAttribute('style', new RegExp(`${loaded.items[2].key}\\?s=l`));
  await couple.getByTestId('pg-enter').click();
  // Avira: no "everything" tab — the page opens on the first set (התארגנות, 10 photos).
  await expect(couple.getByTestId('pg-tabs').getByText('הכל', { exact: true })).toHaveCount(0);
  await expect(couple.getByTestId('pg-tab').first()).toHaveClass(/on/);
  await expect(couple.getByTestId('pg-other-tab')).toHaveCount(0);
  await expect(couple.getByTestId('pg-photo')).toHaveCount(10);
  await expect(couple.getByTestId('pg-expiry')).toContainText('פתוחה');
  // Every photo's address has the gallery's generation (P66): the browser keeps it a year, a new file is a new address.
  const srcs = await couple.getByTestId('pg-photo').locator('img').evaluateAll((els) => els.map((e) => e.getAttribute('src') ?? ''));
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) expect(src).toMatch(new RegExp(`^/api/photos/${g.id}/v${loaded.gen}/[0-9a-f]{8}\\?s=m$`));
  const first = await couple.request.get(srcs[0]);
  expect(first.status()).toBe(200);
  expect(first.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

  // Sets from the folder names; tabs filter.
  await couple.getByTestId('pg-tab').filter({ hasText: 'מסיבה' }).click();
  await expect(couple.getByTestId('pg-photo')).toHaveCount(9);
  expect(couple.url()).toContain('set=');
  await couple.getByTestId('pg-tab').first().click();
  await expect(couple.getByTestId('pg-photo')).toHaveCount(10);

  // Full screen: moves with the arrows; Back closes it and the gallery stays.
  await couple.getByTestId('pg-photo').first().locator('img').click();
  await expect(couple.getByTestId('lb-count')).toHaveText('1 / 10');
  expect(couple.url()).toContain('photo=');
  await couple.keyboard.press('ArrowLeft');
  await expect(couple.getByTestId('lb-count')).toHaveText('2 / 10');
  // The first heart asks who is choosing.
  await couple.getByTestId('lb-fav').click();
  await couple.getByTestId('who-name').fill('מאי');
  await couple.getByTestId('who-save').click();
  await expect(couple.getByTestId('who-dialog')).toHaveCount(0);
  // Download: full quality or a small copy.
  await couple.getByTestId('lb-download').click();
  await expect(couple.getByTestId('download-menu')).toBeVisible();
  const dl = couple.waitForEvent('download');
  await couple.getByTestId('download-small').click();
  expect((await dl).suggestedFilename()).toMatch(/-small\.jpg$/);
  await couple.goBack();
  await expect(couple.getByTestId('lightbox')).toHaveCount(0);
  expect(couple.url()).not.toContain('photo=');
  await expect(couple.getByTestId('photo-gallery')).toBeVisible();

  // Two more hearts from the grid → 3; the favourites tab and the 150 guide.
  for (const n of [5, 6]) {
    await couple.getByTestId('pg-photo').nth(n).hover();
    await couple.getByTestId('pg-photo').nth(n).getByTestId('pg-heart').click();
  }
  await expect(couple.getByTestId('pg-fav-count')).toHaveText('3');
  await expect(couple.getByTestId('pg-favbar')).toContainText('בחרתם 3 · מומלץ 150 לאלבום');
  await couple.getByTestId('pg-fav-tab').click();
  await expect(couple.getByTestId('pg-photo')).toHaveCount(3);
  await expect(couple.getByTestId('pg-who').first()).toContainText('מאי');

  // The studio sees who chose what.
  const admin = await (await request.get(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER })).json();
  expect(admin.favorites).toHaveLength(3);
  expect(Object.values(admin.favBy).flat()).toEqual(['מאי', 'מאי', 'מאי']);

  // A link to one photo opens it, in its own set even when the link has no set (the terms are remembered on this device).
  await couple.goto(`/friend/${g.id}?photo=${loaded.items[4].key}`);
  await expect(couple.getByTestId('lb-count')).toHaveText('5 / 10');
  await couple.keyboard.press('Escape');
  await expect(couple.getByTestId('lightbox')).toHaveCount(0);

  // Photos in no set have their own tab at the end; it goes when the last of them is put in a set.
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items: { [loaded.items[0].key]: { set: null }, [loaded.items[1].key]: { set: null } } } });
  await couple.goto(`/friend/${g.id}?set=more`);
  await expect(couple.getByTestId('pg-other-tab')).toHaveText('תמונות נוספות');
  await expect(couple.getByTestId('pg-other-tab')).toHaveClass(/on/);
  await expect(couple.getByTestId('pg-photo')).toHaveCount(2);
  await couple.getByTestId('pg-tab').first().click();
  await expect(couple.getByTestId('pg-photo')).toHaveCount(8);
  const firstSet = admin.items.find((i: { key: string; set?: string }) => i.key === loaded.items[2].key).set;
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items: { [loaded.items[0].key]: { set: firstSet }, [loaded.items[1].key]: { set: firstSet } } } });
  await couple.goto(`/friend/${g.id}?set=more`);
  await expect(couple.getByTestId('pg-other-tab')).toHaveCount(0);
  await expect(couple.getByTestId('pg-photo')).toHaveCount(10);

  // Closed: the couple is told, and the photos stop.
  await request.put(`/api/admin/galleries/${g.id}`, { headers: OWNER, data: { expiresAt: '2026-01-01T00:00:00.000Z' } });
  expect((await request.get(`/api/photos/${g.id}/${loaded.items[0].key}?s=m`)).status()).toBe(410);
  expect((await request.post(`/api/watch/${g.id}/fav`, { data: { key: loaded.items[0].key, on: true } })).status()).toBe(410);
  // …but the studio's own screens still see the previews.
  expect((await request.get(`/api/photos/${g.id}/${loaded.items[0].key}?s=m&pt=${encodeURIComponent(admin.previewToken)}`)).status()).toBe(200);
  await couple.reload();
  await expect(couple.getByText('התמונות אינן זמינות')).toBeVisible();
});

test('photos and films: each page leads to the other', async ({ page }) => {
  await page.goto(`/friend/${galleryId}`);
  await page.getByTestId('agree').check();
  await page.getByTestId('enter').click();
  await expect(page.getByTestId('to-photos')).toHaveAttribute('href', `/friend/${photoId}`);
  await page.getByTestId('to-photos').click();
  await page.getByTestId('agree').check();
  await page.getByTestId('enter').click();
  await page.getByTestId('pg-enter').click();
  await expect(page.getByTestId('to-films-bar')).toHaveAttribute('href', `/friend/${galleryId}`);
});

// ---------- phase 3: songs, slideshow, ZIP, Instagram marks ----------

test('photos: people heart by name, the studio song plays in the slideshow, a ZIP of the favourites, Instagram marks', async ({ browser, request }) => {
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'מאי & אופק' } })).json();
  const id = g.id;
  const loaded = await (await request.post(`/api/admin/galleries/${id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  const [k1, k2, k3] = loaded.items.map((p: { key: string }) => p.key);

  // The studio's song (any bytes do for the test) becomes the default for its galleries.
  const up = await request.post('/api/admin/music', { headers: { ...OWNER, 'Content-Type': 'audio/mpeg', 'X-File-Name': encodeURIComponent('שיר החתונה.mp3') }, data: Buffer.from('ID3fake-mp3-bytes-for-the-test') });
  expect(up.ok()).toBeTruthy();
  const settings = await up.json();
  expect(settings.music[0].name).toBe('שיר החתונה');
  expect(settings.musicDefault).toBe(settings.music[0].id);
  expect((await request.post('/api/admin/music', { headers: { ...OWNER, 'Content-Type': 'text/plain' }, data: 'x' })).status()).toBe(400);
  const withMusic = await (await request.get(`/api/watch/${id}`)).json();
  expect(withMusic.photos.music).toBe(`/api/music/${STUDIO}/${settings.music[0].id}`);
  const part = await request.get(withMusic.photos.music, { headers: { Range: 'bytes=0-2' } });
  expect(part.status()).toBe(206);
  expect(await part.text()).toBe('ID3');
  // A gallery can be silent.
  await request.put(`/api/admin/galleries/${id}`, { headers: OWNER, data: { music: 'none' } });
  expect((await (await request.get(`/api/watch/${id}`)).json()).photos.music).toBe('');
  expect((await request.put(`/api/admin/galleries/${id}`, { headers: OWNER, data: { music: 'notmysong1' } })).status()).toBe(400);
  await request.put(`/api/admin/galleries/${id}`, { headers: OWNER, data: { music: '' } });

  const open = async () => {
    const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } });
    await ctx.addInitScript(() => {
      // Test the in-memory ZIP (the "save to disk" window can't be clicked in a test).
      delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
    const p = await ctx.newPage();
    await p.goto(`/friend/${id}`);
    await p.getByTestId('agree').check();
    await p.getByTestId('enter').click();
    await p.getByTestId('pg-enter').click();
    const cell = (key: string) => p.getByTestId('pg-photo').filter({ has: p.locator(`img[src*="${key}"]`) });
    const heart = async (key: string) => {
      await cell(key).hover();
      await cell(key).getByTestId('pg-heart').click();
    };
    return { p, heart, cell };
  };
  // Two people on two devices, each with a name.
  const bride = await open();
  await bride.heart(k1);
  await bride.p.getByTestId('who-name').fill('מאי');
  await bride.p.getByTestId('who-save').click();
  await bride.heart(k2);
  const mom = await open();
  await mom.heart(k2);
  await mom.p.getByTestId('who-name').fill('אמא');
  await mom.p.getByTestId('who-save').click();
  await mom.heart(k3);
  await expect(mom.p.getByTestId('pg-fav-count')).toHaveText('3');
  await mom.p.getByTestId('pg-fav-tab').click();
  await expect(mom.p.getByTestId('pg-person')).toHaveCount(2);
  await expect(mom.cell(k2).getByTestId('pg-who')).toHaveText('♥ מאי, אמא');
  await mom.p.getByTestId('pg-person').filter({ hasText: 'מאי' }).click();
  await expect(mom.p.getByTestId('pg-photo')).toHaveCount(2);

  // Slideshow of the open set (Avira: the page opens on the first set, 10 photos), with the song.
  const p = bride.p;
  await p.getByTestId('pg-slideshow').click();
  await expect(p.getByTestId('slideshow')).toBeVisible();
  await expect(p.getByTestId('ss-count')).toHaveText('1 / 10');
  await expect(p.locator('.slideshow audio')).toHaveAttribute('src', withMusic.photos.music);
  await p.getByTestId('ss-next').click();
  await expect(p.getByTestId('ss-count')).toHaveText('2 / 10');
  await p.keyboard.press('Escape');
  await expect(p.getByTestId('slideshow')).toHaveCount(0);

  // The favourites as one ZIP, in the small quality.
  await p.getByTestId('pg-download-all').click();
  await expect(p.getByTestId('zip-dialog')).toBeVisible();
  await p.getByLabel('המועדפים').check();
  await p.getByTestId('zip-small').check();
  const [download] = await Promise.all([p.waitForEvent('download'), p.getByTestId('zip-start').click()]);
  expect(download.suggestedFilename()).toBe('מאי & אופק - המועדפים.zip');
  const zip = await (await import('node:fs/promises')).readFile(await download.path());
  expect(zip.subarray(0, 2).toString()).toBe('PK');
  await expect(p.getByTestId('zip-done')).toContainText('ירדו 2 תמונות');
  await p.keyboard.press('Escape');

  // Instagram marks: two, their own tab; the studio sees them.
  for (const key of [k1, k3]) {
    await bride.cell(key).hover();
    await bride.cell(key).getByTestId('pg-insta').click();
  }
  await expect(p.getByTestId('pg-insta-count')).toHaveText('2');
  await p.getByTestId('pg-insta-tab').click();
  await expect(p.getByTestId('pg-photo')).toHaveCount(2);
  const admin = await (await request.get(`/api/admin/galleries/${id}/photos`, { headers: OWNER })).json();
  expect(admin.insta).toEqual([k1, k3]);
  expect(admin.favBy[k2]).toEqual(['מאי', 'אמא']);

  // Deleting the song: the default goes too.
  const del = await (await request.delete(`/api/admin/music/${settings.music[0].id}`, { headers: OWNER })).json();
  expect(del.music).toEqual([]);
  expect((await request.get(withMusic.photos.music)).status()).toBe(404);
});

// ---------- phase 4: access ----------

test('password, download code and the guests link (and the studio walks straight in)', async ({ browser, request }) => {
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'סוד & קוד' } })).json();
  const id = g.id;
  await request.post(`/api/admin/galleries/${id}/photos/load`, { headers: OWNER, data: { url: FOLDER } });
  await request.put(`/api/admin/galleries/${id}`, { headers: OWNER, data: { password: 'Shir2026', downloadPin: '777777' } });
  const { guestId, previewToken, password } = await (await request.get(`/api/admin/galleries/${id}`, { headers: OWNER })).json();
  expect(password).toBe('Shir2026'); // the studio sees its own settings
  // Nothing in the page's preview gives the photos away, and no page ever carries the password.
  const html = await (await request.get(`/friend/${id}`)).text();
  expect(html).not.toContain('og:image');
  expect(JSON.stringify(await (await request.get(`/api/watch/${id}`)).json())).not.toContain('Shir2026');

  const ctx = { baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } };
  const couple = await (await browser.newContext(ctx)).newPage();
  await couple.goto(`/friend/${id}`);
  await expect(couple.getByTestId('locked')).toContainText('סוד & קוד');
  await couple.getByTestId('gallery-password').fill('nope');
  await couple.getByTestId('gallery-unlock').click();
  await expect(couple.getByTestId('locked')).toContainText('הסיסמה לא נכונה');
  await couple.getByTestId('gallery-password').fill('shir2026');
  await couple.getByTestId('gallery-unlock').click();
  await couple.getByTestId('agree').check();
  await couple.getByTestId('enter').click();
  await couple.getByTestId('pg-enter').click();
  await expect(couple.getByTestId('pg-share-guests')).toBeVisible();

  // Full quality asks for the code once; then it downloads.
  await couple.getByTestId('pg-photo').first().locator('img').click();
  await couple.getByTestId('lb-download').click();
  await couple.getByTestId('download-full').click();
  await expect(couple.getByTestId('pin-dialog')).toBeVisible();
  await couple.getByTestId('pin-code').fill('777777');
  const [dl] = await Promise.all([couple.waitForEvent('download'), couple.getByTestId('pin-save').click()]);
  expect(dl.suggestedFilename()).toMatch(/\.jpg$/i);

  // A guest: the same password, then photos to look at and download, nothing to change.
  const guest = await (await browser.newContext(ctx)).newPage();
  await guest.goto(`/friend/${guestId}`);
  await guest.getByTestId('gallery-password').fill('Shir2026');
  await guest.getByTestId('gallery-unlock').click();
  await guest.getByTestId('agree').check();
  await guest.getByTestId('enter').click();
  await guest.getByTestId('pg-enter').click();
  await expect(guest.getByTestId('pg-photo').first()).toBeVisible();
  await expect(guest.getByTestId('pg-heart')).toHaveCount(0);
  await expect(guest.getByTestId('pg-fav-tab')).toHaveCount(0);
  await expect(guest.getByTestId('pg-share-guests')).toHaveCount(0);
  expect(await guest.content()).not.toContain(id);
  expect((await guest.request.post(`/api/watch/${guestId}/fav`, { data: { key: 'aaaaaaaa', on: true } })).status()).toBe(403);

  // The studio, from the hub's "open as the couple": no password, no code, and the address loses the token.
  const studio = await (await browser.newContext(ctx)).newPage();
  await studio.goto(`/friend/${id}?pt=${encodeURIComponent(previewToken)}`);
  await studio.getByTestId('agree').check();
  await studio.getByTestId('enter').click();
  await expect(studio.getByTestId('photo-gallery')).toBeVisible();
  expect(studio.url()).not.toContain('pt=');
  await studio.reload();
  await studio.getByTestId('pg-enter').click();
  await expect(studio.getByTestId('pg-photo').first()).toBeVisible();
});


// ---------- phase 5a: the album designer (ported from the Avira films app) ----------

async function quickPhotoGallery(request: APIRequestContext, coupleName: string, headers = OWNER): Promise<string> {
  const g = await (await request.post('/api/admin/galleries', { headers, data: { kind: 'photos', coupleName, date: '2026-07-01' } })).json();
  const r = await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers, data: { url: FOLDER } });
  expect(r.ok()).toBeTruthy();
  return g.id as string;
}

test('album designer: draft from hearts, edit, extra page, text, submit, studio unlocks', async ({ browser, request }) => {
    const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'דניאל & סבינה', date: '2026-09-18' } })).json();
  const loaded = await (await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  const items: Record<string, { ar: number }> = {};
  loaded.items.forEach((p: { key: string }, i: number) => (items[p.key] = { ar: (i + 1) % 3 === 0 ? 0.667 : 1.5 }));
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items } });
  const keys = loaded.items.map((p: { key: string }) => p.key);
  for (const k of keys.slice(0, 12)) await request.post(`/api/watch/${g.id}/fav`, { data: { key: k, on: true } });

  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1440, height: 900 } })).newPage();
  await couple.goto(`/watch/${g.id}/album`);
  await expect(couple.getByTestId('album-editor')).toBeVisible();
  await expect(couple.getByTestId('strip-item')).toHaveCount(30);
  await expect(couple.getByTestId('album-stats')).toContainText('30 דפים');
  await expect(couple.getByTestId('album-stats')).toContainText('12 תמונות');
  await expect(couple.getByTestId('spread-number')).toHaveText('דף הפתיחה');
  await expect(couple.getByTestId('album-text').first()).toHaveText('דניאל & סבינה');

  // Text on the opening spread: select, change words and font.
  await couple.getByTestId('album-text').first().click();
  await couple.getByTestId('text-value').fill('Daniel & Sabina');
  await couple.getByTestId('text-font').selectOption('Great Vibes');
  await expect(couple.getByTestId('album-text').first()).toHaveText('Daniel & Sabina');
  await expect(couple.getByTestId('album-text').first()).toHaveCSS('font-family', /Great Vibes/);

  // Place a photo from "all photos" into an empty slot on a later page (click slot, then photo).
  await couple.getByTestId('strip-item').nth(10).click();
  await expect(couple.getByTestId('spread-number')).toHaveText('דף 11');
  const emptySlot = couple.locator('[data-testid="slot"].empty').first();
  await emptySlot.click();
  await expect(couple.getByTestId('slot-tools')).toContainText('משבצת ריקה');
  await couple.getByTestId('bank-all').click();
  const extraKey = keys[20];
  await couple.locator(`[data-testid="bank-photo"][data-key="${extraKey}"]`).click();
  await expect(couple.getByTestId('album-stats')).toContainText('13 תמונות');
  await expect(couple.locator(`[data-testid="bank-photo"][data-key="${extraKey}"]`)).toContainText('בשימוש');
  // Zoom the photo that's now in the slot.
  await couple.getByTestId('zoom').fill('2');

  // Change the layout of the page to a 2-photo one.
  await couple.getByTestId('change-layout').click();
  await couple.locator('[data-testid="layout-option"][data-slots="2"]').first().click();
  await expect(couple.getByTestId('slot')).toHaveCount(2);

  // Extra page: warned about the studio's own price (the made-up studio's 52 ₪ — fix plan P53: never 45 from the code), then counted.
  await couple.getByTestId('add-page').click();
  await expect(couple.getByTestId('add-page-modal')).toContainText('52 ₪');
  await couple.getByTestId('confirm-add-page').click();
  await expect(couple.getByTestId('strip-item')).toHaveCount(31);
  await expect(couple.getByTestId('album-stats')).toContainText('+52 ₪');
  await expect(couple.getByTestId('spread-number')).toContainText('דף נוסף');
  await expect(couple.getByTestId('save-state')).toHaveText('✓ נשמר', { timeout: 10_000 });

  // Everything is kept after a reload.
  await couple.reload();
  await expect(couple.getByTestId('strip-item')).toHaveCount(31);
  await expect(couple.getByTestId('album-text').first()).toHaveText('Daniel & Sabina');
  await expect(couple.getByTestId('album-stats')).toContainText('13 תמונות');

  // Submit → an approved album order in the hub, and the couple goes on to it (product, cover, payment).
  await couple.getByTestId('submit-album').click();
  await expect(couple.getByTestId('submit-modal')).toContainText('תוספת של 52 ₪');
  await expect(couple.getByTestId('submit-modal')).toContainText('בשלב הבא בוחרים מוצר');
  await couple.getByTestId('confirm-submit').click();
  await couple.waitForURL(/\/album\/[A-Za-z0-9_-]{40,}$/);
  const orderUrl = couple.url();
  expect(orderUrl).not.toContain(g.id);
  // Back on the album: locked, with the way to the order.
  await couple.goto(`/watch/${g.id}/album`);
  await expect(couple.getByTestId('album-locked')).toBeVisible();
  await expect(couple.getByTestId('go-order')).toHaveText('צפייה בהזמנה');
  await couple.getByTestId('go-order').click();
  await couple.waitForURL(orderUrl);
  const late = await couple.request.put(`/api/watch/${g.id}/album`, { data: { album: { spreads: [{ id: 's', template: 't01', fills: [], texts: [] }] } } });
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe('album_sent');

  const admin = await (await request.get(`/api/admin/galleries/${g.id}/album`, { headers: OWNER })).json();
  expect(admin.summary).toMatchObject({ status: 'submitted', spreads: 31, photos: 13, extraSpreads: 1, extraCost: 52 });
  expect(admin.order).toMatchObject({ workflowStatus: 'approved', paymentStatus: 'unpaid', coupleLink: orderUrl });
  // Only the couple's own link leads to the order.
  const { guestId: gid } = await (await request.get(`/api/admin/galleries/${g.id}`, { headers: OWNER })).json();
  expect((await request.get(`/api/watch/${gid}/album/order`)).status()).toBe(403);

  // The studio reopens it (the hub's album card calls this).
  const unlocked = await (await request.post(`/api/admin/galleries/${g.id}/album/unlock`, { headers: OWNER })).json();
  expect(unlocked.summary.status).toBe('draft');
  await couple.goto(`/watch/${g.id}/album`);
  await expect(couple.getByTestId('album-locked')).toHaveCount(0);
  await expect(couple.getByTestId('submit-album')).toBeVisible();
  // Guests can't open the album designer.
  const { guestId } = await (await request.get(`/api/admin/galleries/${g.id}`, { headers: OWNER })).json();
  expect((await request.get(`/api/watch/${guestId}/album`)).status()).toBe(403);
});

// ---------- fix plan P57: two tabs, a failed order, a closed gallery ----------

test('album: two tabs never overwrite each other — the stale one is told and shows the newer album', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'שתי & לשוניות');
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1440, height: 900 } });
  const tabA = await ctx.newPage();
  await tabA.goto(`/watch/${id}/album`);
  await expect(tabA.getByTestId('album-editor')).toBeVisible();
  const tabB = await ctx.newPage();
  await tabB.goto(`/watch/${id}/album`);
  await expect(tabB.getByTestId('strip-item')).toHaveCount(30);
  // Tab A adds a page and saves.
  await tabA.getByTestId('add-page').click();
  await tabA.getByTestId('confirm-add-page').click();
  await expect(tabA.getByTestId('strip-item')).toHaveCount(31);
  await expect(tabA.getByTestId('save-state')).toHaveText('✓ נשמר', { timeout: 10_000 });
  // Tab B, still on the old copy, removes a page: refused, and it shows tab A's 31 pages.
  await tabB.getByTestId('strip-item').nth(5).click();
  tabB.once('dialog', (d) => d.accept());
  await tabB.getByTestId('remove-page').click();
  await expect(tabB.getByTestId('notice')).toContainText('האלבום עודכן ממכשיר אחר', { timeout: 10_000 });
  await expect(tabB.getByTestId('strip-item')).toHaveCount(31);
  const saved = (await (await request.get(`/api/admin/galleries/${id}/album`, { headers: OWNER })).json()).album;
  expect(saved.spreads).toHaveLength(31);
  await ctx.close();
});

test('album: a closed gallery with an order shows "הגלריה נסגרה" and the way on to the order', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'נסגרה & בהזמנה');
  const keys = (await (await request.get(`/api/watch/${id}`)).json()).photos.items.map((p: { key: string }) => p.key);
  const put = await (await request.put(`/api/watch/${id}/album`, { data: { album: { size: '80x30', spreads: [{ id: 's1', template: 't01', fills: [{ photo: keys[0] }], texts: [] }] }, rev: 0 } })).json();
  expect((await request.post(`/api/watch/${id}/album/submit`, { data: { rev: put.album.rev } })).ok()).toBeTruthy();
  expect((await request.post('/api/admin/galleries/batch', { headers: OWNER, data: { action: 'close', ids: [id] } })).ok()).toBeTruthy();
  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  await couple.goto(`/watch/${id}/album`);
  await expect(couple.getByTestId('album-closed')).toContainText('הגלריה נסגרה');
  await expect(couple.getByTestId('closed-go-order')).toHaveText('להמשך ההזמנה');
  await couple.getByTestId('closed-go-order').click();
  await couple.waitForURL(/\/album\/[A-Za-z0-9_-]{40,}$/);
  // A closed gallery with only a draft: no way on.
  const other = await quickPhotoGallery(request, 'נסגרה & טיוטה');
  await request.put(`/api/watch/${other}/album`, { data: { album: { size: '80x30', spreads: [{ id: 's1', template: 't01', fills: [], texts: [] }] }, rev: 0 } });
  await request.post('/api/admin/galleries/batch', { headers: OWNER, data: { action: 'close', ids: [other] } });
  await couple.goto(`/watch/${other}/album`);
  await expect(couple.getByTestId('album-closed')).toContainText('הגלריה נסגרה');
  await expect(couple.getByTestId('closed-go-order')).toHaveCount(0);
});

test('album editor: set tabs, auto build by the story, drag and move photos, insert/split pages, layouts, undo/redo, keys', async ({ browser, request }) => {
  test.setTimeout(120_000);
    const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'פטריק & נועה', date: '2026-09-24' } })).json();
  const loaded = await (await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  const keys: string[] = loaded.items.map((p: { key: string }) => p.key);
  const items: Record<string, { ar: number }> = {};
  keys.forEach((k, i) => (items[k] = { ar: i % 3 === 2 ? 0.667 : 1.5 }));
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items } });
  for (const k of keys.slice(0, 6)) await request.post(`/api/watch/${g.id}/fav`, { data: { key: k, on: true } });
  const setOf = new Map(loaded.items.map((p: { key: string; set: string }) => [p.key, p.set]));
  const outdoorId = loaded.sets.find((s: { name: string }) => s.name === 'צילומי חוץ').id;

  const c = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1500, height: 950 } })).newPage();
  await c.goto(`/watch/${g.id}/album`);
  await expect(c.getByTestId('album-editor')).toBeVisible();

  // 4. The bank has a tab per set.
  await c.locator(`[data-testid="bank-set"][data-set="${outdoorId}"]`).click();
  await expect(c.getByTestId('bank-photo')).toHaveCount(10);

  // 2. Drag a photo onto another slot: they swap (the first draft has several photos on page 2).
  await c.getByTestId('strip-item').nth(1).click();
  const slots = c.getByTestId('slot');
  // '' when the slot is empty (no waiting for an image that isn't there).
  const keyAt = async (i: number) => {
    const img = slots.nth(i).locator('img');
    return (await img.count()) ? ((await img.getAttribute('src')) ?? '').replace(/\?.*/, '') : '';
  };
  const a0 = await keyAt(0);
  const a1 = await keyAt(1);
  expect(a0 && a1).toBeTruthy();
  await slots.nth(0).dragTo(slots.nth(1));
  await expect.poll(() => keyAt(1)).toBe(a0);
  expect(await keyAt(0)).toBe(a1);

  // 3. Move a photo to another page: select, X, next page (←), click a slot there.
  await slots.nth(0).click();
  await c.keyboard.press('x');
  await expect(c.getByTestId('moving-banner')).toBeVisible();
  await c.keyboard.press('ArrowLeft');
  await expect(c.getByTestId('spread-number')).toHaveText('דף 3');
  await slots.nth(0).click();
  await expect(c.getByTestId('moving-banner')).toHaveCount(0);
  await expect.poll(() => keyAt(0)).toBe(a1);
  await c.keyboard.press('ArrowRight');
  await expect(c.getByTestId('spread-number')).toHaveText('דף 2');
  expect(await keyAt(0)).not.toBe(a1);

  // 6. A page between pages, and splitting a page in two (undone with Cmd+Z).
  await c.getByTestId('insert-page').nth(0).click();
  await expect(c.getByTestId('strip-item')).toHaveCount(31);
  await expect(c.getByTestId('spread-number')).toHaveText('דף 2');
  await c.getByTestId('strip-item').nth(2).click();
  await c.getByTestId('split-page').click();
  await expect(c.getByTestId('strip-item')).toHaveCount(32);
  await c.keyboard.press('Meta+z');
  await expect(c.getByTestId('strip-item')).toHaveCount(31);
  await c.keyboard.press('Meta+z');
  await expect(c.getByTestId('strip-item')).toHaveCount(30);

  // 7. Automatic design by the story, from every photo in a set.
  await c.getByTestId('auto-build').click();
  await c.getByTestId('auto-src-sets').check();
  await c.getByTestId('auto-confirm').click();
  await expect(c.getByTestId('album-stats')).toContainText('30 תמונות');
  await expect(c.getByTestId('strip-item')).toHaveCount(30);
  await expect(c.getByTestId('spread-number')).toHaveText('דף הפתיחה');
  const openingKeys = await slots.locator('img').evaluateAll((els) => els.map((e) => /\/([0-9a-f]{8})\?/.exec((e as HTMLImageElement).src)?.[1] ?? ''));
  expect(openingKeys.length).toBeGreaterThan(0);
  expect(openingKeys.every((k) => setOf.get(k) === outdoorId)).toBe(true);

  // 9. Undo brings back the design before, redo the automatic one.
  const beforeAuto = await c.getByTestId('album-stats').innerText();
  await c.getByTestId('undo').click();
  await expect(c.getByTestId('album-stats')).not.toContainText('30 תמונות');
  await c.getByTestId('redo').click();
  await expect(c.getByTestId('album-stats')).toContainText('30 תמונות');
  expect(beforeAuto).toContain('30 תמונות');

  // 5. Change a layout by splitting a slot, then save it as a preset (in this album, for the couple).
  await c.getByTestId('strip-item').nth(3).click();
  await slots.nth(0).click();
  const before = await slots.count();
  await c.getByTestId('split-side').click();
  await expect(slots).toHaveCount(before + 1);
  await c.getByTestId('save-preset').click();
  await c.getByTestId('preset-name').fill('שלוש ופנורמה');
  await c.getByTestId('preset-save').click();
  await c.keyboard.press('l');
  await expect(c.getByTestId('saved-layout')).toHaveCount(1);
  await c.keyboard.press('Escape');

  // 8. The shortcuts list.
  await c.keyboard.press('?');
  await expect(c.getByTestId('keys-modal')).toContainText('חלוקת הדף לשניים');
  await c.keyboard.press('Escape');
  await expect(c.getByTestId('save-state')).toHaveText('✓ נשמר', { timeout: 10_000 });

  // Everything (including the custom layout) is kept after a reload.
  await c.reload();
  await expect(c.getByTestId('strip-item')).toHaveCount(30);
  const saved = (await (await request.get(`/api/admin/galleries/${g.id}/album`, { headers: OWNER })).json()).album;
  expect(saved.custom?.some((t: { name?: string }) => t.name === 'שלוש ופנורמה')).toBe(true);

  // The studio (opened from the hub with its preview token) saves layouts for all its albums.
  const { previewToken } = await (await request.get(`/api/admin/galleries/${g.id}`, { headers: OWNER })).json();
  const page = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1500, height: 950 } })).newPage();
  await page.goto(`/watch/${g.id}/album?pt=${encodeURIComponent(previewToken)}`);
  await expect(page.getByTestId('album-editor')).toBeVisible();
  expect(page.url()).not.toContain('pt=');
  await page.getByTestId('strip-item').nth(4).click();
  await page.getByTestId('slot').nth(0).click();
  await page.getByTestId('save-preset').click();
  await expect(page.getByTestId('preset-modal')).toContainText('בכל האלבומים של הסטודיו');
  await page.getByTestId('preset-name').fill('הפריסה של הסטודיו');
  await page.getByTestId('preset-save').click();
  await expect.poll(async () => (await (await page.request.get(`/api/watch/${g.id}/layouts`)).json()).layouts.map((t: { name: string }) => t.name)).toContain('הפריסה של הסטודיו');
  const studio = await (await page.request.get(`/api/watch/${g.id}/layouts`)).json();
  // A couple can't write to the studio's list.
  expect((await c.request.post(`/api/watch/${g.id}/layouts`, { data: { layout: studio.layouts[0] } })).status()).toBe(403);
});

test('album on a phone: hold a photo and drag it into a slot with a finger', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'אצבע & מגע');
  const pub = await (await request.get(`/api/watch/${id}`)).json();
  for (const p of pub.photos.items.slice(0, 4)) await request.post(`/api/watch/${id}/fav`, { data: { key: p.key, on: true } });
  const phone = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
  await phone.goto(`/watch/${id}/album`);
  await expect(phone.getByTestId('album-editor')).toBeVisible();
  // A page with an empty slot.
  await phone.getByTestId('strip-item').nth(3).click();
  const empty = phone.locator('[data-testid="slot"].empty').first();
  await expect(empty).toBeVisible();
  const before = await phone.locator('[data-testid="slot"].empty').count();
  await phone.getByTestId('bank-all').click();
  const photo = phone.locator('[data-testid="bank-photo"]').nth(10);
  await photo.scrollIntoViewIfNeeded();
  const from = (await photo.boundingBox())!;
  await empty.scrollIntoViewIfNeeded();
  const to = (await empty.boundingBox())!;
  // The page fits the phone's width (the photo strip scrolls inside it).
  expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  // Hold, then move and let go (touch events as a phone sends them).
  await photo.evaluate(
    async (el, p) => {
      const touch = (x: number, y: number, target: EventTarget) => new Touch({ identifier: 1, target, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch(p.fx, p.fy, el)], changedTouches: [touch(p.fx, p.fy, el)] }));
      await new Promise((r) => setTimeout(r, 450));
      for (let i = 1; i <= 5; i++) {
        const x = p.fx + ((p.tx - p.fx) * i) / 5;
        const y = p.fy + ((p.ty - p.fy) * i) / 5;
        document.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [touch(x, y, el)], changedTouches: [touch(x, y, el)] }));
      }
      document.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [touch(p.tx, p.ty, el)] }));
    },
    { fx, fy, tx, ty },
  );
  await expect(phone.locator('[data-testid="slot"].empty')).toHaveCount(before - 1);
});


// ---------- phase 5b: print files (ported from the Avira films app) ----------

test('print export: full-size 300 DPI spreads for the studio, and a private link for the print shop', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'רוני & רז', date: '2026-08-11' } })).json();
  const loaded = await (await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  const items: Record<string, { ar: number }> = {};
  loaded.items.forEach((p: { key: string }, i: number) => (items[p.key] = { ar: (i + 1) % 3 === 0 ? 0.667 : 1.5 }));
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { items } });
  for (const p of loaded.items.slice(0, 8)) await request.post(`/api/watch/${g.id}/fav`, { data: { key: p.key, on: true } });
  // A download code on the gallery: the studio's export must pass it anyway.
  await request.put(`/api/admin/galleries/${g.id}`, { headers: OWNER, data: { downloadPin: '999999' } });
  // The couple opens the designer once: the draft is created from the hearts.
  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789' })).newPage();
  await couple.goto(`/watch/${g.id}/album`);
  await expect(couple.getByTestId('strip-item')).toHaveCount(30);
  const album = (await (await request.get(`/api/admin/galleries/${g.id}/album`, { headers: OWNER })).json()).album;
  // The couple's browser cannot open the studio's print export (U1: refused by the server).
  await couple.goto(`/watch/${g.id}/print`);
  await expect(couple.getByText('הדף הזה נפתח מתוך המערכת של הסטודיו (הורדה לדפוס).')).toBeVisible();
  await expect(couple.getByTestId('print-pages')).toHaveCount(0);

  // Studio (from the hub, with its preview token): pages 1–2, one file each.
  const { previewToken } = await (await request.get(`/api/admin/galleries/${g.id}`, { headers: OWNER })).json();
  const page = await (await browser.newContext({ baseURL: 'http://localhost:8789', acceptDownloads: true })).newPage();
  await page.goto(`/friend/${g.id}/print?pt=${encodeURIComponent(previewToken)}`);
  await expect(page.getByTestId('print-pages')).toHaveText('30 דפים');
  expect(page.url()).not.toContain('pt=');
  await page.getByTestId('print-range').fill('1-2');
  const downloads: { name: string; path: string }[] = [];
  page.on('download', async (d) => downloads.push({ name: d.suggestedFilename(), path: (await d.path())! }));
  await page.getByTestId('print-files').click();
  await expect(page.getByTestId('print-message')).toContainText('2 מתוך 2', { timeout: 90_000 });
  await expect.poll(() => downloads.length).toBe(2);
  expect(downloads.map((d) => d.name).sort()).toEqual(['רוני & רז 1.jpg', 'רוני & רז 2.jpg']);
  const first = readFileSync(downloads.find((d) => d.name.endsWith(' 1.jpg'))!.path);
  expect(readJpegInfo(new Uint8Array(first))).toEqual({ width: 9449, height: 3543, dpi: 300 });

  // The photo really is drawn: the centre of the first filled slot isn't blank white or the empty-slot grey.
  const slot = template(album.spreads[0].template).slots[album.spreads[0].fills.findIndex((f: { photo: string }) => f.photo)];
  const px = await page.evaluate(
    async ({ b64, cx, cy }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, Math.round(cx * bmp.width), Math.round(cy * bmp.height), 1, 1, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    },
    { b64: first.toString('base64'), cx: slot.x + slot.w / 2, cy: slot.y + slot.h / 2 },
  );
  expect(px.some((v) => v < 235)).toBe(true);

  // Print-shop link (made from the hub's album card): no login, only this album — only after the couple sent it (P55).
  expect((await request.post(`/api/admin/galleries/${g.id}/print-link`, { headers: OWNER })).status()).toBe(409);
  expect((await request.post(`/api/watch/${g.id}/album/submit`)).ok()).toBeTruthy();
  const made = await (await request.post(`/api/admin/galleries/${g.id}/print-link`, { headers: OWNER })).json();
  const link = made.url as string;
  expect(link).toMatch(/\/print\/[A-Za-z0-9_-]{20,}$/);
  // 30 days from now (D12(1)), renewable from the hub.
  expect(Date.parse(made.expiresAt) - Date.parse(made.createdAt)).toBe(30 * 86_400_000);
  expect((await (await request.get(`/api/admin/galleries/${g.id}/print-link`, { headers: OWNER })).json()).url).toBe(link);
  const shop = await (await browser.newContext({ baseURL: 'http://localhost:8789' })).newPage();
  await shop.goto(new URL(link).pathname);
  await expect(shop.getByTestId('print-pages')).toHaveText('30 דפים');
  await expect(shop.getByText('רוני & רז', { exact: true })).toBeVisible();
  const token = new URL(link).pathname.split('/').pop();
  const inAlbum = album.spreads[0].fills.find((f: { photo: string }) => f.photo).photo;
  const notInAlbum = loaded.items.map((p: { key: string }) => p.key).find((k: string) => !JSON.stringify(album).includes(k));
  expect((await shop.request.get(`/api/print/${token}/photo/${inAlbum}?s=full`)).status()).toBe(200);
  expect((await shop.request.get(`/api/print/${token}/photo/${notInAlbum}?s=full`)).status()).toBe(404);
  // Another studio can't touch the link.
  expect((await request.delete(`/api/admin/galleries/${g.id}/print-link`, { headers: OTHER_OWNER })).status()).toBe(404);
  // Reopened for the couple: paused (never their draft) until they send it again (D17(3)).
  expect((await (await request.post(`/api/admin/galleries/${g.id}/album/unlock`, { headers: OWNER })).json()).printPaused).toBe(true);
  expect((await shop.request.get(`/api/print/${token}`)).status()).toBe(409);
  expect((await request.post(`/api/watch/${g.id}/album/submit`)).ok()).toBeTruthy();
  expect((await shop.request.get(`/api/print/${token}`)).status()).toBe(200);
  // Still works after the gallery closes for the couple.
  await request.put(`/api/admin/galleries/${g.id}`, { headers: OWNER, data: { expiresAt: '2026-01-01T00:00:00.000Z' } });
  expect((await shop.request.get(`/api/print/${token}`)).status()).toBe(200);
  // Revoked → gone.
  await request.delete(`/api/admin/galleries/${g.id}/print-link`, { headers: OWNER });
  expect((await shop.request.get(`/api/print/${token}`)).status()).toBe(404);
});

// ---------- phase 6: guest face search (ported from the Avira films app) ----------

/** A stand-in face engine for tests: one "face" per picture, its numbers taken from the picture's colours. */
const FAKE_FACE_ENGINE = () => {
  const vecOf = (c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4 * 97) (r += d[i]), (g += d[i + 1]), (b += d[i + 2]);
    const n = d.length / (4 * 97);
    const seed = ((r / n) >> 4) * 256 + ((g / n) >> 4) * 16 + ((b / n) >> 4);
    return Array.from({ length: 128 }, (_, i) => Math.sin(seed * 12.9898 + i * 78.233) * 0.25);
  };
  (window as unknown as { __faceEngine: unknown }).__faceEngine = {
    detectAll: async (c: HTMLCanvasElement) => [{ box: [0.4, 0.3, 0.2, 0.3], vec: vecOf(c) }],
    detectOne: async (c: HTMLCanvasElement) => new Float32Array(vecOf(c)),
  };
};

test('guest face search: the studio scans on the films site, a guest finds their photos with a selfie, switching off deletes', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const g = await (await request.post('/api/admin/galleries', { headers: OWNER, data: { kind: 'photos', coupleName: 'שיר & עומר', date: '2026-08-20' } })).json();
  const loaded = await (await request.post(`/api/admin/galleries/${g.id}/photos/load`, { headers: OWNER, data: { url: FOLDER } })).json();
  const key05 = loaded.items.find((i: { name: string }) => /05\.jpg$/.test(i.name)).key as string;
  // Off: nothing to scan, nothing for guests.
  const { previewToken, guestId } = await (await request.get(`/api/admin/galleries/${g.id}`, { headers: OWNER })).json();
  expect((await request.get(`/api/watch/${guestId}/faces`)).status()).toBe(404);
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { faceSearch: true } });

  // The studio (opened from the hub with its preview token) scans; only numbers go up.
  const studioCtx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' });
  await studioCtx.addInitScript(FAKE_FACE_ENGINE);
  const studio = await studioCtx.newPage();
  await studio.goto(`/watch/${g.id}/faces?pt=${encodeURIComponent(previewToken)}`);
  await expect(studio.getByTestId('face-ready')).toContainText('נמצאו 30 פנים', { timeout: 60_000 });
  expect(studio.url()).not.toContain('pt=');
  expect(await (await request.get(`/api/admin/galleries/${g.id}/faces`, { headers: OWNER })).json()).toMatchObject({ photos: 30, faces: 30 });
  // Only the studio uploads face numbers.
  const stranger = await request.post(`/api/watch/${g.id}/faces`, { data: Buffer.from(encodeChunk([{ key: key05, faces: [] }])), headers: { 'Content-Type': 'application/octet-stream' } });
  expect(stranger.status()).toBe(403);

  // The couple's gallery offers the guest page.
  const couple = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  await couple.goto(`/watch/${g.id}`);
  await couple.getByTestId('agree').check();
  await couple.getByTestId('enter').click();
  await couple.getByTestId('pg-enter').click();
  await expect(couple.getByTestId('pg-find-me')).toBeVisible();
  // "Find me" goes through the guests' link, so what is sent on from there never carries the couple's (P67).
  expect(await couple.getByTestId('pg-find-me').getAttribute('href')).toMatch(new RegExp(`/${guestId}/me$`));

  // A guest (on the guests' link): consent, selfie, their photos only.
  const guestCtx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 390, height: 844 } });
  await guestCtx.addInitScript(FAKE_FACE_ENGINE);
  const guest = await guestCtx.newPage();
  await guest.goto(`/watch/${guestId}/me`);
  await expect(guest.getByTestId('guest-selfie')).toBeDisabled();
  await guest.getByTestId('guest-consent').check();
  const selfie = await (await request.get('/demo/photos/05.jpg')).body();
  await guest.getByTestId('guest-selfie').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: selfie });
  await expect(guest.getByTestId('guest-count')).toContainText('מצאנו אתכם');
  await expect(guest.locator(`[data-testid="pg-photo"] img[src*="${key05}"]`)).toHaveCount(1);
  await expect(guest.getByTestId('pg-heart')).toHaveCount(0);
  expect(await guest.content()).not.toContain(g.id);
  const whatsapp = decodeURIComponent((await guest.getByTestId('guest-whatsapp').getAttribute('href')) ?? '');
  expect(whatsapp).toContain(`/${guestId}/me#p=`);
  expect(whatsapp).not.toContain(g.id);
  // The personal link opens the same photos without another selfie.
  const personal = guest.url();
  expect(personal).toContain('#p=');
  const again = await (await browser.newContext({ baseURL: 'http://localhost:8789' })).newPage();
  await again.goto(personal);
  await expect(again.locator(`[data-testid="pg-photo"] img[src*="${key05}"]`)).toHaveCount(1);

  // P68 (D06(4)): the guest asks the studio to be removed — "הסר אדם זה" with their photo; the next search finds nothing.
  await studio.reload();
  studio.once('dialog', (d) => d.accept());
  await studio.getByTestId('face-remove-person').setInputFiles({ name: 'guest.jpg', mimeType: 'image/jpeg', buffer: selfie });
  await expect(studio.getByTestId('face-person-status')).toContainText('נמחקו');
  await guest.goto(`/watch/${guestId}/me`);
  await guest.getByTestId('guest-consent').check();
  await guest.getByTestId('guest-selfie').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: selfie });
  await expect(guest.getByTestId('guest-count')).toContainText('לא מצאנו');

  // Rule 1: switching it off deletes the face data; the guest page stops.
  await request.put(`/api/admin/galleries/${g.id}/photos`, { headers: OWNER, data: { faceSearch: false } });
  expect((await request.get(`/api/watch/${guestId}/faces`)).status()).toBe(404);
  expect((await (await request.get(`/api/admin/galleries/${g.id}/faces`, { headers: OWNER })).json()).photos).toBe(0);
});

test('guest search: a weak selfie is flagged, "maybe you too" finds more, "not me" takes one out; a closed gallery loses its face data', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'עוד & תמונות');
  const pub = await (await request.get(`/api/watch/${id}`)).json();
  const keys: string[] = pub.photos.items.map((p: { key: string }) => p.key);
  const selfie = Array.from({ length: 128 }, (_, i) => Math.sin(3 * 12.9898 + i * 78.233) * 0.25);
  const dir = Array.from({ length: 128 }, (_, i) => Math.cos(i * 1.7 + 0.4));
  const norm = Math.hypot(...dir);
  const drift = (amount: number, wobble: number) => selfie.map((x, i) => x + (dir[i] / norm) * amount + Math.sin(i * 5.3 + wobble) * 0.004);
  const other = Array.from({ length: 128 }, (_, i) => Math.sin(40 * 12.9898 + i * 78.233) * 0.25);
  const chunk = encodeChunk(
    keys.map((key, i) => ({ key, faces: [{ box: [0.4, 0.3, 0.2, 0.3] as [number, number, number, number], vec: i < 3 ? drift(0.27 + i * 0.01, i) : i === 3 ? drift(0.56, 9) : other }] })),
  );
  await request.put(`/api/admin/galleries/${id}/photos`, { headers: OWNER, data: { faceSearch: true } });
  const { previewToken, guestId } = await (await request.get(`/api/admin/galleries/${id}`, { headers: OWNER })).json();
  // Upload as the studio: the preview token leaves the studio cookie in this request context.
  await request.get(`/api/watch/${id}?pt=${encodeURIComponent(previewToken)}`);
  expect((await request.post(`/api/watch/${id}/faces`, { data: Buffer.from(chunk), headers: { 'Content-Type': 'application/octet-stream' } })).ok()).toBeTruthy();

  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((vec: number[]) => {
    (window as unknown as { __faceEngine: unknown }).__faceEngine = {
      detectAll: async () => [],
      detectOne: async (c: HTMLCanvasElement) => ({ descriptor: new Float32Array(vec), box: { x: 10, y: 10, width: c.width * 0.05, height: c.width * 0.05 }, score: 0.95 }),
    };
  }, selfie);
  const guest = await ctx.newPage();
  // P68: the chunks come with the search's token; a second selfie downloads nothing again.
  const chunkCalls: string[] = [];
  guest.on('request', (r) => {
    if (/\/faces\/\d+\?v=\d+$/.test(r.url())) chunkCalls.push(r.url());
  });
  await guest.goto(`/watch/${guestId}/me`);
  // Only the camera: no "choose a photo" (D06(3)).
  await expect(guest.locator('input[type="file"]')).toHaveCount(1);
  await expect(guest.getByTestId('guest-intro')).not.toContainText('רק התמונות שלכם');
  await guest.getByTestId('guest-consent').check();
  const photo = await (await request.get('/demo/photos/05.jpg')).body();
  await guest.getByTestId('guest-selfie').setInputFiles({ name: 'selfie.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(guest.getByTestId('guest-notice')).toContainText('מקרוב');
  await guest.getByTestId('guest-anyway').click();
  await expect(guest.getByTestId('guest-count')).toContainText('3');
  await expect(guest.getByTestId('guest-maybe')).toContainText('(1)');
  await guest.locator('[data-testid="pg-photo"]').filter({ has: guest.locator(`img[src*="${keys[3]}"]`) }).getByTestId('pg-notme').click();
  await expect(guest.getByTestId('guest-maybe')).toHaveCount(0);
  await guest.locator('[data-testid="pg-photo"]').filter({ has: guest.locator(`img[src*="${keys[0]}"]`) }).getByTestId('pg-notme').click();
  await expect(guest.getByTestId('guest-count')).toContainText('2');
  expect(guest.url()).not.toContain(keys[0]);
  expect(chunkCalls.length).toBeGreaterThan(0);
  const before = chunkCalls.length;
  await guest.getByRole('button', { name: 'סלפי אחר' }).click();
  await guest.getByTestId('guest-consent').check();
  await guest.getByTestId('guest-selfie').setInputFiles({ name: 'selfie2.jpg', mimeType: 'image/jpeg', buffer: photo });
  await guest.getByTestId('guest-anyway').click();
  await expect(guest.getByTestId('guest-count')).toContainText('3');
  expect(chunkCalls.length, 'the second selfie used the face data already downloaded').toBe(before);

  // Rule 3 (on the spot): the gallery closed, a guest asks → 410 and the face data is gone.
  await request.put(`/api/admin/galleries/${id}`, { headers: OWNER, data: { expiresAt: '2026-01-01T00:00:00.000Z' } });
  expect((await request.get(`/api/watch/${guestId}/faces`)).status()).toBe(410);
  expect((await (await request.get(`/api/admin/galleries/${id}/faces`, { headers: OWNER })).json()).photos).toBe(0);

  // P68 (D06(2)): extended again — face search went off with its data, the studio is told, guests see it is off
  // (never an empty search). Switched on without a scan: guests are told the studio is still preparing it.
  const g = await (await request.get(`/api/admin/galleries/${id}`, { headers: OWNER })).json();
  const ext = await (await request.post(`/api/admin/galleries/${id}/extend`, { headers: OWNER, data: { days: 10, expiresAt: g.expiresAt } })).json();
  expect(ext.faceSearchOff).toBe(true);
  await guest.goto(`/watch/${guestId}/me`);
  await expect(guest.getByText('החיפוש לפי פנים לא פעיל בגלריה הזו')).toBeVisible();
  await request.put(`/api/admin/galleries/${id}/photos`, { headers: OWNER, data: { faceSearch: true } });
  await guest.goto(`/watch/${guestId}/me`);
  await expect(guest.getByTestId('guest-not-ready')).toContainText('הסטודיו עוד מכין את החיפוש');
  await expect(guest.getByTestId('guest-selfie')).toHaveCount(0);
});

// ---------- phase 7: trash, several galleries at once, summary ----------

test('trash: every link of a trashed gallery stops (couple, guests, print shop, preview card); restore brings them back', async ({ request }) => {
  // A studio without album orders: a sent album (the print link needs one, P55) goes to the trash with the yes.
  const NO_ORDERS = '33333333-3333-3333-3333-333333333333';
  const OWNER = { Authorization: `Bearer test:owner3:${NO_ORDERS}:owner` };
  await seedStudio(request, { id: NO_ORDERS, name: 'סטודיו בלי הזמנות', slug: 'no-orders', albumOrders: false });
  const id = await quickPhotoGallery(request, 'לסל & ובחזרה', OWNER);
  const { guestId } = await (await request.get(`/api/admin/galleries/${id}`, { headers: OWNER })).json();
  const keys = (await (await request.get(`/api/watch/${id}`)).json()).photos.items.map((p: { key: string }) => p.key);
  await request.put(`/api/watch/${id}/album`, { data: { album: { size: '80x30', spreads: [{ id: 's1', template: 't01', fills: [{ photo: keys[0] }], texts: [] }] } } });
  expect((await request.post(`/api/watch/${id}/album/submit`)).ok()).toBeTruthy();
  const shop = (await (await request.post(`/api/admin/galleries/${id}/print-link`, { headers: OWNER })).json()).url.split('/').pop();
  expect((await request.get(`/api/print/${shop}`)).status()).toBe(200);

  expect((await request.delete(`/api/admin/galleries/${id}?force=1`, { headers: OWNER })).ok()).toBeTruthy();
  expect((await request.get(`/api/watch/${id}`)).status()).toBe(404);
  expect((await request.get(`/api/watch/${guestId}`)).status()).toBe(404);
  expect((await request.get(`/api/print/${shop}`)).status()).toBe(404);
  expect((await request.get(`/api/photos/${id}/${keys[0]}?s=m`)).status()).toBe(404);
  expect(await (await request.get(`/no-orders/${id}`)).text()).not.toContain('לסל &amp; ובחזרה');
  // The studio still sees it (in the trash), and "forever" works only from the trash.
  const listed = (await (await request.get('/api/admin/galleries', { headers: OWNER })).json()).find((g: { id: string }) => g.id === id);
  expect(listed.deletedAt).toBeTruthy();

  expect((await request.post(`/api/admin/galleries/${id}/restore`, { headers: OWNER })).ok()).toBeTruthy();
  expect((await request.get(`/api/watch/${id}`)).status()).toBe(200);
  expect((await request.get(`/api/print/${shop}`)).status()).toBe(200);
});

test('several galleries at once: extend, close, trash, restore, remove for good; at most 50; the summary follows', async ({ request }) => {
  const make = async (coupleName: string, days: number) => (await (await request.post('/api/admin/galleries', { headers: OWNER, data: { coupleName, date: '2026-09-01', days } })).json()).id as string;
  const a = await make('קבוצה & א', 3);
  const b = await make('קבוצה & ב', 3);
  let d = await (await request.get('/api/admin/dashboard', { headers: OWNER })).json();
  expect(d.closing.map((g: { id: string }) => g.id)).toEqual(expect.arrayContaining([a, b]));
  // One menu's summary: the photo galleries' leaves these film galleries out.
  const photosOnly = await (await request.get('/api/admin/dashboard?kind=photos', { headers: OWNER })).json();
  expect(photosOnly.closing.map((g: { id: string }) => g.id)).not.toContain(a);
  const filmsOnly = await (await request.get('/api/admin/dashboard?kind=films', { headers: OWNER })).json();
  expect(filmsOnly.closing.map((g: { id: string }) => g.id)).toEqual(expect.arrayContaining([a, b]));
  expect(filmsOnly.albumsSent).toEqual([]);

  const batch = (action: string, ids: string[], extra = {}) => request.post('/api/admin/galleries/batch', { headers: OWNER, data: { action, ids, ...extra } });
  expect((await (await batch('extend', [a, b], { days: 30 })).json()).done).toBe(2);
  d = await (await request.get('/api/admin/dashboard', { headers: OWNER })).json();
  expect(d.closing.map((g: { id: string }) => g.id)).not.toContain(a);
  expect((await (await batch('close', [a])).json()).done).toBe(1);
  expect((await (await request.get(`/api/watch/${a}`)).json()).expired).toBe(true);
  expect((await (await batch('trash', [a, b])).json()).done).toBe(2);
  expect((await (await batch('extend', [a], { days: 5 })).json()).done).toBe(0); // not in the trash
  expect((await (await batch('restore', [a])).json()).done).toBe(1);
  expect((await (await batch('purge', [a, b])).json()).done).toBe(1); // only b was in the trash
  expect((await request.get(`/api/admin/galleries/${b}`, { headers: OWNER })).status()).toBe(404);
  expect((await request.get(`/api/admin/galleries/${a}`, { headers: OWNER })).status()).toBe(200);
  expect((await batch('trash', Array.from({ length: 51 }, () => a))).status()).toBe(400);
  expect((await batch('explode', [a])).status()).toBe(400);
  // Another studio's gallery is never touched.
  const other = { Authorization: 'Bearer test:owner9:other-studio:owner' };
  expect((await (await request.post('/api/admin/galleries/batch', { headers: other, data: { action: 'trash', ids: [a] } })).json()).done).toBe(0);
});

// ---------- ported from the Avira films app (2026-09-27): several photos at once, personal lists, keys, design ----------
test('choose several photos: hearts, Instagram and a personal list at once; keys 1/2/3 in full screen', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'בחירה & רשימות');
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(() => delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  const p = await ctx.newPage();
  await p.goto(`/friend/${id}`);
  await p.getByTestId('agree').check();
  await p.getByTestId('enter').click();
  await p.getByTestId('pg-enter').click();

  // Choose 4 (click, then Shift+click for the range) → favourites in one go.
  await p.getByTestId('pg-pick').click();
  await p.getByTestId('pg-photo').nth(0).locator('img').click();
  await p.getByTestId('pg-photo').nth(3).locator('img').click({ modifiers: ['Shift'] });
  await expect(p.getByTestId('pg-picked')).toHaveText('נבחרו 4');
  await p.getByTestId('pg-picked-fav').click();
  await p.getByTestId('who-name').fill('אופק');
  await p.getByTestId('who-save').click();
  await expect(p.getByTestId('pg-fav-count')).toHaveText('4');
  expect((await (await request.get(`/api/watch/${id}`)).json()).favorites).toHaveLength(4);

  // Two more into a new personal list.
  await p.getByTestId('pg-pick').click();
  await p.getByTestId('pg-photo').nth(5).locator('img').click();
  await p.getByTestId('pg-photo').nth(6).locator('img').click();
  await p.getByTestId('pg-picked-list').click();
  await p.getByTestId('list-name').fill('התמונות של אופק');
  await p.getByTestId('list-create').click();
  await expect(p.getByTestId('pg-list-tab')).toContainText('התמונות של אופק');
  await expect(p.getByTestId('pg-list-tab')).toContainText('2');

  // Full screen: 1 = heart, 2 = Instagram, 3 = the list in use (photo 9 of the first set's 10, the page opens on it).
  await p.getByTestId('pg-photo').nth(8).locator('img').click();
  await expect(p.getByTestId('lightbox')).toBeVisible();
  await p.keyboard.press('1');
  await expect(p.getByTestId('pg-fav-count')).toHaveText('5');
  await p.keyboard.press('2');
  await expect(p.getByTestId('lb-insta')).toHaveAttribute('aria-pressed', 'true');
  await p.keyboard.press('3');
  await expect(p.getByTestId('lb-list').first()).toHaveAttribute('aria-pressed', 'true');
  // 0 = another list: named here, it gets key 4 and this photo.
  await p.keyboard.press('0');
  await expect(p.getByTestId('list-dialog')).toContainText('רשימה אישית חדשה');
  await p.getByTestId('list-name').fill('לסבתא');
  await p.getByTestId('list-create').click();
  await expect(p.getByTestId('lb-list')).toHaveCount(2);
  await expect(p.getByTestId('lb-list').nth(1)).toContainText('4');
  await expect(p.getByTestId('lb-list').nth(1)).toHaveAttribute('aria-pressed', 'true');
  // Next photo: 4 puts it in "לסבתא" only.
  await p.getByTestId('lb-next').click();
  await p.keyboard.press('4');
  await expect(p.getByTestId('lb-list').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(p.getByTestId('lb-list').nth(0)).toHaveAttribute('aria-pressed', 'false');
  await p.keyboard.press('Escape');
  await expect(p.getByTestId('pg-list-tab').first()).toContainText('3');
  await expect(p.getByTestId('pg-list-tab').nth(1)).toContainText('2');

  // The list: its own tab, and a ZIP of just those photos.
  await p.getByTestId('pg-list-tab').first().click();
  await expect(p.getByTestId('pg-photo')).toHaveCount(3);
  await p.getByTestId('pg-download-all').click();
  await expect(p.getByTestId('zip-dialog')).toContainText('הרשימה "התמונות של אופק" (3)');
  await p.getByTestId('zip-small').check();
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByTestId('zip-start').click()]);
  expect(dl.suggestedFilename()).toContain('התמונות של אופק');
  // The list stays out of the album's favourites.
  expect((await (await request.get(`/api/watch/${id}`)).json()).favorites).toHaveLength(5);
});

test('design: the gallery keeps its own look over the studio default; the couple sees it; the studio screen previews live', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'עיצוב & גלריה');
  const other = await quickPhotoGallery(request, 'ברירת & מחדל');
  const look = { cover: 'novel', font: 'bold', color: 'dark', grid: 'columns', thumb: 'regular', spacing: 'regular', nav: 'icons' };
  expect((await request.put(`/api/admin/galleries/${id}/photos`, { headers: OWNER, data: { design: { ...look, cover: 'nope' } } })).ok()).toBeTruthy();
  expect((await (await request.get(`/api/watch/${id}`)).json()).photos.design).toEqual({ ...look, cover: 'center' });
  await request.put(`/api/admin/galleries/${id}/photos`, { headers: OWNER, data: { design: look } });

  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } });
  const couple = await ctx.newPage();
  await couple.goto(`/friend/${id}`);
  await couple.getByTestId('agree').check();
  await couple.getByTestId('enter').click();
  await expect(couple.getByTestId('pg-cover')).toHaveClass(/cv-novel/);
  await expect(couple.getByTestId('photo-gallery')).toHaveCSS('background-color', 'rgb(20, 20, 20)');
  await couple.getByTestId('pg-enter').click();
  await expect(couple.getByTestId('pg-grid')).toHaveClass(/cols/);
  await expect(couple.getByTestId('pg-slideshow').locator('.t')).toBeHidden();

  // The studio default: galleries without their own look follow it.
  const s = await (await request.put('/api/admin/settings', { headers: OWNER, data: { designDefault: { color: 'olive' } } })).json();
  expect(s.designDefault.color).toBe('olive');
  expect((await (await request.get(`/api/watch/${other}`)).json()).photos.design.color).toBe('olive');
  expect((await (await request.get(`/api/watch/${id}`)).json()).photos.design.color).toBe('dark');
  await request.put('/api/admin/settings', { headers: OWNER, data: { designDefault: {} } });

  // The hub's design screen (another address) shows the couple's page in a frame and sends looks to it.
  const hub = await ctx.newPage();
  await hub.setContent(`<iframe data-testid="frame" src="http://localhost:8789/friend/${other}?preview=1" style="width:1200px;height:800px"></iframe>`);
  const frame = hub.frameLocator('[data-testid="frame"]');
  await expect(frame.getByTestId('pg-cover')).toBeVisible(); // straight in, no terms
  await hub.evaluate(() => document.querySelector('iframe')!.contentWindow!.postMessage({ type: 'pg-design', design: { cover: 'journal', color: 'rose', font: 'wrong' } }, '*'));
  await expect(frame.getByTestId('pg-cover')).toHaveClass(/cv-journal/);
  await expect(frame.getByTestId('photo-gallery')).toHaveAttribute('data-color', 'rose');
  // Only a preview listens; the couple's own page ignores looks sent to it.
  await couple.evaluate(() => window.postMessage({ type: 'pg-design', design: { cover: 'stamp' } }, '*'));
  await expect(couple.getByTestId('pg-cover')).toHaveClass(/cv-novel/);
  await ctx.close();
});

test('P72: studio page films play, the last favourite taken off closes full screen and frees the page, views counted apart', async ({ browser, request }) => {
  // The studio page's films stream through the studio's route (never a gallery route with no id).
  const folder = await (await request.post('/api/admin/resolve-folder', { headers: OWNER, data: { url: FOLDER } })).json();
  expect((await request.put('/api/admin/studio', { headers: OWNER, data: { enabled: true, showcase: { folderUrl: FOLDER, films: folder.films }, reviews: [] } })).ok()).toBeTruthy();
  const studio = await (await request.get('/api/studio/friend')).json();
  expect(studio.films.length).toBeGreaterThan(0);
  for (const f of studio.films) {
    expect(f.watchUrl).toMatch(/^\/api\/studio\/friend\/film\/\d+$/);
    expect((await request.get(f.watchUrl, { headers: { Range: 'bytes=0-1' } })).status()).toBeLessThan(300);
  }

  const id = await quickPhotoGallery(request, 'צפיות & לבבות');
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(`/friend/${id}`);
  await p.getByTestId('agree').check();
  await p.getByTestId('enter').click();
  await p.getByTestId('pg-enter').click();

  // One heart, then the favourites tab and its only photo in full screen; "1" takes the heart off.
  await p.getByTestId('pg-photo').nth(2).hover();
  await p.getByTestId('pg-photo').nth(2).getByTestId('pg-heart').click();
  await p.getByTestId('who-name').fill('מאי');
  await p.getByTestId('who-save').click();
  await expect(p.getByTestId('pg-fav-count')).toHaveText('1');
  await p.getByTestId('pg-fav-tab').click();
  await expect(p.getByTestId('pg-photo')).toHaveCount(1);
  await p.getByTestId('pg-photo').first().locator('img').click();
  await expect(p.getByTestId('lightbox')).toBeVisible();
  expect(await p.evaluate(() => document.body.style.overflow)).toBe('hidden');
  await p.keyboard.press('1');
  await expect(p.getByTestId('lightbox')).toHaveCount(0);
  await expect.poll(() => p.evaluate(() => document.body.style.overflow)).toBe('');
  expect(p.url()).not.toContain('photo=');

  // The couple's visit counted once; a guest's view counts apart; the studio's own look not at all.
  const admin = async () => (await (await request.get(`/api/admin/galleries/${id}`, { headers: OWNER })).json()) as { views: number; guestViews?: number; guestId: string; previewToken: string };
  await expect.poll(async () => (await admin()).views).toBe(1);
  const { guestId, previewToken } = await admin();
  const guest = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  await guest.goto(`/friend/${guestId}`);
  await guest.getByTestId('agree').check();
  await guest.getByTestId('enter').click();
  await expect(guest.getByTestId('photo-gallery')).toBeVisible();
  await expect.poll(async () => (await admin()).guestViews ?? 0).toBe(1);
  const own = await (await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' })).newPage();
  await own.goto(`/friend/${id}?pt=${encodeURIComponent(previewToken)}`);
  await own.getByTestId('agree').check();
  await own.getByTestId('enter').click();
  await expect(own.getByTestId('photo-gallery')).toBeVisible();
  await own.waitForTimeout(500);
  expect(await admin()).toMatchObject({ views: 1, guestViews: 1 });
});

test('P70: a heart that fails to save shows what the server has, not what the page remembered; many hearts in one request', async ({ browser, request }) => {
  const id = await quickPhotoGallery(request, 'שמירה & נכשלה');
  const pub = await (await request.get(`/api/watch/${id}`)).json();
  const keys = pub.photos.items.map((i: { key: string }) => i.key) as string[];
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL', viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(`/friend/${id}`);
  await p.getByTestId('agree').check();
  await p.getByTestId('enter').click();
  await p.getByTestId('pg-enter').click();
  await expect(p.getByTestId('pg-photo').first()).toBeVisible();

  // Meanwhile another phone of the couple hearts two photos (in one request).
  const other = await (await request.post(`/api/watch/${id}/fav`, { data: { keys: keys.slice(0, 2), on: true, who: 'אמא' } })).json();
  expect(other.favorites).toEqual([...keys.slice(0, 2)].sort());
  // This page's heart fails: it asks the server again and shows the two hearts it did not know about.
  await p.route('**/api/watch/*/fav', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'שגיאה לא צפויה בשרת' }) }));
  await p.getByTestId('pg-photo').nth(4).hover();
  await p.getByTestId('pg-photo').nth(4).getByTestId('pg-heart').click();
  await p.getByTestId('who-name').fill('מאי');
  await p.getByTestId('who-save').click();
  await expect(p.getByText('שגיאה לא צפויה בשרת')).toBeVisible();
  await expect(p.getByTestId('pg-fav-count')).toHaveText('2');
  await ctx.close();
});

// Fix plan P65: a film its cloud no longer has. The couple is told plainly instead of a player that never starts, and
// the opening clip behind the title is not a broken video. (The mock cloud answers 502 for a file whose link says "gone".)
test('P65: a film gone from the cloud says so to the couple; the opening clip disappears', async ({ browser, request }) => {
  const gone = 'https://www.dropbox.com/scl/fi/gone1/highlights.mp4?rlkey=gone1';
  const g = await (
    await request.post('/api/admin/galleries', {
      headers: OWNER,
      data: { coupleName: 'סרט & שנעלם', films: [{ title: 'הייליטס', tag: 'highlights', fileName: 'highlights.mp4', provider: 'dropbox', fileId: gone, sourceUrl: gone, sizeBytes: 1000, playable: true }] },
    })
  ).json();
  expect((await request.get(`/api/watch/${g.id}/film/0`)).status()).toBe(502);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:8789', locale: 'he-IL' });
  const p = await ctx.newPage();
  await p.goto(`/friend/${g.id}`);
  await p.getByTestId('agree').check();
  await p.getByTestId('enter').click();
  await expect(p.getByTestId('couple-name')).toHaveText('סרט & שנעלם');
  await expect(p.getByTestId('hero-video')).toHaveCount(0);
  await p.getByTestId('watch').click();
  await expect(p.getByTestId('film-gone')).toContainText('הסרט כבר לא זמין אצל ספק האחסון, פנו לסטודיו');
  await expect(p.getByTestId('player')).toHaveCount(0);
  await ctx.close();
});
