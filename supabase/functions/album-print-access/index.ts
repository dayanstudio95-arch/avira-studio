// Public, unauthenticated Edge Function backing the print-shop file-download page.
// No Supabase session — the raw token is the print shop's only credential, hashed and
// looked up directly against print_access_links.token_hash on EVERY request (both
// actions re-validate independently — 'listFiles' never trusts a prior 'validate'
// call). revoked_at / expires_at are checked on every lookup, not just at creation.
//
// This function only ever returns time-limited SIGNED Storage URLs — it never proxies
// file bytes itself (Edge Functions here are capped at ~2s CPU / 400s wall-clock, and
// there can be 30-40+ full-resolution files per order). The actual ZIP assembly happens
// client-side in the print shop's own browser, per CLAUDE.md's iron rules.
//
// Delivers only the order's APPROVED version's spreads (album_orders.approved_version_id)
// — never the couple's current in-review draft — so a print shop can only ever receive
// files the couple has actually signed off on.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';

const BUCKET = 'album-files';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour — enough time to assemble a large ZIP client-side

function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

async function resolveLinkByToken(supabase: any, token: string) {
  if (!token || typeof token !== 'string') return { error: 'טוקן חסר', status: 400 };
  const tokenHash = await hashToken(token);
  const { data: link, error } = await supabase
    .from('print_access_links')
    .select('*')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!link) return { error: 'קישור לא תקין', status: 404 };
  if (link.revoked_at) return { error: 'הקישור בוטל', status: 403 };
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return { error: 'הקישור פג תוקף', status: 403 };
  }
  return { link };
}

async function logAccess(supabase: any, link: any, eventType: 'viewed' | 'downloaded', req: Request) {
  try {
    await supabase.from('print_access_events').insert({
      tenant_id: link.tenant_id,
      print_access_link_id: link.id,
      event_type: eventType,
      ip_address: getClientIp(req),
    });
  } catch (e) {
    console.error('[album-print-access] access log insert failed:', e?.message || e);
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const rateLimit = await checkRateLimit(req, 'album-print-access');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { token, action } = body ?? {};
    const supabase = createServiceRoleClient();

    const resolved = await resolveLinkByToken(supabase, token);
    if (resolved.error) return jsonResponse({ error: resolved.error }, { status: resolved.status });
    const link = resolved.link;

    const { data: order } = await supabase
      .from('album_orders')
      .select('id, tenant_id, couple_names_manual, wedding_date_manual, approved_version_id, event_id')
      .eq('id', link.album_order_id)
      .maybeSingle();
    if (!order) return jsonResponse({ error: 'ההזמנה המקושרת לא נמצאה' }, { status: 404 });

    let coupleNames = order.couple_names_manual;
    let weddingDate = order.wedding_date_manual;
    if (order.event_id) {
      const { data: eventRow } = await supabase.from('events').select('couple_names, date').eq('id', order.event_id).maybeSingle();
      coupleNames = coupleNames || eventRow?.couple_names || null;
      weddingDate = weddingDate || eventRow?.date || null;
    }

    if (action === 'validate') {
      await logAccess(supabase, link, 'viewed', req);
      return jsonResponse({
        coupleNames,
        weddingDate,
        ready: !!order.approved_version_id,
      });
    }

    if (action === 'listFiles') {
      if (!order.approved_version_id) {
        return jsonResponse({ error: 'האלבום עדיין לא אושר על ידי הזוג' }, { status: 400 });
      }
      const { data: spreads, error: spreadsError } = await supabase
        .from('album_spreads')
        .select('sequence_number, file_key')
        .eq('version_id', order.approved_version_id)
        .order('sequence_number', { ascending: true });
      if (spreadsError) return jsonResponse({ error: spreadsError.message }, { status: 500 });
      if (!spreads?.length) return jsonResponse({ files: [] });

      const paths = spreads.map((s: any) => s.file_key);
      const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
      if (signError) return jsonResponse({ error: signError.message }, { status: 500 });

      await logAccess(supabase, link, 'downloaded', req);

      const files = spreads.map((s: any, i: number) => ({
        sequenceNumber: s.sequence_number,
        fileName: `spread-${String(s.sequence_number).padStart(2, '0')}${extensionOf(s.file_key)}`,
        signedUrl: signed[i]?.signedUrl ?? null,
      }));
      return jsonResponse({ files });
    }

    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});

function extensionOf(fileKey: string): string {
  const match = /\.[a-zA-Z0-9]+$/.exec(fileKey);
  return match ? match[0] : '';
}
