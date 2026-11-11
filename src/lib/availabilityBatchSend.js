// One availability link for several events, sent to one crew member (staff_availability_batches,
// migration 0082). Moved out of StaffBatchAvailabilityDialog on 2026-10-27 so the "+ → זמינות
// צוות" window sends exactly the same way. `text` may hold {{link}}; otherwise the link goes at
// the end. Throws on failure, after revoking what was created — nobody got the link, so
// nothing stays half-open.
import { base44 } from "@/api/base44Client";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { eventDay } from "@/lib/missingTeam";
import { slotOption } from "@/lib/staffAvailabilityBatch";

export const LINK_MARK = "{{link}}";

export async function sendAvailabilityBatch({ staff, slot, events, text }) {
  if (!staff?.phoneNumber) throw new Error("אין מספר טלפון לאיש הצוות");
  if (!events?.length) throw new Error("לא נבחרו אירועים");
  let batch = null;
  const created = [];
  try {
    const raw = generateRawToken();
    batch = await base44.entities.StaffAvailabilityBatch.create({ staffMemberId: staff.id, teamRole: slot, tokenHash: await hashToken(raw) });
    for (const e of events) {
      created.push(await base44.entities.StaffAvailabilityRequest.create({
        leadId: e.sourceLeadId || null,
        eventId: e.id,
        staffMemberId: staff.id,
        staffNameSnapshot: staff.name,
        // The slot decides the job (QA 2026-10-09): a photographer asked for "וידאו 1" is a
        // videographer request, and editors never break the photo/video CHECK.
        role: slotOption(slot)?.jobRole || staff.role,
        teamRole: slot,
        eventDateSnapshot: eventDay(e),
        venueSnapshot: e.venue || null,
        coupleNamesSnapshot: e.coupleNames || null,
        tokenHash: await hashToken(generateRawToken()), // unused — the batch link is the credential
        batchId: batch.id,
      }));
    }
    const link = `${window.location.origin}/staff-availability/b/${raw}`;
    const message = text.includes(LINK_MARK) ? text.replace(LINK_MARK, link) : `${text.trim()}\n\n${link}`;
    const res = await base44.functions.invoke("sendWhatsAppMessage", { to: staff.phoneNumber, message });
    if (res?.data?.error) throw new Error(res.data.error);
  } catch (e) {
    const now = new Date().toISOString();
    if (batch) await base44.entities.StaffAvailabilityBatch.update(batch.id, { revokedAt: now }).catch(() => {});
    for (const r of created) await base44.entities.StaffAvailabilityRequest.update(r.id, { revokedAt: now }).catch(() => {});
    throw e;
  }
}

// The reminder to one person about the dates he did not answer (2026-11-11, "תזכורת לכולם" on "תשובות זמינות"): a
// fresh link for all of them (one batch), each new row a copy of the old one; after it went out the old rows are
// revoked — one live link per person per event, like "שלח שוב". Nothing sent → nothing changes.
export async function sendAvailabilityReminder({ staff, slot = null, requests, text }) {
  if (!staff?.phoneNumber) throw new Error("אין מספר טלפון לאיש הצוות");
  if (!requests?.length) throw new Error("לא נבחרו אירועים");
  let batch = null;
  const created = [];
  try {
    const raw = generateRawToken();
    batch = await base44.entities.StaffAvailabilityBatch.create({ staffMemberId: staff.id, teamRole: slot || null, tokenHash: await hashToken(raw) });
    for (const r of requests) {
      created.push(await base44.entities.StaffAvailabilityRequest.create({
        leadId: r.leadId || null,
        eventId: r.eventId || null,
        staffMemberId: staff.id,
        staffNameSnapshot: r.staffNameSnapshot || staff.name,
        role: r.role,
        teamRole: r.teamRole || null,
        eventDateSnapshot: r.eventDateSnapshot || null,
        venueSnapshot: r.venueSnapshot || null,
        coupleNamesSnapshot: r.coupleNamesSnapshot || null,
        tokenHash: await hashToken(generateRawToken()), // unused — the batch link is the credential
        batchId: batch.id,
      }));
    }
    const link = `${window.location.origin}/staff-availability/b/${raw}`;
    const message = text.includes(LINK_MARK) ? text.replace(LINK_MARK, link) : `${text.trim()}\n\n${link}`;
    const res = await base44.functions.invoke("sendWhatsAppMessage", { to: staff.phoneNumber, message });
    if (res?.data?.error) throw new Error(res.data.error);
  } catch (e) {
    const now = new Date().toISOString();
    if (batch) await base44.entities.StaffAvailabilityBatch.update(batch.id, { revokedAt: now }).catch(() => {});
    for (const r of created) await base44.entities.StaffAvailabilityRequest.update(r.id, { revokedAt: now }).catch(() => {});
    throw e;
  }
  const now = new Date().toISOString();
  for (const r of requests) await base44.entities.StaffAvailabilityRequest.update(r.id, { revokedAt: now }).catch(() => {});
}
