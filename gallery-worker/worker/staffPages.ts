// "חשבוניות מהצוות" (Avira, 2026-11-02, the owner's choice): a staff member's Invoice4U document is a web page only —
// there is no PDF behind it (checked on a real one) — so every hour this opens the page in Cloudflare's browser (the
// BROWSER binding, Browser Run) and keeps it as a PDF, the way the owner would save it by hand. The rows are the edge
// scan's (supabase/functions/_shared/staffInvoicesScan.ts, 0106): the PDF goes to their private bucket and the row to
// "pending", so the scan's next run reads it with AI and matches it like any other document. A page that fails gets a
// note and is not tried again (the screen's "נסה שוב" clears it); a browser that can't be had leaves the rows for the
// next hour. A document's link is as good as the document: it is never logged.
import puppeteer from '@cloudflare/puppeteer';
import type { Env } from './types';

/** At most this many pages a run (a few seconds of browser time each; the rest wait for the next hour). */
export const PAGES_PER_RUN = 3;
/** The row's note when the page could not be kept (the screen shows it, with "נסה שוב"). */
export const RENDER_FAILED = 'לא הצלחנו לשמור את העמוד כ-PDF — לפתוח ולשמור ידנית';
const BUCKET = 'staff-invoices';
/** As the scan's own limit for a document (staffDocReader.ts MAX_DOC_BYTES). */
const MAX_BYTES = 10 * 1024 * 1024;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** No browser this run (Browser Run busy or over its limit): nothing is marked, the next hour tries again. */
export class BrowserUnavailable extends Error {}

/** Opens an Invoice4U page and prints it to a PDF. */
export type Render = (url: string) => Promise<Uint8Array>;

/**
 * The page to open for an Invoice4U document link, or null: only Invoice4U's own document pages are ever opened. The
 * full view (NewView.aspx, laid out for an A4 page) rather than the mobile one the messages link to.
 */
export function invoice4uPage(link: unknown): string | null {
  try {
    const u = new URL(String(link ?? '').trim());
    if (u.protocol !== 'https:' || u.hostname !== 'newview.invoice4u.co.il' || !/^\/Views\/NewView(?:Mobile)?\.aspx$/i.test(u.pathname)) return null;
    const docid = u.searchParams.get('docid') || '';
    if (!GUID.test(docid)) return null;
    const q = new URLSearchParams({ docid });
    const n = u.searchParams.get('docNumber');
    if (n && /^\d{1,12}$/.test(n)) q.set('docNumber', n);
    if (u.searchParams.get('original') === 'true') q.set('original', 'true');
    return `https://newview.invoice4u.co.il/Views/NewView.aspx?${q}`;
  } catch {
    return null;
  }
}

const isPdf = (b: Uint8Array) => b.length > 4 && String.fromCharCode(...b.subarray(0, 5)) === '%PDF-';

/** Cloudflare's browser: one per page (a run has at most PAGES_PER_RUN). */
export function browserRender(env: Env): Render {
  return async (url) => {
    let browser;
    try {
      browser = await puppeteer.launch(env.BROWSER!);
    } catch (e) {
      throw new BrowserUnavailable((e as Error).message);
    }
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
      return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true }));
    } finally {
      await browser.close().catch(() => {});
    }
  };
}

export interface StaffPagesReport {
  saved: number;
  failed: number;
}

/** One run: the Invoice4U documents still waiting for their PDF → kept, or noted. */
export async function saveStaffPages(env: Env, render: Render, fetchImpl: typeof fetch = fetch): Promise<StaffPagesReport> {
  const base = String(env.SUPABASE_URL).replace(/\/$/, '');
  const auth = { apikey: String(env.SUPABASE_SERVICE_ROLE_KEY), Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  const res = await fetchImpl(
    `${base}/rest/v1/staff_invoices?select=id,tenant_id,link_url&provider=eq.invoice4u&read_status=eq.manual&file_path=is.null&note=is.null&order=created_at.asc&limit=${PAGES_PER_RUN}`,
    { headers: auth },
  );
  if (!res.ok) throw new Error(`staff pages: the list failed (${res.status})`);
  const rows = (await res.json()) as { id: string; tenant_id: string; link_url: string | null }[];
  // Only a row still waiting is changed (the owner may have uploaded the PDF meanwhile).
  const patch = (id: string, body: Record<string, unknown>) =>
    fetchImpl(`${base}/rest/v1/staff_invoices?id=eq.${encodeURIComponent(id)}&file_path=is.null`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ...body, updated_at: new Date().toISOString() }),
    });
  const report: StaffPagesReport = { saved: 0, failed: 0 };
  for (const r of rows) {
    try {
      const page = invoice4uPage(r.link_url);
      if (!page) throw new Error('not an Invoice4U document page');
      const pdf = await render(page);
      if (!isPdf(pdf) || pdf.length > MAX_BYTES) throw new Error('the page did not print to a PDF');
      const path = `${r.tenant_id}/${r.id}.pdf`;
      const up = await fetchImpl(`${base}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
        body: new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      });
      if (!up.ok) throw new Error(`the upload failed (${up.status})`);
      const done = await patch(r.id, { file_path: path, file_mime: 'application/pdf', read_status: 'pending' });
      if (!done.ok) throw new Error(`the update failed (${done.status})`);
      report.saved++;
    } catch (e) {
      if (e instanceof BrowserUnavailable) {
        console.error(`staff pages: no browser this run (${e.message})`);
        break;
      }
      report.failed++;
      console.error(`staff pages: ${r.id} failed: ${(e as Error).message}`);
      await patch(r.id, { note: RENDER_FAILED }).catch(() => {});
    }
  }
  return report;
}

/** The hourly cron's part (worker/index.ts `scheduled`): its own try, so it never holds the clean-up up. */
export async function staffPagesRun(env: Env): Promise<void> {
  if (!env.BROWSER || env.CLOUD_MOCK || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const r = await saveStaffPages(env, browserRender(env));
    if (r.saved || r.failed) console.log(`staff pages: ${r.saved} kept as PDF, ${r.failed} failed`);
  } catch (e) {
    console.error('staff pages: the run failed', (e as Error).message);
  }
}
