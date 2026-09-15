import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { eventTeamRoleLabel, teamRoleSlotsForJobRole } from "@/lib/staffRoles";
import { assignStaffToEventSlot } from "@/lib/assignStaffToEvent";

// The row of "who said what" pills under an event's team, plus the click-to-assign
// dialog. Extracted from UnifiedSidePanel.jsx on 2026-09-15 so the same pills can be
// shown wherever an event's team is managed, not only when a lead is open.
//
// `requests` is the latest staff_availability_requests row per staff member (the
// caller dedupes). A ✅ pill is clickable when there is an event to assign to.
export default function AvailabilityPills({ requests, staffMembers, event, team, onAssigned }) {
  const [candidate, setCandidate] = useState(null);
  const [roleSlot, setRoleSlot] = useState(null);
  const [isAssigning, setIsAssigning] = useState(false);

  if (!requests || requests.length === 0) return null;

  const currentTeam = team ?? (event?.team || []);
  const candidateStaff = candidate ? staffMembers?.find((s) => s.id === candidate.staffMemberId) : null;
  const candidateName = candidateStaff?.name || candidate?.staffNameSnapshot;
  const jobRole = candidateStaff?.role || candidate?.role;
  const slots = candidate ? teamRoleSlotsForJobRole(jobRole) : [];
  const occupiedBy = candidate ? currentTeam.find((m) => m.role === roleSlot)?.staffMemberName : null;
  const alreadyHere = !!occupiedBy && occupiedBy === candidateName;

  const open = (request) => {
    if (!event) return;
    const staff = staffMembers?.find((s) => s.id === request.staffMemberId);
    const candidateSlots = teamRoleSlotsForJobRole(staff?.role || request.role);
    if (candidateSlots.length === 0) {
      toast.error("לא נמצא תפקיד מתאים בצוות האירוע עבור איש הצוות הזה");
      return;
    }
    const firstEmpty = candidateSlots.find((slot) => !currentTeam.some((m) => m.role === slot));
    setRoleSlot(firstEmpty || candidateSlots[0]);
    setCandidate(request);
  };

  const close = () => {
    setCandidate(null);
    setRoleSlot(null);
  };

  const confirm = async () => {
    if (!event || !candidate || !roleSlot) return;
    if (!candidateStaff) {
      toast.error("איש הצוות לא נמצא ברשימת הצוות הפעילה");
      return;
    }
    setIsAssigning(true);
    try {
      const newTeam = await assignStaffToEventSlot({
        event, staffMember: candidateStaff, roleSlot, currentTeam,
      });
      toast.success(`${candidateStaff.name} שובץ/ה בהצלחה ל${eventTeamRoleLabel(roleSlot)}`);
      onAssigned?.(newTeam);
      close();
    } catch (error) {
      console.error("Error assigning staff to event team:", error);
      toast.error("שגיאה בשיבוץ איש הצוות");
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <>
      <div className="flex gap-2 flex-wrap">
        {requests.map((r) => {
          const isClickable = r.status === "available" && !!event;
          return (
            <Badge
              key={r.id}
              onClick={isClickable ? () => open(r) : undefined}
              className={`text-xs font-medium border ${
                r.status === "available"
                  ? "bg-green-500/20 text-green-400 border-green-500/30"
                  : r.status === "declined"
                  ? "bg-red-500/20 text-red-400 border-red-500/30"
                  : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
              } ${isClickable ? "cursor-pointer hover:bg-green-500/30 transition-colors" : ""}`}
              title={isClickable ? "לחץ לשיבוץ" : undefined}
            >
              {r.staffNameSnapshot} — {r.status === "available" ? "✅ פנוי" : r.status === "declined" ? "❌ לא פנוי" : "⏳ ממתין"}
            </Badge>
          );
        })}
      </div>

      <Dialog open={!!candidate} onOpenChange={(o) => !o && close()}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle>לשבץ את {candidateName} לאירוע?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {slots.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-xs text-gray-400">תפקיד בצוות</label>
                <Select value={roleSlot || undefined} onValueChange={setRoleSlot}>
                  <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {slots.map((slot) => (
                      <SelectItem key={slot} value={slot}>
                        {eventTeamRoleLabel(slot)}
                        {currentTeam.some((m) => m.role === slot)
                          ? ` (תפוס: ${currentTeam.find((m) => m.role === slot).staffMemberName})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {alreadyHere ? (
              <p className="text-sm text-gray-400">כבר משובץ/ת לתפקיד {eventTeamRoleLabel(roleSlot)} באירוע זה.</p>
            ) : occupiedBy ? (
              <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-3 text-sm text-amber-200">
                <span className="font-semibold">{occupiedBy}</span> משובץ/ת כרגע לתפקיד {eventTeamRoleLabel(roleSlot)}.
                האם להחליף בשיבוץ של {candidateName}?
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button variant="outline" onClick={close} disabled={isAssigning} className="border-gray-700 bg-gray-800 text-gray-300">
              ביטול
            </Button>
            <Button
              onClick={confirm}
              disabled={isAssigning || alreadyHere}
              className={occupiedBy && !alreadyHere ? "bg-amber-600 hover:bg-amber-700 text-white" : "bg-green-600 hover:bg-green-700 text-white"}
            >
              {isAssigning ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  משבץ...
                </>
              ) : occupiedBy && !alreadyHere ? (
                "החלף שיבוץ"
              ) : (
                "שבץ"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
