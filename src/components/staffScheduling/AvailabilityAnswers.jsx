import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Clock, XCircle, MapPin, CalendarDays, Send, Lock, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { buildMessage, roleLabelFor } from "@/components/leads/StaffAvailabilityModal";
import { resendAvailabilityRequest } from "@/lib/availabilityResend";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { buildAvailabilityInbox } from "@/lib/availabilityInbox";
import { israelToday, missingRoles } from "@/lib/missingTeam";
import { eventTeamRoleLabel, AVAILABILITY_SLOT_LABELS } from "@/lib/staffRoles";
import { assignStaffToEventSlot } from "@/lib/assignStaffToEvent";
import { formatDateWithWeekday } from "@/lib/chatModel";
import StaffBookingMessageDialog from "@/components/events/StaffBookingMessageDialog";

export const AVAILABILITY_INBOX_KEY = ["availabilityInbox"];
const TEAM_ORDER = ["photographer1", "photographer2", "videographer", "videographer2"];

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
  closed: { icon: Lock, cls: "text-slate-500", text: "לא ענה · האירוע נסגר (לא מחכים לתשובה)" },
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
export default function AvailabilityAnswers({ events, staffMembers, onEventsChanged, focusLeadId, onCheckAvailability }) {
  const qc = useQueryClient();
  const q = useAvailabilityRequests();
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const [filter, setFilter] = useState(focusLeadId ? "all" : "decide");
  const [busy, setBusy] = useState(null);
  const [slotPick, setSlotPick] = useState({});
  const [booked, setBooked] = useState(null); // { staff, roleSlot, event, lead }
  const [resend, setResend] = useState(null); // { request, staff, text } — reminder preview
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

  // "שלח שוב" — a reminder with a fresh link, after a preview (nothing is sent on one click).
  const openResend = async (group, row) => {
    const r = row.request;
    const staff = (staffMembers || []).find((s) => s.id === r.staffMemberId);
    if (!staff?.phoneNumber) { toast.error("אין מספר טלפון לאיש הצוות הזה"); return; }
    const base = await buildMessage({
      roleLabel: roleLabelFor(staff, r.teamRole),
      eventDate: group.date || r.eventDateSnapshot,
      venue: group.venue,
      coupleNames: group.couple,
    });
    setResend({ request: r, staff, text: `🔔 תזכורת — עוד לא קיבלנו ממך תשובה\n${base}` });
  };
  const sendResend = async () => {
    if (!resend?.text.trim()) return;
    setBusy(resend.request.id);
    try {
      await resendAvailabilityRequest({ request: resend.request, phone: resend.staff.phoneNumber, text: resend.text });
      toast.success(`התזכורת נשלחה ל${resend.staff.name}`);
      setResend(null);
      refresh();
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setBusy(null);
  };

  // "סגור" on an event: stop waiting — its unanswered (and undecided) rows leave
  // "ממתינים" / "צריך החלטה". No message to anyone; "פתח מחדש" undoes it.
  const closeGroup = async (g) => {
    const rows = g.rows.filter((x) => ["pending", "decide", "full"].includes(x.state));
    if (!rows.length) return;
    const ok = await confirmDialog({
      title: `לסגור את ${g.couple || "האירוע"}?`,
      message: `${rows.length === 1 ? "איש צוות אחד ייצא" : `${rows.length} אנשי צוות ייצאו`} מ"ממתינים" ומ"צריך החלטה".\nאף אחד לא מקבל הודעה.\nאם מישהו יענה אחר כך — זה יופיע רק ב"הכל", ואפשר תמיד "פתח מחדש".`,
      confirmText: "סגור",
    });
    if (!ok) return;
    setBusy(g.key);
    try {
      const now = new Date().toISOString();
      await Promise.all(rows.map((x) => base44.entities.StaffAvailabilityRequest.update(x.request.id, { decisionDismissedAt: now })));
      toast.success("האירוע נסגר ברשימה");
      refresh();
    } catch (e) {
      toast.error("העדכון נכשל", { description: e?.message });
    }
    setBusy(null);
  };
  const reopenGroup = async (g) => {
    const rows = g.rows.filter((x) => x.state === "closed" || x.state === "dismissed");
    setBusy(g.key);
    try {
      await Promise.all(rows.map((x) => base44.entities.StaffAvailabilityRequest.update(x.request.id, { decisionDismissedAt: null })));
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
                  {/* The team as it stands, slot by slot (editor left out). */}
                  {g.event && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">הצוות כרגע:</span>
                      {(() => {
                        const crew = (g.event.team || [])
                          .filter((m) => m.role !== "editor" && String(m.staffMemberName || "").trim())
                          .sort((a, b) => TEAM_ORDER.indexOf(a.role) - TEAM_ORDER.indexOf(b.role));
                        return crew.length ? crew.map((m, i) => (
                          <span key={i} className="e-chip e-chip-blue text-[11px]">{eventTeamRoleLabel(m.role)}: {m.staffMemberName}</span>
                        )) : <span className="text-[11px] text-slate-500">אף אחד עוד</span>;
                      })()}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Ask more people about this date (2026-10-09) — the same pink "זמינות צלם"
                      as the event panel; a couple without an event yet is asked by its lead. */}
                  {onCheckAvailability && (
                    <button
                      type="button"
                      onClick={() =>
                        onCheckAvailability(
                          g.event || { sourceLeadId: g.leadId, date: g.date, venue: g.venue, coupleNames: g.couple, team: [] }
                        )
                      }
                      title="שליחת בדיקת זמינות לאנשי צוות נוספים לתאריך הזה"
                      className="flex h-7 items-center gap-1 rounded-lg bg-pink-600 px-2.5 text-xs font-semibold text-white hover:bg-pink-700"
                    >
                      <Send className="h-3.5 w-3.5" /> זמינות צלם
                    </button>
                  )}
                  {!g.event ? (
                    <span className="e-chip e-chip-gray">אין אירוע עדיין</span>
                  ) : missing.length ? (
                    <span className="e-chip e-chip-red">חסר: {missing.join(" + ")}</span>
                  ) : (
                    <span className="e-chip e-chip-green">✅ הצוות מלא</span>
                  )}
                  {g.waiting + g.toDecide > 0 ? (
                    <button
                      type="button"
                      disabled={busy === g.key}
                      onClick={() => closeGroup(g)}
                      title="לא צריך יותר תשובות לאירוע הזה (למשל הצוות כבר מלא) — יוצא מ'ממתינים' ומ'צריך החלטה'. לא נשלחת שום הודעה."
                      className="flex h-7 items-center gap-1 rounded-lg border border-[#2A3B57] bg-white/[0.04] px-2.5 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                    >
                      <Lock className="h-3.5 w-3.5" /> סגור
                    </button>
                  ) : g.closed > 0 ? (
                    <button
                      type="button"
                      disabled={busy === g.key}
                      onClick={() => reopenGroup(g)}
                      title="מחזיר את מי שלא ענה ל'ממתינים'"
                      className="flex h-7 items-center gap-1 rounded-lg border border-[#2A3B57] bg-white/[0.04] px-2.5 text-xs text-slate-400 hover:text-white disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> פתח מחדש
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="divide-y divide-white/[0.05] px-3 py-1">
                {g.rows.map((row) => {
                  const r = row.request;
                  const ui = STATE_UI[row.state];
                  const Icon = ui.icon;
                  const asked = r.teamRole ? AVAILABILITY_SLOT_LABELS[r.teamRole] : null;
                  // Where they are on the team, by slot (2026-10-07: "שיבצתי את זיו — לצלם 1 או 2?").
                  const stateText = row.state === "assigned" && row.assignedSlot ? `✔ משובץ/ת כ${eventTeamRoleLabel(row.assignedSlot)}` : ui.text;
                  const slot = slotPick[r.id] || row.defaultSlot;
                  return (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={`h-4 w-4 shrink-0 ${ui.cls}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white">{r.staffNameSnapshot}</div>
                          <div className="text-[11px] text-slate-400">
                            {asked ? `שאלתי: ${asked} · ` : ""}{stateText}
                            {r.respondedAt && row.state !== "pending" ? ` · ענה ${hhmm(r.respondedAt)}` : ""}
                          </div>
                        </div>
                      </div>
                      {row.state === "pending" && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => openResend(g, row)}
                          title="שולח לו שוב את בדיקת הזמינות (עם קישור חדש), אחרי תצוגה מקדימה"
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 text-xs font-medium text-pink-200 hover:bg-pink-500/20 disabled:opacity-50"
                        >
                          <Send className="h-3.5 w-3.5" /> שלח שוב
                        </button>
                      )}
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

      <Dialog open={!!resend} onOpenChange={(o) => !o && busy !== resend?.request.id && setResend(null)}>
        <DialogContent dir="rtl" className="max-w-md border-gray-700 bg-gray-900 text-white">
          <DialogHeader>
            <DialogTitle>לשלוח שוב ל{resend?.staff.name}?</DialogTitle>
          </DialogHeader>
          <textarea
            value={resend?.text || ""}
            onChange={(e) => setResend((x) => ({ ...x, text: e.target.value }))}
            rows={7}
            className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-white"
          />
          <p className="text-[11px] text-gray-400">
            בסוף ההודעה יתווסף קישור חדש לתשובה. הקישור הקודם שנשלח אליו יפסיק לעבוד, כך שתמיד יש רק אחד.
          </p>
          <DialogFooter className="flex-row-reverse gap-2">
            <button type="button" onClick={() => setResend(null)} disabled={busy === resend?.request.id} className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300">
              ביטול
            </button>
            <button
              type="button"
              onClick={sendResend}
              disabled={busy === resend?.request.id || !resend?.text.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy === resend?.request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח בוואטסאפ
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
