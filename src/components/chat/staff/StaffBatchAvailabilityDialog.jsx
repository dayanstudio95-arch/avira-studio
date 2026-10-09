import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { base44 } from "@/api/base44Client";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { israelToday, eventDay, combinedNotes } from "@/lib/missingTeam";
import { formatDateWithWeekday } from "@/lib/chatModel";
import { slotOption, SLOT_OPTIONS, eventsMissingSlot, batchAvailabilityMessage } from "@/lib/staffAvailabilityBatch";

const LINK_MARK = "{{link}}";

// "בדיקת זמינות" from a crew member's chat (2026-10-09): the upcoming events whose package
// needs his slot and nobody holds it; tick some, read the message, send. One WhatsApp with
// all the ticked events and ONE link (staff_availability_batches, migration 0082) where he
// marks each event פנוי / לא פנוי. Nothing is sent before "שלח".
export default function StaffBatchAvailabilityDialog({ staff, onClose }) {
  const mine = (staff.teamSlots || []).filter((s) => SLOT_OPTIONS.some((o) => o.value === s));
  const choices = mine.length ? SLOT_OPTIONS.filter((o) => mine.includes(o.value)) : SLOT_OPTIONS.filter((o) => o.jobRole === staff.role);
  const [slot, setSlot] = useState(choices[0]?.value || "photographer1");
  const [picked, setPicked] = useState({});
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [editedFor, setEditedFor] = useState(""); // which events the hand-edited text was written for
  const [sending, setSending] = useState(false);

  const eventsQ = useQuery({ queryKey: ["staffBatchEvents"], queryFn: () => base44.entities.Event.filter({ date: { $gte: israelToday() } }, "date", 1000), staleTime: 30000 });
  const pkgQ = useQuery({ queryKey: ["dashPackages"], queryFn: () => base44.entities.Package.list(), staleTime: 600000 });
  const notesQ = useQuery({ queryKey: ["staffBatchLeadNotes"], queryFn: () => base44.entities.Lead.filter({}, undefined, undefined, "id, notes"), staleTime: 120000 });
  const pkgById = useMemo(() => Object.fromEntries((pkgQ.data || []).map((p) => [p.id, p])), [pkgQ.data]);
  const leadNotes = useMemo(() => new Map((notesQ.data || []).map((l) => [l.id, l.notes])), [notesQ.data]);
  const rows = useMemo(
    () => eventsMissingSlot({ events: eventsQ.data || [], slot, today: israelToday(), packagesById: pkgById, staffName: staff.name }),
    [eventsQ.data, slot, pkgById, staff.name]
  );
  const chosen = rows.filter((r) => picked[r.event.id] && !r.busyThatDay).map((r) => r.event);

  useEffect(() => {
    setPicked({});
  }, [slot]);
  useEffect(() => {
    if (!edited) setText(batchAvailabilityMessage({ name: staff.name, slot, events: chosen, link: LINK_MARK }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, chosen.map((e) => e.id).join(), edited]);

  const send = async () => {
    if (!staff.phoneNumber) return toast.error("אין מספר טלפון לאיש הצוות");
    if (!chosen.length) return;
    setSending(true);
    let batch = null;
    const created = [];
    try {
      const raw = generateRawToken();
      batch = await base44.entities.StaffAvailabilityBatch.create({ staffMemberId: staff.id, teamRole: slot, tokenHash: await hashToken(raw) });
      for (const e of chosen) {
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
      toast.success(`נשלחה בדיקת זמינות ל${staff.name} · ${chosen.length} אירועים`);
      onClose();
    } catch (e) {
      // nobody got the link → nothing stays half-open
      const now = new Date().toISOString();
      if (batch) await base44.entities.StaffAvailabilityBatch.update(batch.id, { revokedAt: now }).catch(() => {});
      for (const r of created) await base44.entities.StaffAvailabilityRequest.update(r.id, { revokedAt: now }).catch(() => {});
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setSending(false);
  };

  const loading = eventsQ.isLoading || pkgQ.isLoading;
  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-2xl overflow-y-auto border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-right">בדיקת זמינות — {staff.name}</DialogTitle>
        </DialogHeader>
        {choices.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {choices.map((o) => (
              <button key={o.value} type="button" onClick={() => setSlot(o.value)} className={`rounded-full border px-3 py-1 text-xs ${slot === o.value ? "border-sky-400 bg-sky-500/20 text-sky-200" : "border-gray-700 text-gray-300"}`}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="text-xs text-gray-400">
          אירועים קרובים שחסר בהם <b className="text-gray-200">{SLOT_OPTIONS.find((o) => o.value === slot)?.label}</b> לפי החבילה. סמן את מה לשלוח.
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-gray-800 py-6 text-center text-sm text-gray-400">אין אירועים קרובים שחסר בהם התפקיד הזה ✅</div>
        ) : (
          <div className="space-y-1.5">
            {rows.map(({ event: e, busyThatDay }) => {
              const notes = combinedNotes(e.notes, leadNotes.get(e.sourceLeadId));
              return (
                <label key={e.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${busyThatDay ? "border-dashed border-gray-800 text-gray-500" : "border-gray-800 hover:bg-white/[0.03]"}`}>
                  <input type="checkbox" disabled={busyThatDay} checked={!!picked[e.id] && !busyThatDay} onChange={() => setPicked((p) => ({ ...p, [e.id]: !p[e.id] }))} className="mt-1" />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">{formatDateWithWeekday(eventDay(e))}</span>
                    {e.venue ? ` · ${e.venue}` : ""}{e.coupleNames ? ` · ${e.coupleNames}` : ""}
                    {busyThatDay && <span className="block text-xs">כבר משובץ/ת באירוע אחר באותו יום</span>}
                    {notes && !busyThatDay && <span className="block whitespace-pre-wrap text-xs text-amber-200/80">📝 {notes}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}
        {chosen.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-gray-400">תצוגה מקדימה (אפשר לערוך) — {LINK_MARK} יוחלף בקישור האישי שלו</div>
            <textarea value={text} onChange={(e) => { setText(e.target.value); if (!edited) setEditedFor(chosen.map((x) => x.id).join()); setEdited(true); }} rows={Math.min(14, 6 + chosen.length)} className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm text-white" />
            {edited && editedFor !== chosen.map((x) => x.id).join() && (
              <div className="rounded-md bg-amber-950/50 px-2 py-1 text-xs text-amber-200">רשימת האירועים השתנתה אחרי שערכת את הנוסח — ההודעה לא כוללת את השינוי. לחץ "חזרה לנוסח האוטומטי" כדי לעדכן.</div>
            )}
            {edited && <button type="button" onClick={() => setEdited(false)} className="text-xs text-sky-300 hover:underline">חזרה לנוסח האוטומטי</button>}
          </div>
        )}
        <div className="flex flex-row-reverse gap-2 pt-1">
          <button type="button" onClick={send} disabled={sending || !chosen.length || !text.trim()} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח בוואטסאפ ({chosen.length} אירועים)
          </button>
          <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300">ביטול</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
