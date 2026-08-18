import React, { useState, useEffect, useRef } from 'react';
import { useColumnWidths } from '@/hooks/useColumnWidths';
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Eye, Heart, Users, Album, MapPin, UserCheck, AlertTriangle, MessageCircle, Trash2, DollarSign, Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import UnifiedSidePanel from "../unified/UnifiedSidePanel";
import EventExpensesEditor from "../eventDetails/EventExpensesEditor";
import { calculateNetProfit, getProfitColor } from "@/lib/profitCalculations";
import EventMobileCards from "./EventMobileCards";
import MobileStaffAssignmentSheet from "./MobileStaffAssignmentSheet";

const paymentStatusConfig = {
  "Paid": { color: "bg-green-500/20 text-green-400 border-green-500/30", icon: "✅" },
  "Partially Paid": { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", icon: "🟡" },
  "Unpaid": { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: "🔴" }
};

const statusLabels = {
  "Paid": "שולם",
  "Partially Paid": "חלקי",
  "Unpaid": "לא שולם"
};

// Compact staff picker cell — also reused (via named export) by
// MobileStaffAssignmentSheet.jsx so the mobile "צוות" sheet uses the exact same
// selection/conflict-detection/cost-lookup logic as the desktop table.
export function StaffPickerCell({ event, role, roleKey, label, color, icon, staffList, events, onRefresh, editingKey, setEditingKey, sendCalendarInviteByName, isWrapped }) {
  const member = event.team?.find(m => m.role === roleKey);

  const removeMember = async (e) => {
    e.stopPropagation();
    const newTeam = event.team.filter(m => m.role !== roleKey);
    await base44.entities.Event.update(event.id, { team: newTeam });
    onRefresh?.();
  };

  const content = (
    <Popover open={editingKey === `${event.id}-${role}`} onOpenChange={(open) => setEditingKey(open ? `${event.id}-${role}` : null)}>
      <PopoverTrigger asChild>
        <button className="text-left hover:bg-gray-800/30 p-1 rounded transition-colors cursor-pointer w-full">
          {member?.staffMemberName ? (
            <div className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium border ${color} w-fit hover:opacity-80 transition-opacity max-w-full`}>
              <span>{icon}</span>
              <span className="truncate" title={member.staffMemberName}>{member.staffMemberName}</span>
              <button onClick={removeMember} className="hover:text-red-400 text-sm leading-none flex-shrink-0">×</button>
            </div>
          ) : (
            <span className="text-gray-600 hover:text-gray-400 text-[10px] transition-colors">+{label}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 bg-gray-900 border-gray-700 text-white p-3" align="start" side="bottom">
        <div className="space-y-2">
          <div className="text-sm font-semibold text-gray-400 mb-3">בחר {label}</div>
          {staffList.length === 0 ? (
            <div className="text-sm text-gray-500 text-center py-4">אין {label} זמינים</div>
          ) : (
            staffList.map((staff) => {
              const isSelected = member?.staffMemberName === staff.name;
              const isBooked = events.some(e =>
                e.id !== event.id &&
                e.date === event.date &&
                e.team?.some(m => m.staffMemberName === staff.name && m.role === roleKey)
              );
              return (
                <div key={staff.id} className={`flex items-center gap-3 p-2 rounded ${isBooked && !isSelected ? 'opacity-60 cursor-not-allowed' : 'hover:bg-gray-800/50'}`}>
                  <Checkbox
                    checked={isSelected}
                    disabled={isBooked && !isSelected}
                    onCheckedChange={async () => {
                      const currentTeam = event.team || [];
                      const newTeam = currentTeam.filter(m => m.role !== roleKey);
                      if (!isSelected) {
                        // Get cost from ratesByRole if available, otherwise use defaultRate
                        let cost = staff.defaultRate || 0;
                        if (staff.ratesByRole && staff.ratesByRole.length > 0) {
                          const roleRate = staff.ratesByRole.find(r => r.role === roleKey);
                          if (roleRate) {
                            cost = roleRate.rate;
                          }
                        }
                        newTeam.push({ role: roleKey, staffMemberName: staff.name, cost, isPaid: false, progressStatus: 'pending' });
                        await base44.entities.Event.update(event.id, { team: newTeam });
                        await sendCalendarInviteByName(event.id, staff.name);
                      }
                      if (onRefresh) onRefresh();
                      setEditingKey(null);
                    }}
                    />
                  <div className="flex items-center gap-2 flex-1">
                    <div className={`w-8 h-8 ${color} rounded-full flex items-center justify-center text-sm font-semibold`}>
                      {staff.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm">{staff.name}{isBooked && !isSelected && ' (כבר משובץ)'}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );

  if (isWrapped) return content;
  return <TableCell className="px-1 py-1">{content}</TableCell>;
}

export default function EventsTableWithBulkDelete({ events, isLoading, onRefresh }) {
  const { widths, setWidth } = useColumnWidths();
  const tableRef = useRef(null);
  const [resizingColumn, setResizingColumn] = useState(null);
  const [updatingEventId, setUpdatingEventId] = useState(null);
  const [editingTeamEventId, setEditingTeamEventId] = useState(null);
  const [staffMembers, setStaffMembers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [leads, setLeads] = useState([]);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [selectedEventForDrawer, setSelectedEventForDrawer] = useState(null);
  const [selectedLeadForDrawer, setSelectedLeadForDrawer] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [expensesSheetOpen, setExpensesSheetOpen] = useState(false);
  const [selectedEventForExpenses, setSelectedEventForExpenses] = useState(null);
  const [syncingEventId, setSyncingEventId] = useState(null);
  const [selectedEventForTeamSheet, setSelectedEventForTeamSheet] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [members, pkgs, leadsData] = await Promise.all([
          base44.entities.StaffMember.list(),
          base44.entities.Package.list(),
          base44.entities.Lead.list()
        ]);
        setStaffMembers(members);
        setPackages(pkgs);
        setLeads(leadsData);
      } catch (error) {
        console.error("Failed to fetch data:", error);
      }
    };
    fetchData();
  }, []);

  useEffect(() => {
    if (!resizingColumn) return;
    const handleMouseMove = (e) => {
      const header = document.querySelector(`[data-column="${resizingColumn}"]`);
      if (!header) return;
      const rect = header.getBoundingClientRect();
      const newWidth = e.clientX - rect.left;
      if (newWidth > 30) setWidth(resizingColumn, newWidth);
    };
    const handleMouseUp = () => setResizingColumn(null);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, setWidth]);
  // Shared by both the desktop couple-name click (below, in the table row) and
  // the mobile card's couple-name/"פרטים" buttons (EventMobileCards' onOpenDetail
  // prop) so both surfaces open the exact same UnifiedSidePanel with the same
  // linked-lead resolution, instead of mobile opening a separate, narrower modal.
  const openUnifiedPanelForEvent = (event) => {
    let relatedLead = null;
    if (event.sourceLeadId) relatedLead = leads.find(l => l.id === event.sourceLeadId);
    setSelectedLeadForDrawer(relatedLead || null);
    setSelectedEventForDrawer(event);
    setIsDrawerOpen(true);
  };

  const ColumnHeader = ({ column, label, width }) => (
    <TableHead
      className="text-gray-400 px-1 relative group select-none"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
      data-column={column}
    >
      {label}
      <div
        onMouseDown={() => setResizingColumn(column)}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-yellow-400/50 opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </TableHead>
  );

  const photographers = staffMembers.filter(s => s.role === 'photographer');
  const videographers = staffMembers.filter(s => s.role === 'videographer');
  const editors = staffMembers.filter(s => s.role === 'editor');

  const handleToggleSelectAll = () => {
    if (selectedEvents.length === events.length) {
      setSelectedEvents([]);
    } else {
      setSelectedEvents(events.map(e => e.id));
    }
  };

  const handleToggleSelectEvent = (eventId) => {
    setSelectedEvents(prev =>
      prev.includes(eventId) ? prev.filter(id => id !== eventId) : [...prev, eventId]
    );
  };

  const handleBulkSyncToCalendar = async () => {
    if (selectedEvents.length === 0) return;
    if (!confirm(`לסנכרן ${selectedEvents.length} אירועים ליומן גוגל?`)) return;
    setIsBulkSyncing(true);
    let success = 0, failed = 0;
    for (const eventId of selectedEvents) {
      try {
        await base44.functions.invoke('syncEventToCalendar', { eventId });
        success++;
      } catch {
        failed++;
      }
    }
    setIsBulkSyncing(false);
    setSelectedEvents([]);
    if (failed === 0) {
      toast.success(`סונכרנו ${success} אירועים ליומן בהצלחה`);
    } else {
      toast.warning(`הצלחה: ${success}, נכשלו: ${failed}`);
    }
    if (onRefresh) onRefresh();
  };

  const handleDeleteSelected = async () => {
    if (!confirm(`Delete ${selectedEvents.length} selected events?`)) return;
    setIsDeletingBulk(true);
    try {
      await Promise.all(selectedEvents.map(async (id) => {
        // Clean up Google Calendar BEFORE deleting the row — best-effort, never
        // blocks the actual deletion (event_calendar_syncs cascades off events,
        // so cleanup must happen first or the Google event IDs would be lost).
        try {
          await base44.functions.invoke('deleteEventFromCalendar', { eventId: id });
        } catch (calendarErr) {
          console.error('Failed to clean up Google Calendar for event', id, calendarErr);
        }
        await base44.entities.Event.delete(id);
      }));
      setSelectedEvents([]);
      toast.success(`Deleted ${selectedEvents.length} events`);
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Error deleting events');
    }
    setIsDeletingBulk(false);
  };

  const handleStatusChange = async (eventId, newStatus) => {
    setUpdatingEventId(eventId);
    try {
      await base44.entities.Event.update(eventId, { clientPaymentStatus: newStatus });
      toast.success('Status updated');
      if (onRefresh) onRefresh();
    } catch (error) {
      toast.error('Error updating status');
    }
    setUpdatingEventId(null);
  };

  const handleRemoveTeamMember = async (event, staffName) => {
    const newTeam = event.team.filter(m => m.staffMemberName !== staffName);
    await base44.entities.Event.update(event.id, { team: newTeam });
    if (onRefresh) onRefresh();
  };

  const sendCalendarInviteByName = async (eventId, staffName) => {
    try {
      await base44.functions.invoke('sendStaffInvite', { eventId, staffName });
    } catch (error) {
      console.error('Error sending calendar invite:', error);
    }
  };

  const handleSyncToCalendar = async (event) => {
    setSyncingEventId(event.id);
    try {
      await base44.functions.invoke('syncEventToCalendar', { eventId: event.id });
      toast.success('סונכרן ליומן בהצלחה');
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Error syncing to calendar:', error);
      toast.error('שגיאה בסנכרון ליומן');
    } finally {
      setSyncingEventId(null);
    }
  };

  const getEventProgressStatus = (event) => {
    const teamCount = event.team?.filter(m => m.staffMemberName)?.length || 0;
    if (teamCount === 0) return { label: 'חסר צוות', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    if (event.photographer1Done && event.video1Done && event.editorDone) return { label: 'הושלם', color: 'bg-green-500/20 text-green-400 border-green-500/30' };
    return { label: 'בתהליך', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
  };

  return (
    <>
    {/* Mobile: card list */}
    <div className="md:hidden">
      <EventMobileCards
        events={events}
        isLoading={isLoading}
        onOpenDetail={openUnifiedPanelForEvent}
        onOpenTeamAssign={(event) => setSelectedEventForTeamSheet(event)}
        onOpenExpenses={(event) => { setSelectedEventForExpenses(event); setExpensesSheetOpen(true); }}
      />
    </div>

    {/* Desktop: full table — hidden on mobile */}
    <Card className="hidden md:block bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <div className="flex justify-between items-center">
          <CardTitle className="text-xl font-bold text-white flex items-center gap-2">
            <Heart className="w-5 h-5 text-yellow-400" />
            כל האירועים
            {selectedEvents.length > 0 && (
              <span className="text-sm font-normal text-gray-400">({selectedEvents.length} נבחרו)</span>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {selectedEvents.length > 0 && (
              <Button
                size="sm"
                onClick={handleBulkSyncToCalendar}
                disabled={isBulkSyncing}
                className="bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isBulkSyncing ? 'animate-spin' : ''}`} />
                {isBulkSyncing ? 'מסנכרן...' : `סנכרן ליומן (${selectedEvents.length})`}
              </Button>
            )}
            {selectedEvents.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteSelected}
                disabled={isDeletingBulk}
                className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                {isDeletingBulk ? 'מוחק...' : `מחק ${selectedEvents.length}`}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              רענן
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="w-full overflow-x-auto" ref={tableRef}>
          <Table className="text-xs border-collapse w-full">
            <TableHeader>
              <TableRow className="border-gray-800 hover:bg-gray-800/30 sticky top-0 bg-gray-900">
                <TableHead className="text-gray-400 px-1" style={{ width: `${widths.checkbox}px`, minWidth: `${widths.checkbox}px` }}>
                  <Checkbox
                    checked={events.length > 0 && selectedEvents.length === events.length}
                    onCheckedChange={handleToggleSelectAll}
                    className="border-gray-600"
                  />
                </TableHead>
                <ColumnHeader column="id" label="#" width={widths.id} />
                <ColumnHeader column="date" label="תאריך" width={widths.date} />
                <ColumnHeader column="couple" label="זוג" width={widths.couple} />
                <ColumnHeader column="venue" label="אולם" width={widths.venue} />
                <ColumnHeader column="photo1" label="צלם 1" width={widths.photo1} />
                <ColumnHeader column="photo2" label="צלם 2" width={widths.photo2} />
                <ColumnHeader column="video1" label="וידאו 1" width={widths.video1} />
                <ColumnHeader column="video2" label="וידאו 2" width={widths.video2} />
                <ColumnHeader column="editor" label="עורך" width={widths.editor} />
                <ColumnHeader column="teamStatus" label="צוות" width={widths.teamStatus} />
                <ColumnHeader column="gross" label="ברוטו" width={widths.gross} />
                <ColumnHeader column="net" label="נקי" width={widths.net} />
                <ColumnHeader column="payment" label="תשלום" width={widths.payment} />
                <ColumnHeader column="progress" label="התקד'" width={widths.progress} />
                <ColumnHeader column="album" label="אלבום" width={widths.album} />
                <TableHead className="text-gray-400 px-1 sticky right-0 bg-gray-900" style={{ width: '72px', minWidth: '72px' }}>פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="text-center py-12">
                    <div className="text-gray-500">
                      <Heart className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                      <p className="text-lg font-medium">אין אירועים עדיין</p>
                      <p className="text-sm">צור את האירוע הראשון שלך כדי להתחיל</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event, idx, arr) => {
                  const clientPaymentStatus = event.clientPaymentStatus || "Unpaid";
                  const statusConfig = paymentStatusConfig[clientPaymentStatus];
                  const assignedTeam = event.team?.filter(m => {
                    if (!m.staffMemberName) return false;
                    const sm = staffMembers.find(s => s.name === m.staffMemberName);
                    return sm?.role !== 'editor';
                  }) || [];
                  const requiredCrew = event.requiredCrew || 3;
                  const isFullTeam = assignedTeam.length >= requiredCrew;
                  const missingCount = requiredCrew - assignedTeam.length;
                  const ps = getEventProgressStatus(event);

                  // Check if month changed from previous event
                  const prevEventDate = idx > 0 ? new Date(arr[idx - 1].date) : null;
                  const currentMonth = new Date(event.date);
                  const monthChanged = !prevEventDate || prevEventDate.getMonth() !== currentMonth.getMonth() || prevEventDate.getFullYear() !== currentMonth.getFullYear();

                  return (
                    <React.Fragment key={`event-${event.id}`}>
                      {monthChanged && (
                        <TableRow className="bg-gray-800/20 border-t border-b border-gray-700/40 hover:bg-gray-800/20">
                          <TableCell colSpan={17} className="text-center py-2 px-1">
                            <span className="text-gray-500 text-xs font-medium">
                              {format(currentMonth, "MMMM yyyy")}
                            </span>
                          </TableCell>
                        </TableRow>
                      )}
                      <TableRow id={`event-row-${event.id}`} className="border-gray-800 hover:bg-gray-800/30 transition-colors duration-200">
                        {/* Checkbox */}
                        <TableCell className="px-1 py-1">
                          <Checkbox
                            checked={selectedEvents.includes(event.id)}
                            onCheckedChange={() => handleToggleSelectEvent(event.id)}
                            className="border-gray-600"
                          />
                        </TableCell>

                        {/* Studio ID */}
                        <TableCell className="text-gray-500 font-mono text-[10px] font-semibold text-center px-1 py-1" style={{ width: `${widths.id}px`, minWidth: `${widths.id}px` }}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span>{event.studio_id || '—'}</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(event.id); toast.success('ID הועתק'); }}
                              title={`העתק ID: ${event.id}`}
                              className="text-gray-600 hover:text-yellow-400 transition-colors"
                            >
                              <Copy className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </TableCell>

                        {/* Date */}
                        <TableCell className="text-gray-300 px-1 py-1 whitespace-nowrap" style={{ width: `${widths.date}px`, minWidth: `${widths.date}px` }}>
                          {format(new Date(event.date), "d/M/yy")}
                        </TableCell>

                        {/* Couple */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.couple}px`, minWidth: `${widths.couple}px` }}>
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => openUnifiedPanelForEvent(event)}
                              className="flex items-center gap-1 hover:opacity-80 transition-opacity cursor-pointer text-left"
                            >
                              <div className="font-medium text-white hover:text-yellow-400 truncate" title={event.coupleNames}>{event.coupleNames}</div>
                              {event.phoneNumber && (
                                <a
                                  href={`https://wa.me/${(() => { const c = event.phoneNumber.replace(/[-\s()]/g, ''); return c.startsWith('0') ? '972' + c.substring(1) : c; })()}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-green-500 hover:text-green-400 transition-colors flex-shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <MessageCircle className="w-3 h-3" />
                                </a>
                              )}
                            </button>
                            {event.signedAt && (
                              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border w-fit text-[9px] font-medium px-1 py-0">✅ חתם</Badge>
                            )}
                          </div>
                        </TableCell>

                        {/* Venue */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.venue}px`, minWidth: `${widths.venue}px` }}>
                          {event.venue ? (
                            <div className="flex items-center gap-1 text-gray-300">
                              <MapPin className="w-3 h-3 text-gray-500 flex-shrink-0" />
                              <span className="truncate" title={event.venue}>{event.venue}</span>
                            </div>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </TableCell>

                        {/* Photographer 1 */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.photo1}px`, minWidth: `${widths.photo1}px` }}>
                          <StaffPickerCell
                            event={event} role="photo1" roleKey="photographer1" label="צלם"
                            color="bg-blue-500/20 text-blue-400 border-blue-500/30" icon="📸"
                            staffList={photographers} events={events} onRefresh={onRefresh}
                            editingKey={editingTeamEventId} setEditingKey={setEditingTeamEventId}
                            sendCalendarInviteByName={sendCalendarInviteByName}
                            isWrapped={true}
                          />
                        </TableCell>

                        {/* Photographer 2 */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.photo2}px`, minWidth: `${widths.photo2}px` }}>
                          <StaffPickerCell
                            event={event} role="photo2" roleKey="photographer2" label="צלם"
                            color="bg-blue-500/20 text-blue-400 border-blue-500/30" icon="📸"
                            staffList={photographers} events={events} onRefresh={onRefresh}
                            editingKey={editingTeamEventId} setEditingKey={setEditingTeamEventId}
                            sendCalendarInviteByName={sendCalendarInviteByName}
                            isWrapped={true}
                          />
                        </TableCell>

                        {/* Videographer 1 */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.video1}px`, minWidth: `${widths.video1}px` }}>
                          <StaffPickerCell
                            event={event} role="video1" roleKey="videographer" label="וידאו"
                            color="bg-pink-500/20 text-pink-400 border-pink-500/30" icon="🎥"
                            staffList={videographers} events={events} onRefresh={onRefresh}
                            editingKey={editingTeamEventId} setEditingKey={setEditingTeamEventId}
                            sendCalendarInviteByName={sendCalendarInviteByName}
                            isWrapped={true}
                          />
                        </TableCell>

                        {/* Videographer 2 */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.video2}px`, minWidth: `${widths.video2}px` }}>
                          <StaffPickerCell
                            event={event} role="video2" roleKey="videographer2" label="וידאו"
                            color="bg-pink-500/20 text-pink-400 border-pink-500/30" icon="🎥"
                            staffList={videographers} events={events} onRefresh={onRefresh}
                            editingKey={editingTeamEventId} setEditingKey={setEditingTeamEventId}
                            sendCalendarInviteByName={sendCalendarInviteByName}
                            isWrapped={true}
                          />
                        </TableCell>

                        {/* Editor */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.editor}px`, minWidth: `${widths.editor}px` }}>
                          {(() => {
                            const videoEditor = event.team?.find(m => {
                              const staff = staffMembers.find(s => s.name === m.staffMemberName);
                              return staff?.role === 'editor';
                            });
                            return (
                              <Popover open={editingTeamEventId === `${event.id}-editor`} onOpenChange={(open) => setEditingTeamEventId(open ? `${event.id}-editor` : null)}>
                                <PopoverTrigger asChild>
                                  <button className="text-left hover:bg-gray-800/30 p-1 rounded transition-colors cursor-pointer w-full">
                                    {videoEditor ? (
                                      <div className="flex items-center gap-1 px-1 py-0.5 rounded text-[10px] font-medium border bg-purple-500/20 text-purple-400 border-purple-500/30 w-fit hover:opacity-80 transition-opacity">
                                        <span>✂️</span>
                                        <span className="truncate max-w-[44px]" title={videoEditor.staffMemberName}>{videoEditor.staffMemberName}</span>
                                        <button onClick={(e) => { e.stopPropagation(); handleRemoveTeamMember(event, videoEditor.staffMemberName); }} className="hover:text-red-400 text-sm leading-none">×</button>
                                      </div>
                                    ) : (
                                      <span className="text-gray-600 hover:text-gray-400 text-[10px] transition-colors">+עורך</span>
                                    )}
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 bg-gray-900 border-gray-700 text-white p-3" align="start">
                                  <div className="space-y-2">
                                    <div className="text-sm font-semibold text-gray-400 mb-3">בחר עורך וידאו</div>
                                    {editors.length === 0 ? (
                                      <div className="text-sm text-gray-500 text-center py-4">אין עורכים זמינים</div>
                                    ) : (
                                      editors.map((staff) => {
                                        const isSelected = videoEditor?.staffMemberName === staff.name;
                                        return (
                                          <div key={staff.id} className="flex items-center gap-3 p-2 rounded hover:bg-gray-800/50">
                                            <Checkbox
                                              checked={isSelected}
                                              onCheckedChange={async () => {
                                                if (isSelected) {
                                                  await handleRemoveTeamMember(event, staff.name);
                                                } else {
                                                    const currentTeam = event.team || [];
                                                    const withoutEmptyEditor = currentTeam.filter(m => m.role !== 'editor' || m.staffMemberName);
                                                    // Get cost from ratesByRole if available, otherwise use defaultRate
                                                    let cost = staff.defaultRate || 0;
                                                    if (staff.ratesByRole && staff.ratesByRole.length > 0) {
                                                      const roleRate = staff.ratesByRole.find(r => r.role === 'editor');
                                                      if (roleRate) {
                                                        cost = roleRate.rate;
                                                      }
                                                    }
                                                    const newTeam = [...withoutEmptyEditor, { role: 'editor', staffMemberName: staff.name, cost, isPaid: false, progressStatus: 'pending' }];
                                                    await base44.entities.Event.update(event.id, { team: newTeam });
                                                    await sendCalendarInviteByName(event.id, staff.name);
                                                    if (onRefresh) onRefresh();
                                                  }
                                                setEditingTeamEventId(null);
                                              }}
                                            />
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
                            );
                          })()}
                        </TableCell>

                        {/* Team Status */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.teamStatus}px`, minWidth: `${widths.teamStatus}px` }}>
                          {isFullTeam ? (
                            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border text-[10px] font-medium px-1 py-0 flex items-center gap-0.5 w-fit">
                              <UserCheck className="w-2.5 h-2.5" /> מלא
                            </Badge>
                          ) : (
                            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border text-[10px] font-medium px-1 py-0 flex items-center gap-0.5 w-fit">
                              <AlertTriangle className="w-2.5 h-2.5" /> חסר {missingCount}
                            </Badge>
                          )}
                        </TableCell>

                        {/* Gross */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.gross}px`, minWidth: `${widths.gross}px` }}>
                          <span className="font-semibold text-yellow-400 text-[10px]">₪{event.totalAmountGross?.toLocaleString()}</span>
                        </TableCell>

                        {/* Net Profit */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.net}px`, minWidth: `${widths.net}px` }}>
                          <span className={`font-semibold text-[10px] ${getProfitColor(event, staffMembers)}`}>
                            ₪{Math.round(calculateNetProfit(event, staffMembers)).toLocaleString()}
                          </span>
                        </TableCell>

                        {/* Payment Status */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.payment}px`, minWidth: `${widths.payment}px` }}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <div className="focus:outline-none cursor-pointer">
                                <Badge variant="outline" className={`${statusConfig?.color || paymentStatusConfig.Unpaid.color} border font-medium cursor-pointer hover:opacity-80 transition-opacity text-[10px] px-1 py-0`}>
                                  {updatingEventId === event.id ? '...' : `${statusConfig?.icon} ${statusLabels[clientPaymentStatus]}`}
                                </Badge>
                              </div>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-gray-800 border-gray-700 text-white">
                              <DropdownMenuItem onSelect={() => handleStatusChange(event.id, 'Paid')} className="focus:bg-green-500/20 cursor-pointer"><span className="mr-2">✅</span> {statusLabels['Paid']}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => handleStatusChange(event.id, 'Partially Paid')} className="focus:bg-yellow-500/20 cursor-pointer"><span className="mr-2">🟡</span> {statusLabels['Partially Paid']}</DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => handleStatusChange(event.id, 'Unpaid')} className="focus:bg-red-500/20 cursor-pointer"><span className="mr-2">🔴</span> {statusLabels['Unpaid']}</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>

                        {/* Progress Status */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.progress}px`, minWidth: `${widths.progress}px` }}>
                          <Badge variant="outline" className={`${ps.color} border text-[10px] font-medium px-1 py-0`}>{ps.label}</Badge>
                        </TableCell>

                        {/* Album */}
                        <TableCell className="px-1 py-1" style={{ width: `${widths.album}px`, minWidth: `${widths.album}px` }}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const newStatus = event.albumStatus === 'sent' ? 'pending' : 'sent';
                              await base44.entities.Event.update(event.id, { albumStatus: newStatus });
                              if (event.leadId) {
                                try { await base44.functions.invoke('syncEventToLead', { eventId: event.id }); } catch {}
                              }
                              if (onRefresh) onRefresh();
                            }}
                            className="p-0 h-auto hover:bg-transparent"
                          >
                            <div className="flex items-center gap-1">
                              <Album className={`w-3 h-3 ${event.albumStatus === 'sent' ? 'text-green-400' : 'text-pink-400'}`} />
                              <Badge
                                variant="outline"
                                className={`${event.albumStatus === 'sent' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-pink-500/20 text-pink-400 border-pink-500/30'} border font-medium text-[10px] px-1 py-0 cursor-pointer hover:opacity-80 transition-opacity`}
                              >
                                {event.albumStatus === 'sent' ? 'נשלח' : 'ממתין'}
                              </Badge>
                            </div>
                          </Button>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="px-1 py-1 sticky right-0 bg-gray-800/50" style={{ width: '72px', minWidth: '72px' }}>
                          <div className="flex gap-0.5">
                            <Button variant="ghost" size="sm"
                              onClick={() => openUnifiedPanelForEvent(event)}
                              className="text-gray-400 hover:text-yellow-400 hover:bg-yellow-500/10 h-7 w-7 p-0"
                              title="פרטי אירוע">
                              <Eye className="w-3 h-3" />
                            </Button>
                              <Button variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedEventForExpenses(event); setExpensesSheetOpen(true); }}
                              className="text-gray-400 hover:text-green-400 hover:bg-green-500/10 h-7 w-7 p-0"
                              title="עריכת הוצאות"
                            >
                              <DollarSign className="w-3 h-3" />
                            </Button>
                            <Link to={createPageUrl(`TeamPayments?id=${event.id}`)}>
                              <Button variant="ghost" size="sm" className="text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 h-7 w-7 p-0">
                                <Users className="w-3 h-3" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSyncToCalendar(event)}
                              disabled={syncingEventId === event.id}
                              className="text-gray-400 hover:text-purple-400 hover:bg-purple-500/10 h-7 w-7 p-0"
                              title="סנכרון ליומן גוגל"
                            >
                              <RefreshCw className={`w-3 h-3 ${syncingEventId === event.id ? 'animate-spin' : ''}`} />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
    {/* END desktop table */}

    <UnifiedSidePanel
      isOpen={isDrawerOpen}
      onClose={() => { setIsDrawerOpen(false); setSelectedEventForDrawer(null); setSelectedLeadForDrawer(null); }}
      event={selectedEventForDrawer}
      lead={selectedLeadForDrawer}
      staffMembers={staffMembers}
      onEventUpdated={() => { setIsDrawerOpen(false); if (onRefresh) onRefresh(); }}
      onLeadUpdated={() => { setIsDrawerOpen(false); if (onRefresh) onRefresh(); }}
    />

    <Sheet open={expensesSheetOpen} onOpenChange={setExpensesSheetOpen}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white w-full sm:max-w-2xl overflow-y-auto" dir="rtl">
        <SheetHeader>
          <SheetTitle className="text-white">עריכת הוצאות</SheetTitle>
        </SheetHeader>
        {selectedEventForExpenses && (
          <EventExpensesEditor
            eventId={selectedEventForExpenses.id}
            onSave={() => { setExpensesSheetOpen(false); if (onRefresh) onRefresh(); }}
          />
        )}
      </SheetContent>
    </Sheet>

    <MobileStaffAssignmentSheet
      event={selectedEventForTeamSheet}
      isOpen={!!selectedEventForTeamSheet}
      onClose={() => setSelectedEventForTeamSheet(null)}
      staffMembers={staffMembers}
      events={events}
      onRefresh={onRefresh}
      sendCalendarInviteByName={sendCalendarInviteByName}
    />
    </>
  );
}