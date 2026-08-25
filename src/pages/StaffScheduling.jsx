import React, { useState, useEffect } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, List, Users, AlertTriangle, UserCheck, ChevronLeft, ChevronRight, X, GripVertical, Pencil, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths } from "date-fns";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import { getStaffRateForRole } from "@/lib/staffRates";
import MobileStaffAssignmentSheet from "@/components/events/MobileStaffAssignmentSheet";

export default function StaffScheduling() {
  const isMobile = useIsMobile();
  const [events, setEvents] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState("list");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Mobile-only: reuses the same bottom-sheet staff-assignment UI already built
  // for the Events page's mobile "צוות" quick action (MobileStaffAssignmentSheet)
  // instead of the desktop-oriented Dialog+renderStaffList, so mobile users get
  // one consistent per-role picker experience across both pages.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [sortMode, setSortMode] = useState('date');
  const [filterMissing, setFilterMissing] = useState(true);
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [orderedStaff, setOrderedStaff] = useState([]);

  const ROLE_LABELS = {
    photographer1: 'צלם 1',
    photographer2: 'צלם 2',
    videographer: 'וידאו 1',
    videographer2: 'וידאו 2',
    editor: 'עורך'
  };

  const getRolesForStaff = (staffRole) => {
    if (staffRole === 'photographer') return ['photographer1', 'photographer2'];
    if (staffRole === 'videographer') return ['videographer', 'videographer2'];
    return [];
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [eventsData, staffData] = await Promise.all([
        base44.entities.Event.list("-date"),
        base44.entities.StaffMember.list()
      ]);
      setEvents(eventsData);
      const sorted = [...staffData].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
      setStaffMembers(sorted);
      setOrderedStaff(sorted.filter(s => s.role !== 'editor'));
      if (eventsData.length > 0 && !selectedEvent) {
        setSelectedEvent(eventsData[0]);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    }
    setIsLoading(false);
  };

  const upcomingEvents = events
    .filter(e => {
      if (new Date(e.date) < new Date()) return false;
      if (filterMissing) {
        const assignedTeam = (e.team || []).filter(m => m.staffMemberName);
        const requiredCrew = e.requiredCrew || 3;
        return assignedTeam.length < requiredCrew;
      }
      return true;
    })
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const getTeamStatus = (event) => {
    const assignedTeam = event.team?.filter(m => m.staffMemberName) || [];
    const assignedNonEditorTeam = assignedTeam.filter(member => {
      const staffMember = staffMembers.find(s => s.name === member.staffMemberName);
      return staffMember?.role !== 'editor';
    });
    const requiredCrew = event.requiredCrew || 3;
    const isFullTeam = assignedNonEditorTeam.length >= requiredCrew;
    const missingCount = requiredCrew - assignedNonEditorTeam.length;
    return { isFullTeam, missingCount, assignedCount: assignedNonEditorTeam.length };
  };

  const handleToggleEditorMember = async (event, staffMemberName) => {
    try {
      const currentTeam = event.team || [];
      const memberExists = currentTeam.some(m => m.staffMemberName === staffMemberName && m.role === 'editor');
      let newTeam;
      if (memberExists) {
        newTeam = currentTeam.filter(m => !(m.staffMemberName === staffMemberName && m.role === 'editor'));
      } else {
        const withoutEmptyEditor = currentTeam.filter(m => m.role !== 'editor' || m.staffMemberName);
        newTeam = [...withoutEmptyEditor, {
          role: 'editor',
          staffMemberName,
          cost: getStaffRateForRole(staffMembers.find(s => s.name === staffMemberName), 'editor'),
          isPaid: false,
          progressStatus: 'pending'
        }];
      }
      await base44.entities.Event.update(event.id, { team: newTeam });
      await loadData();
      if (selectedEvent?.id === event.id) setSelectedEvent({ ...event, team: newTeam });
    } catch (error) {
      console.error('Failed to update editor:', error);
    }
  };

  const handleAssignRole = async (event, staffMemberName, role) => {
    try {
      const currentTeam = event.team || [];
      const memberWithThisNameAndRole = currentTeam.find(m => m.staffMemberName === staffMemberName && m.role === role);

      let newTeam;
      if (memberWithThisNameAndRole) {
        // Already in this role → remove
        newTeam = currentTeam.filter(m => !(m.staffMemberName === staffMemberName && m.role === role));
      } else {
        const conflictingEvent = events.find(e =>
          e.id !== event.id &&
          e.date === event.date &&
          e.team?.some(m => m.staffMemberName === staffMemberName)
        );
        if (conflictingEvent) {
          toast.error(`${staffMemberName} כבר תפוס באירוע אחר באותו יום`);
          return;
        }
        // Remove this person from any other role, and remove whoever was in target role
        const filtered = currentTeam.filter(m => m.staffMemberName !== staffMemberName && m.role !== role);
        newTeam = [...filtered, {
          role,
          staffMemberName,
          cost: getStaffRateForRole(staffMembers.find(s => s.name === staffMemberName), role),
          isPaid: false,
          progressStatus: 'pending'
        }];
      }

      await base44.entities.Event.update(event.id, { team: newTeam });
      await loadData();
      if (selectedEvent?.id === event.id) setSelectedEvent({ ...event, team: newTeam });
    } catch (error) {
      console.error('Failed to assign role:', error);
    }
  };

  const handleRemoveTeamMember = async (event, staffMemberName) => {
    try {
      const newTeam = (event.team || []).filter(m => m.staffMemberName !== staffMemberName);
      await base44.entities.Event.update(event.id, { team: newTeam });
      await loadData();
      if (selectedEvent?.id === event.id) {
        setSelectedEvent({ ...event, team: newTeam });
      }
    } catch (error) {
      console.error("Failed to remove team member:", error);
    }
  };

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(orderedStaff);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setOrderedStaff(items);
  };

  const handleSaveOrder = async () => {
    await Promise.all(
      orderedStaff.map((staff, idx) =>
        base44.entities.StaffMember.update(staff.id, { orderIndex: idx })
      )
    );
    setIsEditingOrder(false);
    await loadData();
  };

  const renderStaffList = (event, compact = false, showEditControls = false) => (
    <>
      {showEditControls && (
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white font-semibold">אנשי צוות זמינים</h3>
          {isEditingOrder ? (
            <div className="flex gap-2">
              <button
                onClick={handleSaveOrder}
                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white rounded font-medium"
              >
                <Check className="w-3 h-3" /> שמור סדר
              </button>
              <button
                onClick={() => { setIsEditingOrder(false); setOrderedStaff(staffMembers.filter(s => s.role !== 'editor')); }}
                className="text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
              >
                ביטול
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingOrder(true)}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
            >
              <Pencil className="w-3 h-3" /> עריכת סדר
            </button>
          )}
        </div>
      )}

      {isEditingOrder && showEditControls ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="staff-order">
            {(provided) => (
              <div
                {...provided.droppableProps}
                ref={provided.innerRef}
                className="space-y-2 max-h-[450px] overflow-y-auto"
              >
                {orderedStaff.map((staff, index) => (
                  <Draggable key={staff.id} draggableId={staff.id} index={index}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.draggableProps}
                        className={`flex items-center gap-3 p-3 rounded-lg border bg-gray-800/50 border-gray-600 ${
                          snapshot.isDragging ? 'opacity-80 shadow-lg' : ''
                        }`}
                      >
                        <div {...provided.dragHandleProps} className="text-gray-500 cursor-grab active:cursor-grabbing">
                          <GripVertical className="w-5 h-5" />
                        </div>
                        <div className={`w-9 h-9 ${
                          staff.role === 'photographer' ? 'bg-blue-500/20 text-blue-400' : 'bg-pink-500/20 text-pink-400'
                        } rounded-full flex items-center justify-center font-semibold flex-shrink-0`}>
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="text-white font-medium text-sm">{staff.name}</div>
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'} gap-3 ${compact ? 'max-h-64' : 'max-h-[450px]'} overflow-y-auto`}>
          {(showEditControls ? orderedStaff : staffMembers.filter(s => s.role !== 'editor')).map((staff) => {
            const availableRoles = getRolesForStaff(staff.role);
            const assignedRole = event?.team?.find(m => m.staffMemberName === staff.name)?.role;
            const isBooked = event && events.some(e =>
              e.id !== event.id &&
              e.date === event.date &&
              e.team?.some(m => m.staffMemberName === staff.name)
            );
            const avatarColor = staff.role === 'photographer' ? 'bg-blue-500/20 text-blue-400' : 'bg-pink-500/20 text-pink-400';
            return (
              <div
                key={staff.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  assignedRole
                    ? staff.role === 'photographer' ? 'bg-blue-500/20 border-blue-500/50' : 'bg-pink-500/20 border-pink-500/50'
                    : isBooked ? 'bg-gray-800/30 border-gray-700 opacity-50' : 'bg-gray-800/50 border-gray-700'
                }`}
              >
                <div className={`w-9 h-9 ${avatarColor} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}>
                  {staff.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm truncate">{staff.name}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {availableRoles.map(role => (
                      <button
                        key={role}
                        disabled={isBooked && assignedRole !== role}
                        onClick={() => event && handleAssignRole(event, staff.name, role)}
                        className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
                          assignedRole === role
                            ? staff.role === 'photographer' ? 'bg-blue-500 text-white' : 'bg-pink-500 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                      >
                        {ROLE_LABELS[role]}
                      </button>
                    ))}
                  </div>
                </div>
                {isBooked && !assignedRole && (
                  <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border text-xs">תפוס</Badge>
                )}
              </div>
            );
          })}
        </div>
      )}

      {staffMembers.filter(s => s.role === 'editor').length > 0 && (
        <div className="mt-4">
          <h4 className="text-gray-400 text-sm font-semibold mb-2">✂️ עורכים</h4>
          <div className={`grid ${compact ? 'grid-cols-2' : 'grid-cols-1 md:grid-cols-2'} gap-2`}>
            {staffMembers.filter(s => s.role === 'editor').map((staff) => {
              const isAssigned = event?.team?.some(m => m.staffMemberName === staff.name && m.role === 'editor');
              return (
                <div
                  key={staff.id}
                  onClick={() => event && handleToggleEditorMember(event, staff.name)}
                  className={`flex items-center gap-3 p-3 rounded-lg transition-colors border cursor-pointer ${
                    isAssigned
                      ? 'bg-purple-500/20 border-purple-500/50'
                      : 'bg-gray-800/50 hover:bg-gray-800 border-gray-700'
                  }`}
                >
                  <Checkbox checked={isAssigned} onCheckedChange={() => event && handleToggleEditorMember(event, staff.name)} onClick={e => e.stopPropagation()} />
                  <div className="w-9 h-9 bg-purple-500/20 text-purple-400 rounded-full flex items-center justify-center font-semibold">
                    {staff.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-white font-medium text-sm">{staff.name}</div>
                    <div className="text-gray-400 text-xs">עורך</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  const renderAssignedTeam = (event) => {
    const nonEditorTeam = event?.team?.filter(m => {
      if (!m.staffMemberName) return false;
      const staff = staffMembers.find(s => s.name === m.staffMemberName);
      return staff?.role !== 'editor';
    }) || [];

    if (nonEditorTeam.length === 0) {
      return <p className="text-gray-500">אין צוות משובץ</p>;
    }

    return (
      <div className="flex flex-wrap gap-2">
        {nonEditorTeam.map((member, idx) => {
          const staff = staffMembers.find(s => s.name === member.staffMemberName);
          const colorClass = staff?.role === 'photographer'
            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            : 'bg-pink-500/20 text-pink-400 border-pink-500/30';
          const avatarColor = staff?.role === 'photographer' ? 'bg-blue-500/30' : 'bg-pink-500/30';
          return (
            <Badge
              key={idx}
              className={`${colorClass} border text-sm flex items-center gap-2 py-2 px-3`}
            >
              <div className={`w-6 h-6 ${avatarColor} rounded-full flex items-center justify-center text-xs font-semibold`}>
                {member.staffMemberName.charAt(0).toUpperCase()}
              </div>
              <span>{member.staffMemberName}</span>
              {member.role && ROLE_LABELS[member.role] && (
                <span className="text-xs opacity-60">({ROLE_LABELS[member.role]})</span>
              )}
              <button
                onClick={() => handleRemoveTeamMember(event, member.staffMemberName)}
                className="hover:text-red-400 ml-1"
              >
                <X className="w-4 h-4" />
              </button>
            </Badge>
          );
        })}
      </div>
    );
  };

  const renderListView = () => (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: Events List */}
      <div className="lg:col-span-1">
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-white">אירועים קרובים</CardTitle>
              <div className="flex gap-1">
              <button
                onClick={() => setFilterMissing(false)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  !filterMissing ? 'bg-yellow-400 text-gray-900 font-bold' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                📅 כל האירועים
              </button>
              <button
                onClick={() => setFilterMissing(true)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  filterMissing ? 'bg-red-500 text-white font-bold' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                ⚠️ חסר צוות
              </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto">
            {upcomingEvents.length === 0 ? (
              <p className="text-gray-500 text-center py-8">אין אירועים קרובים</p>
            ) : (
              upcomingEvents.map((event) => {
                const teamStatus = getTeamStatus(event);
                const isSelected = selectedEvent?.id === event.id;
                return (
                  <button
                    key={event.id}
                    onClick={() => {
                      setSelectedEvent(event);
                      // CHANGED (2026-08-26): on mobile the "Right: Detail View" column below
                      // just stacks under the list (grid-cols-1 below the lg breakpoint), so
                      // tapping a card silently updated state with no visible feedback unless
                      // the user scrolled down. Opens the same per-role bottom-sheet picker
                      // already used by the Events page's mobile "צוות" action -- desktop keeps
                      // the existing inline split view untouched.
                      if (isMobile) setMobileSheetOpen(true);
                    }}
                    className={`w-full text-left p-4 rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-yellow-500/20 border border-yellow-500/50'
                        : 'bg-gray-800/50 hover:bg-gray-800 border border-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium text-white">{event.coupleNames}</div>
                        <div className="text-sm text-gray-400">
                          {format(new Date(event.date), "d/M/yyyy")}
                        </div>
                      </div>
                      {!teamStatus.isFullTeam ? (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          חסרים {teamStatus.missingCount}
                        </Badge>
                      ) : (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border text-xs">
                          <UserCheck className="w-3 h-3 mr-1" />
                          מלא
                        </Badge>
                      )}
                    </div>
                    {event.team?.filter(m => {
                      if (!m.staffMemberName) return false;
                      const staff = staffMembers.find(s => s.name === m.staffMemberName);
                      return staff?.role !== 'editor';
                    }).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {event.team.filter(m => {
                          if (!m.staffMemberName) return false;
                          const staff = staffMembers.find(s => s.name === m.staffMemberName);
                          return staff?.role !== 'editor';
                        }).map((member, idx) => {
                          const staff = staffMembers.find(s => s.name === member.staffMemberName);
                          const colorClass = staff?.role === 'photographer'
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                            : 'bg-pink-500/20 text-pink-400 border-pink-500/30';
                          return (
                            <Badge key={idx} className={`${colorClass} border text-xs`}>
                              {member.staffMemberName}
                            </Badge>
                          );
                        })}
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: Detail View */}
      <div className="lg:col-span-2">
        {selectedEvent ? (
          <Card className="bg-gray-900/50 border-gray-800">
            <CardHeader className="border-b border-gray-800">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-white text-2xl">{selectedEvent.coupleNames}</CardTitle>
                  <p className="text-gray-400 mt-1">
                    {format(new Date(selectedEvent.date), "EEEE, d MMMM yyyy")}
                  </p>
                  {selectedEvent.venue && (
                    <p className="text-gray-500 text-sm mt-1">{selectedEvent.venue}</p>
                  )}
                </div>
                <div>
                  {(() => {
                    const teamStatus = getTeamStatus(selectedEvent);
                    return teamStatus.isFullTeam ? (
                      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border">
                        <UserCheck className="w-4 h-4 mr-1" />
                        צוות מלא ({teamStatus.assignedCount}/{selectedEvent.requiredCrew || 3})
                      </Badge>
                    ) : (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border">
                        <AlertTriangle className="w-4 h-4 mr-1" />
                        חסרים {teamStatus.missingCount} ({teamStatus.assignedCount}/{selectedEvent.requiredCrew || 3})
                      </Badge>
                    );
                  })()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="mb-6">
                <h3 className="text-white font-semibold mb-3">צוות משובץ</h3>
                {renderAssignedTeam(selectedEvent)}
              </div>

              <div>
                {renderStaffList(selectedEvent, false, true)}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-gray-900/50 border-gray-800">
            <CardContent className="p-12 text-center">
              <Users className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-gray-400">בחר אירוע כדי לשבץ צוות</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );

  const renderCalendarView = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const startDay = monthStart.getDay();
    const emptyCells = Array(startDay).fill(null);

    return (
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800">
          <div className="flex justify-between items-center">
            <CardTitle className="text-white text-xl">
              {format(currentMonth, "MMMM yyyy")}
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                היום
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700">
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-7 gap-2">
            {['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'].map(day => (
              <div key={day} className="text-center text-gray-400 text-sm font-semibold py-2">{day}</div>
            ))}
            {emptyCells.map((_, idx) => (
              <div key={`empty-${idx}`} className="aspect-square" />
            ))}
            {daysInMonth.map((day) => {
              const dayEvents = events.filter(e => isSameDay(new Date(e.date), day));
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toString()}
                  className={`aspect-square border rounded-lg p-2 ${
                    !isSameMonth(day, currentMonth)
                      ? 'bg-gray-800/20 border-gray-800'
                      : isToday
                      ? 'bg-yellow-500/10 border-yellow-500/30'
                      : 'bg-gray-800/50 border-gray-700'
                  }`}
                >
                  <div className={`text-sm mb-1 ${isToday ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
                    {format(day, "d")}
                  </div>
                  <div className="space-y-1 overflow-y-auto max-h-24">
                    {dayEvents.map((event) => {
                      const teamStatus = getTeamStatus(event);
                      return (
                        <button
                          key={event.id}
                          onClick={() => {
                            setSelectedEvent(event);
                            // CHANGED (2026-08-26): mobile uses the same bottom-sheet picker as
                            // the list view now, for a consistent staff-assignment UI across both
                            // view modes; desktop keeps opening the existing Dialog.
                            if (isMobile) setMobileSheetOpen(true);
                            else setEditModalOpen(true);
                          }}
                          className={`w-full text-left p-1 rounded text-xs transition-colors ${
                            teamStatus.isFullTeam
                              ? 'bg-green-500/20 hover:bg-green-500/30 text-green-400'
                              : 'bg-red-500/20 hover:bg-red-500/30 text-red-400'
                          }`}
                        >
                          <div className="font-medium truncate">{event.coupleNames}</div>
                          {event.team?.filter(m => m.staffMemberName).length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {event.team.filter(m => m.staffMemberName).slice(0, 3).map((member, idx) => (
                                <span key={idx} className="text-[10px] opacity-80">
                                  {member.staffMemberName.split(' ')[0]}
                                  {idx < Math.min(event.team.filter(m => m.staffMemberName).length - 1, 2) ? ',' : ''}
                                </span>
                              ))}
                              {event.team.filter(m => m.staffMemberName).length > 3 && (
                                <span className="text-[10px] opacity-80">+{event.team.filter(m => m.staffMemberName).length - 3}</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-12 w-64 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">שיבוץ צוות</h1>
            <p className="text-gray-400">נהל ושבץ אנשי צוות לאירועים</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              onClick={() => setViewMode("list")}
              className={viewMode === "list" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"}
            >
              <List className="w-4 h-4 mr-2" />
              רשימה
            </Button>
            <Button
              variant={viewMode === "calendar" ? "default" : "outline"}
              onClick={() => setViewMode("calendar")}
              className={viewMode === "calendar" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"}
            >
              <Calendar className="w-4 h-4 mr-2" />
              לוח שנה
            </Button>
          </div>
        </div>

        {viewMode === "list" ? renderListView() : renderCalendarView()}

        {/* Calendar Edit Modal */}
        <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {selectedEvent?.coupleNames}
                <div className="text-sm text-gray-400 font-normal mt-1">
                  {selectedEvent && format(new Date(selectedEvent.date), "d/M/yyyy")}
                </div>
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <h3 className="text-white font-semibold mb-3">צוות משובץ</h3>
                {renderAssignedTeam(selectedEvent)}
              </div>
              <div>
                <h3 className="text-white font-semibold mb-3">אנשי צוות זמינים</h3>
                {renderStaffList(selectedEvent, true)}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        <MobileStaffAssignmentSheet
          event={selectedEvent}
          isOpen={mobileSheetOpen}
          onClose={() => setMobileSheetOpen(false)}
          staffMembers={staffMembers}
          events={events}
          onRefresh={loadData}
          sendCalendarInviteByName={sendCalendarInviteByName}
        />
      </div>
    </div>
  );
}