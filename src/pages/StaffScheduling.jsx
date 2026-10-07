import React, { useState, useEffect, useMemo } from "react";
import { isMissingTeam, israelToday, eventDay, assignedShooters, requiredShooters, combinedNotes } from "@/lib/missingTeam";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, List, Users, AlertTriangle, UserCheck, ChevronLeft, ChevronRight, X, GripVertical, Pencil, Check, Send } from "lucide-react";
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
import StaffAvailabilityModal from "@/components/leads/StaffAvailabilityModal";
import AvailabilityAnswers, { useAvailabilityRequests } from "@/components/staffScheduling/AvailabilityAnswers";
import { buildAvailabilityInbox } from "@/lib/availabilityInbox";

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
  // "answers" = 📥 תשובות זמינות (2026-10-07); ?tab=answers&leadId= opens it on that couple.
  const [viewMode, setViewMode] = useState(() => (new URLSearchParams(window.location.search).get("tab") === "answers" ? "answers" : "list"));
  const focusLeadId = new URLSearchParams(window.location.search).get("leadId");
  const answersQ = useAvailabilityRequests();
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [editModalOpen, setEditModalOpen] = useState(false);
  // Mobile-only: reuses the same bottom-sheet staff-assignment UI already built
  // for the Events page's mobile "צוות" quick action (MobileStaffAssignmentSheet)
  // instead of the desktop-oriented Dialog+renderStaffList, so mobile users get
  // one consistent per-role picker experience across both pages.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  // "מצא מחליף" (2026-09-15): which event + role + who cancelled; null = closed.
  const [replacementTarget, setReplacementTarget] = useState(null);
  const openReplacement = (jobRole, excludeName, forEvent) =>
    setReplacementTarget({ event: forEvent, jobRole, excludeName });
  // "זמינות צלם" — the plain availability check (pick a role, tick names, send), the same
  // one the lead panel has. Owner's request on 2026-09-24, for the mobile sheet. Reuses the
  // same modal with `replacement: null`.
  const openAvailability = (forEvent) => setReplacementTarget({ event: forEvent, plain: true });
  // Bumped after a send so the sheet re-reads who has been asked / answered.
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
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

  // `silent` (2026-10-07): refresh in place, without the full-page skeleton — the
  // availability answers tab keeps its open assignment-message window across a refresh.
  const loadData = async (opts) => {
    if (!opts?.silent) setIsLoading(true);
    try {
      const [rawEvents, staffData, leadNotes] = await Promise.all([
        base44.entities.Event.list("-date"),
        base44.entities.StaffMember.list(),
        // Only id + notes: an event's notes are often written on its lead (combinedNotes).
        base44.entities.Lead.filter({}, undefined, undefined, "id, notes").catch(() => []),
      ]);
      const notesByLead = new Map((leadNotes || []).map((l) => [l.id, l.notes]));
      const eventsData = rawEvents.map((e) => ({ ...e, displayNotes: combinedNotes(e.notes, notesByLead.get(e.sourceLeadId)) }));
      setEvents(eventsData);
      const sorted = [...staffData].sort((a, b) => (a.orderIndex ?? 999) - (b.orderIndex ?? 999));
      setStaffMembers(sorted);
      setOrderedStaff(sorted.filter(s => s.role !== 'editor'));
      // ?eventId=… (from "חסר צוות" on the dashboard) opens that event; otherwise the
      // nearest upcoming one rather than the latest-dated event in the list.
      if (!selectedEvent && eventsData.length > 0) {
        const wanted = new URLSearchParams(window.location.search).get("eventId");
        const today0 = israelToday();
        const next = eventsData.filter((e) => eventDay(e) >= today0).sort((a, b) => eventDay(a).localeCompare(eventDay(b)))[0];
        setSelectedEvent(eventsData.find((e) => e.id === wanted) || next || eventsData[0]);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    }
    setIsLoading(false);
  };

  // The shared "חסר צוות" rule (src/lib/missingTeam.js, 2026-10-07) — the same events the
  // sidebar and the dashboard count. Before: the editor counted as crew here (an event with
  // 2 shooters + editor looked full) and today's events dropped out from 03:00 (UTC).
  const today = israelToday();
  const upcomingEvents = events
    .filter(e => {
      if (eventDay(e) < today) return false;
      return filterMissing ? isMissingTeam(e, today) : true;
    })
    .sort((a, b) => eventDay(a).localeCompare(eventDay(b)));

  const getTeamStatus = (event) => {
    const assignedCount = assignedShooters(event);
    const requiredCrew = requiredShooters(event);
    return { isFullTeam: assignedCount >= requiredCrew, missingCount: Math.max(0, requiredCrew - assignedCount), assignedCount, requiredCrew };
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
          onFindReplacement={openReplacement}
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
        <Card className="dash-card">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="text-white">אירועים קרובים</CardTitle>
              <div className="flex gap-1">
              <button
                onClick={() => setFilterMissing(false)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  !filterMissing ? 'bg-[#FACC15]/10 border-[#FACC15]/80 text-[#FDE047] font-bold' : 'bg-[#0B1529] border-[#2A3B57] text-slate-300 hover:text-white'
                }`}
              >
                📅 כל האירועים
              </button>
              <button
                onClick={() => setFilterMissing(true)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  filterMissing ? 'bg-[#F05B70]/15 border-[#F05B70]/70 text-rose-200 font-bold' : 'bg-[#0B1529] border-[#2A3B57] text-slate-300 hover:text-white'
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
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      isSelected
                        ? 'border-[#60A5FA]/50 bg-[#2563EB]/20 shadow-[0_0_22px_-8px_rgba(59,130,246,0.7)]'
                        : 'bg-white/[0.025] border-white/[0.07] hover:border-[#4F7BFF]/40'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="font-medium text-white">{event.coupleNames}</div>
                        <div className="text-sm text-gray-400">
                          {format(new Date(event.date), "d/M/yyyy")}
                          {/* The venue decides who gets booked (2026-09-24: "כדי שאדע
                              איזה צוות לשים"). It was only on the selected card before. */}
                          {event.venue && <span className="text-gray-300"> · {event.venue}</span>}
                        </div>
                        {/* Event notes, verbatim. The owner writes things like "ביקשו את
                            דודו" here and wants to see them while assigning, not after. */}
                        {event.displayNotes && (
                          <div className="mt-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 whitespace-pre-wrap break-words">
                            📝 {event.displayNotes}
                          </div>
                        )}
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
          <Card className="dash-card">
            <CardHeader className="dash-head">
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-white text-2xl">{selectedEvent.coupleNames}</CardTitle>
                  <p className="text-gray-400 mt-1">
                    {format(new Date(selectedEvent.date), "EEEE, d MMMM yyyy")}
                  </p>
                  {selectedEvent.venue && (
                    <p className="text-gray-500 text-sm mt-1">📍 {selectedEvent.venue}</p>
                  )}
                  {selectedEvent.displayNotes && (
                    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 whitespace-pre-wrap break-words">
                      📝 {selectedEvent.displayNotes}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Button
                    size="sm"
                    onClick={() => openAvailability(selectedEvent)}
                    className="bg-pink-600 hover:bg-pink-700 text-white text-xs"
                  >
                    <Send className="w-3.5 h-3.5 ml-1" />
                    זמינות צלם
                  </Button>
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
          <Card className="dash-card">
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
      <div key={key} className="bg-[#09121F] min-h-[76px] md:min-h-[120px]" />
    );

    return (
      <Card className="dash-card">
        <CardHeader className="dash-head">
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
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="rounded-lg border-[#2A3B57] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white">
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(new Date())} className="rounded-lg border-[#2A3B57] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white">
                היום
              </Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="rounded-lg border-[#2A3B57] bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:text-white">
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
          <div className="grid grid-cols-7 gap-px bg-[#22334B]/70 border border-[#22334B]/70 rounded-xl overflow-hidden">
            {Array.from({ length: leadingCount }, (_, idx) => renderBlankCell(`lead-${idx}`))}
            {daysInMonth.map((day) => {
              const dayEvents = eventsByDay.get(format(day, "yyyy-MM-dd")) || [];
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toString()}
                  className={`min-h-[76px] md:min-h-[120px] p-1 md:p-1.5 ${isToday ? 'bg-[#2563EB]/[0.14]' : 'bg-[#0C1729]'}`}
                >
                  {/* Today marked by a filled circle on the number, Google-style,
                      rather than tinting and outlining the whole cell. */}
                  <div className="mb-1">
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] md:text-xs ${
                        isToday ? 'bg-[#3B82F6] text-white font-bold shadow-[0_0_12px_rgba(59,130,246,0.8)]' : 'text-slate-400'
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
                          title={`${event.coupleNames} — ${teamStatus.assignedCount}/${teamStatus.requiredCrew} אנשי צוות${event.venue ? ` · ${event.venue}` : ""}${event.displayNotes ? `\n📝 ${event.displayNotes}` : ""}`}
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
      <div className="e-page min-h-screen p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <Skeleton className="h-12 w-64 mb-8" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="e-page min-h-screen p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-5">
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#F97316]/45 bg-[#F97316]/10 text-orange-300 shadow-[0_0_24px_-6px_rgba(249,115,22,0.7)]">
              <Users className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-1">שיבוץ צוות</h1>
              <p className="text-slate-400">נהל ושבץ אנשי צוות לאירועים</p>
            </div>
          </div>
          <div className="flex w-full gap-1 rounded-xl border border-[#2A3B57] bg-[#0B1529] p-1 md:w-auto [&>button]:flex-1 [&>button]:px-2 [&>button]:text-[13px] md:[&>button]:flex-none md:[&>button]:px-4 md:[&>button]:text-sm">
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              onClick={() => setViewMode("list")}
              className={viewMode === "list" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 font-semibold" : "rounded-lg border-0 bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white"}
            >
              <List className="w-4 h-4 mr-2" />
              רשימה
            </Button>
            <Button
              variant={viewMode === "calendar" ? "default" : "outline"}
              onClick={() => setViewMode("calendar")}
              className={viewMode === "calendar" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 font-semibold" : "rounded-lg border-0 bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white"}
            >
              <Calendar className="w-4 h-4 mr-2" />
              לוח שנה
            </Button>
            {(() => {
              const toDecide = buildAvailabilityInbox({ requests: answersQ.data || [], events, today }).toDecide;
              return (
                <Button
                  variant={viewMode === "answers" ? "default" : "outline"}
                  onClick={() => setViewMode("answers")}
                  className={viewMode === "answers" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 font-semibold" : "rounded-lg border-0 bg-transparent text-slate-300 hover:bg-white/[0.06] hover:text-white"}
                >
                  📥 תשובות זמינות
                  {toDecide > 0 && <span className="mr-1.5 rounded-full bg-emerald-500 px-1.5 text-[11px] font-bold text-white">{toDecide}</span>}
                </Button>
              );
            })()}
          </div>
        </div>

        {/* Design E: three counts over the upcoming events, by the shared missing-team rule. */}
        {(() => {
          const upcoming = events.filter((e) => eventDay(e) >= today);
          const missing = upcoming.filter((e) => isMissingTeam(e, today)).length;
          const tiles = [
            { label: "אירועים קרובים", value: upcoming.length, icon: Calendar, tone: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-sky-300 shadow-[0_0_18px_-4px_rgba(59,130,246,0.6)]" },
            { label: "חסר צוות", value: missing, icon: AlertTriangle, tone: "border-[#F05B70]/55 bg-[#F05B70]/12 text-rose-300 shadow-[0_0_18px_-4px_rgba(240,91,112,0.6)]" },
            { label: "צוות מלא", value: upcoming.length - missing, icon: UserCheck, tone: "border-[#22C987]/50 bg-[#22C987]/12 text-emerald-300 shadow-[0_0_18px_-4px_rgba(34,201,135,0.55)]" },
          ];
          return (
            <div className="grid grid-cols-3 gap-2.5 md:gap-4 mb-5">
              {tiles.map((t) => (
                <div key={t.label} className="dash-card flex items-center justify-end gap-2 px-3 py-3 md:gap-4 md:px-5 md:py-4">
                  <div>
                    <div className="text-xl md:text-2xl font-bold leading-tight text-white tabular-nums">{t.value}</div>
                    <div className="text-[11px] md:text-sm text-slate-400 whitespace-nowrap">{t.label}</div>
                  </div>
                  <div className={`hidden sm:flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl border ${t.tone}`}>
                    <t.icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.75} />
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {viewMode === "answers" ? (
          <AvailabilityAnswers events={events} staffMembers={staffMembers} onEventsChanged={() => loadData({ silent: true })} focusLeadId={focusLeadId} />
        ) : viewMode === "list" ? renderListView() : renderCalendarView()}

        {/* Calendar Edit Modal */}
        <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl">
            <DialogHeader>
              <DialogTitle className="text-xl">
                {selectedEvent?.coupleNames}
                <div className="text-sm text-gray-400 font-normal mt-1">
                  {selectedEvent && format(new Date(selectedEvent.date), "d/M/yyyy")}
                  {selectedEvent?.venue && <span> · {selectedEvent.venue}</span>}
                </div>
                {selectedEvent?.displayNotes && (
                  <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm font-normal text-amber-200 whitespace-pre-wrap break-words">
                    📝 {selectedEvent.displayNotes}
                  </div>
                )}
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
          onFindReplacement={openReplacement}
          onCheckAvailability={openAvailability}
          availabilityVersion={availabilityVersion}
        />

        <StaffAvailabilityModal
          open={!!replacementTarget}
          onClose={() => setReplacementTarget(null)}
          onSent={() => { setReplacementTarget(null); setAvailabilityVersion((v) => v + 1); }}
          staffMembers={staffMembers}
          eventDate={replacementTarget?.event?.date}
          venue={replacementTarget?.event?.venue}
          coupleNames={replacementTarget?.event?.coupleNames}
          leadId={replacementTarget?.event?.sourceLeadId || null}
          eventId={replacementTarget?.event?.id}
          eventTeam={replacementTarget?.event?.team || []}
          eventsOnDate={events}
          replacement={replacementTarget && !replacementTarget.plain ? { jobRole: replacementTarget.jobRole, excludeName: replacementTarget.excludeName } : null}
          existingRequests={[]}
          onStaffMembersChanged={loadData}
        />
      </div>
    </div>
  );
}