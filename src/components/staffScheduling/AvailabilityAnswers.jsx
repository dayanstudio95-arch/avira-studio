import React, { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, Clock, XCircle, MapPin, CalendarDays, Send, Lock, RotateCcw, Bell, MinusCircle, StickyNote } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { buildMessage, roleLabelFor } from "@/components/leads/StaffAvailabilityModal";
import { resendAvailabilityRequest } from "@/lib/availabilityResend";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { buildAvailabilityInbox, reopenRows } from "@/lib/availabilityInbox";
import { israelToday } from "@/lib/missingTeam";
import { eventTeamRoleLabel, AVAILABILITY_SLOT_LABELS } from "@/lib/staffRoles";
import { assignStaffToEventSlot } from "@/lib/assignStaffToEvent";
import { formatDateWithWeekday } from "@/lib/chatModel";
import StaffBookingMessageDialog from "@/components/events/StaffBookingMessageDialog";
import CrewAvailabilityDialog from "@/components/staffScheduling/CrewAvailabilityDialog";
import ReminderDialog from "@/components/staffScheduling/ReminderDialog";

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

// "חסר צוות" first (2026-11-11, the owner: "אני רוצה שאני יוכל לראות את כל האירועים שחסר לי צוות ואז לשלוח זימון").
const FILTERS = [
  { key: "missing", label: "חסר צוות" },
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
  // Already on another event that day (2026-11-09): the words say where; no "שבץ".
  busy: { icon: XCircle, cls: "text-rose-400", text: "כבר משובץ/ת באותו יום באירוע אחר" },
  // Nothing missing for it any more (2026-11-11): the team is full, or this role is.
  not_needed: { icon: MinusCircle, cls: "text-slate-500", text: "לא צריך" },
};

// The notes on a card, two lines until clicked (median 47 characters, a few hundreds).
function CardNotes({ notes, couple }) {
  const [open, setOpen] = useState(false);
  if (!notes && !couple) return null;
  return (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      title={open ? "" : "לחיצה מציגה את כל ההערות"}
      className="mt-2 flex w-full items-start gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-start text-xs text-amber-100/90"
      data-testid="answer-notes"
    >
      <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
      {/* Each part two lines until clicked — what the couple wrote is never hidden under the studio's notes. */}
      <span className="min-w-0 space-y-0.5">
        {notes && <span className={`block whitespace-pre-line ${open ? "" : "line-clamp-2"}`}>{notes}</span>}
        {couple && (
          <span className={`block whitespace-pre-line ${open ? "" : "line-clamp-2"}`}>
            <span className="text-amber-300/80">הזוג בחתימה: </span>
            {couple}
          </span>
        )}
      </span>
    </button>
  );
}

const hhmm = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}.${d.getMonth() + 1} ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jerusalem" })}`;
};

