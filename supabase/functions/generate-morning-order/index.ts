// "הזמנת עבודה" (2026-10-21, the owner's request) — the studio's order book in Morning
// (document type 100 "הזמנה"). Actions:
//   preview  — POST /documents/preview: the PDF as Morning would print it; nothing is created.
//   create   — POST /documents: issues the order and records it in work_orders. With
//              replacesOrderId it is a replacement order ("הזמנה מעודכנת", e.g. the couple pays
//              the videographer directly): the old one is marked replaced here and closed in
//              Morning (an order cannot be edited or cancelled there).
//   resolve  — an issue whose outcome is unknown (the connection broke while Morning answered):
//              looks the order up in Morning (POST /documents/search) and either completes the
//              row or releases it. Never issues anything.
//   linked   — GET /documents/{id}/linked: the documents Morning holds as linked to an order.
// A Morning document cannot be deleted, so a second order must never be issued by accident:
// the row is reserved BEFORE Morning is called ('issuing'; the replaced order is claimed as
// 'replacing'), and the unique index in 0091 makes a concurrent attempt fail first.
// Owners/admins/studio managers only. Everything is read through the caller's own client, so
// RLS keeps it to their studio. Spec: developers.morning.co/docs/openapi.bundled.json (2.0.0).
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { getCallerProfile, isAdmin } from '../_shared/permissions.ts';
import { openMorningSession, morningErrorText, businessTypeOf, BUSINESS_LABEL, isDefiniteRefusal } from '../_shared/morningClient.ts';
import {
  validateOrderLines, linesTotal, buildOrderPayload, mergeRemarks, MAX_REMARKS, ORDER_DOC_TYPE, dateOrNull, classifyIssuedOrders,
} from '../_shared/workOrder.ts';

// An unfinished issue may be checked only after this — far beyond the 60s limit on every
// Morning call (MORNING_TIMEOUT_MS), so the request that started it is surely over.
const RESOLVE_AFTER_MS = 5 * 60 * 1000;
const SEARCH_MAX_PAGES = 10;
const PENDING_TEXT = 'לא ברור אם ההזמנה הופקה ב-Morning (החיבור נקטע באמצע). היא מסומנת "בבדיקה" בכרטיס הזמנת העבודה — בעוד כמה דקות לחצו שם "בדוק מול Morning". אל תפיקו הזמנה חדשה בינתיים.';

const israelDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(d);
const urlOf = (doc: any) => (doc?.url && typeof doc.url === 'object' ? (doc.url.he || doc.url.origin || null) : (doc?.url || null));
const round2 = (n: number) => Math.round(n * 100) / 100;

// Give back a reservation that never reached Morning, and the order it was replacing — one
// transaction (work_order_release in 0091).
async function release(supabase: any, slotId: string) {
  const { data, error } = await supabase.rpc('work_order_release', { p_slot: slotId });
  return { released: data === true, error: error?.message || null };
}

// After a replacement order: the couple's final price drops by what left the order (e.g. the
// video paid directly to the supplier) — only when the owner ticked it in the window.
async function lowerFinalPrice(supabase: any, leadId: string, diff: number) {
  if (!(diff > 0)) return null;
  const { data: l } = await supabase.from('leads').select('final_price, total_paid').eq('id', leadId).maybeSingle();
  if (!l) return null;
  const from = Number(l.final_price) || 0;
  const to = Math.max(0, round2(from - diff));
  const { error } = await supabase.from('leads')
    .update({ final_price: to, remaining_balance: Math.max(0, round2(to - (Number(l.total_paid) || 0))) })
    .eq('id', leadId);
  if (error) return { error: error.message };
  // The event's price, when it still matches the lead's (an event priced by hand is left alone).
  await supabase.from('events').update({ total_amount_gross: to }).eq('source_lead_id', leadId).eq('total_amount_gross', from);
  return { from, to };
}

