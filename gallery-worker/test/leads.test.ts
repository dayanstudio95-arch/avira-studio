import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import { checkTurnstile, cleanReviews, LEAD_LIMITS, rateLimit, validateLead } from '../worker/studio';
import { normalizePhone, normalizeSocial, whatsappNumber } from '../worker/settings';
import { storeFor } from '../worker/store';
import { MemoryStore } from '../worker/store-memory';
import type { Env } from '../worker/types';
import { fakeEnv } from './fake-kv';

describe('leads from the studio page', () => {
  it('cleans what the couple typed and requires names and a phone', () => {
    const l = validateLead({ coupleName: ' שני   ועומר ', phone: '052-765-4321', date: '2027-05-20', venue: 'חוות רונית', guests: '350 איש', note: 'x'.repeat(2000) });
    // As the couple wrote them (P72: "&" is only a suggestion in the studio's form).
    expect(l).toMatchObject({ coupleName: 'שני ועומר', phone: '052-765-4321', date: '2027-05-20', guests: '350', status: 'new' });
    expect(l.note.length).toBe(1000);
    expect(validateLead({ coupleName: 'א', phone: '0501234567', date: 'next week' }).date).toBe('');
    expect(validateLead({ coupleName: 'א', phone: '0501234567', date: '2027-02-31' }).date).toBe('');
    expect(() => validateLead({ coupleName: '', phone: '0501234567' })).toThrow(/שמות/);
    expect(() => validateLead({ coupleName: 'א ו ב', phone: '123' })).toThrow(/טלפון/);
  });
  it('limits submissions per hour, per key', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 3; i++) await rateLimit(store, 'k', 3);
    await expect(rateLimit(store, 'k', 3)).rejects.toThrow(/בעוד שעה/);
    await expect(rateLimit(store, 'other', 3)).resolves.toBeUndefined();
  });
});

