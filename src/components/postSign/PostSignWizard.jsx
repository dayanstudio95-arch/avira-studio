import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Check, SkipForward, Clock, Receipt, Send, Users, CheckCircle2, ChevronLeft } from "lucide-react";
import InvoiceDialog from "@/components/invoice/InvoiceDialog";
import StaffAvailabilityModal from "@/components/leads/StaffAvailabilityModal";
import AvailabilityPills from "@/components/events/AvailabilityPills";
import StaffAssignmentRoleList from "@/components/events/StaffAssignmentRoleList";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import { leadSyncOutcome } from "@/lib/actionOutcome";
import { applyLeadTemplateVariables, loadScheduleTemplates, SCHEDULE_OPTIONS } from "@/lib/leadMessages";
import {
  STEPS, CLOSED_STATUS, SNOOZE_OPTIONS, snoozeUntil, currentStep, advance, finish, formatEventDateHe,
} from "@/lib/postSignFlow";

// "After signing" wizard (2026-10-07). A couple signed (status חוזה) → the owner is walked
// through the routine: status → נסגר/חתימה, deposit invoice, schedule message, staff
// availability check, direct staff assignment. Every step can be skipped; closing keeps the
// step (saved on the lead, so it continues on another device); "דחה" hides it until a chosen
// day. Pure rules in src/lib/postSignFlow.js. Mounted by PostSignWizardHost (pops up by itself)
// and by the side panel's "תהליך אחרי חתימה" button.

export const SESSION_SNOOZE_PREFIX = "postSign:snooze:";

export function markSessionSnoozed(leadId) {
  try { sessionStorage.setItem(SESSION_SNOOZE_PREFIX + leadId, "1"); } catch { /* storage blocked */ }
}

export function isSessionSnoozed(leadId) {
  try { return sessionStorage.getItem(SESSION_SNOOZE_PREFIX + leadId) === "1"; } catch { return false; }
}

const DEPOSIT_ITEM = "מקדמה";

// How many wizards are on screen right now (the side panel's button can open one while the
// host is idle). The host never pops a second one on top.
let openWizards = 0;
export function isAnyWizardOpen() {
  return openWizards > 0;
}

