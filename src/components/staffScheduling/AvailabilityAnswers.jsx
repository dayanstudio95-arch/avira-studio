import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Clock, XCircle, MapPin, CalendarDays } from "lucide-react";
import { buildAvailabilityInbox } from "@/lib/availabilityInbox";
import { israelToday, missingRoles } from "@/lib/missingTeam";
import { eventTeamRoleLabel, AVAILABILITY_SLOT_LABELS } from "@/lib/staffRoles";
import { assignStaffToEventSlot } from "@/lib/assignStaffToEvent";
import { formatDateWithWeekday } from "@/lib/chatModel";
import StaffBookingMessageDialog from "@/components/events/StaffBookingMessageDialog";

export const AVAILABILITY_INBOX_KEY = ["availabilityInbox"];

// Every availability request for an upcoming event (one query, reused by the tab's count).
export function useAvailabilityRequests() {
  return useQuery({
    queryKey: AVAILABILITY_INBOX_KEY,
    queryFn: () => base44.entities.StaffAvailabilityRequest.filter({ eventDateSnapshot: { $gte: israelToday() } }, "-requestedAt", 1000),
    refetchInterval: 60000,
  });
}

const FILTERS = [
  { key: "decide", label: "צריך החלטה" },
  { key: "pending", label: "ממתינים לתשובה" },
  { key: "all", label: "הכל" },
];

const STATE_UI = {
  assigned: { icon: CheckCircle2, cls: "text-emerald-400", text: "✔ כבר משובץ/ת" },
  decide: { icon: CheckCircle2, cls: "text-emerald-400", text: "פנוי/ה" },
  full: { icon: CheckCircle2, cls: "text-emerald-400", text: "פנוי/ה · אין צורך (התפקיד מלא)" },
  no_event: { icon: CheckCircle2, cls: "text-emerald-400", text: "פנוי/ה · אין עדיין אירוע (הזוג לא חתם)" },
  dismissed: { icon: CheckCircle2, cls: "text-slate-500", text: "פנוי/ה · סומן \"לא צריך\"" },
  pending: { icon: Clock, cls: "text-amber-300", text: "עוד לא ענה" },
  declined: { icon: XCircle, cls: "text-rose-400", text: "לא פנוי/ה" },
};

