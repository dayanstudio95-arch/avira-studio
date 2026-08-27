import React, { useState, useEffect, useMemo } from "react";
import { Event } from "@/entities/Event";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, Calendar, Banknote, Receipt, Search, X, CalendarDays } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

import StatsCards from "../components/dashboard/StatsCards";
import EventsTable from "../components/dashboard/EventsTable";
import RecentLeadsCard from "../components/dashboard/RecentLeadsCard";
import DashboardUnpaidCard from "../components/dashboard/DashboardUnpaidCard";
import DashboardWorkStatusCard from "../components/dashboard/DashboardWorkStatusCard";
import DashboardMissingTeamCard from "../components/dashboard/DashboardMissingTeamCard";
import { calculateNetProfit } from "../lib/profitCalculations";
import { calculateEventFinancials } from "../lib/financialCalculations";

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [timeFilter, setTimeFilter] = useState("thisMonth");

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const [data, sm] = await Promise.all([
        Event.list("-date"),
        base44.entities.StaffMember.list()
      ]);
      setEvents(data);
      setStaffMembers(sm);
    } catch (error) {
      console.error("Error loading events:", error);
    }
    setIsLoading(false);
  };

  // Force refresh when component refocuses (e.g., after drawer closes)
  useEffect(() => {
    const handleFocus = () => {
      loadEvents();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  const calculateStats = () => {
    const today = new Date();
    const currentMonth = today.getMonth();

    const filterEvents = (events) => {
        const income = events.reduce((sum, event) => sum + (event.totalAmountGross || 0), 0);
        // Expenses come from the event's own crew list and nothing else -- the same
        // source calculateNetProfit() uses. There used to be a `+ (hasVideographer ?
        // 1200 : 0)` term here, a hardcoded copy of the video editor's fee. It was
        // wrong twice over: the editor is normally assigned to the event like any
        // other crew member, so on 250 of 271 events his 1,200 was counted a second
        // time on top of his real team[] row (2026 expenses overstated by 271,200);
        // and `hasVideographer` tests only m.role, so an event whose videographer row
        // is explicitly named "אין וידאו" with cost 0 still triggered it. The 15
        // events with a videographer but no editor are deliberate -- the studio
        // sometimes books video without editing -- so no compensation term belongs
        // here at all. staff_members.default_rate (Settings -> אנשי צוות) is now the
        // single source for that price: raise the editor's rate there and every new
        // assignment follows, while past events keep the rate snapshotted into
        // team[].cost.
        //
        // No number on screen changes as a result: `expenses` is returned in the
        // stats object but never rendered -- the cards show only income and
        // netProfit, and netProfit comes from calculateNetProfit(), which has always
        // summed team[].cost alone. That is precisely why the wrong figure survived
        // this long. It is fixed rather than deleted so that whoever does render
        // הוצאות one day gets a number that agrees with רווח נקי beside it.
        let expenses = events.reduce((sum, event) => {
          return sum + (event.team || []).reduce((s, m) => s + (m.cost || 0), 0);
        }, 0);
        const vat = events.reduce((sum, event) => sum + (event.vatAmount != null ? event.vatAmount : calculateEventFinancials(event).vatAmount), 0);
        const profit = events.reduce((sum, event) => sum + calculateNetProfit(event, staffMembers), 0);
        return { income, expenses, vat, profit };
    }

    const todayEvents = events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.toDateString() === today.toDateString() && eventDate.getFullYear() === selectedYear;
    });

    const monthEvents = events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.getMonth() === currentMonth && eventDate.getFullYear() === selectedYear;
    });

    const yearEvents = events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.getFullYear() === selectedYear;
    });

    const calcNetProfit = (evts) => evts.reduce((sum, e) => sum + calculateNetProfit(e, staffMembers), 0);

    const now2 = new Date();
    const nextWeek = new Date(now2); nextWeek.setDate(now2.getDate() + 7);
    const thisWeekUpcoming = events.filter(e => {
      const d = new Date(e.date);
      return d >= now2 && d <= nextWeek;
    });

    return {
      today: { ...filterEvents(todayEvents), netProfit: calcNetProfit(todayEvents) },
      month: { ...filterEvents(monthEvents), netProfit: calcNetProfit(monthEvents) },
      year: { ...filterEvents(yearEvents), netProfit: calcNetProfit(yearEvents) },
      thisWeekUpcoming,
    };
  };

  const stats = useMemo(() => calculateStats(), [events, selectedYear]);

  // Filter events based on search term, year, and time filter
  const filteredEvents = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    let filtered = events.filter(event => {
      const eventDate = new Date(event.date);
      const yearMatch = eventDate.getFullYear() === selectedYear;
      
      if (!yearMatch) return false;
      
      // Apply time filter
      if (timeFilter === "thisWeek") {
        return eventDate >= startOfWeek && eventDate <= endOfWeek;
      } else if (timeFilter === "thisMonth") {
        return eventDate >= startOfMonth && eventDate <= endOfMonth;
      } else if (timeFilter === "nextMonth") {
        return eventDate >= startOfNextMonth && eventDate <= endOfNextMonth;
      }
      
      return true; // "all"
    });
    
    if (!searchTerm.trim()) return filtered;
    
    const searchLower = searchTerm.toLowerCase();
    return filtered.filter(event => {
      const coupleMatch = event.coupleNames?.toLowerCase().includes(searchLower);
      const eventDate = new Date(event.date);
      const formattedDate = format(eventDate, "d/M/yyyy");
      const dateMatch = formattedDate.includes(searchTerm) || 
                       format(eventDate, "dd/MM/yyyy").includes(searchTerm) ||
                       format(eventDate, "yyyy").includes(searchTerm) ||
                       format(eventDate, "M/yyyy").includes(searchTerm);
      
      return coupleMatch || dateMatch;
    });
  }, [events, searchTerm, selectedYear, timeFilter]);

  // Calculate counts for each filter
  const filterCounts = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    const yearEvents = events.filter(e => new Date(e.date).getFullYear() === selectedYear);
    
    return {
      all: yearEvents.length,
      thisWeek: yearEvents.filter(e => {
        const d = new Date(e.date);
        return d >= startOfWeek && d <= endOfWeek;
      }).length,
      thisMonth: yearEvents.filter(e => {
        const d = new Date(e.date);
        return d >= startOfMonth && d <= endOfMonth;
      }).length,
      nextMonth: yearEvents.filter(e => {
        const d = new Date(e.date);
        return d >= startOfNextMonth && d <= endOfNextMonth;
      }).length,
    };
  }, [events, selectedYear]);

  // Search bar + time filters — rendered twice: once right below the page
  // header on mobile (md:hidden), once in its original spot on desktop
  // (hidden md:block). Same searchTerm/timeFilter state either way, just
  // moved higher up on mobile so it's reachable without scrolling past the
  // ~8 stacked KPI/summary cards above it.
  const searchAndFilterBar = (
    <div className="mb-4">
      <div className="flex flex-col gap-3">
        <div className="relative w-full md:max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
          <Input
            type="text"
            placeholder="חפש לפי שם הזוג או תאריך..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10 bg-gray-900/50 border-gray-700 text-white placeholder-gray-400 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
          {searchTerm && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={timeFilter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("all")}
            className={timeFilter === "all" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"}
          >
            הכל ({filterCounts.all})
          </Button>
          <Button
            variant={timeFilter === "thisWeek" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("thisWeek")}
            className={timeFilter === "thisWeek" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"}
          >
            השבוע ({filterCounts.thisWeek})
          </Button>
          <Button
            variant={timeFilter === "thisMonth" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("thisMonth")}
            className={timeFilter === "thisMonth" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"}
          >
            החודש ({filterCounts.thisMonth})
          </Button>
          <Button
            variant={timeFilter === "nextMonth" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("nextMonth")}
            className={timeFilter === "nextMonth" ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500 text-xs" : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs"}
          >
            החודש הבא ({filterCounts.nextMonth})
          </Button>
        </div>
      </div>
      {searchTerm && (
        <p className="text-sm text-gray-400 mt-2">
          נמצאו {filteredEvents.length} תוצאות עבור "{searchTerm}"
        </p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-1">
              Financial Dashboard
            </h1>
            <p className="text-gray-400 text-sm md:text-base">
              Track your wedding photography business performance
            </p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2 flex-1 md:flex-none">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
                <SelectTrigger className="w-full sm:w-32 bg-gray-900/50 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  <SelectItem value="2025">2025</SelectItem>
                  <SelectItem value="2026">2026</SelectItem>
                  <SelectItem value="2027">2027</SelectItem>
                  <SelectItem value="2028">2028</SelectItem>
                  <SelectItem value="2029">2029</SelectItem>
                  <SelectItem value="2030">2030</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Search bar, mobile-only, moved above the KPI cards so it's reachable
            without scrolling — see searchAndFilterBar above. */}
        <div className="md:hidden">{searchAndFilterBar}</div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-6">
          <StatsCards
            title="הכנסות היום"
            value={`₪${stats.today.income.toLocaleString()}`}
            icon={Banknote}
            bgColor="bg-yellow-500"
            textColor="text-yellow-400"
            subValue={`₪${Math.round(stats.today.netProfit).toLocaleString()}`}
            trend={null}
          />
          <StatsCards
            title="הכנסות החודש"
            value={`₪${stats.month.income.toLocaleString()}`}
            icon={TrendingUp}
            bgColor="bg-blue-500"
            textColor="text-blue-400"
            subValue={`₪${Math.round(stats.month.netProfit).toLocaleString()}`}
          />
          <StatsCards
            title="הכנסות השנה"
            value={`₪${stats.year.income.toLocaleString()}`}
            icon={Receipt}
            bgColor="bg-green-500"
            textColor="text-green-400"
            subValue={`₪${Math.round(stats.year.netProfit).toLocaleString()}`}
          />
          <StatsCards
            title="אירועים השבוע הקרוב"
            value={stats.thisWeekUpcoming.length}
            icon={Calendar}
            bgColor="bg-purple-500"
            textColor="text-purple-400"
            trend={stats.thisWeekUpcoming.length > 0 ? stats.thisWeekUpcoming.map(e => e.coupleNames).join(', ') : 'אין אירועים'}
          />
        </div>

        {/* Middle Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-6">
          <DashboardUnpaidCard events={events} onRefresh={loadEvents} />
          <RecentLeadsCard />
          <DashboardWorkStatusCard events={events} onRefresh={loadEvents} />
          <DashboardMissingTeamCard events={events} />
        </div>

        {/* Search Bar and Filters — desktop position (mobile renders this above
            the KPI cards instead, see searchAndFilterBar above). */}
        <div className="hidden md:block">{searchAndFilterBar}</div>

        {/* Events Table */}
        <EventsTable events={filteredEvents} isLoading={isLoading} onRefresh={loadEvents} />
      </div>
    </div>
  );
}