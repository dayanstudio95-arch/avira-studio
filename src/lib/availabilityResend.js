import { base44 } from "@/api/base44Client";
import { generateRawToken, hashToken } from "@/lib/albumTokens";

// "שלח שוב" (2026-10-09, the owner's request): a reminder to someone who hasn't answered an
// availability check. Only the hash of a link's token is stored, so the old link can't be
// sent again — a new request row (same event, person, role and slot) gets a fresh link.
// The old row is revoked only after the reminder went out, so there is always exactly one
// live link per person and the answers tab reads the new row.
export async function resendAvailabilityRequest({ request, phone, text }) {
  const rawToken = generateRawToken();
  const tokenHash = await hashToken(rawToken);
  const fresh = await base44.entities.StaffAvailabilityRequest.create({
    leadId: request.leadId || null,
    eventId: request.eventId || null,
    staffMemberId: request.staffMemberId,
    staffNameSnapshot: request.staffNameSnapshot,
    role: request.role,
    teamRole: request.teamRole || null,
    eventDateSnapshot: request.eventDateSnapshot || null,
    venueSnapshot: request.venueSnapshot || null,
    coupleNamesSnapshot: request.coupleNamesSnapshot || null,
    tokenHash,
  });
  const link = `${window.location.origin}/staff-availability/${rawToken}`;
  let res;
  try {
    res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message: `${text}\n\n${link}` });
    if (res?.data?.error) throw new Error(res.data.error);
  } catch (e) {
    // nobody got the new link → drop it, the old request stays as it was
    await base44.entities.StaffAvailabilityRequest.update(fresh.id, { revokedAt: new Date().toISOString() }).catch(() => {});
    throw e;
  }
  await base44.entities.StaffAvailabilityRequest.update(request.id, { revokedAt: new Date().toISOString() }).catch(() => {});
  return fresh;
}
