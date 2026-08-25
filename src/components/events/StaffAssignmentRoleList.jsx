import React, { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { base44 } from "@/api/base44Client";
import { getStaffRateForRole } from "@/lib/staffRates";
import { StaffPickerCell } from "./EventsTableWithBulkDelete";

// Shared per-role staff-assignment list -- 5 fixed role slots (photographer1/2,
// videographer/2, editor), each with a gold "בחר" popover picker. Originally
// built inline for MobileStaffAssignmentSheet.jsx's bottom sheet; extracted
// here so StaffScheduling.jsx's desktop list/calendar views can render the
// exact same structure (no Sheet wrapper needed) instead of duplicating the
// logic, per the studio's explicit request to match the mobile layout on
// desktop too -- desktop previously had its own, different "אנשי צוות זמינים"
// grid + role-toggle-buttons design here.
export default function StaffAssignmentRoleList({ event, staffMembers, events, onRefresh, sendCalendarInviteByName }) {
  const [editingKey, setEditingKey] = useState(null);
  const [editingEditor, setEditingEditor] = useState(false);

  if (!event) return null;

  const photographers = staffMembers.filter(s => s.role === 'photographer');
  const videographers = staffMembers.filter(s => s.role === 'videographer');
  const editors = staffMembers.filter(s => s.role === 'editor');

  const handleRemoveTeamMember = async (staffName) => {
    const newTeam = (event.team || []).filter(m => m.staffMemberName !== staffName);
    await base44.entities.Event.update(event.id, { team: newTeam });
    onRefresh?.();
  };

  const videoEditor = event.team?.find(m => {
    const staff = staffMembers.find(s => s.name === m.staffMemberName);
    return staff?.role === 'editor';
  });

  const roles = [
    { role: "photo1", roleKey: "photographer1", label: "צלם 1", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: "📸", staffList: photographers },
    { role: "photo2", roleKey: "photographer2", label: "צלם 2", color: "bg-blue-500/20 text-blue-400 border-blue-500/30", icon: "📸", staffList: photographers },
    { role: "video1", roleKey: "videographer", label: "וידאו 1", color: "bg-pink-500/20 text-pink-400 border-pink-500/30", icon: "🎥", staffList: videographers },
    { role: "video2", roleKey: "videographer2", label: "וידאו 2", color: "bg-pink-500/20 text-pink-400 border-pink-500/30", icon: "🎥", staffList: videographers },
  ];

  return (
    <div className="space-y-3">
      {roles.map((r) => (
        <div key={r.role} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-3">
          <span className="text-sm text-gray-400">{r.label}</span>
          <StaffPickerCell
            event={event}
            role={r.role}
            roleKey={r.roleKey}
            label={r.label}
            color={r.color}
            icon={r.icon}
            staffList={r.staffList}
            events={events}
            onRefresh={onRefresh}
            editingKey={editingKey}
            setEditingKey={setEditingKey}
            sendCalendarInviteByName={sendCalendarInviteByName}
            isWrapped={true}
          />
        </div>
      ))}

      {/* Editor -- same matching logic as the desktop table's editor column,
          since it isn't a StaffPickerCell instance there either (it matches
          by looking up staffMembers' role rather than a team[].role key). */}
      <div className="flex items-center justify-between bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-3">
        <span className="text-sm text-gray-400">עורך</span>
        <Popover open={editingEditor} onOpenChange={setEditingEditor}>
          <PopoverTrigger asChild>
            <button className="text-left hover:bg-gray-800/30 p-1 rounded transition-colors cursor-pointer">
              {videoEditor ? (
                <div className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border bg-purple-500/20 text-purple-400 border-purple-500/30 w-fit hover:opacity-80 transition-opacity">
                  <span>✂️</span>
                  <span className="truncate max-w-[90px]" title={videoEditor.staffMemberName}>{videoEditor.staffMemberName}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemoveTeamMember(videoEditor.staffMemberName); }}
                    className="hover:text-red-400 text-sm leading-none"
                  >×</button>
                </div>
              ) : (
                <span className="text-gray-600 hover:text-gray-400 text-xs transition-colors">+עורך</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 bg-gray-900 border-gray-700 text-white p-3" align="end">
            <div className="text-sm font-semibold text-gray-400 mb-3">בחר עורך וידאו</div>
            {/* onTouchMove stopPropagation: needed when this list is rendered inside
                a Sheet (MobileStaffAssignmentSheet) so the Sheet's touch-scroll lock
                doesn't block dragging inside this Popover's own scrollable list --
                harmless no-op on desktop (mouse wheel scroll isn't affected). */}
            <div
              className="space-y-2 max-h-[65vh] overflow-y-auto pr-1"
              style={{ WebkitOverflowScrolling: 'touch' }}
              onTouchMove={(e) => e.stopPropagation()}
            >
              {editors.length === 0 ? (
                <div className="text-sm text-gray-500 text-center py-4">אין עורכים זמינים</div>
              ) : (
                editors.map((staff) => {
                  const isSelected = videoEditor?.staffMemberName === staff.name;
                  return (
                    <div key={staff.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-800/50">
                      <button
                        type="button"
                        onClick={async () => {
                          if (isSelected) {
                            await handleRemoveTeamMember(staff.name);
                          } else {
                            const currentTeam = event.team || [];
                            const withoutEmptyEditor = currentTeam.filter(m => m.role !== 'editor' || m.staffMemberName);
                            const cost = getStaffRateForRole(staff, 'editor');
                            const newTeam = [...withoutEmptyEditor, { role: 'editor', staffMemberName: staff.name, cost, isPaid: false, progressStatus: 'pending' }];
                            await base44.entities.Event.update(event.id, { team: newTeam });
                            await sendCalendarInviteByName(event.id, staff.name);
                            onRefresh?.();
                          }
                          setEditingEditor(false);
                        }}
                        className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                          isSelected
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                            : 'bg-amber-500 hover:bg-amber-600 text-gray-900'
                        }`}
                      >
                        {isSelected ? '✓ נבחר' : 'בחר'}
                      </button>
                      <div className="flex items-center gap-2 flex-1">
                        <div className="w-8 h-8 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center text-sm font-semibold">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <span className="text-sm">{staff.name}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
