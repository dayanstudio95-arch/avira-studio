import { base44 } from "@/api/base44Client";

export async function sendCalendarInviteByName(eventId, staffName) {
  try {
    await base44.functions.invoke('sendStaffInvite', { eventId, staffName });
  } catch (error) {
    console.error('Error sending calendar invite:', error);
  }
}