// The document exists in Morning — the reservation becomes the order and the replaced one is
// marked replaced, in one transaction (work_order_finish in 0091); then the old one is closed
// in Morning.
async function finishIssued(supabase: any, session: any, slot: any, replaced: any, doc: any) {
  const args = {
    p_slot: slot.id,
    p_morning_id: String(doc.id),
    p_morning_number: Number(doc.number) || null,
    p_morning_client_id: doc.client?.id ? String(doc.client.id) : (replaced?.morning_client_id || null),
    p_morning_url: urlOf(doc),
  };
  let res = await supabase.rpc('work_order_finish', args);
  if (res.error && !String(res.error.message).includes('work_order_slot_gone')) res = await supabase.rpc('work_order_finish', args);
  if (res.error) {
    if (String(res.error.message).includes('work_order_slot_gone')) {
      // Should not happen (a reservation is checked only long after its request ended) —
      // said loudly, with the number, so it is recorded by hand.
      return {
        success: false, pending: false,
        error: `ההזמנה הופקה ב-Morning (מס' ${doc.number}) אבל שמירת המקום שלה כבר לא קיימת במערכת. רשמו את המספר ופנו לתמיכה — אל תפיקו הזמנה נוספת.`,
      };
    }
    return {
      success: false, pending: true, order: slot,
      warning: `ההזמנה הופקה ב-Morning (מס' ${doc.number}) אבל השמירה במערכת נכשלה (${res.error.message}). בעוד כמה דקות לחצו "בדוק מול Morning" בכרטיס הזמנת העבודה — זה ישלים אותה. אל תפיקו הזמנה חדשה.`,
    };
  }
  const order = res.data;
  const warnings: string[] = [];
  if (replaced) {
    // Closed in Morning ("סגור ידנית"). Only an open order can be closed; one Morning already
    // closed by itself (2400) stays as it is.
    const closed = await session.call('POST', `/documents/${encodeURIComponent(replaced.morning_id)}/close`, {});
    if (!closed.ok && closed.errorCode !== 2400) {
      warnings.push(`${morningErrorText(closed, `סגירת הזמנה מס' ${replaced.morning_number}`)} — אפשר לסגור אותה ידנית ב-Morning.`);
    }
  }
  // The couple's business, when nothing decided it yet — so the next invoice goes to the same one.
  if (slot.lead_id) {
    await supabase.from('leads').update({ payment_entity: slot.business_type }).eq('id', slot.lead_id).is('payment_entity', null);
  }
  return { success: true, order, ...(warnings.length ? { warning: warnings.join(' · ') } : {}) };
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });
    const supabase = createUserClient(req);
    const profile = await getCallerProfile(supabase, user.id, 'role, tenant_id');
    if (!profile?.tenant_id || !isAdmin(profile.role)) return jsonResponse({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || '');

    // ---- linked ----------------------------------------------------------------
    if (action === 'linked') {
      const { data: order } = await supabase.from('work_orders').select('*').eq('id', String(body.orderId || '')).maybeSingle();
      if (!order?.morning_id) return jsonResponse({ error: 'ההזמנה לא נמצאה' }, { status: 404 });
      const session = await openMorningSession(supabase, order.business_type);
      if (!session.ok) return jsonResponse({ error: session.message }, { status: session.status });
      const r = await session.call('GET', `/documents/${encodeURIComponent(order.morning_id)}/linked`);
      if (!r.ok) return jsonResponse({ error: morningErrorText(r, 'קריאת המסמכים המקושרים') }, { status: 502 });
      return jsonResponse({ success: true, linked: Array.isArray(r.data) ? r.data : [] });
    }

    // ---- resolve ---------------------------------------------------------------
    // body: { orderId, pickMorningId?, forceRelease? }
    if (action === 'resolve') {
      const { data: slot } = await supabase.from('work_orders').select('*').eq('id', String(body.orderId || '')).maybeSingle();
      if (!slot || slot.status !== 'issuing') return jsonResponse({ error: 'אין כאן הזמנה שממתינה לבדיקה — רעננו את החלון' }, { status: 400 });
      const since = Date.parse(slot.created_at);
      if (Date.now() - since < RESOLVE_AFTER_MS) {
        return jsonResponse({ error: 'ההפקה התחילה לפני פחות מ-5 דקות — נסו שוב בעוד כמה דקות' }, { status: 409 });
      }
      // The owner checked Morning himself and the order is not there.
      if (body.forceRelease) {
        if (profile.role !== 'owner') return jsonResponse({ error: 'רק בעל הסטודיו יכול לשחרר ידנית' }, { status: 403 });
        const rel = await release(supabase, slot.id);
        if (!rel.released) return jsonResponse({ error: `השחרור נכשל${rel.error ? `: ${rel.error}` : ''}` }, { status: 500 });
        return jsonResponse({ success: true, resolved: 'not_issued' });
      }
      const { data: replaced } = slot.replaces_order_id
        ? await supabase.from('work_orders').select('*').eq('id', slot.replaces_order_id).maybeSingle()
        : { data: null };
      const session = await openMorningSession(supabase, slot.business_type);
      if (!session.ok) return jsonResponse({ error: session.message }, { status: session.status });
      // Every order document of the business since the day before the attempt — no client
      // filter, so a name Morning stored differently cannot hide it. All pages, or no decision.
      const items: any[] = [];
      let complete = false;
      for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
        const r = await session.call('POST', '/documents/search', {
          page, pageSize: 100, type: [ORDER_DOC_TYPE], fromDate: israelDate(new Date(since - 24 * 3600 * 1000)),
        });
        if (!r.ok) return jsonResponse({ error: `${morningErrorText(r, 'החיפוש')}. לא שיניתי כלום — נסו שוב מאוחר יותר.` }, { status: 502 });
        items.push(...(Array.isArray(r.data?.items) ? r.data.items : []));
        if (page >= (Number(r.data?.pages) || 1)) { complete = true; break; }
      }
      if (!complete) return jsonResponse({ error: 'יותר מדי הזמנות ב-Morning בטווח הבדיקה — צריך לבדוק ידנית.' }, { status: 409 });
      const ids = items.filter((d) => Number(d?.type) === ORDER_DOC_TYPE).map((d) => String(d.id));
      const { data: known } = ids.length
        ? await supabase.from('work_orders').select('morning_id').in('morning_id', ids)
        : { data: [] };
      const { candidates, exact } = classifyIssuedOrders(items, {
        coupleNames: slot.couple_names,
        clientId: replaced?.morning_client_id || null,
        total: Number(slot.total),
        eventDate: slot.event_date,
        sinceMs: since,
        knownIds: new Set((known || []).map((k: any) => String(k.morning_id))),
      });
      const picked = body.pickMorningId ? candidates.find((d) => String(d.id) === String(body.pickMorningId)) : null;
      if (body.pickMorningId && !picked) return jsonResponse({ error: 'המסמך שנבחר כבר לא מתאים — רעננו ובדקו שוב' }, { status: 409 });
      const doc = picked || (exact.length === 1 ? exact[0] : null);
      if (doc) {
        const done: any = await finishIssued(supabase, session, slot, replaced, doc);
        return jsonResponse(done.success ? { ...done, resolved: 'issued' } : done);
      }
      if (candidates.length === 0) {
        const rel = await release(supabase, slot.id);
        if (!rel.released) return jsonResponse({ error: `השחרור נכשל${rel.error ? `: ${rel.error}` : ''} — נסו שוב` }, { status: 500 });
        return jsonResponse({ success: true, resolved: 'not_issued' });
      }
      // Unrecorded orders exist but none is surely this one — the owner picks.
      return jsonResponse({
        needsPick: true,
        error: `נמצאו ב-Morning הזמנות שלא רשומות במערכת — בחרו את ההזמנה של הזוג, או שחררו אם אף אחת מהן לא שלו.`,
        candidates: candidates.slice(0, 10).map((d) => ({
          id: String(d.id), number: d.number, amount: d.amount, client: d.client?.name || '', description: d.description || '', documentDate: d.documentDate || null,
        })),
      });
    }

    if (action !== 'preview' && action !== 'create') return jsonResponse({ error: 'unknown action' }, { status: 400 });

    // ---- shared input -----------------------------------------------------------
    const businessType = businessTypeOf(body.businessType);
    const leadId = body.leadId ? String(body.leadId) : null;
    if (!leadId) return jsonResponse({ error: 'חסר הזוג (leadId)' }, { status: 400 });
    // exactly the name sent to Morning (it is cut to 200 there) — stored the same
    const coupleNames = String(body.coupleNames || '').trim().slice(0, 200);
    if (!coupleNames) return jsonResponse({ error: 'חסרים שמות הזוג' }, { status: 400 });
    const eventDate = dateOrNull(body.eventDate);
    const receivedOn = dateOrNull(body.receivedOn);
    const checked = validateOrderLines(body.lines);
    if ('error' in checked) return jsonResponse({ error: checked.error }, { status: 400 });
    const lines = checked.lines;
    const total = linesTotal(lines);
    const ourRemarks = String(body.remarks || '').trim();
    if (ourRemarks.length > MAX_REMARKS) return jsonResponse({ error: `ההערה ארוכה מדי (עד ${MAX_REMARKS} תווים)` }, { status: 400 });

    const { data: lead } = await supabase.from('leads').select('id').eq('id', leadId).maybeSingle();
    if (!lead) return jsonResponse({ error: 'הליד לא נמצא' }, { status: 404 });

    let replaced: any = null;
    if (body.replacesOrderId) {
      const { data } = await supabase.from('work_orders').select('*').eq('id', String(body.replacesOrderId)).maybeSingle();
      if (!data || data.status !== 'active') return jsonResponse({ error: 'ההזמנה שמחליפים לא נמצאה, כבר מתעדכנת או שכבר לא פעילה — רעננו את החלון' }, { status: 400 });
      if (data.business_type !== businessType) return jsonResponse({ error: `ההזמנה המקורית היא של ה${BUSINESS_LABEL[data.business_type]} — ההזמנה המעודכנת חייבת לצאת מאותו עסק` }, { status: 400 });
      if (data.lead_id !== leadId) return jsonResponse({ error: 'ההזמנה המקורית שייכת לזוג אחר' }, { status: 400 });
      replaced = data;
    } else if (action === 'create') {
      // A friendly message first; the unique index below is the real guard.
      const { data: open } = await supabase.from('work_orders').select('id, morning_number, status')
        .eq('lead_id', leadId).eq('business_type', businessType).in('status', ['active', 'issuing', 'replacing']).limit(1);
      if (open?.length) {
        return jsonResponse({
          error: open[0].status !== 'active'
            ? 'יש לזוג הזמנה שההפקה שלה לא הסתיימה — לחצו "בדוק מול Morning" בכרטיס הזמנת העבודה.'
            : `לזוג כבר יש הזמנת עבודה פעילה (מס' ${open[0].morning_number}). לשינוי — "הזמנה מעודכנת".`,
        }, { status: 409 });
      }
    }

    const session = await openMorningSession(supabase, businessType);
    if (!session.ok) return jsonResponse({ error: session.message }, { status: session.status });

    // The business's own default remark for orders, so ours does not silently replace it.
    const info = await session.call('GET', `/documents/info?type=${ORDER_DOC_TYPE}`);
    if (!info.ok) return jsonResponse({ error: `${morningErrorText(info, 'קריאת הגדרות ההזמנה (ההערה הקבועה של העסק)')}. נסו שוב.` }, { status: 502 });
    const defaultRemark = String(info.data?.remark?.he || '');
    const remarks = mergeRemarks(defaultRemark, ourRemarks);
    if (remarks.length > MAX_REMARKS) {
      return jsonResponse({
        error: `ההערות ארוכות מדי: יחד עם ההערה הקבועה של העסק ב-Morning מותר עד ${MAX_REMARKS} תווים — קצרו ב-${remarks.length - MAX_REMARKS} תווים.`,
      }, { status: 400 });
    }
    const payload = buildOrderPayload({ coupleNames, eventDate, lines, remarks, clientId: replaced?.morning_client_id || null });

    // ---- preview ------------------------------------------------------------------
    if (action === 'preview') {
      const r = await session.call('POST', '/documents/preview', payload);
      if (!r.ok || !r.data?.file) return jsonResponse({ error: morningErrorText(r, 'תצוגה מקדימה') }, { status: 502 });
      return jsonResponse({ success: true, file: r.data.file, nextNumber: info.data?.number ?? null });
    }

    // ---- create -------------------------------------------------------------------
    // The document's date is "today" in the business's timezone (DocumentInfo.today), not UTC.
    const today = (typeof info.data?.today === 'string' && info.data.today) || israelDate(new Date());

    // 1. Reserve (one transaction): claim the replaced order and write the 'issuing' row —
    //    before anything reaches Morning. A concurrent attempt fails here.
    const { data: slot, error: slotErr } = await supabase.rpc('work_order_reserve', {
      p_lead_id: leadId,
      p_business_type: businessType,
      p_replaces: replaced?.id || null,
      p_document_date: today,
      p_received_on: receivedOn,
      p_couple_names: coupleNames,
      p_event_date: eventDate,
      p_lines: lines,
      p_total: total,
      p_remarks: remarks || null,
      p_replace_reason: replaced ? String(body.replaceReason || '').slice(0, 300) || null : null,
    });
    if (slotErr || !slot?.id) {
      const msg = String(slotErr?.message || '');
      if ((slotErr as any)?.code === '23505') return jsonResponse({ error: 'לזוג כבר יש הזמנת עבודה פעילה או הזמנה שנמצאת בהפקה — רעננו את החלון' }, { status: 409 });
      if (msg.includes('work_order_replace_conflict')) return jsonResponse({ error: 'ההזמנה שמחליפים כבר מתעדכנת או הוחלפה — רעננו את החלון' }, { status: 409 });
      return jsonResponse({ error: `שמירת ההזמנה נכשלה: ${msg || 'לא ידוע'}` }, { status: 500 });
    }

    // 2. Issue.
    const created = await session.call('POST', '/documents', payload);
    if (!created.ok || !created.data?.id) {
      if (isDefiniteRefusal(created)) {
        const rel = await release(supabase, slot.id);
        const err = morningErrorText(created, 'הפקת ההזמנה');
        // Morning refused, so nothing exists there; if even the release failed, the card shows
        // the reservation and "בדוק מול Morning" clears it.
        return jsonResponse({ error: rel.released ? err : `${err}. (שמירת המקום לא שוחררה — לחצו "בדוק מול Morning" בכרטיס.)` }, { status: 502 });
      }
      // Unknown (connection broke / timed out / 5xx) — the reservation stays and blocks new
      // orders until 'resolve'.
      return jsonResponse({ success: false, pending: true, order: slot, warning: PENDING_TEXT }, { status: 202 });
    }

    // 3. Complete.
    const done: any = await finishIssued(supabase, session, slot, replaced, created.data);
    if (done.success && replaced && body.updateFinalPrice) {
      const priceUpdate = await lowerFinalPrice(supabase, leadId, round2(Number(replaced.total) - total));
      return jsonResponse({ ...done, priceUpdate });
    }
    return jsonResponse(done, { status: done.success || done.pending ? (done.success ? 200 : 202) : 500 });
  } catch (error) {
    return jsonResponse({ error: `שגיאה: ${(error as Error).message}` }, { status: 500 });
  }
});
