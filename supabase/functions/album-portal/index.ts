// Public, unauthenticated Edge Function backing the couple-facing wedding album
// portal (/album/:token — see App.jsx). No Supabase session ever exists here, exactly
// like get-lead-public / submit-production-questionnaire — the raw token from the URL
// is the couple's only credential. It is hashed (see _shared/albumTokens.ts) and looked
// up directly against album_orders.portal_token_hash on EVERY request (never trusted
// from a prior call), and portal_token_revoked_at is checked every time too, not just
// once at link-creation time. See CLAUDE.md's "Wedding Albums module" section for the
// full set of isolation/security/data-integrity rules this function follows.
//
// Single action-dispatch endpoint (POST { token, action, ...params }), mirroring the
// action-based pattern already used by supabase/functions/coordinator-leads. Every
// action re-resolves the order from the token first — nothing here ever trusts a
// client-supplied albumOrderId/eventId directly.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';
import { hashToken } from '../_shared/albumTokens.ts';

const BUCKET = 'album-files';
const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 min — long enough to browse a full gallery

async function resolveOrderByToken(supabase: any, token: string) {
  if (!token || typeof token !== 'string') return { error: 'טוקן חסר', status: 400 };
  const tokenHash = await hashToken(token);
  const { data: order, error } = await supabase
    .from('album_orders')
    .select('*')
    .eq('portal_token_hash', tokenHash)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!order) return { error: 'קישור לא תקין', status: 404 };
  if (order.portal_token_revoked_at) return { error: 'הקישור בוטל', status: 403 };
  return { order };
}

async function signSpreads(supabase: any, spreads: any[]) {
  if (!spreads.length) return [];
  const paths = spreads.map((s) => s.file_key);
  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  if (error) {
    console.error('[album-portal] createSignedUrls failed:', error.message);
    return spreads.map((s) => ({ id: s.id, sequenceNumber: s.sequence_number, previewUrl: null }));
  }
  return spreads.map((s, i) => ({
    id: s.id,
    sequenceNumber: s.sequence_number,
    previewUrl: signed[i]?.signedUrl ?? null,
  }));
}

