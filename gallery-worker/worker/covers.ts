import { edge } from './photos';
import type { Env, Gallery } from './types';
import { HttpError } from './types';

/** A cover is a picture for a screen (the hub makes it 2000px, about 1MB): 2MB at most (fix plan P66). */
export const MAX_COVER_BYTES = 2 * 1024 * 1024;

/** How long the edge keeps a cover it read from KV (P66): the access checks still run on every request. */
const COVER_EDGE_SECONDS = 600;

/**
 * A gallery's cover address: `?v=<cover version>` changes with every new cover (P72), so a browser or
 * WhatsApp never keeps showing the old one. Covers from before the version have no `v`.
 */
export function coverPath(id: string, g: Pick<Gallery, 'coverVersion'>, extra = ''): string {
  const q = [g.coverVersion ? `v=${g.coverVersion}` : '', extra].filter(Boolean).join('&');
  return `/api/cover/${id}${q ? `?${q}` : ''}`;
}

/** Saves a new cover under its version (the gallery row gets the same number). */
export async function putCover(env: Env, id: string, request: Request, version: number): Promise<void> {
  const type = request.headers.get('Content-Type') ?? '';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(400, 'תמונת השער חייבת להיות JPG, PNG או WebP');
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) throw new HttpError(400, 'הקובץ ריק');
  if (body.byteLength > MAX_COVER_BYTES) throw new HttpError(400, 'תמונת השער גדולה מדי (עד 2MB)');
  await env.KV.put(`cover:${id}`, body, { metadata: { type, v: version } });
}

/** A cover's place at the edge: per gallery and cover version (the row's), so a new cover is a new place. */
const coverCacheKey = (id: string, version: number | undefined) => new Request(`https://cover-cache.internal/${id}/${Math.floor(version ?? 0)}`);

/**
 * Forgets a gallery's cover at the edge (a new cover, the trash, removed for good). Cloudflare forgets it in this
 * data centre only; elsewhere the copy is unreachable anyway (a new cover has another version, a gallery in the
 * trash stops at the gallery check) and goes by itself within 10 minutes.
 */
export async function forgetCover(id: string, version: number | undefined): Promise<void> {
  await Promise.resolve(edge()?.delete(coverCacheKey(id, version))).catch(() => {});
}

/**
 * The cover of a gallery (the caller checked access). Behind a password it is kept by this browser only.
 * Kept for a year only when the address names the version stored (`asked`); any other address an hour.
 * The picture comes from the edge when it read it in the last 10 minutes (P66: `opts.version` = the gallery
 * row's cover version), else from KV, and is put at the edge after the answer went out (`opts.waitUntil`).
 */
export async function getCover(env: Env, id: string, isPrivate = false, asked: string | null = null, opts: { version?: number; waitUntil?: (p: Promise<unknown>) => void } = {}): Promise<Response> {
  const cache = edge();
  const key = coverCacheKey(id, opts.version);
  const hit = cache ? await Promise.resolve(cache.match(key)).catch(() => undefined) : undefined;
  let value: ArrayBuffer | null;
  let metadata: { type?: string; v?: number } | null;
  if (hit) {
    value = await hit.arrayBuffer();
    const v = hit.headers.get('X-Cover-Version');
    metadata = { type: hit.headers.get('Content-Type') ?? undefined, ...(v ? { v: Number(v) } : {}) };
  } else {
    const read = await env.KV.getWithMetadata<{ type: string; v?: number }>(`cover:${id}`, 'arrayBuffer');
    value = read.value;
    metadata = read.metadata;
    if (value && cache) {
      const headers: Record<string, string> = { 'Content-Type': metadata?.type ?? 'image/jpeg', 'Cache-Control': `public, max-age=${COVER_EDGE_SECONDS}` };
      if (metadata?.v !== undefined) headers['X-Cover-Version'] = String(metadata.v);
      const saving = cache.put(key, new Response(value.slice(0), { headers })).catch(() => {});
      if (opts.waitUntil) opts.waitUntil(saving);
      else await saving;
    }
  }
  if (!value) return new Response('not found', { status: 404 });
  const type = metadata?.type && /^image\/(jpeg|png|webp)$/.test(metadata.type) ? metadata.type : 'image/jpeg';
  const current = Boolean(asked) && metadata?.v !== undefined && String(metadata.v) === asked;
  const age = current ? 'max-age=31536000, immutable' : 'max-age=3600';
  return new Response(value, {
    headers: { 'Content-Type': type, 'Cache-Control': `${isPrivate ? 'private' : 'public'}, ${age}` },
  });
}