// "📥 תשובות זמינות" (2026-10-07, the owner's request): instead of opening notification
// after notification, every answer in one place, grouped by event — who is already on the
// team, who said "פנוי" and still needs a decision (assign / "לא צריך"), who hasn't answered.
export default function AvailabilityAnswers({ events, staffMembers, onEventsChanged, focusLeadId, onCheckAvailability, ask }) {
  const qc = useQueryClient();
  const q = useAvailabilityRequests();
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const [filter, setFilter] = useState(focusLeadId ? "all" : ask?.filter || "missing");
  useEffect(() => {
    if (ask?.filter) setFilter(ask.filter);
  }, [ask?.at]);
  // Unanswered rows ticked for one reminder (request ids), across events (2026-11-11).
  const [picked, setPicked] = useState(() => new Set());
  const [reminding, setReminding] = useState(null); // the ticked items, frozen while the window is open
  const [crewOpen, setCrewOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [slotPick, setSlotPick] = useState({});
  const [booked, setBooked] = useState(null); // { staff, roleSlot, event, lead }
  const [resend, setResend] = useState(null); // { request, staff, text } — reminder preview
  const focusRef = useRef(null);

  const pkgById = useMemo(() => Object.fromEntries((pkgQ.data || []).map((p) => [p.id, p])), [pkgQ.data]);
  const inbox = useMemo(
    () => buildAvailabilityInbox({ requests: q.data || [], events, today: israelToday(), packagesById: pkgById }),
    [q.data, events, pkgById]
  );
  const groups = inbox.groups.filter((g) =>
    filter === "missing" ? g.isMissing : filter === "decide" ? g.toDecide > 0 : filter === "pending" ? g.waiting > 0 : true
  );
  // Every unanswered row now, by request id — what a tick can point at (a sent or answered one drops out by itself).
  const pendingById = useMemo(() => {
    const m = new Map();
    for (const g of inbox.groups) for (const row of g.rows) if (row.state === "pending") m.set(row.request.id, { request: row.request, date: g.date, venue: g.venue, couple: g.couple, eventKey: g.key });
    return m;
  }, [inbox]);
  const pickedItems = [...picked].filter((id) => pendingById.has(id)).map((id) => pendingById.get(id));
  const pickedEvents = new Set(pickedItems.map((x) => x.eventKey)).size;
  const togglePick = (id) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const shownPending = groups.flatMap((g) => g.rows.filter((r) => r.state === "pending").map((r) => r.request.id));

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
      await Promise.all(rows.map((x) => base44.entities.StaffAvailabilityRequest.update(x.request.id, { decisionDismissedAt: now, groupClosedAt: now })));
      toast.success("האירוע נסגר ברשימה");
      refresh();
    } catch (e) {
      toast.error("העדכון נכשל", { description: e?.message });
    }
    setBusy(null);
  };
  const reopenGroup = async (g) => {
    // Only what "סגור" took out — a personal "לא צריך" stays (reopenRows, availabilityInbox.js).
    const rows = reopenRows(g.rows);
    if (!rows.length) return;
    setBusy(g.key);
    try {
      await Promise.all(rows.map((x) => base44.entities.StaffAvailabilityRequest.update(x.request.id, {
        decisionDismissedAt: null,
        ...(x.request.groupClosedAt ? { groupClosedAt: null } : {}),
      })));
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
          const n = f.key === "missing" ? inbox.missing : f.key === "decide" ? inbox.toDecide : f.key === "pending" ? inbox.waiting : inbox.groups.length;
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
      {filter === "missing" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <button
            type="button"
            onClick={() => setCrewOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-pink-500/40 bg-pink-500/10 px-3 font-medium text-pink-200 hover:bg-pink-500/20"
            data-testid="crew-multi"
          >
            <Send className="h-3.5 w-3.5" /> זימון לכמה אירועים יחד
          </button>
          בוחרים תפקיד ואירועים, וכל איש צוות מקבל הודעה אחת עם כל התאריכים.
        </div>
      )}
      {shownPending.length > 1 && filter !== "missing" && (
        <button
          type="button"
          onClick={() => setPicked((cur) => { const all = shownPending.every((id) => cur.has(id)); const next = new Set(cur); shownPending.forEach((id) => (all ? next.delete(id) : next.add(id))); return next; })}
          className="text-xs text-pink-200 underline-offset-2 hover:underline"
          data-testid="pick-all-pending"
        >
          {shownPending.every((id) => picked.has(id)) ? "ניקוי הסימון" : `סימון כל מי שלא ענה כאן (${shownPending.length}) לתזכורת`}
        </button>
      )}

      {q.isLoading ? (
        <div className="py-16 text-center text-slate-400"><Loader2 className="mx-auto h-6 w-6 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <div className="dash-card py-14 text-center text-slate-400">
          {filter === "missing" ? "בכל האירועים הקרובים הצוות מלא ✅" : filter === "decide" ? "אין תשובות שמחכות להחלטה ✅" : filter === "pending" ? "כולם ענו ✅" : "אין בקשות זמינות לאירועים קרובים"}
        </div>
      ) : (
        groups.map((g) => {
          const missing = g.missing;
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
                  {/* The notes (2026-11-11, "ככה אני יוכל לדעת אם הם ביקשו צלם ספציפי"): the event's, its lead's, and
                      what the couple wrote when signing. */}
                  <CardNotes notes={g.event?.displayNotes || ""} couple={g.event?.coupleNotes || ""} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Missing crew (2026-11-11): one pink button per empty slot, opening on that role. */}
                  {onCheckAvailability && g.isMissing && g.missingSlots.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => onCheckAvailability(g.event, { jobRole: slot.startsWith("video") ? "videographer" : "photographer", slot })}
                      title={`שליחת בדיקת זמינות ל${eventTeamRoleLabel(slot)} לתאריך הזה`}
                      className="flex h-7 items-center gap-1 rounded-lg bg-pink-600 px-2.5 text-xs font-semibold text-white hover:bg-pink-700"
                      data-testid={`invite-${slot}`}
                    >
                      <Send className="h-3.5 w-3.5" /> זימון ל{eventTeamRoleLabel(slot)}
                    </button>
                  ))}
                  {/* Ask more people about this date (2026-10-09) — the same pink "זמינות צלם"
                      as the event panel; a couple without an event yet is asked by its lead. */}
                  {onCheckAvailability && !(g.isMissing && g.missingSlots.length) && (
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
                  ) : g.isMissing ? (
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
                      title="מחזיר את מי שהסגירה הוציאה. מי שסימנת אצלו 'לא צריך' נשאר כמו שהוא."
                      className="flex h-7 items-center gap-1 rounded-lg border border-[#2A3B57] bg-white/[0.04] px-2.5 text-xs text-slate-400 hover:text-white disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> פתח מחדש
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="divide-y divide-white/[0.05] px-3 py-1">
                {!g.rows.length && <div className="py-2.5 text-xs text-slate-400">עוד לא שאלת אף אחד על התאריך הזה.</div>}
                {g.rows.map((row) => {
                  const r = row.request;
                  const ui = STATE_UI[row.state];
                  const Icon = ui.icon;
                  const asked = r.teamRole ? AVAILABILITY_SLOT_LABELS[r.teamRole] : null;
                  // Where they are on the team, by slot (2026-10-07: "שיבצתי את זיו — לצלם 1 או 2?").
                  const stateText =
                    row.state === "assigned" && row.assignedSlot
                      ? `✔ משובץ/ת כ${eventTeamRoleLabel(row.assignedSlot)}`
                      : row.state === "not_needed"
                        ? `${r.status === "available" ? "פנוי/ה" : "לא ענה"} · לא צריך תשובה, ${g.isMissing ? "התפקיד הזה כבר מלא" : "הצוות מלא"}`
                      : row.state === "busy"
                        ? `${r.status === "available" ? 'ענה "פנוי" · ' : ""}אבל כבר משובץ/ת באותו יום אצל ${row.busy.couple} (${eventTeamRoleLabel(row.busy.role)})`
                        : ui.text;
                  const slot = slotPick[r.id] || row.defaultSlot;
                  return (
                    <div key={r.id} className={`flex flex-wrap items-center justify-between gap-2 py-2.5 ${row.state === "not_needed" ? "opacity-60" : ""}`} data-testid={`answer-row-${row.state}`}>
                      <div className="flex min-w-0 items-center gap-2">
                        {/* Ticked for one reminder to several people (2026-11-11). */}
                        {row.state === "pending" && (
                          <input
                            type="checkbox"
                            checked={picked.has(r.id)}
                            onChange={() => togglePick(r.id)}
                            aria-label={`סימון ${r.staffNameSnapshot} לתזכורת`}
                            className="h-4 w-4 shrink-0 accent-pink-500"
                            data-testid="pick-pending"
                          />
                        )}
                        <Icon className={`h-4 w-4 shrink-0 ${ui.cls}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-white">{r.staffNameSnapshot}</div>
                          <div className="text-[11px] text-slate-400">
                            {asked ? `שאלתי: ${asked} · ` : ""}
                            <span className={row.state === "busy" ? "text-rose-300" : ""} data-testid={row.state === "busy" ? "answer-busy" : undefined}>{stateText}</span>
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
                      {/* Said "פנוי" but booked elsewhere that day: only "לא צריך", to clear it. */}
                      {row.state === "busy" && r.status === "available" && !r.decisionDismissedAt && (
                        <button
                          type="button"
                          disabled={busy === r.id}
                          onClick={() => dismiss(row)}
                          title="מוציא את השורה. איש הצוות לא מקבל שום הודעה."
                          className="h-8 rounded-lg border border-[#2A3B57] bg-white/[0.04] px-3 text-xs text-slate-300 hover:text-white disabled:opacity-50"
                        >
                          לא צריך
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

      {/* The ticked ones: one reminder each, from any event (2026-11-11). Fixed at the bottom of the screen, clear of the
          yellow "+" (bottom-left): beside it on a phone, centred on a computer — where the upload pill sits too. */}
      {pickedItems.length > 0 && <div className="h-16" aria-hidden="true" />}
      {pickedItems.length > 0 && (
        <div className="fixed bottom-4 left-[88px] right-3 z-[60] flex flex-wrap items-center justify-between gap-2 rounded-xl border border-pink-500/40 bg-[#0B1529]/95 px-4 py-2.5 shadow-lg backdrop-blur md:left-1/2 md:right-auto md:w-[min(92vw,520px)] md:-translate-x-1/2" data-testid="pick-bar">
          <span className="text-sm text-white">
            נבחרו {pickedItems.length === 1 ? "איש צוות אחד" : `${pickedItems.length} אנשי צוות`}
            {pickedEvents > 1 ? ` מ-${pickedEvents} אירועים` : ""}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setPicked(new Set())} className="h-8 rounded-lg border border-[#2A3B57] px-3 text-xs text-slate-300 hover:text-white">
              ניקוי
            </button>
            <button
              type="button"
              onClick={() => setReminding(pickedItems)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-semibold text-white hover:bg-green-700"
              data-testid="remind-picked"
            >
              <Bell className="h-3.5 w-3.5" /> תזכורת {pickedItems.length === 1 ? "" : "לכולם"}
            </button>
          </span>
        </div>
      )}

      {reminding && (
        <ReminderDialog
          items={reminding}
          staffMembers={staffMembers}
          onClose={() => {
            setReminding(null);
            refresh();
          }}
          onSent={(ids) => setPicked((cur) => { const next = new Set(cur); ids.forEach((id) => next.delete(id)); return next; })}
        />
      )}
      {crewOpen && <CrewAvailabilityDialog open onClose={() => { setCrewOpen(false); refresh(); }} />}

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
