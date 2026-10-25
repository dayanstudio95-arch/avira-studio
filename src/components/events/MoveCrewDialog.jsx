import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { moveOptions, planCrewMove, moveMessage, friendlySendError, MOVE_TEMPLATE_KEY } from "@/lib/crewMove";

// "באותו יום" → a name → "העבר לאירוע הזה" (2026-10-25, the owner's request). Step 1: which
// slot on this event (a taken one = swap). Step 2: both events are re-read, the move is planned
// on them as they are now and written — this event first, then the other one, so a failure in
// between leaves the person on both (visible) rather than on none — and the calendar invite
// goes out. Step 3: the "you were moved" message to each person moved, sent only by a click.
// The host list is refreshed only when the window closes — the staff page re-mounts the role
// list while it reloads, which took the message step away with it.
export default function MoveCrewDialog({ open, source, fromSlot, target, staffMembers, onClose, onMoved }) {
  const [toSlot, setToSlot] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { moved, swapped }
  const [texts, setTexts] = useState({}); // name → message
  const [sent, setSent] = useState({}); // name → 'sending' | 'sent' | error text
  const [dirty, setDirty] = useState(false); // something was written — refresh the host on close

  const mover = (source?.team || []).find((m) => m?.role === fromSlot);
  const options = open ? moveOptions({ source, fromSlot, target, staffMembers }) : [];

  useEffect(() => {
    if (!open) return;
    setDone(null); setTexts({}); setSent({}); setBusy(false); setDirty(false);
    setToSlot(options.find((o) => o.canMove && !o.occupant)?.slot || options.find((o) => o.canMove)?.slot || null);
  }, [open, source?.id, fromSlot, target?.id]);

  const leadOf = async (event) => {
    if (!event?.sourceLeadId) return null;
    const rows = await base44.entities.Lead.filter({ id: event.sourceLeadId }).catch(() => []);
    return rows?.[0] || null;
  };

  const doMove = async () => {
    if (!toSlot || busy) return;
    setBusy(true);
    try {
      // the events as they are now — the card's copy may be minutes old
      const [s, t] = await Promise.all([
        base44.entities.Event.filter({ id: source.id }).then((r) => r?.[0]),
        base44.entities.Event.filter({ id: target.id }).then((r) => r?.[0]),
      ]);
      if (!s || !t) throw new Error("אחד האירועים לא נמצא");
      const plan = planCrewMove({ source: s, fromSlot, target: t, toSlot, staffMembers });
      setDirty(true);
      await base44.entities.Event.update(t.id, { team: plan.targetTeam });
      try {
        await base44.entities.Event.update(s.id, { team: plan.sourceTeam });
      } catch (e) {
        throw new Error(`${plan.moved.name} נוסף ל${t.coupleNames}, אבל ההסרה מ${s.coupleNames} נכשלה — הסירו אותו שם ידנית (${e?.message || "שגיאה"})`);
      }
      // best-effort and slow — the message step doesn't wait for it
      sendCalendarInviteByName(t.id, plan.moved.name);
      if (plan.swapped) sendCalendarInviteByName(s.id, plan.swapped.name);

      const tpl = await base44.entities.AppSetting.filter({ key: MOVE_TEMPLATE_KEY }).then((rows) => rows?.[0]?.value).catch(() => null);
      const [leadT, leadS] = await Promise.all([leadOf(t), plan.swapped ? leadOf(s) : null]);
      const nextTexts = { [plan.moved.name]: moveMessage(tpl, plan.moved, leadT) };
      if (plan.swapped) nextTexts[plan.swapped.name] = moveMessage(tpl, plan.swapped, leadS);
      setTexts(nextTexts);
      setDone(plan);
      toast.success(plan.swapped ? `${plan.moved.name} ו${plan.swapped.name} הוחלפו` : `${plan.moved.name} הועבר ל${t.coupleNames}`);
    } catch (e) {
      toast.error("ההעברה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const send = async (person) => {
    const staffId = person.staff?.id;
    if (!staffId) return;
    setSent((s) => ({ ...s, [person.name]: "sending" }));
    try {
      const res = await base44.functions.invoke("sendStaffScheduleMessage", { staffId, message: texts[person.name] });
      if (res?.data?.error) throw new Error(res.data.error);
      setSent((s) => ({ ...s, [person.name]: "sent" }));
    } catch (e) {
      console.error("move message send failed:", e);
      setSent((s) => ({ ...s, [person.name]: friendlySendError(e?.message) }));
    }
  };

  const close = () => {
    if (dirty) onMoved?.();
    onClose?.();
  };

  const people = done ? [done.moved, done.swapped].filter(Boolean) : [];
  const day = String(target?.date || "").slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto border-gray-700 bg-gray-900 text-white" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-right">
            <ArrowLeftRight className="h-4 w-4 text-sky-300" />
            {done ? "עדכון לאנשי הצוות" : `להעביר את ${mover?.staffMemberName || ""}`}
          </DialogTitle>
        </DialogHeader>

        {!done ? (
          <div className="space-y-3 text-sm">
            <div className="text-slate-300">
              מ: {source?.coupleNames} · {eventTeamRoleLabel(fromSlot)}
              <br />
              אל: {target?.coupleNames}{day ? ` · ${formatDateWithWeekday(day)}` : ""}
            </div>
            {options.length === 0 ? (
              <p className="text-amber-300">אין תפקיד מתאים לו באירוע הזה.</p>
            ) : (
              <div className="space-y-1.5">
                {options.map((o) => (
                  <label key={o.slot} className={`block rounded-lg border p-2.5 ${!o.canMove ? "cursor-not-allowed border-gray-800 opacity-50" : toSlot === o.slot ? "cursor-pointer border-sky-400 bg-sky-950/40" : "cursor-pointer border-gray-700 hover:bg-gray-800"}`}>
                    <div className="flex items-center gap-2">
                      <input type="radio" name="toSlot" disabled={!o.canMove} checked={toSlot === o.slot} onChange={() => setToSlot(o.slot)} className="accent-sky-500" />
                      <span className="font-semibold">{o.label}</span>
                      <span className={o.occupant ? "text-amber-300" : "text-slate-400"}>— {o.occupant ? `תפוס: ${o.occupant}` : "פנוי"}</span>
                    </div>
                    {o.swap && <div className="mt-1 ps-6 text-xs text-slate-400">החלפה: {o.occupant} יעבור ל{source?.coupleNames} כ{eventTeamRoleLabel(fromSlot)}</div>}
                    {!o.canMove && o.reason && <div className="mt-1 ps-6 text-xs text-slate-500">{o.reason}</div>}
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-slate-400">
              העלות לפי המחיר שלו לתפקיד החדש. {toSlot && !options.find((o) => o.slot === toSlot)?.occupant ? `ב${source?.coupleNames} ${eventTeamRoleLabel(fromSlot)} יתפנה.` : ""} היומן מתעדכן לבד.
            </p>
            <div className="flex gap-2">
              <Button onClick={doMove} disabled={!toSlot || busy} className="flex-1 gap-2 bg-sky-600 text-white hover:bg-sky-700">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
                {options.find((o) => o.slot === toSlot)?.swap ? "החלף ביניהם" : "העבר"}
              </Button>
              <Button variant="outline" onClick={close} disabled={busy} className="border-gray-700 bg-gray-800 text-gray-200">ביטול</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            {people.map((p) => {
              const state = sent[p.name];
              return (
                <div key={p.name} className="space-y-1.5">
                  <div className="font-semibold">ל{p.name} · {p.toEvent.coupleNames} · {eventTeamRoleLabel(p.toSlot)}</div>
                  <textarea
                    value={texts[p.name] || ""}
                    onChange={(e) => setTexts((t) => ({ ...t, [p.name]: e.target.value }))}
                    rows={8}
                    disabled={state === "sent" || state === "sending"}
                    className="w-full rounded-lg border border-gray-700 bg-gray-800 p-2 text-sm text-white"
                  />
                  {!p.staff?.id ? (
                    <p className="text-xs text-amber-300">לא ברשימת הצוות — אין לאן לשלוח מכאן.</p>
                  ) : state === "sent" ? (
                    <p className="text-xs text-green-400">✓ נשלח</p>
                  ) : (
                    <>
                      <Button onClick={() => send(p)} disabled={state === "sending"} className="w-full gap-2 bg-green-600 text-white hover:bg-green-700">
                        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח ל{p.name}
                      </Button>
                      {state && state !== "sending" && <p className="text-xs text-red-300">{state}</p>}
                    </>
                  )}
                </div>
              );
            })}
            <Button variant="outline" onClick={close} className="w-full border-gray-700 bg-gray-800 text-gray-200">
              {people.every((p) => sent[p.name] === "sent") ? "סגור" : "לא עכשיו"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
