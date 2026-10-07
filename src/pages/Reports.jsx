import React, { useState, useEffect } from "react";
import { Event } from "@/entities/Event";
import { base44 } from "@/api/base44Client";
import { calculateNetProfit } from "../lib/profitCalculations";
import { getEventVatAmount, getEventTeamCost } from "../lib/financialCalculations";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, TrendingUp, Calendar, BarChart3 } from "lucide-react";

import ReportsChart from "../components/reports/ReportsChart";
import MonthlyChart from "../components/reports/MonthlyChart";
import ReportsTable from "../components/reports/ReportsTable";

const MONTHS = [
  { value: 0, label: "ינואר" },
  { value: 1, label: "פברואר" },
  { value: 2, label: "מרץ" },
  { value: 3, label: "אפריל" },
  { value: 4, label: "מאי" },
  { value: 5, label: "יוני" },
  { value: 6, label: "יולי" },
  { value: 7, label: "אוגוסט" },
  { value: 8, label: "ספטמבר" },
  { value: 9, label: "אוקטובר" },
  { value: 10, label: "נובמבר" },
  { value: 11, label: "דצמבר" }
];

export default function Reports() {
  const [events, setEvents] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("monthly");
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

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

  const filterEventsByPeriod = (period) => {
    const today = new Date();
    
    switch (period) {
      case 'daily':
        return events.filter(event => {
          const eventDate = new Date(event.date);
          return eventDate.toDateString() === today.toDateString();
        });
      case 'monthly':
        return events.filter(event => {
          const eventDate = new Date(event.date);
          return eventDate.getMonth() === selectedMonth && 
                 eventDate.getFullYear() === selectedYear;
        });
      case 'annual':
        return events.filter(event => {
          const eventDate = new Date(event.date);
          return eventDate.getFullYear() === selectedYear;
        });
      default:
        return events;
    }
  };

  const exportToCSV = (period) => {
    const filteredEvents = filterEventsByPeriod(period);
    const csvData = filteredEvents.map(event => ({
      'Date': event.date,
      'Couple': event.coupleNames,
      'Gross Amount': event.totalAmountGross,
      'VAT': getEventVatAmount(event),
      'Expenses': getEventTeamCost(event),
      'Net Profit': calculateNetProfit(event, staffMembers),
      'Payment Status': event.clientPaymentStatus
    }));

    const headers = Object.keys(csvData[0] || {});
    const csvContent = [
      headers.join(','),
      ...csvData.map(row => headers.map(header => `"${row[header]}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `avira-reports-${period}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabs = [
    { id: 'daily', label: 'יומי', icon: Calendar },
    { id: 'monthly', label: 'חודשי', icon: TrendingUp },
    { id: 'annual', label: 'שנתי', icon: BarChart3 }
  ];

  return (
    <div className="e-page min-h-screen bg-gray-950 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#FACC15]/55 bg-[#FACC15]/10 text-[#FDE047] shadow-[0_0_26px_-6px_rgba(250,204,21,0.8)]">
              <BarChart3 className="h-7 w-7" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-1 bg-gradient-to-l from-[#FDE68A] via-[#FACC15] to-[#F59E0B] bg-clip-text text-transparent">דוחות פיננסיים</h1>
              <p className="text-slate-400">ניתוח ביצועי העסק שלך</p>
            </div>
          </div>
          <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
            <SelectTrigger className="w-40 h-11 rounded-xl bg-[#0B1529] border-[#2A3B57] text-white">
              <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
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

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 h-11 rounded-xl bg-[#0B1529] border border-[#2A3B57] p-1">
            {tabs.map((tab) => (
              <TabsTrigger 
                key={tab.id}
                value={tab.id} 
                className="rounded-lg data-[state=active]:bg-gradient-to-b data-[state=active]:from-[#FFD84A] data-[state=active]:to-[#F5B800] data-[state=active]:text-gray-900 data-[state=active]:font-bold data-[state=active]:shadow-[0_0_18px_-4px_rgba(250,204,21,0.8)] text-slate-300 flex items-center gap-2"
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Monthly Tab */}
          <TabsContent value="monthly" className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-white">דוח חודשי</h2>
                <Select value={selectedMonth.toString()} onValueChange={(value) => setSelectedMonth(parseInt(value))}>
                  <SelectTrigger className="w-40 h-10 rounded-xl bg-[#0B1529] border-[#2A3B57] text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-900 border-gray-700 text-white">
                    {MONTHS.map((month) => (
                      <SelectItem key={month.value} value={month.value.toString()}>
                        {month.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={() => exportToCSV('monthly')}
                variant="outline"
                className="h-10 rounded-xl border-[#3B5BA0]/70 bg-[#0B1529] text-slate-100 hover:bg-white/[0.06] shadow-[0_0_16px_-8px_rgba(96,130,240,0.8)]"
                disabled={filterEventsByPeriod('monthly').length === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                ייצא CSV
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ReportsChart 
                events={filterEventsByPeriod('monthly')} 
                period="monthly"
                isLoading={isLoading}
                staffMembers={staffMembers}
              />
              <ReportsTable 
                events={filterEventsByPeriod('monthly')} 
                period="monthly"
                isLoading={isLoading}
                staffMembers={staffMembers}
                periodLabel={`${MONTHS[selectedMonth].label} ${selectedYear}`}
              />
            </div>

            {/* Monthly Overview Chart */}
            <MonthlyChart events={events} isLoading={isLoading} staffMembers={staffMembers} year={selectedYear} />
          </TabsContent>

          {/* Daily Tab */}
          <TabsContent value="daily" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-white">דוח יומי</h2>
              <Button
                onClick={() => exportToCSV('daily')}
                variant="outline"
                className="h-10 rounded-xl border-[#3B5BA0]/70 bg-[#0B1529] text-slate-100 hover:bg-white/[0.06] shadow-[0_0_16px_-8px_rgba(96,130,240,0.8)]"
                disabled={filterEventsByPeriod('daily').length === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                ייצא CSV
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ReportsChart 
                events={filterEventsByPeriod('daily')} 
                period="daily"
                isLoading={isLoading}
                staffMembers={staffMembers}
              />
              <ReportsTable 
                events={filterEventsByPeriod('daily')} 
                period="daily"
                isLoading={isLoading}
                staffMembers={staffMembers}
                periodLabel={new Date().toLocaleDateString("he-IL")}
              />
            </div>
          </TabsContent>

          {/* Annual Tab */}
          <TabsContent value="annual" className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold text-white">דוח שנתי</h2>
              <Button
                onClick={() => exportToCSV('annual')}
                variant="outline"
                className="h-10 rounded-xl border-[#3B5BA0]/70 bg-[#0B1529] text-slate-100 hover:bg-white/[0.06] shadow-[0_0_16px_-8px_rgba(96,130,240,0.8)]"
                disabled={filterEventsByPeriod('annual').length === 0}
              >
                <Download className="w-4 h-4 mr-2" />
                ייצא CSV
              </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ReportsChart 
                events={filterEventsByPeriod('annual')} 
                period="annual"
                isLoading={isLoading}
                staffMembers={staffMembers}
              />
              <ReportsTable 
                events={filterEventsByPeriod('annual')} 
                period="annual"
                isLoading={isLoading}
                staffMembers={staffMembers}
                periodLabel={String(selectedYear)}
              />
            </div>

            {/* Monthly Overview Chart for Annual View */}
            <MonthlyChart events={events} isLoading={isLoading} staffMembers={staffMembers} year={selectedYear} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}