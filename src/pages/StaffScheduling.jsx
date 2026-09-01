import React, { useState, useEffect, useMemo } from "react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, List, Users, AlertTriangle, UserCheck, ChevronLeft, ChevronRight, X, GripVertical, Pencil, Check } from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, addMonths, subMonths } from "date-fns";
// Hebrew month names in the calendar header -- the title used to render in
// English ("September 2026") above Hebrew weekday headers. Already the
// established pattern in this project (NotificationBell.jsx:9).
import { he } from "date-fns/locale";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { sendCalendarInviteByName } from "@/lib/calendarInvites";
import MobileStaffAssignmentSheet from "@/components/events/MobileStaffAssignmentSheet";
import StaffAssignmentRoleList from "@/components/events/StaffAssignmentRoleList";

// Module-level so the array isn't rebuilt on every render. Short form on mobile
// (a 7-column month grid leaves ~48px per column on a phone, where "ראשון" wraps).
const WEEKDAYS = [
  { short: "א׳", long: "ראשון" },
  { short: "ב׳", long: "שני" },
  { short: "ג׳", long: "שלישי" },
  { short: "ד׳", long: "רביעי" },
  { short: "ה׳", long: "חמישי" },
  { short: "ו׳", long: "שישי" },
  { short: "ש׳", long: "שבת" },
];

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
    // requiredCrew is returned (additively -- no existing consumer changes) so the
    // calendar chip can show "2/3" without recomputing the `|| 3` default itself.
    return { isFullTeam, missingCount, assignedCount: assignedNonEditorTeam.length, requiredCrew };
  };

  // Group once instead of running `events.filter(...)` inside the day loop, which
  // was ~30 x 271 comparisons -- each constructing a throwaway Date -- per render.
  // Keying by local yyyy-MM-dd is exactly equivalent to the previous
  // `isSameDay(new Date(e.date), day)`: both compare local calendar days, so no
  // timezone behaviour changes here.
  const eventsByDay = useMemo(() => {
    const map = new Map();
    for (const event of events) {
      if (!event.date) continue;
      const key = format(new Date(event.date), "yyyy-MM-dd");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(event);
    }
    return map;
  }, [events]);

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

  const renderStaffList = (event, _compact = false, showEditControls = false) => (
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
        <StaffAssignmentRoleList
          event={event}
          staffMembers={staffMembers}
          events={events}
          onRefresh={loadData}
          sendCalendarInviteByName={sendCalendarInviteByName}
        />
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

  // Google-Calendar-style month grid. Replaces a layout whose day cells were
  // `aspect-square` (height derived from column width) while the events box
  // inside them was capped at `max-h-24` = 96px with `overflow-y-auto` -- so on
  // the 75 days that carry 2+ events, events sat behind a near-invisible inner
  // scrollbar with ~50px of unused space below them in the same cell. That, not
  // styling alone, is what the studio reported as "צפוף מדיי".
  //
  // Three deliberate structural choices:
  //  1. `gap-px` over a border-coloured background => one continuous hairline
  //     grid, instead of 35 detached rounded boxes separated by `gap-2`.
  //  2. `min-h-*` rather than a fixed height or an inner scroller: a day can
  //     never hide an event again. Today's worst case is 4 events on one day
  //     (one such day in 271 events), which fits; a busier day just grows its row.
  //  3. Leading AND trailing blanks, so the last week is a full 7-cell row --
  //     without trailing blanks a hairline grid ends ragged mid-row.
  const renderCalendarView = () => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const leadingCount = monthStart.getDay();
    const trailingCount = (7 - ((leadingCount + daysInMonth.length) % 7)) % 7;
    const renderBlankCell = (key) => (
      <div key={key} className="bg-gray-900/30 min-h-[76px] md:min-h-[120px]" />
    );

    return (
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800">
          <div className="flex justify-between items-center gap-3 flex-wrap">
            <div>
              <CardTitle className="text-white text-xl">
                {format(currentMonth, "MMMM yyyy", { locale: he })}
              </CardTitle>
              <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  צוות מלא
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  חסר צוות
                </span>
              </div>
            </div>
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
        <CardContent className="p-2 md:p-4">
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map((weekday) => (
              <div key={weekday.long} className="text-center text-gray-500 text-[11px] md:text-xs font-semibold py-2">
                <span className="md:hidden">{weekday.short}</span>
                <span className="hidden md:inline">{weekday.long}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-px bg-gray-800 border border-gray-800 rounded-lg overflow-hidden">
            {Array.from({ length: leadingCount }, (_, idx) => renderBlankCell(`lead-${idx}`))}
            {daysInMonth.map((day) => {
              const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) || [];
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toString()}
                  className={`min-h-[76px] md:min-h-[120px] p-1 md:p-1.5 ${isToday ? 'bg-yellow-500/[0.07]' : 'bg-gray-900'}`}
                >
                  {/* Today marked by a filled circle on the number, Google-style,
                      rather than tinting and outlining the whole cell. */}
                  <div className="mb-1">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] md:text-xs ${
                        isToday ? 'bg-yellow-400 text-gray-900 font-bold' : 'text-gray-400'
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
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
                          title={`${event.coupleNames} — ${teamStatus.assignedCount}/${teamStatus.requiredCrew} אנשי צוות`}
                          className={`w-full flex items-center gap-1 md:gap-1.5 rounded px-1 py-[3px] md:py-1 transition-colors ${
                            teamStatus.isFullTeam
                              ? 'bg-green-500/10 hover:bg-green-500/20 text-green-300'
                              : 'bg-red-500/10 hover:bg-red-500/20 text-red-300'
                          }`}
                        >
                          <span
                            className={`shrink-0 w-[3px] self-stretch min-h-[12px] rounded-full ${
                              teamStatus.isFullTeam ? 'bg-green-400' : 'bg-red-400'
                            }`}
                          />
                          <span className="flex-1 min-w-0 truncate text-right text-[10px] md:text-[11px] font-medium leading-tight">
                            {event.coupleNames}
                          </span>
                          {/* Hidden on phones: at ~48px per column the couple's name
                              needs every pixel. The count is still in the tooltip. */}
                          <span className="hidden md:inline shrink-0 text-[10px] tabular-nums opacity-70">
                            {teamStatus.assignedCount}/{teamStatus.requiredCrew}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {Array.from({ length: trailingCount }, (_, idx) => renderBlankCell(`trail-${idx}`))}
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