// The owner's Google Drive helper (Avira, 2026-11-02, the owner's request; 0101). The system only reads Drive, so a
// small Google Apps Script in the owner's own Google account (made in Settings ← חיבורים ← גוגל דרייב) calls here every
// 5 minutes: it reports the Drive's used / total space and what it did, and gets the next work — a removed gallery's
// folder to the Drive trash, a starred gallery's folder into "גלריות מועדפים", the star taken off → back where it was.
//
// verify_jwt = false (a Google script has no Supabase session). The credential is the x-avira-token header: a random
// token made in Settings, stored only as its SHA-256 (app_settings.drive_helper_token_hash) — the lookup by hash is also
// how the studio (tenant) is found; nothing in the body is trusted for that. Work written before the script was made, or
// more than DRIVE_TASK_DAYS ago, is never handed out.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimitForKey } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';
import {
  DRIVE_CONNECTED_KEY, DRIVE_LAST_KEY, DRIVE_LIMIT_KEY, DRIVE_TASK_DAYS, DRIVE_TASKS_PER_RUN, DRIVE_TOKEN_KEY, DRIVE_USED_KEY, DRIVE_VERSION_KEY,
  parseSync,
} from '../_shared/driveHelper.ts';

async function setting(supabase: any, tenantId: string, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function upsertSetting(supabase: any, tenantId: string, key: string, value: string) {
  await supabase.from('app_settings').upsert({ tenant_id: tenantId, key, value }, { onConflict: 'tenant_id,key' });
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 });

  const token = req.headers.get('x-avira-token') || '';
  if (token.length < 20) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const rl = await checkRateLimitForKey(`drive-helper:${(await hashToken(token)).slice(0, 16)}`, { maxHits: 60, windowSeconds: 600 });
  if (!rl.allowed) return jsonResponse({ error: 'too many requests' }, { status: 429 });

  const supabase = createServiceRoleClient();
  const { data: owner } = await supabase
    .from('app_settings')
    .select('tenant_id')
    .eq('key', DRIVE_TOKEN_KEY)
    .eq('value', await hashToken(token))
    .maybeSingle();
  if (!owner?.tenant_id) return jsonResponse({ error: 'unauthorized' }, { status: 401 });
  const tenantId = owner.tenant_id as string;

  let body: unknown = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: 'bad json' }, { status: 400 }); }
  const { storage, results, version } = parseSync(body);
  const now = new Date().toISOString();

  if (storage) {
    await upsertSetting(supabase, tenantId, DRIVE_USED_KEY, String(storage.used));
    await upsertSetting(supabase, tenantId, DRIVE_LIMIT_KEY, String(storage.limit));
  }
  await upsertSetting(supabase, tenantId, DRIVE_LAST_KEY, now);
  // Which script runs: a version 1 script skips "file" (0110), the upload panel says to update it.
  await upsertSetting(supabase, tenantId, DRIVE_VERSION_KEY, String(version));

  // What the script did: only this studio's pending tasks change.
  for (const r of results) {
    const { data: task } = await supabase
      .from('drive_tasks')
      .update({ status: r.ok ? 'done' : 'failed', error: r.ok ? null : r.error || 'נכשל', done_at: now })
      .eq('id', r.id)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending')
      .select('kind, gallery_id')
      .maybeSingle();
    if (!task || !r.ok || !task.gallery_id) continue;
    // Moved into "גלריות מועדפים": where it was, for the way back; moved back: nothing to remember.
    if (task.kind === 'to_favorites' && r.prevParentId) {
      await supabase.from('films_galleries').update({ drive_prev_parent: r.prevParentId }).eq('id', task.gallery_id).eq('tenant_id', tenantId);
    } else if (task.kind === 'restore') {
      await supabase.from('films_galleries').update({ drive_prev_parent: null }).eq('id', task.gallery_id).eq('tenant_id', tenantId);
    }
  }

  // The next work: written after this script was made, and recently.
  const connectedAt = (await setting(supabase, tenantId, DRIVE_CONNECTED_KEY)) || now;
  const weekAgo = new Date(Date.now() - DRIVE_TASK_DAYS * 86400000).toISOString();
  const since = new Date(Math.max(Date.parse(connectedAt) || 0, Date.parse(weekAgo))).toISOString();
  // Filing a gallery's folder (0110) waits for the script, even one made after it (the owner updates the script for it).
  // A version 1 script does not know it: it gets none, so they wait for the new one.
  let query = supabase.from('drive_tasks').select('id, kind, folder_id, parent_id, path').eq('tenant_id', tenantId).eq('status', 'pending');
  query = version >= 2 ? query.or(`created_at.gte.${since},and(kind.eq.file,created_at.gte.${weekAgo})`) : query.gte('created_at', since).neq('kind', 'file');
  const { data: tasks } = await query.order('created_at', { ascending: true }).limit(DRIVE_TASKS_PER_RUN);

  return jsonResponse({
    tasks: (tasks || []).map((t: any) => ({ id: t.id, kind: t.kind, folderId: t.folder_id, parentId: t.parent_id || '', path: Array.isArray(t.path) ? t.path : [] })),
  });
});
