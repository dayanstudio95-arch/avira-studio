// "The couple finished choosing their album photos" (the gallery's "סיימנו לבחור") → WhatsApp to the album group
// (Avira, 2026-10-31, the owner's request; 0099). Two callers:
//   • the gallery Worker, the moment the couple presses it (the service role key; also rings the studio's bell), when
//     the automatic message is on (Settings ← תבניות הודעות; on unless turned off);
//   • the studio's "שליחה לקבוצת אלבומים" in the galleries: a signed-in user of the gallery's studio, an album role.
// Only the gallery's id is taken from the body; the gallery, its event and its link are read here, and the message goes
// only to the studio's own album group (the one chosen for Pixieset, Settings ← חיבורים). The link preview is off
// (see _shared/whatsapp.ts).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { ALBUM_MANAGER_ROLES, getCallerProfile, hasRole } from '../_shared/permissions.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { hebrewDay } from '../_shared/pixiesetFavorites.ts';
import {
  GALLERY_CHOICE_ENABLED_KEY, GALLERY_CHOICE_TEMPLATE_KEY, galleryChoiceLink, phoneForPeople, renderGalleryChoice,
} from '../_shared/galleryChoice.ts';

// The couples' gallery site (the gallery Worker's address).
const GALLERY_BASE = Deno.env.get('GALLERY_BASE_URL') || 'https://gallery.avira-studio.com';

/** The role claim of a JWT ('' for anything else). Read only after the gateway verified it (verify_jwt). */
function jwtRole(token: string): string {
  const part = token.split('.')[1];
  if (!part) return '';
  try {
    return String(JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4)))?.role || '');
  } catch {
    return '';
  }
}

async function setting(supabase: any, tenantId: string, key: string): Promise<string | null> {
  const { data } = await supabase.from('app_settings').select('value').eq('tenant_id', tenantId).eq('key', key).maybeSingle();
  return data?.value ?? null;
}

Deno.serve(async (req) => {
  const pre = handleOptions(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'method not allowed' }, { status: 405 });

  let body: any = {};
  try { body = await req.json(); } catch { return jsonResponse({ error: 'bad json' }, { status: 400 }); }
  const galleryId = String(body?.galleryId || '');
  if (!/^[a-f0-9]{16}$/.test(galleryId)) return jsonResponse({ error: 'bad gallery' }, { status: 400 });

  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  // The Worker's own copy of the service key, or any service-role JWT (verify_jwt is on: the gateway checked its signature).
  const system = (serviceKey !== '' && bearer === serviceKey) || jwtRole(bearer) === 'service_role';

  const supabase = createServiceRoleClient();
  const { data: g } = await supabase
    .from('films_galleries')
    .select('id, tenant_id, kind, couple_name, event_id, event_date, venue, choice_done_count, choice_token, deleted_at')
    .eq('id', galleryId)
    .maybeSingle();
  if (!g || g.deleted_at || g.kind !== 'photos') return jsonResponse({ error: 'הגלריה לא נמצאה' }, { status: 404 });

  if (!system) {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const profile = await getCallerProfile(supabase, user.id, 'role, tenant_id');
    if (!profile || profile.tenant_id !== g.tenant_id || !hasRole(profile.role, ALBUM_MANAGER_ROLES)) {
      return jsonResponse({ error: 'אין הרשאה' }, { status: 403 });
    }
  }

  const link = galleryChoiceLink(GALLERY_BASE, g.choice_token);
  if (!link) return jsonResponse({ error: 'אין קישור לבחירה של הזוג. צרו אותו בחלון הבחירה.' }, { status: 409 });

  const { data: ev } = g.event_id
    ? await supabase.from('events').select('couple_names, date, venue, phone_number, source_lead_id').eq('id', g.event_id).maybeSingle()
    : { data: null };
  const names = ev?.couple_names || g.couple_name || '';
  const count = Number.isFinite(g.choice_done_count) ? String(g.choice_done_count) : '';

  // The studio's bell, for the couple's own press (the studio's button needs none).
  const bell = (sent: boolean) =>
    system
      ? supabase.from('notifications').insert({
          tenant_id: g.tenant_id,
          type: 'gallery_choice_done',
          title: `📸 ${names} סיימו לבחור תמונות לאלבום`,
          body: `${count ? `נבחרו ${count} תמונות. ` : ''}${sent ? 'נשלחה הודעה לקבוצת האלבומים.' : 'ההודעה לקבוצת האלבומים לא נשלחה.'}`,
          related_lead_id: ev?.source_lead_id || null,
        }).then(() => {}, (e: unknown) => console.error('[gallery-choice-notify] bell insert failed:', e))
      : Promise.resolve();

  if (system && (await setting(supabase, g.tenant_id, GALLERY_CHOICE_ENABLED_KEY)) === 'false') {
    await bell(false);
    return jsonResponse({ sent: false, skipped: 'turned off' });
  }
  const groupChatId = await setting(supabase, g.tenant_id, 'pixieset_notify_group_chat_id');
  if (!groupChatId || !/@g\.us$/.test(groupChatId)) {
    await bell(false);
    if (system) return jsonResponse({ sent: false, skipped: 'no group' });
    return jsonResponse({ error: 'לא נבחרה קבוצת וואטסאפ לאלבומים (הגדרות ← חיבורים ← פיקסיסט)' }, { status: 409 });
  }

  const text = renderGalleryChoice(await setting(supabase, g.tenant_id, GALLERY_CHOICE_TEMPLATE_KEY), {
    names,
    event_date: hebrewDay(ev?.date || g.event_date),
    venue: ev?.venue || g.venue || '',
    phone: phoneForPeople(ev?.phone_number),
    count,
    link,
  });
  const sent = await sendWhatsApp(supabase, groupChatId, text, g.tenant_id, { linkPreview: false });
  if (sent.success) {
    await supabase.from('films_galleries').update({ choice_group_sent_at: new Date().toISOString() }).eq('id', g.id);
  } else {
    console.error('[gallery-choice-notify] send failed:', sent.error);
  }
  await bell(sent.success);
  if (!sent.success) return jsonResponse({ sent: false, error: 'השליחה לוואטסאפ לא הצליחה' }, { status: 502 });
  return jsonResponse({ sent: true });
});