async function insertNotification(supabase: any, order: any, type: string, title: string, body: string) {
  try {
    await supabase.from('notifications').insert({
      tenant_id: order.tenant_id,
      type,
      title,
      body,
      related_album_order_id: order.id,
    });
  } catch (e) {
    // Best-effort — a notification failure must never block the couple's action.
    console.error('[album-portal] notification insert failed:', e?.message || e);
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const rateLimit = await checkRateLimit(req, 'album-portal');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const body = await req.json();
    const { token, action } = body ?? {};
    const supabase = createServiceRoleClient();

    const resolved = await resolveOrderByToken(supabase, token);
    if (resolved.error) return jsonResponse({ error: resolved.error }, { status: resolved.status });
    const order = resolved.order;

    if (action === 'getOrder') {
      let currentVersion: any = null;
      if (order.current_version_id) {
        const { data: versionRow } = await supabase
          .from('album_versions')
          .select('id, version_number')
          .eq('id', order.current_version_id)
          .maybeSingle();
        if (versionRow) {
          const { data: spreads } = await supabase
            .from('album_spreads')
            .select('id, sequence_number, file_key')
            .eq('version_id', versionRow.id)
            .order('sequence_number', { ascending: true });
          currentVersion = {
            id: versionRow.id,
            versionNumber: versionRow.version_number,
            spreads: await signSpreads(supabase, spreads ?? []),
          };
        }
      }

      let openRound: any = null;
      if (order.current_version_id) {
        const { data: roundRow } = await supabase
          .from('album_review_rounds')
          .select('id, round_number, status')
          .eq('version_id', order.current_version_id)
          .order('round_number', { ascending: false })
          .limit(1)
          .maybeSingle();
        openRound = roundRow ?? null;
      }

      return jsonResponse({
        id: order.id,
        workflowStatus: order.workflow_status,
        paymentStatus: order.payment_status,
        coupleNamesManual: order.couple_names_manual,
        weddingDateManual: order.wedding_date_manual,
        totalAmount: order.total_amount,
        shippingName: order.shipping_name,
        shippingPhone: order.shipping_phone,
        shippingAddress: order.shipping_address,
        shippingNotes: order.shipping_notes,
        currentVersion,
        latestRound: openRound,
      });
    }

    if (action === 'submitReviewRound') {
      if (!order.current_version_id) {
        return jsonResponse({ error: 'אין גרסת סקיצה פעילה' }, { status: 400 });
      }
      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      if (!decisions.length) {
        return jsonResponse({ error: 'לא התקבלו החלטות על העמודים' }, { status: 400 });
      }

      // Real spreads belonging to this order's current version only — never trust
      // spreadIds the client sent beyond checking they belong here.
      const { data: realSpreads } = await supabase
        .from('album_spreads')
        .select('id')
        .eq('version_id', order.current_version_id);
      const realSpreadIds = new Set((realSpreads ?? []).map((s: any) => s.id));

      const { data: existingRounds } = await supabase
        .from('album_review_rounds')
        .select('id, round_number')
        .eq('version_id', order.current_version_id)
        .order('round_number', { ascending: false })
        .limit(1);
      const nextRoundNumber = (existingRounds?.[0]?.round_number ?? 0) + 1;

      const { data: round, error: roundError } = await supabase
        .from('album_review_rounds')
        .insert({
          tenant_id: order.tenant_id,
          album_order_id: order.id,
          version_id: order.current_version_id,
          round_number: nextRoundNumber,
          status: 'submitted',
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (roundError) return jsonResponse({ error: roundError.message }, { status: 500 });

      const rows = decisions
        .filter((d: any) => realSpreadIds.has(d.spreadId))
        .map((d: any) => ({
          tenant_id: order.tenant_id,
          review_round_id: round.id,
          spread_id: d.spreadId,
          decision: d.decision === 'approved' ? 'approved' : 'needs_revision',
          comment: d.comment || null,
          point_x: typeof d.pointX === 'number' ? d.pointX : null,
          point_y: typeof d.pointY === 'number' ? d.pointY : null,
        }));
      if (rows.length) {
        const { error: decisionsError } = await supabase.from('album_spread_decisions').insert(rows);
        if (decisionsError) return jsonResponse({ error: decisionsError.message }, { status: 500 });
      }

      const allApproved = rows.length === realSpreadIds.size && rows.every((r: any) => r.decision === 'approved');
      const newStatus = allApproved ? 'approved' : 'revision_requested';
      const updatePayload: Record<string, unknown> = { workflow_status: newStatus };
      if (allApproved) updatePayload.approved_version_id = order.current_version_id;

      const { error: updateError } = await supabase.from('album_orders').update(updatePayload).eq('id', order.id);
      if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });

      const displayName = order.couple_names_manual || 'הזמנת אלבום';
      if (allApproved) {
        await insertNotification(supabase, order, 'album_round_approved', `סקיצת אלבום אושרה: ${displayName}`, 'הזוג אישר את כל העמודים בסבב הביקורת.');
      } else {
        await insertNotification(supabase, order, 'album_revision_requested', `נדרש תיקון בסקיצה: ${displayName}`, 'הזוג ביקש תיקונים באחד או יותר מהעמודים (סבב חינם ראשון / מידע בלבד בסבבים הבאים).');
      }

      return jsonResponse({ workflowStatus: newStatus });
    }

    if (action === 'getCatalog') {
      const [{ data: products }, { data: covers }, { data: addons }] = await Promise.all([
        supabase.from('album_products').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_covers').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_addons').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
      ]);
      return jsonResponse({
        products: (products ?? []).map((p: any) => ({ id: p.id, name: p.name, description: p.description, basePrice: p.base_price, albumCount: p.album_count })),
        covers: (covers ?? []).map((c: any) => ({ id: c.id, name: c.name, priceDelta: c.price_delta })),
        addons: (addons ?? []).map((a: any) => ({ id: a.id, name: a.name, price: a.price })),
      });
    }

    if (action === 'submitPurchase') {
      const allowedStatuses = ['approved', 'product_selected', 'awaiting_payment'];
      if (!allowedStatuses.includes(order.workflow_status)) {
        return jsonResponse({ error: 'לא ניתן לבצע רכישה במצב הנוכחי של ההזמנה' }, { status: 400 });
      }

      const { productId, coverId, engravingText, addons, shipping } = body;
      if (!productId) return jsonResponse({ error: 'נא לבחור מוצר' }, { status: 400 });

      const { data: product } = await supabase
        .from('album_products')
        .select('*')
        .eq('id', productId)
        .eq('tenant_id', order.tenant_id)
        .maybeSingle();
      if (!product) return jsonResponse({ error: 'מוצר לא נמצא' }, { status: 404 });

      let cover: any = null;
      if (coverId) {
        const { data: coverRow } = await supabase
          .from('album_covers')
          .select('*')
          .eq('id', coverId)
          .eq('tenant_id', order.tenant_id)
          .maybeSingle();
        cover = coverRow ?? null;
      }

      const addonInputs = Array.isArray(addons) ? addons : [];
      const addonIds = addonInputs.map((a: any) => a.addonId).filter(Boolean);
      let addonRows: any[] = [];
      if (addonIds.length) {
        const { data } = await supabase.from('album_addons').select('*').eq('tenant_id', order.tenant_id).in('id', addonIds);
        addonRows = data ?? [];
      }

      let total = Number(product.base_price) + (cover ? Number(cover.price_delta) : 0);
      const orderAddonRows = addonInputs
        .map((input: any) => {
          const catalogRow = addonRows.find((a) => a.id === input.addonId);
          if (!catalogRow) return null;
          const quantity = Number(input.quantity) > 0 ? Number(input.quantity) : 1;
          total += Number(catalogRow.price) * quantity;
          return {
            tenant_id: order.tenant_id,
            album_order_id: order.id,
            addon_id: catalogRow.id,
            addon_name_snapshot: catalogRow.name,
            addon_price_snapshot: catalogRow.price,
            quantity,
          };
        })
        .filter(Boolean);

      const { error: selectionError } = await supabase.from('album_order_selections').insert({
        tenant_id: order.tenant_id,
        album_order_id: order.id,
        product_id: product.id,
        product_name_snapshot: product.name,
        product_price_snapshot: product.base_price,
        cover_id: cover?.id ?? null,
        cover_name_snapshot: cover?.name ?? null,
        cover_price_delta_snapshot: cover?.price_delta ?? null,
        engraving_text: engravingText || null,
      });
      if (selectionError) return jsonResponse({ error: selectionError.message }, { status: 500 });

      if (orderAddonRows.length) {
        const { error: addonsError } = await supabase.from('album_order_addons').insert(orderAddonRows);
        if (addonsError) return jsonResponse({ error: addonsError.message }, { status: 500 });
      }

      const { error: updateError } = await supabase
        .from('album_orders')
        .update({
          workflow_status: 'awaiting_payment',
          total_amount: total,
          shipping_name: shipping?.name || null,
          shipping_phone: shipping?.phone || null,
          shipping_address: shipping?.address || null,
          shipping_notes: shipping?.notes || null,
        })
        .eq('id', order.id);
      if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });

      return jsonResponse({ workflowStatus: 'awaiting_payment', totalAmount: total });
    }

    if (action === 'createTransferProofUploadUrl') {
      const fileName = (body.fileName || 'proof').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${order.tenant_id}/${order.id}/transfer-proof/${Date.now()}-${fileName}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ path: data.path, token: data.token });
    }

    if (action === 'confirmTransferProofUploaded') {
      const { path } = body;
      const expectedPrefix = `${order.tenant_id}/${order.id}/transfer-proof/`;
      if (!path || !path.startsWith(expectedPrefix)) {
        return jsonResponse({ error: 'נתיב קובץ לא תקין' }, { status: 400 });
      }
      const { error: updateError } = await supabase
        .from('album_orders')
        .update({ transfer_proof_file_key: path, payment_status: 'transfer_pending_review' })
        .eq('id', order.id);
      if (updateError) return jsonResponse({ error: updateError.message }, { status: 500 });

      const displayName = order.couple_names_manual || 'הזמנת אלבום';
      await insertNotification(supabase, order, 'album_transfer_proof_uploaded', `אישור העברה הועלה: ${displayName}`, 'הזוג העלה אסמכתת העברה בנקאית — ממתין לאישור ידני של הסטודיו.');

      return jsonResponse({ paymentStatus: 'transfer_pending_review' });
    }

    return jsonResponse({ error: 'פעולה לא מוכרת' }, { status: 400 });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