export default function PostSignWizard({ lead: initialLead, isOpen, onClose, onChanged }) {
  const [lead, setLead] = useState(initialLead);
  const [flow, setFlow] = useState(initialLead?.postSignFlow || null);
  const [step, setStep] = useState(currentStep(initialLead?.postSignFlow));
  const [event, setEvent] = useState(null);
  const [eventsOnDate, setEventsOnDate] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);

  const [invoiceType, setInvoiceType] = useState(null); // 'sole_prop' | 'company' | null
  const [templates, setTemplates] = useState(null);
  const [scheduleKey, setScheduleKey] = useState(null);
  const [scheduleText, setScheduleText] = useState("");
  const [showAvailability, setShowAvailability] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");

  const eventDate = event?.date || lead?.eventDate;

  useEffect(() => {
    if (!isOpen) return;
    openWizards += 1;
    return () => { openWizards -= 1; };
  }, [isOpen]);

  // Fresh copy of the lead + its event + staff whenever the wizard opens for a lead.
  useEffect(() => {
    if (!isOpen || !initialLead?.id) return;
    setLead(initialLead);
    setFlow(initialLead.postSignFlow || null);
    setStep(currentStep(initialLead.postSignFlow));
    setScheduleKey(null);
    setScheduleText("");
    reloadLead();
    loadEvent(initialLead);
    base44.entities.StaffMember.list().then(setStaffMembers).catch(() => {});
    loadScheduleTemplates().then(setTemplates).catch(() => setTemplates({}));
  }, [isOpen, initialLead?.id]);

  const reloadLead = async () => {
    try {
      const fresh = await base44.entities.Lead.get(initialLead.id);
      if (fresh) setLead(fresh);
    } catch { /* keep the copy we have */ }
  };

  const loadEvent = async (forLead) => {
    try {
      let ev = null;
      const rows = await base44.entities.Event.filter({ sourceLeadId: forLead.id });
      ev = rows?.[0] || null;
      if (!ev && forLead.linkedEventId) ev = await base44.entities.Event.get(forLead.linkedEventId).catch(() => null);
      setEvent(ev);
      if (ev?.date) {
        const sameDay = await base44.entities.Event.filter({ date: ev.date });
        setEventsOnDate(sameDay || []);
      }
      loadRequests(forLead.id, ev?.id);
    } catch (e) {
      console.error("PostSignWizard: loading event failed", e);
    }
  };

  const loadRequests = async (leadId, eventId) => {
    try {
      const [byLead, byEvent] = await Promise.all([
        leadId ? base44.entities.StaffAvailabilityRequest.filter({ leadId }, "-requestedAt") : [],
        eventId ? base44.entities.StaffAvailabilityRequest.filter({ eventId }, "-requestedAt") : [],
      ]);
      const rows = [...(byLead || []), ...(byEvent || [])].sort(
        (a, b) => new Date(b.requestedAt || 0) - new Date(a.requestedAt || 0)
      );
      const latest = new Map();
      for (const r of rows) if (!latest.has(r.staffMemberId)) latest.set(r.staffMemberId, r);
      setRequests(Array.from(latest.values()));
    } catch { /* pills are informational */ }
  };

  // Saves progress on the lead. A failed save is reported but never blocks the owner —
  // the action itself (invoice, message) already happened.
  const saveFlow = async (nextFlow, extra = {}) => {
    setFlow(nextFlow);
    setStep(currentStep(nextFlow));
    try {
      await base44.entities.Lead.update(lead.id, { postSignFlow: nextFlow, ...extra });
      onChanged?.();
    } catch (e) {
      toast.error("שמירת ההתקדמות בתהליך נכשלה", { description: e?.message });
    }
  };

  const markStep = (key, outcome) => saveFlow(advance(flow, key, outcome));

  const goTo = (key) => {
    const next = { ...(flow || {}), step: key };
    saveFlow(next);
  };

  // ---- step actions -------------------------------------------------------------------

  const handleCloseStatus = async () => {
    setBusy(true);
    try {
      await base44.entities.Lead.update(lead.id, { status: CLOSED_STATUS, lastContactDate: new Date().toISOString() });
      setLead((l) => ({ ...l, status: CLOSED_STATUS }));
      const res = await base44.functions.invoke("syncLeadToEvent", { leadId: lead.id }).catch((e) => ({ data: { error: e.message } }));
      const out = leadSyncOutcome(res?.data);
      if (out.ok) toast.success("הסטטוס עודכן לנסגר/חתימה והאירוע נוצר/עודכן");
      else toast.warning(`הסטטוס עודכן, אבל ${out.text}`);
      await loadEvent({ ...lead, linkedEventId: res?.data?.eventId || lead.linkedEventId });
      await markStep("status", "done");
    } catch (e) {
      toast.error("עדכון הסטטוס נכשל", { description: e?.message });
    }
    setBusy(false);
  };

  const pickSchedule = (key) => {
    setScheduleKey(key);
    const raw = templates?.[key] || "";
    setScheduleText(raw.trim() ? applyLeadTemplateVariables(raw, lead, { eventDate }) : "");
  };

  const handleSendSchedule = async () => {
    const opt = SCHEDULE_OPTIONS.find((o) => o.key === scheduleKey);
    if (!lead.phoneNumber) { toast.error("אין מספר טלפון לליד"); return; }
    if (!scheduleText.trim()) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: lead.phoneNumber, message: scheduleText });
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`${opt.label} נשלח`);
      await markStep("schedule", "done");
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const handleFinish = async () => {
    await saveFlow(finish(flow), { postSignSnoozedUntil: null });
    toast.success("התהליך הושלם");
    onClose();
  };

  // ---- close / snooze -----------------------------------------------------------------

  const handleCloseForNow = () => {
    // Closing = "continue later": the step is already saved; don't pop up again this session.
    markSessionSnoozed(lead.id);
    onClose();
  };

  const handleSnooze = async (option) => {
    if (option === "session") {
      markSessionSnoozed(lead.id);
      toast.success("יופיע שוב בכניסה הבאה למערכת");
      setSnoozeOpen(false);
      onClose();
      return;
    }
    const until = snoozeUntil(option, new Date(), pickedDate || null);
    if (!until) { toast.error("בחר תאריך"); return; }
    try {
      await base44.entities.Lead.update(lead.id, { postSignSnoozedUntil: until.toISOString() });
      markSessionSnoozed(lead.id);
      toast.success(`נדחה עד ${until.toLocaleDateString("he-IL")} 08:00`);
      onChanged?.();
      setSnoozeOpen(false);
      onClose();
    } catch (e) {
      toast.error("הדחייה לא נשמרה", { description: e?.message });
    }
  };

  if (!lead) return null;

  const done = flow?.done || {};
  const depositInvoices = (lead.invoicesList || []).filter((i) => i.description === DEPOSIT_ITEM);
  const paidFromInvoices = (lead.invoicesList || []).reduce((s, i) => s + (i.amount || 0), 0);
  const remainingBalance = (lead.finalPrice || 0) - (paidFromInvoices || lead.totalPaid || 0);

  return (
    <>
      <Dialog open={isOpen && !invoiceType && !showAvailability} onOpenChange={(o) => { if (!o) handleCloseForNow(); }}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-2xl max-h-[92vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white text-right">✍️ תהליך אחרי חתימה</DialogTitle>
          </DialogHeader>

          {/* פרטי הזוג — תמיד מול העיניים */}
          <div className="bg-gray-800/70 border border-gray-700 rounded-xl p-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div className="col-span-2 text-lg font-bold text-yellow-400">{lead.coupleNames}</div>
            <div><span className="text-gray-400">תאריך: </span>{formatEventDateHe(eventDate) || "—"}</div>
            <div><span className="text-gray-400">אולם: </span>{lead.venueName || event?.venue || "—"}</div>
            <div><span className="text-gray-400">חבילה: </span>{lead.packageChoice || "—"}</div>
            <div><span className="text-gray-400">מחיר: </span>{lead.finalPrice ? `₪${Number(lead.finalPrice).toLocaleString()}` : "—"}</div>
            <div><span className="text-gray-400">טלפון: </span><span dir="ltr">{lead.phoneNumber || "—"}</span></div>
            <div><span className="text-gray-400">סטטוס: </span>{lead.status}</div>
            {(lead.notes || lead.coupleNotesSigned) && (
              <div className="col-span-2 text-gray-300 whitespace-pre-wrap border-t border-gray-700 pt-1.5 mt-1">
                <span className="text-gray-400">הערות: </span>
                {[lead.notes, lead.coupleNotesSigned && `הזוג בחתימה: ${lead.coupleNotesSigned}`].filter(Boolean).join("\n")}
              </div>
            )}
          </div>

          {/* פס שלבים */}
          <div className="flex flex-wrap gap-1.5">
            {STEPS.map((s, i) => {
              const state = done[s.key];
              const isNow = s.key === step;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => goTo(s.key)}
                  className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 ${
                    isNow ? "bg-yellow-500 text-black border-yellow-400 font-semibold"
                      : state === "done" ? "bg-emerald-900/40 text-emerald-300 border-emerald-700"
                      : state === "skipped" ? "bg-gray-800 text-gray-500 border-gray-700 line-through"
                      : "bg-gray-800 text-gray-300 border-gray-700"
                  }`}
                >
                  {state === "done" ? <Check className="w-3 h-3" /> : state === "skipped" ? <SkipForward className="w-3 h-3" /> : <span>{i + 1}</span>}
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* תוכן השלב */}
          <div className="min-h-[160px] bg-gray-800/40 border border-gray-700 rounded-xl p-4 space-y-3">
            {step === "status" && (
              <>
                <p className="font-semibold">להעביר את הליד לסטטוס "נסגר/חתימה"?</p>
                <p className="text-xs text-gray-400">זה גם יוצר/מעדכן את האירוע ביומן האירועים (כמו שינוי סטטוס בטבלת הלידים).</p>
                {lead.status === CLOSED_STATUS ? (
                  <div className="flex items-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle2 className="w-4 h-4" /> הליד כבר בסטטוס נסגר/חתימה
                    <Button size="sm" onClick={() => markStep("status", "done")} className="mr-auto bg-yellow-500 hover:bg-yellow-600 text-black">הבא <ChevronLeft className="w-4 h-4" /></Button>
                  </div>
                ) : (
                  <Button onClick={handleCloseStatus} disabled={busy} className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Check className="w-4 h-4 ml-2" />}
                    כן, להעביר לנסגר/חתימה
                  </Button>
                )}
              </>
            )}

            {step === "invoice" && (
              <>
                <p className="font-semibold">להוציא חשבונית מס קבלה על המקדמה — מאיזה עסק?</p>
                {depositInvoices.length > 0 && (
                  <p className="text-xs text-yellow-400">
                    שים לב: כבר הופקה ללקוח הזה חשבונית מקדמה ({depositInvoices.map((i) => `₪${i.amount}${i.date ? ` ב-${i.date}` : ""}`).join(", ")}).
                  </p>
                )}
                <div className="flex gap-2">
                  <Button onClick={() => setInvoiceType("sole_prop")} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Receipt className="w-4 h-4 ml-2" /> עוסק מורשה
                  </Button>
                  <Button onClick={() => setInvoiceType("company")} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white">
                    <Receipt className="w-4 h-4 ml-2" /> חברה בע״מ
                  </Button>
                </div>
              </>
            )}

            {step === "schedule" && (
              <>
                <p className="font-semibold">איזה לוז לשלוח לזוג?</p>
                <div className="flex gap-2">
                  {SCHEDULE_OPTIONS.map((o) => (
                    <Button
                      key={o.key}
                      onClick={() => pickSchedule(o.key)}
                      className={`flex-1 ${scheduleKey === o.key ? "bg-yellow-500 text-black hover:bg-yellow-600" : "bg-gray-700 hover:bg-gray-600 text-white"}`}
                    >
                      {o.label}
                    </Button>
                  ))}
                </div>
                {scheduleKey && (
                  templates?.[scheduleKey]?.trim() ? (
                    <>
                      <p className="text-xs text-gray-400">ההודעה שתישלח ל-<span dir="ltr">{lead.phoneNumber || "—"}</span> (אפשר לערוך לפני שליחה):</p>
                      <Textarea
                        value={scheduleText}
                        onChange={(e) => setScheduleText(e.target.value)}
                        rows={7}
                        className="bg-gray-900 border-gray-700 text-white text-sm"
                      />
                      <Button onClick={handleSendSchedule} disabled={busy || !scheduleText.trim()} className="bg-green-600 hover:bg-green-700 text-white">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Send className="w-4 h-4 ml-2" />}
                        שלח לזוג בוואטסאפ
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-red-400">
                      התבנית "{SCHEDULE_OPTIONS.find((o) => o.key === scheduleKey)?.label}" ריקה — יש למלא אותה בהגדרות ← תבניות הודעה.
                    </p>
                  )
                )}
              </>
            )}

            {step === "availability" && (
              <>
                <p className="font-semibold">לשלוח בדיקת זמינות לצלמים/וידאו?</p>
                <Button onClick={() => setShowAvailability(true)} className="bg-pink-600 hover:bg-pink-700 text-white">
                  <Users className="w-4 h-4 ml-2" /> בחר למי לשלוח
                </Button>
                {requests.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs text-gray-400">תשובות עד עכשיו:</p>
                    <AvailabilityPills requests={requests} staffMembers={staffMembers} event={null} />
                  </div>
                )}
              </>
            )}

            {step === "assign" && (
              <>
                <p className="font-semibold">לשבץ אנשי צוות לאירוע?</p>
                {!event ? (
                  <p className="text-sm text-yellow-400">עדיין אין אירוע לליד הזה — צריך קודם להעביר לנסגר/חתימה (שלב 1).</p>
                ) : (
                  <>
                    {requests.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-gray-400">מי שענה "פנוי" — לחיצה משבצת:</p>
                        <AvailabilityPills
                          requests={requests}
                          staffMembers={staffMembers}
                          event={event}
                          team={event.team || []}
                          onAssigned={() => loadEvent(lead)}
                          lead={lead}
                        />
                      </div>
                    )}
                    <StaffAssignmentRoleList
                      event={event}
                      staffMembers={staffMembers}
                      events={eventsOnDate}
                      onRefresh={() => loadEvent(lead)}
                      sendCalendarInviteByName={sendCalendarInviteByName}
                    />
                    <Button onClick={() => markStep("assign", "done")} className="bg-yellow-500 hover:bg-yellow-600 text-black">
                      סיימתי לשבץ <ChevronLeft className="w-4 h-4" />
                    </Button>
                  </>
                )}
              </>
            )}

            {step === "finish" && (
              <>
                <p className="font-semibold">סיכום</p>
                <ul className="text-sm space-y-1">
                  {STEPS.filter((s) => s.key !== "finish").map((s) => (
                    <li key={s.key} className="flex items-center gap-2">
                      {done[s.key] === "done" ? <Check className="w-4 h-4 text-emerald-400" />
                        : done[s.key] === "skipped" ? <SkipForward className="w-4 h-4 text-gray-500" />
                        : <span className="w-4 h-4 inline-block text-center text-gray-500">–</span>}
                      {s.label}: {done[s.key] === "done" ? "בוצע" : done[s.key] === "skipped" ? "דולג" : "לא טופל"}
                    </li>
                  ))}
                </ul>
                <Button onClick={handleFinish} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <CheckCircle2 className="w-4 h-4 ml-2" /> סיום התהליך
                </Button>
              </>
            )}
          </div>

          {/* תחתית */}
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              {step !== "finish" && (
                <Button variant="outline" onClick={() => markStep(step, "skipped")} disabled={busy} className="border-gray-600 bg-gray-800 text-gray-300">
                  <SkipForward className="w-4 h-4 ml-1" /> דלג לשלב הבא
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="border-gray-600 bg-gray-800 text-gray-300">
                    <Clock className="w-4 h-4 ml-1" /> דחה
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="bg-gray-900 border-gray-700 text-white w-60 p-2 space-y-1" dir="rtl">
                  {SNOOZE_OPTIONS.filter((o) => o.key !== "date").map((o) => (
                    <button key={o.key} type="button" onClick={() => handleSnooze(o.key)} className="w-full text-right text-sm px-2 py-1.5 rounded hover:bg-gray-800">
                      {o.label}
                    </button>
                  ))}
                  <div className="border-t border-gray-700 pt-2 space-y-1.5">
                    <p className="text-xs text-gray-400">עד תאריך שאבחר (יופיע שוב ב-08:00):</p>
                    <Input type="date" value={pickedDate} onChange={(e) => setPickedDate(e.target.value)} className="bg-gray-800 border-gray-700 text-white" dir="ltr" />
                    <Button size="sm" disabled={!pickedDate} onClick={() => handleSnooze("date")} className="w-full bg-yellow-500 hover:bg-yellow-600 text-black">
                      דחה עד התאריך
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
              <Button variant="outline" onClick={handleCloseForNow} className="border-gray-600 bg-gray-800 text-gray-300">
                סגור — אמשיך אחר כך
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <InvoiceDialog
        isOpen={!!invoiceType}
        onClose={() => setInvoiceType(null)}
        businessType={invoiceType || "sole_prop"}
        initialItem={DEPOSIT_ITEM}
        coupleNames={lead.coupleNames}
        eventDate={eventDate}
        venueName={lead.venueName}
        clientEmail={lead.email}
        clientPhone={lead.phoneNumber}
        leadId={lead.id}
        remainingBalance={remainingBalance}
        eventId={event?.id}
        onInvoiceCreated={() => { reloadLead(); markStep("invoice", "done"); }}
      />

      <StaffAvailabilityModal
        open={showAvailability}
        onClose={() => setShowAvailability(false)}
        onSent={() => {
          setShowAvailability(false);
          loadRequests(lead.id, event?.id);
          markStep("availability", "done");
        }}
        staffMembers={staffMembers}
        eventDate={eventDate}
        venue={lead.venueName || event?.venue}
        coupleNames={lead.coupleNames}
        leadId={lead.id}
        eventId={event?.id}
        existingRequests={requests}
        onStaffMembersChanged={() => base44.entities.StaffMember.list().then(setStaffMembers).catch(() => {})}
      />
    </>
  );
}
