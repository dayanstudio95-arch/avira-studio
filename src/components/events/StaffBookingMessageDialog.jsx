import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { eventTeamRoleLabel } from "@/lib/staffRoles";
import { BOOKING_TEMPLATE_KEY, renderBookingMessage, bookingVars } from "@/lib/staffBooking";

// Right after a crew member is booked from an availability pill (2026-10-07, the owner's
// request): the "you're booked" WhatsApp — couple, date, venue, role, getting-ready place and
// times — editable, sent only on "שלח". The text comes from Settings → תבניות הודעה
// (template_staff_booking). The phone is looked up on the server (send-staff-schedule-message).
export default function StaffBookingMessageDialog({ booking, event, lead: leadProp, onClose }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const staff = booking?.staff;

  useEffect(() => {
    if (!booking) return;
    let alive = true;
    (async () => {
      const lead = leadProp || (event?.sourceLeadId ? await base44.entities.Lead.get(event.sourceLeadId).catch(() => null) : null);
      const rows = await base44.entities.AppSetting.filter({ key: BOOKING_TEMPLATE_KEY }).catch(() => []);
      if (!alive) return;
      setText(renderBookingMessage(rows?.[0]?.value, bookingVars({
        staffName: staff?.name, roleLabel: eventTeamRoleLabel(booking.roleSlot), event, lead,
      })));
    })();
    return () => { alive = false; };
  }, [booking, event, leadProp, staff]);

  if (!booking) return null;

  const send = async () => {
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendStaffScheduleMessage", { staffId: staff.id, message: text });
      if (res.data?.error) throw new Error(res.data.error);
      toast.success(`ההודעה נשלחה ל${staff.name}`);
      onClose();
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setSending(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white sm:max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">לשלוח ל{staff?.name} הודעת שיבוץ?</DialogTitle>
        </DialogHeader>
        {!staff?.phoneNumber && <p className="text-xs text-amber-300">אין מספר טלפון לאיש הצוות — ההודעה לא תישלח.</p>}
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="bg-gray-800 border-gray-700 text-white text-sm" />
        <p className="text-xs text-gray-500">אפשר לערוך לפני השליחה. הנוסח הקבוע: הגדרות ← תבניות הודעה ← "הודעת שיבוץ לצוות".</p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={sending} className="border-gray-700 bg-gray-800 text-gray-300">לא עכשיו</Button>
          <Button onClick={send} disabled={sending || !text.trim() || !staff?.phoneNumber} className="bg-green-600 hover:bg-green-700 text-white">
            {sending ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <Send className="ml-2 h-4 w-4" />} שלח בוואטסאפ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
