import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
// Avira's in-app question, as work status asks it (the galleries' @/lib/confirmDialog has no window mounted here).
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { closeFromSend } from "@films-shared/day";
import { filmsApi } from "@/lib/filmsApi";

// "שלח לזוג" from the galleries (Avira, 2026-10-31, the owner's request): the work-status "→ זוג" button's
// send-to-couple function, with the gallery's couple link as the final link — in the gallery's own words since
// 2026-11-02 (template "gallery": template_gallery_link, with the day the gallery closes). Then the event's "לינק סופי"
// is that link, and the function marks it sent, so the work-status row turns green by itself. A gallery is sent through
// the event it is linked to (the couple's names and phone are the event's).

/** The wedding's main photographer: the event's "צלם 1" ('' when none). */
export const mainPhotographer = (team) => (Array.isArray(team) ? team.find((m) => m?.role === "photographer1")?.staffMemberName || "" : "");

/** What the galleries list shows of each linked event, by event id: sent to the couple (work status), photographer, venue. */
export async function eventsInfo(eventIds) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data } = await supabase.from("events").select("id, final_done_manual, team, venue").in("id", ids);
  return Object.fromEntries((data || []).map((e) => [e.id, { sent: e.final_done_manual === true, photographer: mainPhotographer(e.team), venue: e.venue || "" }]));
}

/**
 * Sends the gallery's link to the couple on WhatsApp. `gallery` ({ id, kind, days, expiresAt }): its access days count
 * from the send (2026-11-03) — the message says the new closing day and the gallery gets it once the message went out;
 * work status shows it was sent from the galleries (0109: final_sent_via / final_sent_at / final_sent_gallery).
 * false when nothing was sent, else { expiresAt } — the gallery's closing time now.
 */
export async function sendGalleryToCouple(eventId, link, { gallery = null } = {}) {
  const expiresAt = gallery?.days >= 1 ? closeFromSend(gallery.expiresAt, gallery.days, Date.now()) : gallery?.expiresAt;
  if (!eventId) {
    toast.error("קודם לבחור את האירוע של הזוג בעריכת הגלריה");
    return false;
  }
  const { data: ev, error } = await supabase
    .from("events")
    .select("id, couple_names, date, venue, phone_number, final_link, final_done_manual")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !ev) {
    toast.error("האירוע של הגלריה לא נמצא");
    return false;
  }
  if (!ev.phone_number) {
    toast.error("חסר טלפון זוג לאירוע");
    return false;
  }
  const names = ev.couple_names || "הזוג";
  const other = String(ev.final_link || "").trim();
  // Daniel's decision R4 (a second send only after asking), and never overwrite another final link unasked.
  const asks = [];
  if (other && other !== link) asks.push(`ב"לינק סופי" בסטטוס עבודה כתוב קישור אחר:\n${other}\nהוא יוחלף בקישור לגלריה.`);
  if (ev.final_done_manual) asks.push(`${names} כבר סומנו בסטטוס עבודה כמי שקיבלו את הלינק הסופי.`);
  if (asks.length && !(await confirmDialog(`${asks.join("\n\n")}\n\nלשלוח ל${names} את הקישור לגלריה?`))) return false;
  try {
    await base44.functions.invoke("sendToCouple", {
      eventId: ev.id,
      coupleNames: ev.couple_names,
      eventDate: ev.date,
      venue: ev.venue,
      phoneNumber: ev.phone_number,
      finalLink: link,
      template: "gallery",
      expiresAt: expiresAt || null,
    });
  } catch (err) {
    toast.error("שגיאה בשליחה: " + (err?.message || ""));
    return false;
  }
  // After the send: a failed send never leaves the event looking done ("סופי" is green as soon as there is a link).
  const sent = { expiresAt: gallery?.expiresAt };
  if (gallery?.id && expiresAt && expiresAt !== gallery.expiresAt) {
    try {
      sent.expiresAt = (await filmsApi("PUT", `/api/admin/galleries/${gallery.id}`, { expiresAt })).expiresAt;
    } catch (e) {
      toast.warning(`נשלח, אבל תאריך הסגירה של הגלריה לא עודכן: ${e.message}`);
    }
  }
  try {
    await base44.entities.Event.update(ev.id, {
      finalLink: link,
      finalSentVia: "gallery",
      finalSentAt: new Date().toISOString(),
      finalSentGallery: gallery?.id ? `${gallery.kind === "films" ? "films" : "photos"}/${gallery.id}` : null,
    });
  } catch {
    toast.warning(`נשלח ל${names}, אבל הקישור לא נשמר ב"לינק סופי" בסטטוס עבודה`);
    return sent;
  }
  toast.success(`נשלח ל${names} ✅`);
  return sent;
}
