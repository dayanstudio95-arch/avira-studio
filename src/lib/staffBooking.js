// "You're booked" message to a crew member (2026-10-07). Pure — tested in PART 33.
// A line whose variable came out empty is dropped, so a lead without a questionnaire still
// gets a clean message (no "התארגנות: " with nothing after it).
import { formatDateWithWeekday } from "@/lib/chatModel";

export const BOOKING_TEMPLATE_KEY = "template_staff_booking";

export const DEFAULT_BOOKING_TEMPLATE = `היי {{name}} 👋
שובצת כ{{role}} באירוע של {{names}}
📅 {{event_date}}
📍 {{venue}}
💄 התארגנות: {{prep_location}}
🕐 קבלת פנים: {{checkin_time}}
💍 חופה: {{chuppah_time}}
תאשר/י ב-👍 בבקשה`;

export function renderBookingMessage(template, vars) {
  const tpl = String(template || "").trim() ? template : DEFAULT_BOOKING_TEMPLATE;
  return tpl
    .split("\n")
    .map((line) => {
      let emptied = false;
      const out = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
        const v = vars?.[k];
        if (v === undefined || v === null || String(v).trim() === "") { emptied = true; return ""; }
        return String(v).trim();
      });
      return emptied ? null : out;
    })
    .filter((l) => l !== null)
    .join("\n")
    .trim();
}

export function bookingVars({ staffName, roleLabel, event, lead }) {
  const day = String(event?.date || lead?.eventDate || "").slice(0, 10);
  return {
    name: String(staffName || "").split(" ")[0],
    role: roleLabel,
    names: event?.coupleNames || lead?.coupleNames || "",
    event_date: day ? formatDateWithWeekday(day) : "",
    venue: event?.venue || lead?.venueName || "",
    prep_location: lead?.productionBridePrepLocation || "",
    checkin_time: lead?.productionCheckinTime || "",
    chuppah_time: lead?.productionChuppahTime || "",
  };
}
