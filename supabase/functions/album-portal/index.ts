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

// Runs `fn` over `items` with at most `limit` calls in flight at once. Firing all
// 30-40 spreads' signed-URL (transform) requests in one Promise.all overwhelmed
// Supabase's image-render pipeline (observed as bulk network failures on the
// admin grid, same root cause) — a small concurrency cap is much gentler.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Authoritative, server-side engraving pricing matrix. Kept in sync manually with the
// identical (display-only) copy in src/pages/AlbumPortal.jsx — this copy is the one that
// actually determines what gets charged and snapshotted, never trust the client's total.
const ENGRAVING_PRICES: Record<string, Record<string, number>> = {
  colored: { main_only: 110, full_set: 220 },
  blind: { main_only: 100, full_set: 130 },
};
function getEngravingPrice(type: string | null, scope: string | null): number {
  if (!type || !scope) return 0;
  return ENGRAVING_PRICES[type]?.[scope] ?? 0;
}
// Blind (colorless) engraving is only allowed on faux-leather base covers — hard
// restriction, enforced here (not just hinted at in the UI).
const BLIND_ENGRAVING_ALLOWED_COVER_TYPE = 'faux_leather';

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
  // Prefer each spread's small, dedicated thumb file (album_spreads.thumb_file_key,
  // generated client-side in the admin at upload time -- see src/lib/imageCompress.js
  // and 0043_album_spread_thumbnails.sql) over resize-on-read of the full-resolution
  // original. Confirmed 2026-08-24 that Supabase Storage's Image Transformation
  // service has a hard source-file-size cap this studio's real spread files (25-30MB
  // originals) are all over -- every transform request against the original fails
  // with "The source image file is too large to process". The thumb file is already
  // small, so it's signed directly with no transform needed.
  //
  // Spreads uploaded before 0043 have no thumb_file_key yet -- fall back to the old
  // resize-on-read attempt against the original for those (harmless: it just
  // degrades to previewUrl:null for the same oversized files that always failed
  // before). There's no browser/canvas available here to backfill a thumb
  // server-side (and doing so would reintroduce the server-side preview-pipeline
  // CLAUDE.md's iron rule warns against) -- once the studio opens that spread once
  // in the admin grid (AlbumOrderDetail.jsx's lazy backfill), thumb_file_key is
  // persisted and this path picks it up automatically on the couple's next visit.
  //
  // IMPORTANT: the *batch* `createSignedUrls` (plural) does NOT support the
  // `transform` option at all -- the storage-js SDK silently drops it (its batch
  // sign endpoint only ever accepts `{ expiresIn, paths }`), so signing must be
  // done one spread at a time regardless. Capped concurrency, not one big
  // Promise.all -- see mapWithConcurrency above.
  const results = await mapWithConcurrency(spreads, 6, (s) =>
    s.thumb_file_key
      ? supabase.storage.from(BUCKET).createSignedUrl(s.thumb_file_key, SIGNED_URL_TTL_SECONDS)
      : supabase.storage
          .from(BUCKET)
          .createSignedUrl(s.file_key, SIGNED_URL_TTL_SECONDS, { transform: { width: 1600, quality: 75 } })
  );
  return spreads.map((s, i) => {
    const { data, error } = results[i];
    if (error) console.error('[album-portal] createSignedUrl failed:', error.message);
    return { id: s.id, sequenceNumber: s.sequence_number, previewUrl: data?.signedUrl ?? null };
  });
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
            .select('id, sequence_number, file_key, thumb_file_key')
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
      const [{ data: products }, { data: covers }, { data: addons }, { data: engravingColors }, { data: engravingFonts }] = await Promise.all([
        supabase.from('album_products').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_covers').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_addons').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_engraving_colors').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
        supabase.from('album_engraving_fonts').select('*').eq('tenant_id', order.tenant_id).eq('active', true).order('sort_order'),
      ]);
      return jsonResponse({
        products: (products ?? []).map((p: any) => ({ id: p.id, name: p.name, description: p.description, basePrice: p.base_price, albumCount: p.album_count })),
        covers: (covers ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          coverType: c.cover_type,
          previewImageUrl: c.preview_image_url,
          priceDelta: c.price_delta,
        })),
        addons: (addons ?? []).map((a: any) => ({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          previewImageUrl: a.preview_image_url,
          allowsMultipleImages: a.allows_multiple_images,
          requiresUpload: a.requires_upload,
          price: a.price,
          priceType: a.price_type,
        })),
        engravingColors: (engravingColors ?? []).map((c: any) => ({
          id: c.id,
          name: c.name,
          hexColor: c.hex_color,
          previewImageUrl: c.preview_image_url,
        })),
        engravingFonts: (engravingFonts ?? []).map((f: any) => ({
          id: f.id,
          name: f.name,
          cssFontFamily: f.css_font_family,
          previewImageUrl: f.preview_image_url,
          previewImageDeboss: f.preview_image_deboss,
          previewImageColor: f.preview_image_color,
        })),
      });
    }

    if (action === 'submitPurchase') {
      const allowedStatuses = ['approved', 'product_selected', 'awaiting_payment'];
      if (!allowedStatuses.includes(order.workflow_status)) {
        return jsonResponse({ error: 'לא ניתן לבצע רכישה במצב הנוכחי של ההזמנה' }, { status: 400 });
      }

      const {
        productId,
        coverId,
        engravingText,
        engravingTextLine2,
        engravingType,
        engravingScope,
        engravingColorId,
        engravingFontId,
        addons,
        shipping,
      } = body;
      if (!productId) return jsonResponse({ error: 'נא לבחור מוצר' }, { status: 400 });

      const validEngravingType = engravingType === 'colored' || engravingType === 'blind' ? engravingType : null;
      const validEngravingScope = engravingScope === 'main_only' || engravingScope === 'full_set' ? engravingScope : null;

      const { data: product } = await supabase
        .from('album_products')
        .select('*')
        .eq('id', productId)
        .eq('tenant_id', order.tenant_id)
        .maybeSingle();
      if (!product) return jsonResponse({ error: 'מוצר לא נמצא' }, { status: 404 });

      // A cover selection is now mandatory — "no cover" is not a real-world option.
      if (!coverId) return jsonResponse({ error: 'נא לבחור כריכה' }, { status: 400 });
      const { data: coverRow } = await supabase
        .from('album_covers')
        .select('*')
        .eq('id', coverId)
        .eq('tenant_id', order.tenant_id)
        .maybeSingle();
      if (!coverRow) return jsonResponse({ error: 'כריכה לא נמצאה' }, { status: 404 });
      const cover: any = coverRow;

      // Hard restriction: blind (colorless) engraving is only valid on faux-leather covers.
      if (validEngravingType === 'blind' && cover.cover_type !== BLIND_ENGRAVING_ALLOWED_COVER_TYPE) {
        return jsonResponse({ error: 'הטבעת שמות ללא צבע אפשרית רק על כריכת עור סינטטי' }, { status: 400 });
      }

      let engravingColor: any = null;
      if (engravingColorId) {
        const { data: colorRow } = await supabase
          .from('album_engraving_colors')
          .select('*')
          .eq('id', engravingColorId)
          .eq('tenant_id', order.tenant_id)
          .maybeSingle();
        engravingColor = colorRow ?? null;
      }

      let engravingFont: any = null;
      if (engravingFontId) {
        const { data: fontRow } = await supabase
          .from('album_engraving_fonts')
          .select('*')
          .eq('id', engravingFontId)
          .eq('tenant_id', order.tenant_id)
          .maybeSingle();
        engravingFont = fontRow ?? null;
      }

      // Server-authoritative "extra pages" charge. The couple never manually picks
      // this in the UI (see AlbumPortal.jsx's addons step, which filters the
      // 'extra_pages' catalog category out of the pickable list) -- it's computed
      // purely from the real album_spreads count of the order's current (== approved,
      // by the time a purchase can be submitted) version vs. the 30-page baseline
      // every product's base_price already includes. Never trust a client-supplied
      // quantity for this: recomputed here from the DB, and any addonId the client
      // still sent for this specific catalog row is dropped below (defense in depth).
      const PAGE_BASELINE = 30;
      let spreadCount = 0;
      if (order.current_version_id) {
        const { count } = await supabase
          .from('album_spreads')
          .select('id', { count: 'exact', head: true })
          .eq('version_id', order.current_version_id);
        spreadCount = count || 0;
      }
      const extraPagesCount = Math.max(0, spreadCount - PAGE_BASELINE);
      const { data: extraPagesAddonRow } = await supabase
        .from('album_addons')
        .select('*')
        .eq('tenant_id', order.tenant_id)
        .eq('category', 'extra_pages')
        .eq('active', true)
        .maybeSingle();

      const addonInputs = (Array.isArray(addons) ? addons : []).filter(
        (a: any) => !extraPagesAddonRow || a.addonId !== extraPagesAddonRow.id
      );
      const addonIds = addonInputs.map((a: any) => a.addonId).filter(Boolean);
      let addonRows: any[] = [];
      if (addonIds.length) {
        const { data } = await supabase.from('album_addons').select('*').eq('tenant_id', order.tenant_id).in('id', addonIds);
        addonRows = data ?? [];
      }

      const engravingPrice = getEngravingPrice(validEngravingType, validEngravingScope);

      let total = Number(product.base_price) + Number(cover.price_delta) + engravingPrice;
      const orderAddonRows = addonInputs
        .map((input: any) => {
          const catalogRow = addonRows.find((a) => a.id === input.addonId);
          if (!catalogRow) return null;
          const quantity = Number(input.quantity) > 0 ? Number(input.quantity) : 1;
          total += Number(catalogRow.price) * quantity;

          // Validate any uploaded image keys belong to this order + this addon, so a
          // client can never attach someone else's uploaded file to their order.
          const expectedPrefix = `${order.tenant_id}/${order.id}/addons/${catalogRow.id}/`;
          const rawKeys = Array.isArray(input.imageKeys) ? input.imageKeys : [];
          let imageKeys = rawKeys.filter((k: any) => typeof k === 'string' && k.startsWith(expectedPrefix));
          if (!catalogRow.allows_multiple_images) imageKeys = imageKeys.slice(0, 1);

          return {
            tenant_id: order.tenant_id,
            album_order_id: order.id,
            addon_id: catalogRow.id,
            addon_name_snapshot: catalogRow.name,
            addon_price_snapshot: catalogRow.price,
            quantity,
            uploaded_file_keys: imageKeys,
            _requiresUpload: catalogRow.requires_upload,
            _addonName: catalogRow.name,
          };
        })
        .filter(Boolean);

      if (extraPagesCount > 0 && extraPagesAddonRow) {
        total += Number(extraPagesAddonRow.price) * extraPagesCount;
        orderAddonRows.push({
          tenant_id: order.tenant_id,
          album_order_id: order.id,
          addon_id: extraPagesAddonRow.id,
          addon_name_snapshot: extraPagesAddonRow.name,
          addon_price_snapshot: extraPagesAddonRow.price,
          quantity: extraPagesCount,
          uploaded_file_keys: [],
          _requiresUpload: false,
          _addonName: extraPagesAddonRow.name,
        });
      }

      // Addons flagged requires_upload must have at least one validated image key —
      // enforced server-side, not just as a UI gate.
      const missingUpload = orderAddonRows.find((r: any) => r._requiresUpload && (!r.uploaded_file_keys || r.uploaded_file_keys.length === 0));
      if (missingUpload) {
        return jsonResponse({ error: `יש להעלות תמונה עבור התוספת: ${missingUpload._addonName}` }, { status: 400 });
      }
      const insertableAddonRows = orderAddonRows.map(({ _requiresUpload, _addonName, ...rest }: any) => rest);

      const { error: selectionError } = await supabase.from('album_order_selections').insert({
        tenant_id: order.tenant_id,
        album_order_id: order.id,
        product_id: product.id,
        product_name_snapshot: product.name,
        product_price_snapshot: product.base_price,
        cover_id: cover.id,
        cover_name_snapshot: cover.name,
        cover_price_delta_snapshot: cover.price_delta,
        engraving_text: engravingText ? String(engravingText).slice(0, 30) : null,
        engraving_text_line2: engravingTextLine2 ? String(engravingTextLine2).slice(0, 30) : null,
        engraving_type: validEngravingType,
        engraving_scope: validEngravingScope,
        engraving_price_snapshot: engravingPrice,
        engraving_color_id: engravingColor?.id ?? null,
        engraving_color_name_snapshot: engravingColor?.name ?? null,
        engraving_font_id: engravingFont?.id ?? null,
        engraving_font_name_snapshot: engravingFont?.name ?? null,
      });
      if (selectionError) return jsonResponse({ error: selectionError.message }, { status: 500 });

      if (insertableAddonRows.length) {
        const { error: addonsError } = await supabase.from('album_order_addons').insert(insertableAddonRows);
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

    if (action === 'createAddonUploadUrl') {
      // Validate addonId against a real album_addons row scoped to this order's tenant,
      // so the storage path can't be built from an arbitrary client-supplied string
      // (prevents path injection / writing into another addon's/order's folder).
      const { data: addonRow } = await supabase
        .from('album_addons')
        .select('id')
        .eq('id', body.addonId)
        .eq('tenant_id', order.tenant_id)
        .maybeSingle();
      if (!addonRow) return jsonResponse({ error: 'תוספת לא נמצאה' }, { status: 404 });

      const fileName = (body.fileName || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${order.tenant_id}/${order.id}/addons/${addonRow.id}/${Date.now()}-${fileName}`;
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error) return jsonResponse({ error: error.message }, { status: 500 });
      return jsonResponse({ path: data.path, token: data.token });
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
