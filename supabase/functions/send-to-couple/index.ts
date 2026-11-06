// Ports base44/functions/sendToCouple/entry.ts.
// Called from ProgressStatus.jsx (handleSendToCouple). Message now composed from an
// editable app_settings template (template_final_link) and sent directly via Green
// API instead of forwarding to Make.com.
import { handleOptions, jsonResponse } from '../_shared/cors.ts';
import { createUserClient, getRequestUser } from '../_shared/supabaseClients.ts';
import { sendWhatsApp } from '../_shared/whatsapp.ts';
import { GALLERY_LINK_TEMPLATE_KEY, israelDay, renderGalleryLink } from '../_shared/galleryLinkMessage.ts';
import { DEFAULT_FILM_FIX_TEMPLATE, FILM_FIX_TEMPLATE_KEY, FILM_TEMPLATE_KEY, markFixSent, renderFilmMessage } from '../_shared/editorPortal.ts';

const DEFAULT_FINAL_LINK_TEMPLATE = `שלום {{names}} 😊
האלבום/סרטון הסופי שלכם מוכן!
תאריך האירוע: {{event_date}}
לצפייה: {{final_link}}
מדריך לבחירת תמונות והזמנת אלבום: {{album_guide_link}}
מקווים שתיהנו לצפות 🎉`;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const user = await getRequestUser(req);
    if (!user) return jsonResponse({ error: 'Unauthorized' }, { status: 401 });

    const supabase = createUserClient(req);
    const body = await req.json();
    const { eventId, coupleNames, eventDate, venue, phoneNumber, finalLink } = body;
    // The galleries' "שלח לזוג" (2026-11-02): the gallery's own words (template_gallery_link) and its closing day.
    // Without it — work status — everything below is as before.
    const fromGallery = body?.template === 'gallery';
    // "עריכת וידאו" (2026-11-06): the editor's film, in his own words (template_film_link). It lights the editor's
    // square on work status (editor_done + film_sent_at) — not "סופי" / "→ זוג", which are the photo gallery's.
    const fromFilm = body?.template === 'film';
    // The corrected film (template_film_fix_link): the open correction round gets its day; nothing else changes.
    const fromFix = body?.template === 'film_fix';

    if (!finalLink) return jsonResponse({ error: 'חסר לינק סופי' }, { status: 400 });
    if (!phoneNumber) return jsonResponse({ error: 'חסר טלפון זוג' }, { status: 400 });

    // Needed to build the Album Guide Page link below (tenant-scoped, public,
    // no-login companion page -- see supabase/functions/get-album-guide-public
    // and src/pages/AlbumGuide.jsx). getRequestUser()/createUserClient() don't
    // expose tenant_id directly, so it's looked up explicitly here.
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    const albumGuideLink = profile?.tenant_id
      ? `${Deno.env.get('APP_BASE_URL') ?? ''}/album-guide/${profile.tenant_id}`
      : '';

    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .eq('key', fromGallery ? GALLERY_LINK_TEMPLATE_KEY : fromFix ? FILM_FIX_TEMPLATE_KEY : fromFilm ? FILM_TEMPLATE_KEY : 'template_final_link');
    const template = settings?.[0]?.value || DEFAULT_FINAL_LINK_TEMPLATE;

    const formattedDate = eventDate ? new Date(eventDate).toLocaleDateString('he-IL') : '';
    const message = fromFix
      ? renderFilmMessage(settings?.[0]?.value, { link: finalLink, names: coupleNames || '', event_date: formattedDate, venue: venue || '' }, DEFAULT_FILM_FIX_TEMPLATE)
      : fromFilm
      ? renderFilmMessage(settings?.[0]?.value, { link: finalLink, names: coupleNames || '', event_date: formattedDate, venue: venue || '' })
      : fromGallery
      ? renderGalleryLink(settings?.[0]?.value, {
          names: coupleNames || '',
          event_date: formattedDate,
          venue: venue || '',
          link: finalLink,
          expires: israelDay(body?.expiresAt),
          album_guide_link: albumGuideLink,
        })
      : template
          .replace(/{{names}}/g, coupleNames || '')
          .replace(/{{event_date}}/g, formattedDate)
          .replace(/{{venue}}/g, venue || '')
          .replace(/{{final_link}}/g, finalLink)
          .replace(/{{album_guide_link}}/g, albumGuideLink);

    // No link-preview card on this message, deliberately (2026-09-22): with the card,
    // the gallery message sat undelivered on a single tick for two couples; without it,
    // the same text was delivered within minutes. See _shared/whatsapp.ts.
    const result = await sendWhatsApp(supabase, phoneNumber, message, undefined, { linkPreview: false });
    if (!result.success) return jsonResponse({ error: result.error }, { status: 502 });

    let update: Record<string, unknown> = fromFilm ? { editor_done: true, film_sent_at: new Date().toISOString(), film_link: finalLink } : { final_done_manual: true };
    if (fromFix) {
      const { data: ev } = await supabase.from('events').select('film_fixes').eq('id', eventId).maybeSingle();
      update = { film_fixes: markFixSent(ev?.film_fixes, new Date().toISOString()) };
    }
    const { error: updateErr } = await supabase
      .from('events')
      .update(update)
      .eq('id', eventId);

    if (updateErr) return jsonResponse({ error: updateErr.message }, { status: 500 });

    return jsonResponse({ success: true });
  } catch (error) {
    return jsonResponse({ error: error.message }, { status: 500 });
  }
});
