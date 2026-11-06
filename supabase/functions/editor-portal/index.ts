// The video editor's own page (Avira, 2026-11-06, the owner's request) — its only door. The editor has no user in
// the system: he signs in with his phone (his staff_members phone) and a password the owner sets, and gets a token
// whose SHA-256 is looked up on every request (staff_portal_sessions, 0112). Everything goes through the service
// role, scoped by that session: his studio, and only the events where he is the editor (team[].role 'editor').
//
//   login      { phone, password }        → { token, name }
//   list       { token }                  → { name, events }   (open ones, and those delivered in the last 120 days)
//   set_link   { token, eventId, link }   → { event }          (the final film's link; '' takes it off; not once sent)
//   report_fix { token, eventId, newLink, link?, note? } → { event } ("עשיתי תיקונים" on a film the couple got)
//   logout     { token }
// The studio's side (a signed-in owner/admin of the editor's studio):
//   admin_status / admin_set_password { staffMemberId, password } / admin_remove { staffMemberId }
// Public like album-print-access, but called through functions.invoke (the anon key satisfies verify_jwt).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { checkRateLimit, checkRateLimitForKey } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';
import { normalizeIsraeliPhone } from '../_shared/phone.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import {
  LOCK_MINUTES, MAX_FAILED, SESSION_DAYS, applyFix, cleanFilmLink, hashPassword, isEditorOf, newSessionToken, passwordProblem,
  pendingFix, portalEventView, verifyPassword,
} from '../_shared/editorPortal.ts';

const EVENT_COLUMNS = 'id, tenant_id, date, couple_names, venue, team, raw_link, raw_sent_to_editor, film_link, film_link_at, film_sent_at, film_backed_up_at, editor_done, film_fixes';
const DAY = 24 * 60 * 60 * 1000;
const RELOGIN = { relogin: true, error: 'צריך להתחבר שוב' };

const delivered = (e: any) => Boolean(e.film_sent_at) || e.editor_done === true || e.editor_done === 'true';

async function sessionFrom(db: any, token: unknown) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const { data: s } = await db
    .from('staff_portal_sessions')
    .select('id, tenant_id, staff_member_id, expires_at, revoked_at, last_seen_at')
    .eq('token_hash', await hashToken(token))
    .maybeSingle();
  if (!s || s.revoked_at || new Date(s.expires_at).getTime() < Date.now()) return null;
  const [{ data: staff }, { data: access }] = await Promise.all([
    db.from('staff_members').select('id, tenant_id, name').eq('id', s.staff_member_id).maybeSingle(),
    db.from('staff_portal_access').select('id').eq('staff_member_id', s.staff_member_id).maybeSingle(),
  ]);
  if (!staff || !access || staff.tenant_id !== s.tenant_id) return null;
  if (!s.last_seen_at || Date.now() - new Date(s.last_seen_at).getTime() > 60 * 60 * 1000) {
    await db.from('staff_portal_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', s.id);
  }
  return { session: s, staff };
}

async function login(db: any, req: Request, body: any) {
  const byIp = await checkRateLimit(req, 'editor-portal-login', { maxHits: 30, windowSeconds: 900 });
  if (!byIp.allowed) return jsonResponse({ error: 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות' }, { status: 429 });
  const phone = normalizeIsraeliPhone(body?.phone);
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!phone || !password) return jsonResponse({ error: 'מספר טלפון וסיסמה' }, { status: 400 });
  const byPhone = await checkRateLimitForKey(`editor-portal-login:${phone}`, { maxHits: 15, windowSeconds: 900 });
  if (!byPhone.allowed) return jsonResponse({ error: 'יותר מדי ניסיונות, נסו שוב בעוד כמה דקות' }, { status: 429 });

  const { data: rows, error } = await db
    .from('staff_portal_access')
    .select('id, tenant_id, staff_member_id, password_hash, failed_count, locked_until, staff_members(id, tenant_id, name, phone_number, extra_phones)');
  if (error) return jsonResponse({ error: 'שגיאה, נסו שוב' }, { status: 500 });
  const mine = (rows || []).filter((r: any) => {
    const sm = r.staff_members;
    if (!sm || sm.tenant_id !== r.tenant_id) return false;
    return [sm.phone_number, ...(sm.extra_phones || [])].some((p) => normalizeIsraeliPhone(p) === phone);
  });
  const wrong = () => jsonResponse({ error: 'טלפון או סיסמה שגויים' }, { status: 401 });
  if (mine.length === 0) return wrong();

  for (const row of mine) {
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const min = Math.ceil((new Date(row.locked_until).getTime() - Date.now()) / 60000);
      return jsonResponse({ error: `יותר מדי ניסיונות שגויים — נסו שוב בעוד ${min} דקות` }, { status: 429 });
    }
    if (await verifyPassword(password, row.password_hash)) {
      const token = newSessionToken();
      const now = new Date();
      await db.from('staff_portal_access').update({ failed_count: 0, locked_until: null, last_login_at: now.toISOString() }).eq('id', row.id);
      const { error: insErr } = await db.from('staff_portal_sessions').insert({
        tenant_id: row.tenant_id,
        staff_member_id: row.staff_member_id,
        token_hash: await hashToken(token),
        expires_at: new Date(now.getTime() + SESSION_DAYS * DAY).toISOString(),
        last_seen_at: now.toISOString(),
      });
      if (insErr) return jsonResponse({ error: 'שגיאה, נסו שוב' }, { status: 500 });
      return jsonResponse({ token, name: row.staff_members.name });
    }
  }
  // A wrong password counts against every entry with this phone (normally one).
  for (const row of mine) {
    const failed = (row.failed_count || 0) + 1;
    const lock = failed >= MAX_FAILED;
    await db.from('staff_portal_access').update({
      failed_count: lock ? 0 : failed,
      locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : row.locked_until,
    }).eq('id', row.id);
  }
  return wrong();
}

