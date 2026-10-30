import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import { isMit4mitUrl, mit4mitBizId, parseMit4mit } from '../worker/mit4mit';
import { storeFor } from '../worker/store';
import type { MemoryStore } from '../worker/store-memory';
import { shortName } from '../worker/studio';
import type { Env, Review } from '../worker/types';
import { fakeEnv } from './fake-kv';
import html from './fixtures/mit4mit.html?raw';

describe('mit4mit reviews', () => {
  it('reads name, score, time and the full text (visible + "read more" parts)', () => {
    const r = parseMit4mit(html);
    expect(r).toHaveLength(2); // the empty third block is skipped
    expect(r[0]).toEqual({
      name: 'נועה & איתי',
      score: 100,
      when: 'לפני שנה',
      text: 'צוות מקסים, הסרט יצא מושלם ו"מרגש" עד דמעות. היו איתנו מהבוקר ועד הריקוד האחרון.\nממליצים בחום!',
      ext: 'id:1',
    });
    expect(r[1]).toMatchObject({ name: 'Shira', score: 96, when: 'לפני 3 חודשים', text: 'קצר ולעניין.', ext: 'id:2' });
  });
  it('accepts only business page links and normalises them', () => {
    expect(isMit4mitUrl('https://mit4mit.co.il/biz/15100?tab=reviews')).toBe('https://www.mit4mit.co.il/biz/15100');
    expect(isMit4mitUrl('https://www.mit4mit.co.il/biz/15100/')).toBe('https://www.mit4mit.co.il/biz/15100');
    expect(isMit4mitUrl('https://www.mit4mit.co.il/category/340')).toBeNull();
    expect(isMit4mitUrl('https://evil.com/biz/1')).toBeNull();
    expect(mit4mitBizId('https://mit4mit.co.il/biz/15100?tab=reviews')).toBe('15100');
    expect(mit4mitBizId('https://evil.com/biz/1')).toBeNull();
  });
  it('keeps emoji and typographic marks in reviews (P72)', () => {
    const page = '<html><div class="displayEngine_review displayEngine_element"><div itemprop="author"><span itemprop="name">דנה &amp; רועי</span></div><div class="reviewText">הכי מרגש &#128525;&nbsp;תודה&hellip; &amp;lt;3</div></div>';
    expect(parseMit4mit(page)[0]).toMatchObject({ name: 'דנה & רועי', text: 'הכי מרגש 😍 תודה… &lt;3' });
  });
});

// ---------- fix plan P71: importing again keeps what the studio chose; one business, one studio ----------

const env = { ...fakeEnv(), CLOUD_MOCK: '1' } as unknown as Env;
const PAGE = 'https://www.mit4mit.co.il/biz/15100';

/** A mit4mit page with these reviews (data-id, name, text, score). */
function mitPage(list: [number, string, string, number][]) {
  return `<html>${list
    .map(
      ([id, name, text, score]) =>
        `<div class="displayEngine_review displayEngine_element " data-id="${id}"><div class="userName" itemprop="author"><span itemprop="name">${name}</span></div>` +
        `<div class="writeTime" itemprop="datePublished">לפני שבוע</div><div class="rankScore">${score} מתוך 100</div><div class="reviewText" itemprop="description"><span>${text}</span></div></div>`,
    )
    .join('')}</html>`;
}

let served = mitPage([]);
function serveMit4mit() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const u = String(input instanceof Request ? input.url : input);
    if (!u.startsWith('https://www.mit4mit.co.il/biz/')) throw new Error(`unexpected request: ${u}`);
    return new Response(served, { headers: { 'Content-Type': 'text/html' } });
  });
}

let n = 0;
async function studio() {
  const tid = `00000000-0000-4000-8000-${(0x71000 + ++n).toString(16).padStart(12, '0')}`;
  const store = (await storeFor(env)) as MemoryStore;
  store.seedTenant({ id: tid, slug: `mit-studio-${n}` });
  await store.patchFilmsStudio(tid, { pageEnabled: true });
  const auth = { Authorization: `Bearer test:u${n}:${tid}:owner` };
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await worker.fetch(new Request(`https://films.test${path}`, { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) }), env);
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  return { tid, store, call, slug: `mit-studio-${n}` };
}