// Fix plan P10 (decision D23(3)): the studio page's quote form — a moderate cap per studio (20 an hour, 100 a day),
// the address's 5 an hour, the limiter failing closed, one lead per phone, and Cloudflare Turnstile when its keys are set.
describe('the quote form, end to end (P10)', () => {
  let n = 0;
  const site = (extra: Partial<Env> = {}) => ({ ...fakeEnv(), CLOUD_MOCK: '1', ASSETS: { fetch: async () => new Response('x') }, ...extra }) as unknown as Env;
  async function studio(env: Env) {
    n++;
    const id = `00000000-0000-4000-8000-0000000p10${String(n).padStart(2, '0')}`.replace('p', 'a');
    const slug = `p10-leads-${n}`;
    const store = (await storeFor(env)) as MemoryStore;
    store.seedTenant({ id, name: `Studio ${n}`, slug });
    await store.patchFilmsStudio(id, { pageEnabled: true });
    const send = (body: Record<string, unknown>, ip = `10.${n}.0.1`) =>
      worker.fetch(new Request(`https://films.test/api/studio/${slug}/lead`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), env);
    const leads = () => store.leads.filter((l) => l.tenantId === id);
    return { id, store, send, leads };
  }
  const phone = (i: number) => `05${String(20000000 + i).padStart(8, '0')}`;

  it('the 21st lead of a studio in an hour is refused, from any address', async () => {
    const { send, leads } = await studio(site());
    for (let i = 0; i < LEAD_LIMITS.perStudioHour; i++) {
      expect((await send({ coupleName: `זוג ${i}`, phone: phone(i) }, `198.51.100.${i}`)).status).toBe(200);
    }
    const r = await send({ coupleName: 'זוג 21', phone: phone(99) }, '198.51.100.200');
    expect(r.status).toBe(429);
    expect(((await r.json()) as { error: string }).error).toMatch(/הרבה פניות/);
    expect(leads()).toHaveLength(20);
  });

  it('the same phone in another spelling is one lead (the couple is told "sent" again)', async () => {
    const { send, leads } = await studio(site());
    expect((await send({ coupleName: 'דנה ואבי', phone: '050-111-2233' })).status).toBe(200);
    const again = await send({ coupleName: 'דנה ואבי', phone: '+972 50 111 2233' });
    expect(again.status).toBe(200);
    expect(leads()).toHaveLength(1);
  });

  it('a limiter that cannot count refuses (503) instead of letting leads through', async () => {
    const env = site();
    const { store, send, leads } = await studio(env);
    store.failHits = true;
    try {
      expect((await send({ coupleName: 'א ב', phone: phone(1) })).status).toBe(503);
    } finally {
      store.failHits = false;
    }
    expect(leads()).toHaveLength(0);
  });

  it('with the Turnstile keys the form needs a confirmed token; without them it works as before', async () => {
    const keys = { TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: 'test-secret' };
    const env = site(keys);
    const { send, leads } = await studio(env);
    const realFetch = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      asked.push(String(url));
      const token = (init.body as FormData).get('response');
      return new Response(JSON.stringify({ success: token === 'good-token' }));
    }) as typeof fetch;
    try {
      expect((await send({ coupleName: 'א ב', phone: phone(2) })).status).toBe(400);
      expect((await send({ coupleName: 'א ב', phone: phone(2), turnstileToken: 'forged' })).status).toBe(400);
      expect((await send({ coupleName: 'א ב', phone: phone(2), turnstileToken: 'good-token' })).status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(asked.every((u) => u === 'https://challenges.cloudflare.com/turnstile/v0/siteverify')).toBe(true);
    expect(leads()).toHaveLength(1);
    // The page gets the site key only when both keys are set.
    const pageOf = async (e: Env, slug: string) => ((await (await worker.fetch(new Request(`https://films.test/api/studio/${slug}`), e)).json()) as { turnstileSiteKey: string }).turnstileSiteKey;
    const other = await studio(site({ TURNSTILE_SITE_KEY: 'only-the-site-key' }));
    expect(await pageOf(env, `p10-leads-${n - 1}`)).toBe(keys.TURNSTILE_SITE_KEY);
    expect(await pageOf(site({ TURNSTILE_SITE_KEY: 'only-the-site-key' }), `p10-leads-${n}`)).toBe('');
    expect(other.leads()).toHaveLength(0);
    // No answer from Cloudflare with the keys set: refused, never let through.
    await expect(checkTurnstile(env, 'good-token', null, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).rejects.toMatchObject({ status: 400 });
    await expect(checkTurnstile(site(), undefined, null)).resolves.toBeUndefined();
  });

  it('the daily cap: 100 a day for one studio', async () => {
    const env = site();
    const { id, store, send } = await studio(env);
    store.hits.set(`lead-studio-day:${id}`, Array.from({ length: LEAD_LIMITS.perStudioDay }, () => Date.now() - 2 * 3600_000));
    expect((await send({ coupleName: 'א ב', phone: phone(3) })).status).toBe(429);
  });
});

describe('studio contact fields', () => {
  it('phones and WhatsApp numbers', () => {
    expect(normalizePhone('050-1234567')).toBe('050-1234567');
    expect(normalizePhone('call me')).toBe('');
    expect(whatsappNumber('050-1234567')).toBe('972501234567');
    expect(whatsappNumber('+972 50 123 4567')).toBe('972501234567');
    // Fix plan P41: every spelling of one Israeli number gives the same wa.me number.
    for (const p of ['00972501234567', '00972-50-123-4567', '+972 (0)50-123-4567', '9720501234567', '501234567', '972501234567']) {
      expect(whatsappNumber(p)).toBe('972501234567');
    }
    expect(whatsappNumber('+1 415 555 0123')).toBe('14155550123');
    expect(whatsappNumber('0044 7700 900123')).toBe('447700900123');
  });
  it('social links only for the right site', () => {
    expect(normalizeSocial('vimeo.com/avira', ['vimeo.com'])).toBe('https://vimeo.com/avira');
    expect(normalizeSocial('https://www.youtube.com/@avira', ['youtube.com', 'youtu.be'])).toBe('https://www.youtube.com/@avira');
    expect(normalizeSocial('https://evil.com/vimeo.com', ['vimeo.com'])).toBe('');
  });
  it('reviews are trimmed and typed', () => {
    const r = cleanReviews([{ name: '', text: '  מעולה  ', score: 140, visible: 1, source: 'hacker' }, { text: '' }]).reviews;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ name: 'זוג מאושר', text: 'מעולה', score: 100, visible: true, source: 'manual' });
  });
});
