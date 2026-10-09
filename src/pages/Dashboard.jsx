import React, { useState, useEffect, useMemo } from "react";
import { Event } from "@/entities/Event";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X, CalendarDays } from "lucide-react";
import { format } from "date-fns";

import EventsTable from "../components/dashboard/EventsTable";
import RecentLeadsCard from "../components/dashboard/RecentLeadsCard";
import DashboardUnpaidCard from "../components/dashboard/DashboardUnpaidCard";
import DashboardWorkStatusCard from "../components/dashboard/DashboardWorkStatusCard";
import DashboardMissingTeamCard from "../components/dashboard/DashboardMissingTeamCard";
import TodayEventsCard from "../components/dashboard/TodayEventsCard";
import FinanceCard from "../components/dashboard/FinanceCard";
import { MeetingsTodayCard, WhatsAppPulseCard, FollowUpCard, PostSignCard } from "../components/dashboard/DailyPulseCards";
import { israelToday, eventDay } from "@/lib/missingTeam";
import { useQuery } from "@tanstack/react-query";
import { yearGaps, GAP_TYPES } from "@/lib/eventGaps";
import { GAP_TONE } from "../components/dashboard/EventsTable";
import { calculateNetProfit } from "../lib/profitCalculations";
import { calculateEventFinancials } from "../lib/financialCalculations";
import YearPicker from "@/components/common/YearPicker";

