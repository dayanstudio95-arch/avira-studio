import { useCallback, useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Send, CalendarDays, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { missingRoles, missingCount, assignedShooters, requiredShooters, combinedNotes } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import StaffAssignmentRoleList from "@/components/events/StaffAssignmentRoleList";
import AvailabilityPills from "@/components/events/AvailabilityPills";
import StaffAvailabilityModal from "@/components/leads/StaffAvailabilityModal";

// "צוות" on the dashboard (2026-10-09, the owner's request): one window per event with the
// team as it stands (who is in which role, which slots are empty), a "בדיקת זמינות" send,
// the answers so far (✅ = assign), and direct assignment to a role — the same pieces the
// staff scheduling page uses, so nothing behaves differently here.
const ROLE_ORDER = ["photographer1", "photographer2", "videographer", "videographer2", "editor"];

export default function EventTeamDialog({ event, staffMembers, onClose, onChanged }) {
  const [sameDay, setSameDay] = useState([]); // every event that day — conflict check + live team
  const [requests, setRequests] = useState([]);
  const [asking, setAsking] = useState(false);
  const [leadNotes, setLeadNotes] = useState("");
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });

  // Only the newest load may write (QA 2026-10-09): closing A and opening B quickly let A's
  // late answers land in B's window — and "✅ פנוי" would then book A's person on B.
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!event) return;
    const seq = ++loadSeq.current;
    const [day, byEvent, byLead, lead] = await Promise.all([
      base44.entities.Event.filter({ date: event.date }).catch(() => []),
      base44.entities.StaffAvailabilityRequest.filter({ eventId: event.id }, "-requestedAt").catch(() => []),
      event.sourceLeadId ? base44.entities.StaffAvailabilityRequest.filter({ leadId: event.sourceLeadId }, "-requestedAt").catch(() => []) : [],
      // the couple's requests ("ביקשו את דודו") are often written on the lead, not the event
      event.sourceLeadId ? base44.entities.Lead.get(event.sourceLeadId).catch(() => null) : null,
    ]);
    if (seq !== loadSeq.current) return;
    setLeadNotes(lead?.notes || "");
    setSameDay(day || []);
    // latest live request per person (re-asking adds a row; a resent one revokes the old)
    const rows = [...(byEvent || []), ...(byLead || [])]
      .filter((r) => !r.revokedAt)
      .sort((a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0));
    const latest = new Map();
    for (const r of rows) if (!latest.has(r.staffMemberId)) latest.set(r.staffMemberId, r);
    setRequests([...latest.values()]);
  }, [event]);

  useEffect(() => {
    setSameDay([]);
    setRequests([]);
    setLeadNotes("");
    load();
  }, [load]);

  if (!event) return null;
  const live = sameDay.find((e) => e.id === event.id) || event;
  const pkg = (pkgQ.data || []).find((p) => p.id === live.packageId);
  const missing = missingCount(live) > 0 ? missingRoles(live, pkg) : [];
  const others = sameDay.filter((e) => e.id !== live.id);
  const notes = combinedNotes(live.notes, leadNotes);
  const refresh = async () => {
    await load();
    onChanged?.();
  };

  return (
    <>
      <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
        <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto border-gray-700 bg-gray-900 text-white">
          <DialogHeader>
            <DialogTitle className="text-right">צוות — {live.coupleNames}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
              <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{formatDateWithWeekday(String(live.date).slice(0, 10))}</span>
              {live.venue && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{live.venue}</span>}
            </div>
            {missing.length ? (
              <span className="rounded-md border border-red-500/30 bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-300">
                חסר: {missing.join(" + ")} ({assignedShooters(live)}/{requiredShooters(live)})
              </span>
            ) : (
              <span className="rounded-md border border-green-500/30 bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-300">✅ הצוות מלא</span>
            )}
          </div>

          {/* The event's notes (2026-10-09) — the couple's requests, to staff accordingly. */}
          {notes && (
            <div className="whitespace-pre-wrap break-words rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              <div className="mb-0.5 text-xs font-semibold text-amber-300">📝 הערות</div>
              {notes}
            </div>
          )}

          <div className="rounded-lg border border-pink-500/25 bg-pink-500/5 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">בדיקת זמינות</span>
              <button
                type="button"
                onClick={() => setAsking(true)}
                className="flex items-center gap-1.5 rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700"
              >
                <Send className="h-3.5 w-3.5" /> שלח בדיקת זמינות
              </button>
            </div>
            {requests.length ? (
              <>
                <div className="mb-1.5 text-[11px] text-slate-400">מי נשאל ומה ענה · לחיצה על ✅ פנוי = שיבוץ לתפקיד והודעה לאיש הצוות</div>
                <AvailabilityPills requests={requests} staffMembers={staffMembers} event={live} team={live.team || []} onAssigned={refresh} />
              </>
            ) : (
              <div className="text-[11px] text-slate-400">עוד לא נשלחה בדיקת זמינות לאירוע הזה.</div>
            )}
          </div>

          <div>
            <div className="mb-2 text-sm font-semibold">הצוות באירוע — שיבוץ לפי תפקיד</div>
            <StaffAssignmentRoleList
              event={live}
              staffMembers={staffMembers}
              events={sameDay.length ? sameDay : [live]}
              onRefresh={refresh}
              sendCalendarInviteByName={sendCalendarInviteByName}
            />
          </div>

          {/* Other weddings that day (2026-10-09): who is already booked there, so nobody is
              asked or assigned twice — the picker above marks them "כבר משובץ" as well. */}
          {others.length > 0 && (
            <div className="border-t border-white/10 pt-3">
              <div className="mb-2 text-sm font-semibold">עוד אירועים באותו יום ({formatDateWithWeekday(String(live.date).slice(0, 10))})</div>
              <div className="space-y-2">
                {others.map((o) => {
                  const crew = (o.team || [])
                    .filter((m) => String(m?.staffMemberName || "").trim())
                    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
                  const gap = missingCount(o);
                  return (
                    <div key={o.id} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{o.coupleNames}{o.venue ? ` · ${o.venue}` : ""}</span>
                        <span className={`text-xs ${gap > 0 ? "text-red-300" : "text-green-300"}`}>{gap > 0 ? `חסר ${gap}` : "צוות מלא"}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {crew.length ? crew.map((m, i) => (
                          <span key={i} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-slate-200">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                        )) : <span className="text-xs text-slate-500">אף אחד עוד לא משובץ</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <StaffAvailabilityModal
        open={asking}
        onClose={() => setAsking(false)}
        onSent={() => {
          setAsking(false);
          load();
        }}
        staffMembers={staffMembers}
        eventDate={live.date}
        venue={live.venue}
        coupleNames={live.coupleNames}
        leadId={live.sourceLeadId || null}
        eventId={live.id}
        eventTeam={live.team || []}
        eventsOnDate={sameDay}
        existingRequests={requests}
      />
    </>
  );
}
