import React, { useState, useEffect } from "react";
import { Event } from "@/entities/Event";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, addMonths, isSameMonth, isSameDay, isToday, addWeeks, subWeeks, subMonths } from "date-fns";
import EventQuickEditModal from "../components/calendar/EventQuickEditModal";
import AddEventModal from "../components/calendar/AddEventModal";

const STATUS_COLORS = {
  "Paid": "bg-green-500 hover:bg-green-600 border-green-600",
  "Partially Paid": "bg-yellow-500 hover:bg-yellow-600 border-yellow-600",
  "Unpaid": "bg-red-500 hover:bg-red-600 border-red-600"
};

export default function Calendar() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState("month"); // month, week, day
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedDateForAdd, setSelectedDateForAdd] = useState(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const data = await Event.list("-date");
      setEvents(data);
    } catch (error) {
      console.error("Error loading events:", error);
    }
    setIsLoading(false);
  };

  const getEventsForDate = (date) => {
    return events.filter(event => 
      isSameDay(new Date(event.date), date)
    );
  };

  const handleEventClick = (eventId) => {
    const event = events.find(e => e.id === eventId);
    if (event) {
      setSelectedEvent(event);
      setIsModalOpen(true);
    }
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setSelectedEvent(null);
  };

  const handleEventUpdate = () => {
    loadEvents();
  };

  const handleAddEvent = (date) => {
    setSelectedDateForAdd(date);
    setIsAddModalOpen(true);
  };

  const handleAddModalClose = () => {
    setIsAddModalOpen(false);
    setSelectedDateForAdd(null);
  };

  const handleEventCreated = () => {
    loadEvents();
  };

  const handlePrevious = () => {
    if (view === "month") {
      setCurrentDate(subMonths(currentDate, 1));
    } else if (view === "week") {
      setCurrentDate(subWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, -1));
    }
  };

  const handleNext = () => {
    if (view === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else if (view === "week") {
      setCurrentDate(addWeeks(currentDate, 1));
    } else {
      setCurrentDate(addDays(currentDate, 1));
    }
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);

    const rows = [];
    let days = [];
    let day = startDate;

    while (day <= endDate) {
      for (let i = 0; i < 7; i++) {
        const dayEvents = getEventsForDate(day);
        const isCurrentMonth = isSameMonth(day, monthStart);
        const isCurrentDay = isToday(day);
        const formattedDay = format(day, "d");
        const currentDay = day;

        days.push(
          <div
            key={day}
            className={`min-h-[120px] border border-gray-800 p-2 relative group ${
              !isCurrentMonth ? "bg-gray-900/30" : "bg-gray-900/50"
            } ${isCurrentDay ? "ring-2 ring-yellow-400" : ""}`}
          >
            <div className="flex justify-between items-center mb-2">
              <div className={`text-sm font-semibold ${
                isCurrentDay ? "text-yellow-400" : isCurrentMonth ? "text-gray-300" : "text-gray-600"
              }`}>
                {formattedDay}
              </div>
              {isCurrentMonth && (
                <button
                  onClick={() => handleAddEvent(currentDay)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-yellow-400/20 rounded"
                  title="הוסף אירוע"
                >
                  <Plus className="w-3 h-3 text-yellow-400" />
                </button>
              )}
            </div>
            <div className="space-y-1 overflow-y-auto max-h-[80px]">
              {dayEvents.map((event) => (
                <button
                  key={event.id}
                  onClick={() => handleEventClick(event.id)}
                  className={`w-full text-left px-2 py-1 rounded text-xs font-medium text-white transition-colors ${
                    STATUS_COLORS[event.clientPaymentStatus || "Unpaid"]
                  }`}
                >
                  {event.coupleNames}
                </button>
              ))}
            </div>
          </div>
        );
        day = addDays(day, 1);
      }
      rows.push(
        <div key={day} className="grid grid-cols-7 gap-0">
          {days}
        </div>
      );
      days = [];
    }

    return (
      <div>
        <div className="grid grid-cols-7 gap-0 mb-0">
          {["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"].map((dayName) => (
            <div
              key={dayName}
              className="text-center py-3 font-semibold text-gray-400 bg-gray-800/50 border border-gray-800"
            >
              {dayName}
            </div>
          ))}
        </div>
        {rows}
      </div>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const days = [];

    for (let i = 0; i < 7; i++) {
      const day = addDays(weekStart, i);
      const dayEvents = getEventsForDate(day);
      const isCurrentDay = isToday(day);

      days.push(
        <div key={i} className="border border-gray-800 bg-gray-900/50 group">
          <div className={`text-center py-3 border-b border-gray-800 flex justify-between items-center px-3 ${
            isCurrentDay ? "bg-yellow-400/20 text-yellow-400" : "text-gray-300"
          }`}>
            <div className="flex-1">
              <div className="text-xs font-medium">{format(day, "EEEE")}</div>
              <div className="text-lg font-bold">{format(day, "d")}</div>
            </div>
            <button
              onClick={() => handleAddEvent(day)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-yellow-400/20 rounded"
              title="הוסף אירוע"
            >
              <Plus className="w-4 h-4 text-yellow-400" />
            </button>
          </div>
          <div className="p-3 space-y-2 min-h-[400px]">
            {dayEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => handleEventClick(event.id)}
                className={`w-full text-left px-3 py-2 rounded text-sm font-medium text-white transition-colors ${
                  STATUS_COLORS[event.clientPaymentStatus || "Unpaid"]
                }`}
              >
                <div className="font-semibold">{event.coupleNames}</div>
                <div className="text-xs opacity-90">
                  ₪{event.totalAmountGross?.toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    return <div className="grid grid-cols-7 gap-0">{days}</div>;
  };

  const renderDayView = () => {
    const dayEvents = getEventsForDate(currentDate);

    return (
      <div className="bg-gray-900/50 border border-gray-800 rounded-lg p-6">
        <div className="text-center mb-6">
          <div className="flex justify-between items-center mb-4">
            <div className="flex-1"></div>
            <div>
              <div className="text-2xl font-bold text-white mb-2">
                {format(currentDate, "EEEE, d MMMM yyyy")}
              </div>
              <div className="text-gray-400">
                {dayEvents.length} {dayEvents.length === 1 ? "אירוע" : "אירועים"}
              </div>
            </div>
            <div className="flex-1 flex justify-end">
              <Button
                onClick={() => handleAddEvent(currentDate)}
                size="sm"
                className="bg-yellow-400 text-gray-900 hover:bg-yellow-500"
              >
                <Plus className="w-4 h-4 mr-2" />
                הוסף אירוע
              </Button>
            </div>
          </div>
        </div>
        <div className="space-y-3 max-w-2xl mx-auto">
          {dayEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CalendarIcon className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <p className="text-lg">אין אירועים ביום זה</p>
            </div>
          ) : (
            dayEvents.map((event) => (
              <button
                key={event.id}
                onClick={() => handleEventClick(event.id)}
                className={`w-full text-left px-4 py-4 rounded-lg text-white transition-all hover:shadow-lg ${
                  STATUS_COLORS[event.clientPaymentStatus || "Unpaid"]
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xl font-bold mb-1">{event.coupleNames}</div>
                    <div className="text-sm opacity-90">
                      ₪{event.totalAmountGross?.toLocaleString()} • רווח נקי: ₪{event.profitNet?.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs opacity-75">
                    {format(new Date(event.date), "HH:mm")}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="animate-pulse">
            <div className="h-12 bg-gray-800 rounded-lg w-64 mb-6"></div>
            <div className="h-96 bg-gray-800 rounded-xl"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2 flex items-center gap-3">
              <CalendarIcon className="w-8 h-8 text-yellow-400" />
              לוח אירועים
            </h1>
            <p className="text-gray-400">תצוגת לוח שנה של כל האירועים</p>
          </div>

          <div className="flex gap-2">
            <Button
              variant={view === "month" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("month")}
              className={view === "month" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : "border-gray-700 text-gray-300 hover:bg-gray-800"}
            >
              חודש
            </Button>
            <Button
              variant={view === "week" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("week")}
              className={view === "week" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : "border-gray-700 text-gray-300 hover:bg-gray-800"}
            >
              שבוע
            </Button>
            <Button
              variant={view === "day" ? "default" : "outline"}
              size="sm"
              onClick={() => setView("day")}
              className={view === "day" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500" : "border-gray-700 text-gray-300 hover:bg-gray-800"}
            >
              יום
            </Button>
          </div>
        </div>

        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm mb-4">
          <div className="p-4 flex justify-between items-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrevious}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-white">
                {view === "month" && format(currentDate, "MMMM yyyy")}
                {view === "week" && `${format(startOfWeek(currentDate), "d MMM")} - ${format(endOfWeek(currentDate), "d MMM yyyy")}`}
                {view === "day" && format(currentDate, "d MMMM yyyy")}
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={handleToday}
                className="border-gray-700 text-gray-300 hover:bg-gray-800"
              >
                היום
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleNext}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        </Card>

        <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm overflow-hidden">
          {view === "month" && renderMonthView()}
          {view === "week" && renderWeekView()}
          {view === "day" && renderDayView()}
        </Card>

        <div className="mt-4 flex gap-4 justify-center">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-500 rounded"></div>
            <span className="text-sm text-gray-400">שולם</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-yellow-500 rounded"></div>
            <span className="text-sm text-gray-400">שולם חלקית</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-red-500 rounded"></div>
            <span className="text-sm text-gray-400">לא שולם</span>
          </div>
        </div>

        {/* Quick Edit Modal */}
        <EventQuickEditModal
          event={selectedEvent}
          isOpen={isModalOpen}
          onClose={handleModalClose}
          onUpdate={handleEventUpdate}
        />

        {/* Add Event Modal */}
        <AddEventModal
          selectedDate={selectedDateForAdd}
          isOpen={isAddModalOpen}
          onClose={handleAddModalClose}
          onSuccess={handleEventCreated}
        />
      </div>
    </div>
  );
}