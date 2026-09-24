import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import StaffAssignmentRoleList from "./StaffAssignmentRoleList";

// Mobile bottom-sheet wrapper around the shared StaffAssignmentRoleList (5
// fixed role slots -- photographer1/2, videographer/2, editor -- each with a
// gold "בחר" popover picker). The actual assignment UI lives in
// StaffAssignmentRoleList.jsx so StaffScheduling.jsx's desktop views can
// render the exact same structure without duplicating this logic.
export default function MobileStaffAssignmentSheet({ event, isOpen, onClose, staffMembers, events, onRefresh, sendCalendarInviteByName, onFindReplacement }) {
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
