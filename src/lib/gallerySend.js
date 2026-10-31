import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
// Avira's in-app question, as work status asks it (the galleries' @/lib/confirmDialog has no window mounted here).
import { confirmDialog } from "@/components/ui/confirm-dialog";

// "שליחה לזוג" from the galleries (Avira, 2026-10-31, the owner's request): exactly the work-status "→ זוג" button —
// the same send-to-couple function and message (the "לינק סופי" template), with the gallery's couple link as the
// final link. Then the event's "לינק סופי" is that link, and the function marks it sent, so the work-status row turns
// green by itself. A gallery is sent through the event it is linked to (the couple's names and phone are the event's).

/** Whether each linked event's couple already got their final link (work status "→ זוג"), by event id. */
export async function eventsSentState(eventIds) {
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data } = await supabase.from("events").select("id, final_done_manual").in("id", ids);
  return Object.fromEntries((data || []).map((e) => [e.id, e.final_done_manual === true]));
}

/** Sends the gallery's link to the couple on WhatsApp. True when it was sent. */
export async function sendGalleryToCouple(eventId, link) {
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
    });
  } catch (err) {
    toast.error("שגיאה בשליחה: " + (err?.message || ""));
    return false;
  }
  // After the send: a failed send never leaves the event looking done ("סופי" is green as soon as there is a link).
  try {
    await base44.entities.Event.update(ev.id, { finalLink: link });
  } catch {
    toast.warning(`נשלח ל${names}, אבל הקישור לא נשמר ב"לינק סופי" בסטטוס עבודה`);
    return true;
  }
  toast.success(`נשלח ל${names} ✅`);
  return true;
}