const hhmm = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })}`;
};

// "📥 תשובות זמינות" (2026-10-07, the owner's request): instead of opening notification
// after notification, every answer in one place, grouped by event — who is already on the
// team, who said "פנוי" and still needs a decision (assign / "לא צריך"), who hasn't answered.
export default function AvailabilityAnswers({ events, staffMembers, onEventsChanged, focusLeadId }) {
  const qc = useQueryClient();
  const q = useAvailabilityRequests();
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const [filter, setFilter] = useState(focusLeadId ? "all" : "decide");
  const [busy, setBusy] = useState(null);
  const [slotPick, setSlotPick] = useState({});
  const [booked, setBooked] = useState(null); // { staff, roleSlot, event, lead }
  const focusRef = useRef(null);

  const inbox = useMemo(
    () => buildAvailabilityInbox({ requests: q.data || [], events, today: israelToday() }),
    [q.data, events]
  );
  const pkgById = useMemo(() => Object.fromEntries((pkgQ.data || []).map((p) => [p.id, p])), [pkgQ.data]);
  const groups = inbox.groups.filter((g) =>
    filter === "decide" ? g.toDecide > 0 : filter === "pending" ? g.waiting > 0 : true
  );

  useEffect(() => {
    if (focusLeadId && focusRef.current) focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusLeadId, groups.length]);

  const refresh = () => qc.invalidateQueries({ queryKey: AVAILABILITY_INBOX_KEY });

  const assign = async (group, row) => {
    const staff = (staffMembers || []).find((s) => s.id === row.request.staffMemberId);
    const roleSlot = slotPick[row.request.id] || row.defaultSlot;
    if (!staff) { toast.error("איש הצוות לא נמצא ברשימת הצוות הפעילה"); return; }
    if (!roleSlot) return;
    setBusy(row.request.id);
    try {
      await assignStaffToEventSlot({ event: group.event, staffMember: staff, roleSlot });
      toast.success(`${staff.name} שובץ/ה ל${eventTeamRoleLabel(roleSlot)} — ${group.couple}`);
      const lead = group.leadId ? (await base44.entities.Lead.filter({ id: group.leadId }).catch(() => []))?.[0] || null : null;
      setBooked({ staff, roleSlot, event: group.event, lead });
      onEventsChanged?.();
      refresh();
    } catch (e) {
      toast.error("השיבוץ נכשל", { description: e?.message });
    }
    setBusy(null);
  };

  const dismiss = async (row) => {
    setBusy(row.request.id);
    try {
      await base44.entities.StaffAvailabilityRequest.update(row.request.id, { decisionDismissedAt: new Date().toISOString() });
      refresh();
    } catch (e) {
      toast.error("העדכון נכשל", { description: e?.message });
    }
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const n = f.key === "decide" ? inbox.toDecide : f.key === "pending" ? inbox.groups.reduce((t, g) => t + g.waiting, 0) : inbox.groups.length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-lg border px-3.5 py-1.5 text-xs font-medium transition-all ${
                filter === f.key ? "bg-[#FACC15]/10 border-[#FACC15]/80 text-[#FDE047]" : "bg-[#0B1529] border-[#2A3B57] text-slate-300 hover:text-white"
              }`}
            >
              {f.label} ({n})
            </button>
          );
        })}
        {q.isFetching && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
      </div>

      {q.isLoading ? (
        <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="dash-card py-14 text-center text-slate-400">
          {filter === "decide" ? "אין תשובות שמחכות להחלטה ✅" : filter === "pending" ? "כולם ענו ✅" : "אין בקשות זמינות לאירועים קרובים"}
        </div>
      ) : (
        groups.map((g) => {
          const missing = g.event ? missingRoles(g.event, pkgById[g.event.packageId]) : [];
          const focused = focusLeadId && g.leadId === focusLeadId;
          return (
            <div key={g.key} ref={focused ? focusRef : undefined} className={`dash-card overflow-hidden ${focused ? "ring-2 ring-[#60A5FA]/60" : ""}`}>
              <div className="dash-head flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white">{g.couple || "—"}</div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{g.date ? formatDateWithWeekday(g.date) : "—"}</span>
                    {g.venue && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{g.venue}</span>}
                  </div>
                </div>
                {!g.event ? (
                  <span className="e-chip e-chip-gray">אין אירוע עדיין</span>
                ) : missing.length ? (
                  <span className="e-chip e-chip-red">חסר: {missing.join(" + ")}</span>
                ) : (
                  <span className="e-chip e-chip-green">✅ הצוות מלא</span>
                )}
              </div>
              <div className="divide-y divide-white/[0.05] px-3 py-1">
                {g.rows.map((row) => {
                  const r = row.request;
                  const ui = STATE_UI[row.state];
                  const Icon = ui.icon;
                  const asked = r.teamRole ? AVAILABILITY_SLOT_LABELS[r.teamRole] : null;
                  const slot = slotPick[r.id] || row.defaultSlot;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${ui.cls}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white">{r.staffNameSnapshot}</div>
                          <div className="text-[11px] text-slate-400">
                            {asked ? `שאלתי: ${asked} · ` : ""}{ui.text}
                            {r.respondedAt && row.state !== "pending" ? ` · ענה ${hhmm(r.respondedAt)}` : ""}
                          </div>
                        </div>
                      </div>
                      {(row.state === "decide" || row.state === "full") && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {row.state === "decide" && row.freeSlots.length > 1 && (
                            <select
                              value={slot || ""}
                              onChange={(e) => setSlotPick((m) => ({ ...m, [r.id]: e.target.value }))}
                              className="h-8 rounded-lg border border-[#2A3B57] bg-[#0B1529] px-2 text-xs text-white"
                            >
                              {row.freeSlots.map((s) => <option key={s} value={s}>{eventTeamRoleLabel(s)}</option>)}
                            </select>
                          )}
                          {row.state === "decide" && (
                            <button
                              type="button"
                              disabled={busy === r.id}
                              onClick={() => assign(g, row)}
                              className="h-8 rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {busy === r.id ? "…" : `שבץ ל${eventTeamRoleLabel(slot)}`}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy === r.id}
                            onClick={() => dismiss(row)}
                            title="מוציא מ'צריך החלטה'. איש הצוות לא מקבל שום הודעה."
                            className="h-8 rounded-lg border border-[#2A3B57] bg-white/[0.04] px-3 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                          >
                            לא צריך
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {booked && (
        <StaffBookingMessageDialog
          booking={{ staff: booked.staff, roleSlot: booked.roleSlot }}
          event={booked.event}
          lead={booked.lead}
          onClose={() => setBooked(null)}
        />
      )}
    </div>
  );
}