describe('P71: importing mit4mit reviews', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('the first import needs the studio\'s responsibility declaration, binds the business and locks the address', async () => {
    serveMit4mit();
    served = mitPage([[1, 'שירה כהן', 'מקצועיים ומרגשים', 100]]);
    const { tid, store, call } = await studio();
    const refused = await call('POST', '/api/admin/studio/reviews/import', { url: PAGE });
    expect(refused).toMatchObject({ status: 400, json: { code: 'mit4mit_confirm' } });
    expect((await store.getFilmsStudio(tid)).mit4mitBizId).toBeUndefined();
    const r = await call('POST', '/api/admin/studio/reviews/import', { url: PAGE, confirmOwnership: true });
    expect(r.status).toBe(200);
    expect(r.json.counts).toEqual({ imported: 1, added: 1, kept: 0, stale: 0, skipped: 0 });
    // New reviews come in hidden; the business is bound on the studio's own declaration (legal decision 2026-10-02 (3):
    // no operator approval), and the declaration's wording is kept in the audit line.
    expect(r.json.reviews).toMatchObject([{ name: 'שירה כהן', visible: false, source: 'mit4mit', ext: 'id:1' }]);
    expect(r.json).toMatchObject({ mit4mitBizId: '15100', mit4mitApproved: true, mit4mitUrl: PAGE });
    expect(store.audits.at(-1)).toMatchObject({ tenantId: tid, table: 'films_studio_settings', changes: { mit4mit_import: { bizId: '15100', linked: true, added: 1, declaration: expect.stringContaining('באחריות הסטודיו') } } });
    // Another business's page is refused, and the address can't be changed by the page's form either.
    const other = await call('POST', '/api/admin/studio/reviews/import', { url: 'https://www.mit4mit.co.il/biz/999', confirmOwnership: true });
    expect(other).toMatchObject({ status: 400, json: { code: 'mit4mit_other_business' } });
    expect((await call('PUT', '/api/admin/studio', { mit4mitUrl: 'https://www.mit4mit.co.il/biz/999' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/studio', { mit4mitUrl: PAGE })).status).toBe(200);
  });

  it('a second import keeps the old reviews and their choice, marks the ones gone from the page, and never brings back a deleted one', async () => {
    serveMit4mit();
    const PAGE2 = 'https://www.mit4mit.co.il/biz/15200';
    served = mitPage([
      [1, 'שירה כהן', 'מקצועיים ומרגשים', 100],
      [2, 'דנה', 'סרט מדהים', 90],
      [3, 'רון לוי', 'היה בסדר', 60],
    ]);
    const { tid, store, call } = await studio();
    const first = await call('POST', '/api/admin/studio/reviews/import', { url: PAGE2, confirmOwnership: true });
    const [a, b, c] = first.json.reviews as Review[];
    // The studio shows the first, deletes the third and adds its own.
    const mine = { id: 'm1', name: 'נועה & איתי', text: 'תודה!', score: 100, visible: true, source: 'manual' };
    const saved = await call('PUT', '/api/admin/studio', { reviews: [{ ...a, visible: true, text: 'נערך בדפדפן' }, b, mine] });
    expect(saved.status).toBe(200);
    // The screen changes only whether an imported review is shown, never its words.
    expect((saved.json.reviews as Review[])[0]).toMatchObject({ id: a.id, visible: true, text: 'מקצועיים ומרגשים' });
    expect((await store.getFilmsStudio(tid)).mit4mitRemoved).toEqual(expect.arrayContaining(['id:3']));

    // mit4mit's page now: the first review, the deleted one, and a new one (the second fell off the page).
    served = mitPage([
      [4, 'יעל', 'חדש לגמרי', 100],
      [1, 'שירה כהן', 'מקצועיים ומרגשים!', 100],
      [3, 'רון לוי', 'היה בסדר', 60],
    ]);
    const again = await call('POST', '/api/admin/studio/reviews/import', { url: PAGE2 });
    expect(again.status).toBe(200);
    expect(again.json.counts).toEqual({ imported: 3, added: 1, kept: 1, stale: 1, skipped: 1 });
    const list = again.json.reviews as Review[];
    expect(list.map((r) => r.name)).toEqual(['יעל', 'שירה כהן', 'דנה', 'נועה & איתי']);
    expect(list[0]).toMatchObject({ visible: false, source: 'mit4mit' });
    expect(list[1]).toMatchObject({ id: a.id, visible: true, text: 'מקצועיים ומרגשים!' });
    expect(list[1].stale).toBeUndefined();
    expect(list[2]).toMatchObject({ id: b.id, stale: true, source: 'mit4mit' });
    expect(list[3]).toMatchObject({ id: 'm1', source: 'manual' });
    expect(list.some((r) => r.id === c.id || r.name === 'רון לוי')).toBe(false);
  });

  it('another studio cannot bind a business that is already bound', async () => {
    serveMit4mit();
    served = mitPage([[1, 'שירה כהן', 'מקצועיים', 100]]);
    const one = await studio();
    const two = await studio();
    const url = 'https://www.mit4mit.co.il/biz/424242';
    expect((await one.call('POST', '/api/admin/studio/reviews/import', { url, confirmOwnership: true })).status).toBe(200);
    const clash = await two.call('POST', '/api/admin/studio/reviews/import', { url, confirmOwnership: true });
    expect(clash.status).toBe(409);
    expect(clash.json.error).toMatch(/כבר מקושר לסטודיו אחר/);
    // Nothing of it was saved for the second studio.
    const f = await two.store.getFilmsStudio(two.tid);
    expect(f.mit4mitBizId).toBeUndefined();
    expect(f.reviews).toEqual([]);
  });

  it('the public page shows the reviews the studio marked, by first name and initial; an old link not yet checked shows none', async () => {
    serveMit4mit();
    served = mitPage([[1, 'שירה כהן', 'מקצועיים ומרגשים', 100]]);
    const { tid, store, call, slug } = await studio();
    const first = await call('POST', '/api/admin/studio/reviews/import', { url: PAGE.replace('15100', '777'), confirmOwnership: true });
    const [a] = first.json.reviews as Review[];
    await call('PUT', '/api/admin/studio', { reviews: [{ ...a, visible: true }, { id: 'm1', name: 'דנה לוי', text: 'תודה', visible: true, source: 'manual' }] });
    const pub = async () => ((await (await worker.fetch(new Request(`https://films.test/api/studio/${slug}`), env)).json()) as { reviews: { name: string }[] }).reviews.map((r) => r.name);
    expect(await pub()).toEqual(['שירה כ.', 'דנה לוי']);
    // A business linked before the decision (no approval stamp) still waits for the operator's check.
    await store.patchFilmsStudio(tid, { mit4mitApprovedAt: undefined });
    expect(await pub()).toEqual(['דנה לוי']);
  });

  it('a name on the public page is each person\'s first name and an initial', () => {
    expect(shortName('שירה כהן')).toBe('שירה כ.');
    expect(shortName('נועה & איתי')).toBe('נועה & איתי');
    expect(shortName('Dana Levi + Avi Cohen')).toBe('Dana L. & Avi C.');
    expect(shortName('זוג מאושר')).toBe('זוג מ.');
  });
});
