// Public, unauthenticated endpoint backing the /album-guide/:tenantId page — the
// generic, studio-owner-edited "how album ordering works" guide sent as a companion
// link alongside the gallery link (see send-to-couple/index.ts). No PII, no secret
// beyond tenantId itself (a UUID) — same trust model as get-lead-public: called via
// the frontend's functions.invoke() wrapper, which always attaches a valid JWT (the
// real session token, or the anon-key fallback), so no supabase/config.toml
// verify_jwt=false override is needed here, same as get-lead-public.
//
// Deliberately isolated per CLAUDE.md's Wedding Albums module rules: reads (never
// writes) album_products/album_covers/album_addons, and has no relationship at all
// to the album_orders/album_versions/... purchase-wizard tables or the legacy
// events.album_status marker.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createServiceRoleClient } from '../_shared/supabaseClients.ts';
import { checkRateLimit } from '../_shared/rateLimit.ts';

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const rateLimit = await checkRateLimit(req, 'get-album-guide-public');
  if (!rateLimit.allowed) {
    return jsonResponse({ error: 'יותר מדי בקשות, נסה שוב בעוד כמה דקות' }, { status: 429 });
  }

  try {
    const { tenantId } = await req.json();
    if (!tenantId) return jsonResponse({ error: 'tenantId is required' }, { status: 400 });

    const supabase = createServiceRoleClient();

    const { data: guideRow, error: guideErr } = await supabase
      .from('album_guide_content')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (guideErr) return jsonResponse({ error: guideErr.message }, { status: 500 });

    // No row yet, or the studio has explicitly unpublished it -- still a 200 with
    // guide: null, not a 404/error, so the frontend can show a graceful "coming
    // soon" state instead of an error page (a tenant may simply not have filled
    // this in yet).
    const guide = guideRow && guideRow.is_published ? guideRow : null;

    const { data: faqRows, error: faqErr } = await supabase
      .from('album_guide_faq_items')
      .select('id, question, answer, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });
    if (faqErr) return jsonResponse({ error: faqErr.message }, { status: 500 });

    const { data: productRows } = await supabase
      .from('album_products')
      .select('id, name, description, base_price, album_count, sort_order')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort_order', { ascending: true });

    const { data: coverRows } = await supabase
      .from('album_covers')
      .select('id, name, price_delta, sort_order')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort_order', { ascending: true });

    const { data: addonRows } = await supabase
      .from('album_addons')
      .select('id, name, price, sort_order')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('sort_order', { ascending: true });

    // Per-cover preview images (migration 0040) -- optional, merged onto the
    // matching cover below by cover_id. Not every cover necessarily has one.
    const { data: coverPreviewRows } = await supabase
      .from('album_guide_cover_previews')
      .select('cover_id, image_url')
      .eq('tenant_id', tenantId);
    const coverImageByCoverId = new Map((coverPreviewRows || []).map((r) => [r.cover_id, r.image_url]));

    // Full sketch examples (migration 0040) -- each a titled sequence of
    // images (~30/example), replaces the old single sketchExampleImageUrl.
    const { data: sketchExampleRows } = await supabase
      .from('album_guide_sketch_examples')
      .select('id, title, sort_order')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true });

    let sketchExampleImageRows = [];
    if ((sketchExampleRows || []).length > 0) {
      const { data: imgRows } = await supabase
        .from('album_guide_sketch_example_images')
        .select('example_id, sequence_number, image_url')
        .eq('tenant_id', tenantId)
        .order('sequence_number', { ascending: true });
      sketchExampleImageRows = imgRows || [];
    }
    const imagesByExampleId = new Map();
    for (const row of sketchExampleImageRows) {
      const list = imagesByExampleId.get(row.example_id) || [];
      list.push({ sequenceNumber: row.sequence_number, imageUrl: row.image_url });
      imagesByExampleId.set(row.example_id, list);
    }
    const sketchExamples = (sketchExampleRows || []).map((ex) => ({
      id: ex.id,
      title: ex.title,
      images: imagesByExampleId.get(ex.id) || [],
    }));

    // Best-effort studio display name, same fallback chain as get-lead-public --
    // a missing/unset tenant row must never break loading the guide itself.
    let studioDisplayName = 'הסטודיו';
    try {
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('name, display_name_to_clients')
        .eq('id', tenantId)
        .maybeSingle();
      studioDisplayName = tenantRow?.display_name_to_clients || tenantRow?.name || 'הסטודיו';
    } catch (tenantErr) {
      console.error('[getAlbumGuidePublic] Failed to load studio display name:', tenantErr);
    }

    return jsonResponse({
      studioDisplayName,
      guide: guide
        ? {
            id: guide.id,
            photoSelectionIntro: guide.photo_selection_intro,
            submissionInstructions: guide.submission_instructions,
            sketchExampleImageUrl: guide.sketch_example_image_url,
            cancellationPolicy: guide.cancellation_policy,
          }
        : null,
      faqItems: (faqRows || []).map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
      catalog: {
        products: (productRows || []).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          basePrice: p.base_price,
          albumCount: p.album_count,
        })),
        covers: (coverRows || []).map((c) => ({
          id: c.id,
          name: c.name,
          priceDelta: c.price_delta,
          imageUrl: coverImageByCoverId.get(c.id) || null,
        })),
        addons: (addonRows || []).map((a) => ({ id: a.id, name: a.name, price: a.price })),
      },
      sketchExamples,
    });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