async function list(db: any, who: any) {
  const { data, error } = await db
    .from('events')
    .select(EVENT_COLUMNS)
    .eq('tenant_id', who.staff.tenant_id)
    .filter('team', 'cs', JSON.stringify([{ role: 'editor' }])) // jsonb containment (an array would go out as a Postgres array)
    .gte('date', new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10))
    .lte('date', new Date(Date.now() + DAY).toISOString().slice(0, 10))
    .order('date', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[editor-portal] list:', error.message);
    return jsonResponse({ error: 'שגיאה בטעינת האירועים' }, { status: 500 });
  }
  const since = Date.now() - 120 * DAY;
  const events = (data || [])
    .filter((e: any) => isEditorOf(e.team, who.staff.name))
    .filter((e: any) => !delivered(e) || pendingFix(e.film_fixes) || new Date(e.date).getTime() >= since)
    .map((e: any) => portalEventView(e, who.staff.name));
  return jsonResponse({ name: who.staff.name, events });
}

async function setLink(db: any, who: any, body: any) {
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const raw = typeof body?.link === 'string' ? body.link.trim() : '';
  const { data: ev } = await db.from('events').select(EVENT_COLUMNS).eq('id', eventId).eq('tenant_id', who.staff.tenant_id).maybeSingle();
  if (!ev || !isEditorOf(ev.team, who.staff.name)) return jsonResponse({ error: 'האירוע לא נמצא' }, { status: 404 });
  if (ev.film_sent_at) return jsonResponse({ error: 'הסרט כבר נשלח לזוג — שינוי רק דרך הסטודיו' }, { status: 409 });
  const link = raw ? cleanFilmLink(raw) : null;
  if (raw && !link) return jsonResponse({ error: 'זה לא נראה כמו לינק — צריך להתחיל ב-https://' }, { status: 400 });
  if ((ev.film_link || null) === link) return jsonResponse({ event: portalEventView(ev, who.staff.name) });

  const at = link ? new Date().toISOString() : null;
  const { error } = await db.from('events').update({ film_link: link, film_link_at: at }).eq('id', ev.id).eq('tenant_id', who.staff.tenant_id);
  if (error) return jsonResponse({ error: 'השמירה נכשלה, נסו שוב' }, { status: 500 });
  if (link) {
    // "התראה בדף עצמו" (the owner's choice): the bell and the count beside "עריכת וידאו" — no phone push.
    try {
      const day = ev.date ? new Date(ev.date).toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem' }) : '';
      await db.from('notifications').insert({
        tenant_id: who.staff.tenant_id,
        type: 'staff_film_ready',
        title: `🎬 ${who.staff.name} העלה את הסרט של ${ev.couple_names || 'הזוג'}`,
        body: [day, ev.venue, ev.film_link ? 'הלינק הוחלף — מוכן לשליחה' : 'מוכן לשליחה לזוג'].filter(Boolean).join(' · '),
      });
    } catch (e) {
      console.error('[editor-portal] notification insert failed:', (e as Error)?.message || e);
    }
  }
  return jsonResponse({ event: portalEventView({ ...ev, film_link: link, film_link_at: at }, who.staff.name) });
}

