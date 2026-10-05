// Profile pictures for "אווירה צ'אט" (2026-10-05).
//
// Green API getAvatar — verified against https://green-api.com/en/docs/api/service/GetAvatar/
// on 2026-10-05: POST {chatId} → { urlAvatar, available, base64Avatar }; groups supported;
// empty / available:false when the person hides their picture. We store base64Avatar as a
// file (no second download from WhatsApp's CDN, whose links expire).
//
// Runs from the hourly automation-engine cron: the most recently active conversations
// first, at most AVATAR_BATCH per run, ~6 per second (Green API allows 10/s for this
// method). A picture is re-checked every 14 days. Never throws.
import { greenApiRead } from './whatsapp.ts';

export const AVATAR_BATCH = 80;
export const AVATAR_RECHECK_DAYS = 14;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^,]+,/, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function refreshAvatars(supabase: any, tenantId: string, limit = AVATAR_BATCH): Promise<{ checked: number; saved: number }> {
  const out = { checked: 0, saved: 0 };
  try {
    const cutoff = new Date(Date.now() - AVATAR_RECHECK_DAYS * 86400000).toISOString();
    const { data: rows, error } = await supabase
      .from('whatsapp_conversations')
      .select('id, chat_id, avatar_path')
      .eq('tenant_id', tenantId)
      .or(`avatar_checked_at.is.null,avatar_checked_at.lt."${cutoff}"`)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error || !rows?.length) return out;

    for (const c of rows) {
      const res = await greenApiRead(supabase, 'getAvatar', { chatId: c.chat_id }, tenantId);
      out.checked++;
      const now = new Date().toISOString();
      if (res === null) {
        // Green API unreachable / not configured — stop for this run, try next hour.
        break;
      }
      let avatarPath: string | null = null;
      if (res.available !== false && typeof res.base64Avatar === 'string' && res.base64Avatar.length > 100) {
        try {
          const bytes = decodeBase64(res.base64Avatar);
          const path = `${tenantId}/avatars/${c.id}.jpg`;
          const { error: upErr } = await supabase.storage.from('whatsapp-media').upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
          if (!upErr) {
            avatarPath = path;
            out.saved++;
          }
        } catch (e: any) {
          console.error('[whatsappAvatars] decode/upload failed:', e?.message || e);
        }
      }
      if (!avatarPath && c.avatar_path) {
        // The person hid or removed their picture — respect it.
        await supabase.storage.from('whatsapp-media').remove([c.avatar_path]).catch(() => {});
      }
      await supabase.from('whatsapp_conversations').update({ avatar_path: avatarPath, avatar_checked_at: now }).eq('id', c.id);
      await sleep(150);
    }
  } catch (e: any) {
    console.error('[whatsappAvatars] failed:', e?.message || e);
  }
  return out;
}