export default function Dashboard() {
  const [events, setEvents] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [timeFilter, setTimeFilter] = useState("thisMonth");
  const [gapFilter, setGapFilter] = useState(null); // one hole type inside "חורים השנה", null = all

  useEffect(() => {
    loadEvents();
  }, []);

  // 2026-10-07: every refresh (window focus, a save in the side panel) used to swap the
  // whole table for a loading skeleton, which unmounted any side panel / invoice dialog
  // open on top of it — e.g. an invoice issued while the owner glanced at another window
  // never showed its success screen. Only the first load shows the skeleton now; later
  // refreshes replace the rows in place.
  const loadEvents = async (opts) => {
    const silent = opts?.silent === true || events.length > 0;
    if (!silent) setIsLoading(true);
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
      loadEvents({ silent: true });
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

  // Still open to collect: events already held and not marked "שולם" (the old sidebar
  // number, moved here with the rest of the money).
  const pendingCollection = useMemo(() => {
    const today = israelToday();
    return events.reduce((sum, e) => (eventDay(e) < today && e.clientPaymentStatus !== "Paid" ? sum + (e.totalAmountGross || 0) : sum), 0);
  }, [events]);

  // "חורים השנה" (2026-10-09): events of the selected year with something open — rules in
  // src/lib/eventGaps.js. The questionnaire flag lives on the lead (one light query).
  // Only the leads of the events on screen, in chunks (QA 2026-10-09: an unfiltered query
  // stops at 1000 rows, and leads past it would silently lose their questionnaire hole).
  const questLeadIds = useMemo(() => Array.from(new Set(events.map((e) => e.sourceLeadId).filter(Boolean))).sort(), [events]);
  const questLeadsQ = useQuery({
    queryKey: ["dashQuestionnaireLeads", questLeadIds.join()],
    enabled: questLeadIds.length > 0,
    queryFn: async () => {
      const out = [];
      for (let i = 0; i < questLeadIds.length; i += 100) {
        const chunk = questLeadIds.slice(i, i + 100);
        out.push(...(await base44.entities.Lead.filter({ id: { $in: chunk } }, undefined, undefined, "id, production_form_filled_at")));
      }
      return out;
    },
    staleTime: 120000,
  });
  const gapsMap = useMemo(() => {
    const filled = questLeadsQ.data ? new Map(questLeadsQ.data.map((l) => [l.id, !!(l.productionFormFilledAt || l.production_form_filled_at)])) : null;
    return yearGaps(events, {
      today: israelToday(),
      year: selectedYear,
      questionnaireFilledFor: (e) => (filled && e.sourceLeadId ? filled.get(e.sourceLeadId) ?? null : null),
    });
  }, [events, selectedYear, questLeadsQ.data]);
  const gapCounts = useMemo(() => {
    const c = {};
    for (const keys of Object.values(gapsMap)) for (const k of keys) c[k] = (c[k] || 0) + 1;
    return c;
  }, [gapsMap]);

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
      } else if (timeFilter === "gaps") {
        const g = gapsMap[event.id];
        return !!g && (!gapFilter || g.includes(gapFilter));
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
  }, [events, searchTerm, selectedYear, timeFilter, gapsMap, gapFilter]);

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
            className="pl-10 rounded-lg bg-[#0B1529] border-[#2A3B57] text-white placeholder:text-slate-500 focus:border-sky-500 focus:ring-sky-500/20"
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
            className={timeFilter === "all" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 text-xs font-semibold shadow-[0_6px_18px_-8px_rgba(250,204,21,0.8)]" : "rounded-lg border-[#2A3B57] bg-[#0B1529] text-slate-300 hover:bg-white/[0.06] hover:text-white text-xs"}
          >
            הכל ({filterCounts.all})
          </Button>
          <Button
            variant={timeFilter === "thisWeek" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("thisWeek")}
            className={timeFilter === "thisWeek" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 text-xs font-semibold shadow-[0_6px_18px_-8px_rgba(250,204,21,0.8)]" : "rounded-lg border-[#2A3B57] bg-[#0B1529] text-slate-300 hover:bg-white/[0.06] hover:text-white text-xs"}
          >
            השבוע ({filterCounts.thisWeek})
          </Button>
          <Button
            variant={timeFilter === "thisMonth" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("thisMonth")}
            className={timeFilter === "thisMonth" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 text-xs font-semibold shadow-[0_6px_18px_-8px_rgba(250,204,21,0.8)]" : "rounded-lg border-[#2A3B57] bg-[#0B1529] text-slate-300 hover:bg-white/[0.06] hover:text-white text-xs"}
          >
            החודש ({filterCounts.thisMonth})
          </Button>
          <Button
            variant={timeFilter === "nextMonth" ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeFilter("nextMonth")}
            className={timeFilter === "nextMonth" ? "rounded-lg bg-[#FACC15] text-gray-900 hover:bg-yellow-300 text-xs font-semibold shadow-[0_6px_18px_-8px_rgba(250,204,21,0.8)]" : "rounded-lg border-[#2A3B57] bg-[#0B1529] text-slate-300 hover:bg-white/[0.06] hover:text-white text-xs"}
          >
            החודש הבא ({filterCounts.nextMonth})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setTimeFilter("gaps"); setGapFilter(null); }}
            title="אירועי השנה שיש בהם משהו פתוח: צוות, יומן, התקדמות, תשלום, שאלון"
            className={timeFilter === "gaps" ? "rounded-lg border-red-400/80 bg-red-500/20 text-red-200 hover:bg-red-500/30 text-xs font-semibold" : "rounded-lg border-red-500/40 bg-[#0B1529] text-red-300 hover:bg-red-500/10 hover:text-red-200 text-xs"}
          >
            ⚠ חורים השנה ({Object.keys(gapsMap).length})
          </Button>
        </div>
        {timeFilter === "gaps" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">סינון:</span>
            {GAP_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setGapFilter((f) => (f === t.key ? null : t.key))}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-opacity ${GAP_TONE[t.tone]} ${gapFilter && gapFilter !== t.key ? "opacity-40" : ""} ${gapFilter === t.key ? "ring-1 ring-white/50" : ""}`}
              >
                {t.label} · {gapCounts[t.key] || 0}
              </button>
            ))}
            {gapFilter && (
              <button type="button" onClick={() => setGapFilter(null)} className="text-xs text-slate-400 hover:text-white">הצג הכל</button>
            )}
          </div>
        )}
      </div>
      {searchTerm && (
        <p className="text-sm text-gray-400 mt-2">
          נמצאו {filteredEvents.length} תוצאות עבור "{searchTerm}"
        </p>
      )}
    </div>
  );

  return (
    <div className="e-page min-h-screen p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white mb-1">
              לוח בקרה
            </h1>
            <p className="text-gray-400 text-sm md:text-base">
              מה קורה היום, ומה מחכה לך
            </p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2 flex-1 md:flex-none">
              <CalendarDays className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <YearPicker value={selectedYear} onChange={setSelectedYear} dates={events.map((e) => e.date)} triggerClassName="w-full sm:w-36 rounded-lg bg-[#0B1529] border-[#2A3B57] text-white" />
            </div>
          </div>
        </div>

        {/* Search bar, mobile-only, moved above the KPI cards so it's reachable
            without scrolling — see searchAndFilterBar above. */}
        <div className="md:hidden">{searchAndFilterBar}</div>

        {/* Dashboard, 2026-10-07 (the owner's layout): today first — today's events with
            every detail he needs on the day, and all the money in one tile. Then the four
            "what do I do today" tiles, then the state of the work. "צריך טיפול" left: the
            WhatsApp and follow-up tiles now say the same thing, each with its own door. */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 md:gap-5 mb-5">
          <div className="lg:col-span-2 min-h-[240px] lg:h-full"><TodayEventsCard events={events} /></div>
          <FinanceCard stats={stats} year={selectedYear} pendingCollection={pendingCollection} events={events} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 sm:[&>*]:h-[245px] gap-3 sm:gap-4 md:gap-5 mb-5">
          <MeetingsTodayCard />
          <WhatsAppPulseCard />
          <FollowUpCard />
          <PostSignCard />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 sm:[&>*]:h-[305px] gap-3 sm:gap-4 md:gap-5 mb-6">
          <DashboardMissingTeamCard events={events} staffMembers={staffMembers} onChanged={() => loadEvents({ silent: true })} />
          <DashboardWorkStatusCard events={events} onRefresh={loadEvents} />
          <DashboardUnpaidCard events={events} onRefresh={loadEvents} />
          <RecentLeadsCard />
        </div>

        {/* Search Bar and Filters — desktop position (mobile renders this above
            the KPI cards instead, see searchAndFilterBar above). */}
        <div className="hidden md:block">{searchAndFilterBar}</div>

        {/* Events Table */}
        <EventsTable events={filteredEvents} isLoading={isLoading} onRefresh={loadEvents} gaps={timeFilter === "gaps" ? gapsMap : null} />
      </div>
    </div>
  );
}