// "עשיתי תיקונים" (2026-11-06): the couple asked him for changes on a film they got; he fixed it, in the same link or
// a new one. The owner gets a notice and sends it from "עריכת וידאו". A new round asks for a backup again (the film
// changed). Pressed again before the owner sent it, it updates that same round.
async function reportFix(db: any, who: any, body: any) {
  const eventId = typeof body?.eventId === 'string' ? body.eventId : '';
  const { data: ev } = await db.from('events').select(EVENT_COLUMNS).eq('id', eventId).eq('tenant_id', who.staff.tenant_id).maybeSingle();
  if (!ev || !isEditorOf(ev.team, who.staff.name)) return jsonResponse({ error: 'האירוע לא נמצא' }, { status: 404 });
  if (!delivered(ev)) return jsonResponse({ error: 'הסרט עוד לא נשלח לזוג — מדביקים את הלינק בשדה של הסרט' }, { status: 409 });
  const newLink = body?.newLink === true;
  const link = newLink ? cleanFilmLink(body?.link) : null;
  if (newLink && !link) return jsonResponse({ error: 'זה לא נראה כמו לינק — צריך להתחיל ב-https://' }, { status: 400 });
  const note = typeof body?.note === 'string' ? body.note : '';
  const at = new Date().toISOString();
  const fixes = applyFix(ev.film_fixes, { at, link: link || ev.film_link || null, newLink, note });
  const patch: Record<string, unknown> = { film_fixes: fixes, film_backed_up_at: null };
  if (link) Object.assign(patch, { film_link: link, film_link_at: at });
  const { error } = await db.from('events').update(patch).eq('id', ev.id).eq('tenant_id', who.staff.tenant_id);
  if (error) return jsonResponse({ error: 'השמירה נכשלה, נסו שוב' }, { status: 500 });
  try {
    const fix = fixes[fixes.length - 1];
    await db.from('notifications').insert({
      tenant_id: who.staff.tenant_id,
      type: 'staff_film_fix',
      title: `🛠️ ${who.staff.name} סיים תיקון ${fix.n} לסרט של ${ev.couple_names || 'הזוג'}`,
      body: [newLink ? 'בקישור חדש' : 'באותו קישור', fix.note].filter(Boolean).join(' · '),
    });
  } catch (e) {
    console.error('[editor-portal] notification insert failed:', (e as Error)?.message || e);
  }
  return jsonResponse({ event: portalEventView({ ...ev, ...patch }, who.staff.name) });
}

// ── the studio's side ─────────────────────────────────────────────────────────────────────────────────────────────
async function admin(db: any, req: Request, action: string, body: any) {
  const user = await getRequestUser(req);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
  const profile = await getCallerProfile(db, user.id);
  if (!profile || !isAdmin(profile.role)) return jsonResponse({ error: 'רק מנהל הסטודיו' }, { status: 403 });
  const staffMemberId = typeof body?.staffMemberId === 'string' ? body.staffMemberId : '';
  const { data: staff } = await db.from('staff_members').select('id, tenant_id, name, phone_number').eq('id', staffMemberId).maybeSingle();
  if (!staff || staff.tenant_id !== profile.tenant_id) return jsonResponse({ error: 'איש הצוות לא נמצא' }, { status: 404 });
  const now = new Date().toISOString();
  const revokeAll = () => db.from('staff_portal_sessions').update({ revoked_at: now }).eq('staff_member_id', staff.id).is('revoked_at', null);

  if (action === 'admin_set_password') {
    if (!normalizeIsraeliPhone(staff.phone_number)) return jsonResponse({ error: `קודם להוסיף ל${staff.name} מספר טלפון — איתו הוא נכנס` }, { status: 400 });
    const problem = passwordProblem(body?.password);
    if (problem) return jsonResponse({ error: problem }, { status: 400 });
    const { error } = await db.from('staff_portal_access').upsert({
      tenant_id: staff.tenant_id,
      staff_member_id: staff.id,
      password_hash: await hashPassword(String(body.password)),
      failed_count: 0,
      locked_until: null,
      updated_at: now,
    }, { onConflict: 'staff_member_id' });
    if (error) return jsonResponse({ error: error.message }, { status: 500 });
    await revokeAll(); // a new password signs every device out
  } else if (action === 'admin_remove') {
    await revokeAll();
    const { error } = await db.from('staff_portal_access').delete().eq('staff_member_id', staff.id);
    if (error) return jsonResponse({ error: error.message }, { status: 500 });
  } else if (action !== 'admin_status') {
    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  }

  const [{ data: access }, { count }] = await Promise.all([
    db.from('staff_portal_access').select('last_login_at, locked_until, updated_at').eq('staff_member_id', staff.id).maybeSingle(),
    db.from('staff_portal_sessions').select('id', { count: 'exact', head: true }).eq('staff_member_id', staff.id).is('revoked_at', null).gt('expires_at', now),
  ]);
  return jsonResponse({
    hasAccess: Boolean(access),
    phone: staff.phone_number || '',
    lastLoginAt: access?.last_login_at || null,
    passwordSetAt: access?.updated_at || null,
    lockedUntil: access?.locked_until || null,
    devices: access ? count || 0 : 0,
  });
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  try {
    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';
    const db = createServiceRoleClient();

    if (action === 'login') return await login(db, req, body);
    if (action.startsWith('admin_')) return await admin(db, req, action, body);

    const limit = await checkRateLimit(req, 'editor-portal', { maxHits: 300, windowSeconds: 600 });
    if (!limit.allowed) return jsonResponse({ error: 'יותר מדי בקשות, נסו שוב בעוד כמה דקות' }, { status: 429 });
    const who = await sessionFrom(db, body?.token);
    if (action === 'logout') {
      if (who) await db.from('staff_portal_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', who.session.id);
      return jsonResponse({ ok: true });
    }
    if (!who) return jsonResponse(RELOGIN);
    if (action === 'list') return await list(db, who);
    if (action === 'set_link') return await setLink(db, who, body);
    if (action === 'report_fix') return await reportFix(db, who, body);
    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (e) {
    console.error('[editor-portal]', (e as Error)?.message || e);
    return jsonResponse({ error: 'שגיאה, נסו שוב' }, { status: 500 });
  }
});
