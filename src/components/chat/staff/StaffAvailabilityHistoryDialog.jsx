import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send, CheckCircle2, XCircle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { israelToday } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { assignStaffToEventSlot } from "@/lib/assignStaffToEvent";
import { pauseBetweenSends } from "@/lib/pace";
import { BOOKING_TEMPLATE_KEY, renderBookingMessage, bookingVars } from "@/lib/staffBooking";
import { SLOT_OPTIONS, availabilityHistory, combinedBookingMessage, slotFilled } from "@/lib/staffAvailabilityBatch";

const STATE_UI = {
  assigned: { cls: "text-sky-300", text: (r) => `✔ משובץ/ת · ${eventTeamRoleLabel(r.assignedSlot)}` },
  available: { cls: "text-emerald-300", text: () => "פנוי/ה", icon: CheckCircle2 },
  declined: { cls: "text-red-300", text: () => "לא פנוי/ה", icon: XCircle },
  pending: { cls: "text-amber-300", text: () => "עוד לא ענה", icon: Clock },
};

// A crew member's availability history in the chat (2026-10-09): every check sent to him,
// the latest answer per wedding; tick the "פנוי" ones and assign them (slot per event), then
// the "you're booked" WhatsApp — one message for all, or one per event, after a preview.
// Assigned here but not yet told (assigned_at without booking_notified_at) → offered again
// the next time this window opens.
export default function StaffAvailabilityHistoryDialog({ staff, onClose }) {
  const qc = useQueryClient();
  const today = israelToday();
  const reqQ = useQuery({
    queryKey: ["staffHistoryRequests", staff.id],
    queryFn: () => base44.entities.StaffAvailabilityRequest.filter({ staffMemberId: staff.id }, "-requestedAt", 500),
  });
  const eventIds = useMemo(() => [...new Set((reqQ.data || []).map((r) => r.eventId).filter(Boolean))], [reqQ.data]);
  const leadIds = useMemo(() => [...new Set((reqQ.data || []).filter((r) => !r.eventId && r.leadId).map((r) => r.leadId))], [reqQ.data]);
  const evQ = useQuery({
    queryKey: ["staffHistoryEvents", eventIds.join(), leadIds.join()],
    enabled: !reqQ.isLoading,
    queryFn: async () => {
      const [byId, byLead] = await Promise.all([
        eventIds.length ? base44.entities.Event.filter({ id: { $in: eventIds } }) : [],
        leadIds.length ? base44.entities.Event.filter({ sourceLeadId: { $in: leadIds } }) : [],
      ]);
      return {
        byId: Object.fromEntries([...byId, ...byLead].map((e) => [e.id, e])),
        byLead: Object.fromEntries(byLead.map((e) => [e.sourceLeadId, e])),
      };
    },
  });
  const rows = useMemo(
    () => availabilityHistory({ requests: reqQ.data || [], eventsById: evQ.data?.byId || {}, eventsByLead: evQ.data?.byLead || {}, staffName: staff.name })
      .filter((r) => r.date >= today),
    [reqQ.data, evQ.data, staff.name, today]
  );
  const unnotified = rows.filter((r) => r.unnotified);

  const [pick, setPick] = useState({}); // requestId → slot (ticked = present)
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState(null); // [{ request, event, slot }]
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["staffHistoryRequests", staff.id] });
    qc.invalidateQueries({ queryKey: ["staffHistoryEvents"] });
  };

  // The request's own slot / job decides (QA 2026-10-09): a photographer who answered a
  // "וידאו 1" request is offered the video slots, not צלם 1/2.
  const slotsFor = (r) => {
    const jobRole = SLOT_OPTIONS.find((o) => o.value === r.request.teamRole)?.jobRole || r.request.role || staff.role;
    const mine = (staff.teamSlots || []).filter((s) => SLOT_OPTIONS.some((o) => o.value === s && o.jobRole === jobRole));
    const all = SLOT_OPTIONS.filter((o) => o.jobRole === jobRole).map((o) => o.value);
    const order = [r.request.teamRole, ...mine, ...all].filter((v, i, a) => v && a.indexOf(v) === i && all.includes(v));
    return order;
  };
  const toggle = (r) => setPick((p) => {
    const next = { ...p };
    if (next[r.request.id]) delete next[r.request.id];
    else next[r.request.id] = slotsFor(r).find((s) => !slotFilled(r.event, s)) || slotsFor(r)[0];
    return next;
  });

  const assign = async () => {
    const chosen = rows.filter((r) => pick[r.request.id] && r.event);
    if (!chosen.length) return;
    setBusy(true);
    const done = [];
    for (const r of chosen) {
      const slot = pick[r.request.id];
      try {
        const fresh = await base44.entities.Event.get(r.event.id); // the newest team
        await assignStaffToEventSlot({ event: fresh, staffMember: staff, roleSlot: slot });
        await base44.entities.StaffAvailabilityRequest.update(r.request.id, { assignedAt: new Date().toISOString() });
        done.push({ request: r.request, event: fresh, slot });
      } catch (e) {
        toast.error(`השיבוץ נכשל: ${r.event.coupleNames || ""}`, { description: e?.message });
      }
    }
    setBusy(false);
    setPick({});
    refresh();
    if (done.length) {
      toast.success(`${staff.name} שובץ/ה ל-${done.length} אירועים`);
      setNotify(done);
    }
  };

  const loading = reqQ.isLoading || evQ.isLoading;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-right">היסטוריית זמינות — {staff.name}</DialogTitle>
        </DialogHeader>
        {notify ? (
          <BookingStep staff={staff} items={notify} onDone={() => { setNotify(null); refresh(); }} />
        ) : (
          <>
            {unnotified.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                <span>שיבצת אותו ל-{unnotified.length} {unnotified.length === 1 ? "אירוע" : "אירועים"} שעוד לא נשלחה עליהם הודעה.</span>
                <button type="button" onClick={() => setNotify(unnotified.map((r) => ({ request: r.request, event: r.event, slot: r.assignedSlot })))} className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-semibold text-black hover:bg-amber-400">
                  לשלוח עכשיו
                </button>
              </div>
            )}
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-gray-800 py-6 text-center text-sm text-gray-400">אין בדיקות זמינות לאירועים קרובים</div>
            ) : (
              <div className="space-y-1.5">
                {rows.map((r) => {
                  const ui = STATE_UI[r.state];
                  const canAssign = r.state === "available" && !!r.event;
                  const slot = pick[r.request.id];
                  return (
                    <div key={r.request.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 px-3 py-2">
                      {canAssign ? <input type="checkbox" checked={!!slot} onChange={() => toggle(r)} /> : <span className="w-[13px]" />}
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="font-semibold">{r.date ? formatDateWithWeekday(r.date) : "—"}</span>
                        {` · ${r.event?.venue || r.request.venueSnapshot || ""}`}{` · ${r.event?.coupleNames || r.request.coupleNamesSnapshot || ""}`}
                        {!r.event && <span className="block text-xs text-gray-500">אין עדיין אירוע (הזוג לא חתם)</span>}
                      </span>
                      {slot && (
                        <select value={slot} onChange={(e) => setPick((p) => ({ ...p, [r.request.id]: e.target.value }))} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white">
                          {slotsFor(r).map((s) => (
                            <option key={s} value={s}>{eventTeamRoleLabel(s)}{slotFilled(r.event, s) ? " (תפוס — יוחלף)" : ""}</option>
                          ))}
                        </select>
                      )}
                      <span className={`text-xs font-medium ${ui.cls}`}>{ui.text(r)}{r.unnotified ? " · לא נשלחה הודעה" : ""}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-row-reverse gap-2 pt-1">
              <button type="button" onClick={assign} disabled={busy || !Object.keys(pick).length} className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50">
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} שבץ את המסומנים ({Object.keys(pick).length})
              </button>
              <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300">סגור</button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// The "you're booked" message after assigning: one WhatsApp with every event, or one per event
// (the studio's booking template). Marks booking_notified_at on what was sent.
function BookingStep({ staff, items, onDone }) {
  const [mode, setMode] = useState(items.length > 1 ? "one" : "each");
  const [combined, setCombined] = useState("");
  const [each, setEach] = useState([]);
  const [sending, setSending] = useState(false);
  // Messages already sent in this window (QA 2026-10-09): a retry after a failure in the
  // middle must not send the first ones again.
  const sentRef = useRef(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: BOOKING_TEMPLATE_KEY }).catch(() => []);
      const tpl = rows?.[0]?.value;
      const leadIds = [...new Set(items.map((i) => i.event?.sourceLeadId).filter(Boolean))];
      const leads = leadIds.length ? await base44.entities.Lead.filter({ id: { $in: leadIds } }).catch(() => []) : [];
      const leadById = Object.fromEntries(leads.map((l) => [l.id, l]));
      if (!alive) return;
      setCombined(combinedBookingMessage({ name: staff.name, items }));
      setEach(items.map((i) => renderBookingMessage(tpl, bookingVars({ staffName: staff.name, roleLabel: eventTeamRoleLabel(i.slot), event: i.event, lead: leadById[i.event?.sourceLeadId] }))));
    })();
    return () => { alive = false; };
  }, [items, staff.name]);

  const send = async () => {
    setSending(true);
    try {
      const messages = mode === "one" ? [combined] : each;
      let sentNow = 0;
      for (const [i, message] of messages.entries()) {
        const key = `${mode}:${i}`;
        if (sentRef.current.has(key)) continue;
        if (sentNow > 0) await pauseBetweenSends();
        const res = await base44.functions.invoke("sendStaffScheduleMessage", { staffId: staff.id, message });
        if (res.data?.error) throw new Error(res.data.error);
        sentRef.current.add(key);
        sentNow++;
        const covered = mode === "one" ? items : [items[i]];
        for (const it of covered) await base44.entities.StaffAvailabilityRequest.update(it.request.id, { bookingNotifiedAt: new Date().toISOString() }).catch(() => {});
      }
      toast.success(`הודעת השיבוץ נשלחה ל${staff.name}`);
      onDone();
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setSending(false);
  };

  return (
    <div className="space-y-3">
      <div className="text-sm">לשלוח ל{staff.name} הודעת שיבוץ על {items.length} {items.length === 1 ? "אירוע" : "אירועים"}?</div>
      {items.length > 1 && (
        <div className="flex gap-2 text-xs">
          <button type="button" onClick={() => setMode("one")} className={`rounded-full border px-3 py-1 ${mode === "one" ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-gray-700 text-gray-300"}`}>הודעה אחת לכל האירועים</button>
          <button type="button" onClick={() => setMode("each")} className={`rounded-full border px-3 py-1 ${mode === "each" ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-gray-700 text-gray-300"}`}>הודעה לכל אירוע</button>
        </div>
      )}
      {!staff.phoneNumber && <p className="text-xs text-amber-300">אין מספר טלפון לאיש הצוות — ההודעה לא תישלח.</p>}
      {mode === "one" ? (
        <textarea value={combined} onChange={(e) => setCombined(e.target.value)} rows={Math.min(14, 5 + items.length)} className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-white" />
      ) : (
        <div className="space-y-2">
          {each.map((m, i) => (
            <textarea key={i} value={m} onChange={(e) => setEach((a) => a.map((x, k) => (k === i ? e.target.value : x)))} rows={7} className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-white" />
          ))}
        </div>
      )}
      <div className="flex flex-row-reverse gap-2">
        <button type="button" onClick={send} disabled={sending || !staff.phoneNumber || (mode === "one" ? !combined.trim() : !each.length)} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח בוואטסאפ{mode === "each" && items.length > 1 ? ` (${items.length} הודעות)` : ""}
        </button>
        <button type="button" onClick={onDone} disabled={sending} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300">לא עכשיו</button>
      </div>
      <p className="text-[11px] text-gray-500">"לא עכשיו" — בפעם הבאה שתפתח את ההיסטוריה המערכת תשאל שוב.</p>
    </div>
  );
}
