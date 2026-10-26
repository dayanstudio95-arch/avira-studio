import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { israelToday, eventDay, combinedNotes } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { sameDayOthers, crewByRole } from "@/lib/sameDayCrew";
import { SLOT_OPTIONS, slotOption, batchAvailabilityMessage } from "@/lib/staffAvailabilityBatch";
import { missingBySlot, staffForSlot, planForStaff, askedForEvent } from "@/lib/crewAvailability";
import { sendAvailabilityBatch, LINK_MARK } from "@/lib/availabilityBatchSend";
import { friendlySendError } from "@/lib/sendErrors";
import { useAvailabilityRequests, AVAILABILITY_INBOX_KEY } from "./AvailabilityAnswers";

const STATUS_TEXT = { available: "✓ פנוי", pending: "ממתין", declined: "לא פנוי" };
const shortDate = (e) => { const [, m, d] = eventDay(e).split("-"); return `${Number(d)}.${Number(m)}`; };

// "+ → זמינות צוות" (2026-10-27, the owner's design): step 1 — a role, and every upcoming event
// missing it, each with its notes, who else works that day and who was already asked; tick some.
// Step 2 — who to ask: each person gets ONE WhatsApp with his dates and one link where he marks
// each פנוי / לא פנוי (the batch link, 0082). A date he works elsewhere is left out of his
// message. Answers land like every availability answer (bell, ✅ pill, "תשובות זמינות") and the
// owner assigns with a click — nothing is assigned automatically (his choice).
export default function CrewAvailabilityDialog({ open, onClose }) {
  const today = israelToday();
  const qc = useQueryClient();
  const [slot, setSlot] = useState("photographer1");
  const [picked, setPicked] = useState({}); // eventId → true
  const [step, setStep] = useState("events");
  const [people, setPeople] = useState({}); // staffId → true
  const [texts, setTexts] = useState({}); // staffId → edited text
  const [openText, setOpenText] = useState(null);
  const [status, setStatus] = useState({}); // staffId → 'sending' | 'sent' | error text
  const [sending, setSending] = useState(false);

  const eventsQ = useQuery({ queryKey: ["crewAvailEvents"], enabled: open, queryFn: () => base44.entities.Event.filter({ date: { $gte: today } }, "date", 1000), staleTime: 30000 });
  const pkgQ = useQuery({ queryKey: ["dashPackages"], enabled: open, queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const notesQ = useQuery({ queryKey: ["staffBatchLeadNotes"], enabled: open, queryFn: () => base44.entities.Lead.filter({}, undefined, undefined, "id, notes"), staleTime: 120000 });
  const staffQ = useQuery({ queryKey: ["crewAvailStaff"], enabled: open, queryFn: () => base44.entities.StaffMember.list(), staleTime: 60000 });
  const requestsQ = useAvailabilityRequests();

  useEffect(() => {
    if (!open) return;
    setPicked({}); setStep("events"); setPeople({}); setTexts({}); setStatus({}); setOpenText(null); setSending(false);
  }, [open]);
  useEffect(() => { setPicked({}); setPeople({}); setTexts({}); setStatus({}); }, [slot]);

  const events = useMemo(() => eventsQ.data || [], [eventsQ.data]);
  const pkgById = useMemo(() => Object.fromEntries((pkgQ.data || []).map((p) => [p.id, p])), [pkgQ.data]);
  const leadNotes = useMemo(() => new Map((notesQ.data || []).map((l) => [l.id, l.notes])), [notesQ.data]);
  const bySlot = useMemo(() => missingBySlot({ events, today, packagesById: pkgById }), [events, today, pkgById]);
  const rows = bySlot[slot] || [];
  const selected = rows.filter((e) => picked[e.id]);
  const requests = requestsQ.data || [];
  const staffList = useMemo(() => staffForSlot(staffQ.data || [], slot), [staffQ.data, slot]);
  const plans = useMemo(
    () => Object.fromEntries(staffList.map((s) => [s.id, planForStaff({ staff: s, selected, allEvents: events, requests })])),
    [staffList, selected.map((e) => e.id).join(), events, requests]
  );
  const chosenPeople = staffList.filter((s) => people[s.id] && s.phoneNumber && plans[s.id]?.send.length);
  const textFor = (s) => texts[s.id] ?? batchAvailabilityMessage({ name: s.name, slot, events: plans[s.id]?.send || [], link: LINK_MARK });

  const sendAll = async () => {
    if (!chosenPeople.length || sending) return;
    setSending(true);
    let ok = 0;
    for (const s of chosenPeople) {
      if (status[s.id] === "sent") { ok++; continue; }
      setStatus((st) => ({ ...st, [s.id]: "sending" }));
      try {
        await sendAvailabilityBatch({ staff: s, slot, events: plans[s.id].send, text: textFor(s) });
        setStatus((st) => ({ ...st, [s.id]: "sent" }));
        ok++;
      } catch (e) {
        console.error("crew availability send failed:", e);
        setStatus((st) => ({ ...st, [s.id]: friendlySendError(e?.message) }));
      }
    }
    setSending(false);
    qc.invalidateQueries({ queryKey: AVAILABILITY_INBOX_KEY });
    if (ok === chosenPeople.length) {
      toast.success(ok === 1 ? `נשלחה בדיקת זמינות ל${chosenPeople[0].name}` : `נשלחה בדיקת זמינות ל-${ok} אנשי צוות`);
      onClose?.();
    }
  };

  const loading = eventsQ.isLoading || pkgQ.isLoading;
  const slotLabel = slotOption(slot)?.label || "";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose?.(); }}>
      <DialogContent dir="rtl" className="max-h-[92vh] max-w-2xl overflow-y-auto border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            {step === "people" && (
              <button type="button" onClick={() => setStep("events")} disabled={sending} className="rounded p-1 text-gray-400 hover:text-white" aria-label="חזרה לאירועים">
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
            {step === "events" ? "זמינות צוות" : `${slotLabel} · ${selected.length} אירועים`}
          </DialogTitle>
        </DialogHeader>

        {step === "events" ? (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-gray-400">אירועים קרובים שחסר בהם (לפי החבילה):</div>
            <div className="flex flex-wrap gap-1.5">
              {SLOT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSlot(o.value)}
                  className={`rounded-full border px-3 py-1 text-xs ${slot === o.value ? "border-yellow-400 bg-yellow-400 font-semibold text-gray-900" : "border-gray-700 text-gray-300 hover:text-white"}`}
                >
                  {o.label.split(" · ")[0]} · {(bySlot[o.value] || []).length}
                </button>
              ))}
            </div>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>
            ) : rows.length === 0 ? (
              <div className="rounded-lg border border-gray-800 py-6 text-center text-gray-400">אין אירועים קרובים שחסר בהם {slotLabel.split(" · ")[0]} ✅</div>
            ) : (
              <div className="space-y-1.5">
                {rows.map((e) => {
                  const notes = combinedNotes(e.notes, leadNotes.get(e.sourceLeadId));
                  const others = sameDayOthers(events, { date: e.date, eventId: e.id });
                  const asked = askedForEvent(requests, e.id, slot);
                  return (
                    <label key={e.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 ${picked[e.id] ? "border-yellow-400/70 bg-yellow-400/[0.04]" : "border-gray-800 hover:bg-white/[0.03]"}`}>
                      <input type="checkbox" checked={!!picked[e.id]} onChange={() => setPicked((p) => ({ ...p, [e.id]: !p[e.id] }))} className="mt-1 accent-yellow-400" />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{formatDateWithWeekday(eventDay(e))}</span>
                        {e.coupleNames ? ` · ${e.coupleNames}` : ""}
                        {e.venue && <span className="block text-xs text-gray-400">{e.venue}</span>}
                        {notes && <span className="mt-1 block whitespace-pre-wrap rounded-md border border-yellow-500/30 bg-yellow-500/[0.06] px-2 py-1 text-xs text-yellow-100/90">📝 {notes}</span>}
                        {others.map((o) => {
                          const crew = crewByRole(o);
                          return (
                            <span key={o.id} className="mt-1 block rounded-md border border-sky-400/30 bg-sky-400/[0.06] px-2 py-1 text-xs text-sky-100">
                              באותו יום: {o.coupleNames}{o.venue ? ` · ${o.venue}` : ""} — {crew.length ? crew.map((m) => `${eventTeamRoleLabel(m.role)}: ${m.staffMemberName}`).join(" · ") : "אף אחד עוד לא משובץ"}
                            </span>
                          );
                        })}
                        {asked.length > 0 && (
                          <span className="mt-1 block text-xs text-gray-400">
                            כבר נשאלו: {asked.map((a) => `${a.name} (${STATUS_TEXT[a.status] || a.status})`).join(", ")}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <Button onClick={() => setStep("people")} disabled={!selected.length} className="w-full bg-yellow-400 font-semibold text-gray-900 hover:bg-yellow-500">
              {selected.length ? `המשך — ${selected.length === 1 ? "אירוע אחד נבחר" : `${selected.length} אירועים נבחרו`}` : "סמן אירועים כדי להמשיך"}
            </Button>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="text-xs text-gray-400">בחר את מי לשאול — כל אחד מקבל הודעה משלו עם קישור אחד לכל התאריכים.</div>
            {staffList.length === 0 && <div className="rounded-lg border border-gray-800 py-6 text-center text-gray-400">אין אנשי צוות בתפקיד הזה ברשימת הצוות</div>}
            <div className="space-y-1.5">
              {staffList.map((s) => {
                const plan = plans[s.id] || { send: [], busy: [], asked: [] };
                const st = status[s.id];
                const disabled = !s.phoneNumber || plan.send.length === 0 || st === "sent";
                const summary = !s.phoneNumber
                  ? { cls: "text-gray-500", text: "אין טלפון" }
                  : plan.send.length === 0
                  ? { cls: "text-red-300", text: "משובץ באירוע אחר בכל התאריכים" }
                  : plan.busy.length
                  ? { cls: "text-amber-300", text: `משובץ ב-${plan.busy.map((b) => `${shortDate(b.event)} (${b.where})`).join(", ")} — יקבל רק ${plan.send.map(shortDate).join(", ")}` }
                  : { cls: "text-green-300", text: plan.send.length === 1 ? "פנוי בתאריך הזה" : `לא משובץ באף אחד מ-${plan.send.length} התאריכים` };
                return (
                  <div key={s.id} className={`rounded-lg border px-3 py-2 ${people[s.id] && !disabled ? "border-yellow-400/70" : "border-gray-800"}`}>
                    <label className={`flex items-start gap-2 ${disabled && st !== "sent" ? "opacity-60" : "cursor-pointer"}`}>
                      <input type="checkbox" disabled={disabled || sending} checked={!!people[s.id] && !disabled} onChange={() => setPeople((p) => ({ ...p, [s.id]: !p[s.id] }))} className="mt-1 accent-yellow-400" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{s.name}</span>
                          {st === "sent" ? <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> נשלח</span> : st === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" /> : null}
                        </span>
                        <span className={`block text-xs ${summary.cls}`}>{summary.text}</span>
                        {plan.asked.length > 0 && (
                          <span className="block text-xs text-gray-400">כבר נשאל על {plan.asked.map((a) => `${shortDate(a.event)} — ${STATUS_TEXT[a.status] || a.status}`).join(", ")}</span>
                        )}
                        {st && st !== "sent" && st !== "sending" && <span className="block text-xs text-red-300">{st}</span>}
                      </span>
                    </label>
                    {people[s.id] && !disabled && (
                      <div className="mt-1.5 ps-6">
                        <button type="button" onClick={() => setOpenText(openText === s.id ? null : s.id)} className="flex items-center gap-1 text-xs text-sky-300 hover:underline">
                          <ChevronDown className={`h-3 w-3 transition ${openText === s.id ? "rotate-180" : ""}`} /> ההודעה ל{s.name.split(" ")[0]}
                        </button>
                        {openText === s.id && (
                          <div className="mt-1 space-y-1">
                            <textarea
                              value={textFor(s)}
                              onChange={(ev) => setTexts((t) => ({ ...t, [s.id]: ev.target.value }))}
                              rows={Math.min(14, 6 + plan.send.length)}
                              className="w-full rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-white"
                            />
                            <div className="text-xs text-gray-500">{LINK_MARK} יוחלף בקישור האישי שלו.</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <Button onClick={sendAll} disabled={!chosenPeople.length || sending} className="w-full gap-2 bg-green-600 font-semibold text-white hover:bg-green-700">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {chosenPeople.length === 0 ? "בחר את מי לשאול" : chosenPeople.length === 1 ? `שלח ל${chosenPeople[0].name}` : `שלח ל-${chosenPeople.length} אנשי צוות`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
