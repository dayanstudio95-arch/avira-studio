import React from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import StaffAssignmentRoleList from "./StaffAssignmentRoleList";

// Mobile bottom-sheet wrapper around the shared StaffAssignmentRoleList (5
// fixed role slots -- photographer1/2, videographer/2, editor -- each with a
// gold "בחר" popover picker). The actual assignment UI lives in
// StaffAssignmentRoleList.jsx so StaffScheduling.jsx's desktop views can
// render the exact same structure without duplicating this logic.
export default function MobileStaffAssignmentSheet({ event, isOpen, onClose, staffMembers, events, onRefresh, sendCalendarInviteByName }) {
  if (!event) return null;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white w-full sm:max-w-md overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle className="text-white">שיבוץ צוות — {event.coupleNames}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <StaffAssignmentRoleList
            event={event}
            staffMembers={staffMembers}
            events={events}
            onRefresh={onRefresh}
            sendCalendarInviteByName={sendCalendarInviteByName}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
