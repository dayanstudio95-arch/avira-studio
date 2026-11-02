// The team's Invoice4U pages kept as PDF (Avira, 2026-11-02; worker/staffPages.ts): only Invoice4U document pages are
// opened; a page that prints → the PDF in the bucket and the row "pending" (only while it still has no file); a page
// that fails → a note, not tried again; no browser → nothing marked, the next hour tries. A fake database and browser.
import { describe, expect, it } from 'vitest';
import { BrowserUnavailable, invoice4uPage, PAGES_PER_RUN, RENDER_FAILED, saveStaffPages, staffPagesRun, type Render } from '../worker/staffPages';
import type { Env } from '../worker/types';

const DOC = '9853fbbd-bf57-4a8c-9a8a-63dcdb5466ad';
const LINK = `https://newview.invoice4u.co.il/Views/NewViewMobile.aspx?docid=${DOC}&docNumber=70156&original=true`;
const PDF = new TextEncoder().encode('%PDF-1.7 fake');
const env = { SUPABASE_URL: 'https://db.example/', SUPABASE_SERVICE_ROLE_KEY: 'service' } as unknown as Env;

type Call = { method: string; url: string; body: unknown };
function fakeDb(rows: { id: string; tenant_id: string; link_url: string | null }[], opts: { uploadStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    calls.push({ method, url: String(input), body });
    if (method === 'GET') return new Response(JSON.stringify(rows), { status: 200 });
    if (String(input).includes('/storage/')) return new Response('{}', { status: opts.uploadStatus ?? 200 });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('invoice4uPage', () => {
  it("opens Invoice4U's full view of the same document", () => {
    expect(invoice4uPage(LINK)).toBe(`https://newview.invoice4u.co.il/Views/NewView.aspx?docid=${DOC}&docNumber=70156&original=true`);
    expect(invoice4uPage(` https://newview.invoice4u.co.il/Views/NewView.aspx?docid=${DOC.toUpperCase()}\r`)).toBe(`https://newview.invoice4u.co.il/Views/NewView.aspx?docid=${DOC.toUpperCase()}`);
  });
  it('never anything else', () => {
    for (const bad of [
      null,
      '',
      'not a link',
      `http://newview.invoice4u.co.il/Views/NewViewMobile.aspx?docid=${DOC}`,
      `https://evil.example/Views/NewViewMobile.aspx?docid=${DOC}`,
      `https://newview.invoice4u.co.il.evil.example/Views/NewView.aspx?docid=${DOC}`,
      `https://newview.invoice4u.co.il/Views/Other.aspx?docid=${DOC}`,
      'https://newview.invoice4u.co.il/Views/NewView.aspx?docid=9853',
      'https://www.paperless.tax/invoice?sID=abc',
    ]) expect(invoice4uPage(bad)).toBeNull();
  });
  it('drops a document number that is not a number', () => {
    expect(invoice4uPage(`https://newview.invoice4u.co.il/Views/NewView.aspx?docid=${DOC}&docNumber=1;x`)).toBe(`https://newview.invoice4u.co.il/Views/NewView.aspx?docid=${DOC}`);
  });
});

describe('saveStaffPages', () => {
  it('asks only for Invoice4U documents still waiting, a few a run', async () => {
    const { calls, fetchImpl } = fakeDb([]);
    expect(await saveStaffPages(env, async () => PDF, fetchImpl)).toEqual({ saved: 0, failed: 0 });
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0].url);
    expect(u.origin + u.pathname).toBe('https://db.example/rest/v1/staff_invoices');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ provider: 'eq.invoice4u', read_status: 'eq.manual', file_path: 'is.null', note: 'is.null', limit: String(PAGES_PER_RUN) });
  });

  it('a page that prints → the PDF in the bucket, the row pending (only while it has no file)', async () => {
    const opened: string[] = [];
    const { calls, fetchImpl } = fakeDb([{ id: 'inv1', tenant_id: 't1', link_url: LINK }]);
    const render: Render = async (url) => (opened.push(url), PDF);
    expect(await saveStaffPages(env, render, fetchImpl)).toEqual({ saved: 1, failed: 0 });
    expect(opened).toEqual([invoice4uPage(LINK)]);
    expect(calls[1]).toMatchObject({ method: 'POST', url: 'https://db.example/storage/v1/object/staff-invoices/t1/inv1.pdf' });
    expect(calls[2].method).toBe('PATCH');
    expect(calls[2].url).toBe('https://db.example/rest/v1/staff_invoices?id=eq.inv1&file_path=is.null');
    expect(calls[2].body).toMatchObject({ file_path: 't1/inv1.pdf', file_mime: 'application/pdf', read_status: 'pending' });
  });

  it('a page that fails, prints no PDF or is not Invoice4U → noted, and the run goes on', async () => {
    const { calls, fetchImpl } = fakeDb([
      { id: 'bad-link', tenant_id: 't1', link_url: 'https://evil.example/x' },
      { id: 'throws', tenant_id: 't1', link_url: LINK },
      { id: 'not-pdf', tenant_id: 't1', link_url: LINK },
    ]);
    let n = 0;
    const render: Render = async () => {
      n++;
      if (n === 1) throw new Error('navigation timeout');
      return new TextEncoder().encode('<html>');
    };
    expect(await saveStaffPages(env, render, fetchImpl)).toEqual({ saved: 0, failed: 3 });
    expect(n).toBe(2);
    const notes = calls.filter((c) => c.method === 'PATCH');
    expect(notes.map((c) => new URL(c.url).searchParams.get('id'))).toEqual(['eq.bad-link', 'eq.throws', 'eq.not-pdf']);
    for (const c of notes) expect(c.body).toMatchObject({ note: RENDER_FAILED });
    expect(calls.some((c) => c.url.includes('/storage/'))).toBe(false);
  });

  it('an upload that fails → noted, the row not marked pending', async () => {
    const { calls, fetchImpl } = fakeDb([{ id: 'inv1', tenant_id: 't1', link_url: LINK }], { uploadStatus: 500 });
    expect(await saveStaffPages(env, async () => PDF, fetchImpl)).toEqual({ saved: 0, failed: 1 });
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ note: RENDER_FAILED });
  });

  it('no browser this run → nothing marked, the rest wait for the next hour', async () => {
    const { calls, fetchImpl } = fakeDb([
      { id: 'a', tenant_id: 't1', link_url: LINK },
      { id: 'b', tenant_id: 't1', link_url: LINK },
    ]);
    const render: Render = async () => {
      throw new BrowserUnavailable('429');
    };
    expect(await saveStaffPages(env, render, fetchImpl)).toEqual({ saved: 0, failed: 0 });
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a list that fails throws (the hourly part catches it)', async () => {
    const fetchImpl = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    await expect(saveStaffPages(env, async () => PDF, fetchImpl)).rejects.toThrow('500');
  });
});

describe('staffPagesRun', () => {
  it('does nothing without the browser, under CLOUD_MOCK or without the database', async () => {
    await staffPagesRun(env);
    await staffPagesRun({ ...env, BROWSER: {} as Fetcher, CLOUD_MOCK: '1' } as Env);
    await staffPagesRun({ BROWSER: {} as Fetcher } as Env);
  });
});
