import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import StaffAssignmentRoleList from "./StaffAssignmentRoleList";
import AvailabilityPills from "./AvailabilityPills";

// Mobile bottom-sheet wrapper around the shared StaffAssignmentRoleList (5
// fixed role slots -- photographer1/2, videographer/2, editor -- each with a
// gold "בחר" popover picker). The actual assignment UI lives in
// StaffAssignmentRoleList.jsx so StaffScheduling.jsx's desktop views can
// render the exact same structure without duplicating this logic.
export default function MobileStaffAssignmentSheet({
  event, isOpen, onClose, staffMembers, events, onRefresh, sendCalendarInviteByName,
  onFindReplacement, onCheckAvailability, availabilityVersion = 0,
}) {
  // Who has been asked whether they're free for this event, and what they answered —
  // latest row per staff member, loaded by event (requests made from the lead side carry
  // the event id too once the event exists). A ✅ pill assigns straight into a slot.
  const [requests, setRequests] = useState([]);
  useEffect(() => {
    if (!isOpen || !event?.id) return;
    let mounted = true;
    base44.entities.StaffAvailabilityRequest.filter({ eventId: event.id }, "-requestedAt")
      .then((rows) => {
        if (!mounted) return;
        const latest = new Map();
        for (const r of rows || []) if (!latest.has(r.staffMemberId)) latest.set(r.staffMemberId, r);
        setRequests([...latest.values()]);
      })
      .catch(() => { if (mounted) setRequests([]); });
    return () => { mounted = false; };
  }, [isOpen, event?.id, availabilityVersion]);

  if (!event) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white w-full sm:max-w-md overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle className="text-white">שיבוץ צוות — {event.coupleNames}</SheetTitle>
          {event.venue && <p className="text-sm text-gray-400">📍 {event.venue}</p>}
          {/* Same as the desktop card: the venue and the owner's notes decide who gets
              booked, so they belong next to the pickers (2026-09-24). */}
          {event.notes?.trim() && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 whitespace-pre-wrap break-words">
              📝 {event.notes.trim()}
            </div>
          )}
        </SheetHeader>
        {/* Same "זמינות צלם" as the lead panel (owner's request, 2026-09-24): ask the crew
            who is free for this date without leaving the sheet, and see the answers here. */}
        {onCheckAvailability && (
          <div className="mt-4 space-y-2">
            <Button
              onClick={() => onCheckAvailability(event)}
              className="w-full flex items-center justify-center gap-2 bg-pink-600 hover:bg-pink-700 text-white font-semibold py-3 rounded-xl text-sm"
            >
              <Send className="w-4 h-4" />
              זמינות צלם
            </Button>
            <AvailabilityPills
              requests={requests}
              staffMembers={staffMembers}
              event={events?.find((e) => e.id === event.id) || event}
              onAssigned={() => onRefresh?.()}
            />
          </div>
        )}
        <div className="mt-4">
          <StaffAssignmentRoleList
            event={event}
            staffMembers={staffMembers}
            events={events}
            onRefresh={onRefresh}
            sendCalendarInviteByName={sendCalendarInviteByName}
            onFindReplacement={onFindReplacement}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
