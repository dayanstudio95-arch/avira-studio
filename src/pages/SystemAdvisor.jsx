import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import SystemHeader from "@/components/systemAdvisor/SystemHeader";
import HealthScoreCard from "@/components/systemAdvisor/HealthScoreCard";
import DailyTipCard from "@/components/systemAdvisor/DailyTipCard";
import PriorityQueueCard from "@/components/systemAdvisor/PriorityQueueCard";
import NowTab from "@/components/systemAdvisor/NowTab";
import AutomationsStatusCard from "@/components/systemAdvisor/AutomationsStatusCard";
import DataAnomaliesCard from "@/components/systemAdvisor/DataAnomaliesCard";
import OpenDebtsCard from "@/components/systemAdvisor/OpenDebtsCard";
import MissingCrewCard from "@/components/systemAdvisor/MissingCrewCard";
import AskSystemPanelV2 from "@/components/systemAdvisor/AskSystemPanelV2";
import ActionsTab from "@/components/systemAdvisor/ActionsTab";
import { calcHealthScore, getDailyTip, getPriorityItems } from "@/components/systemAdvisor/healthScore";

// ─── READ ONLY PAGE ───────────────────────────────────────────────────────────
// דף זה קורא נתונים בלבד. אין update / create / delete / invoke בכל הדף.
// ─────────────────────────────────────────────────────────────────────────────

export default function SystemAdvisor() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [leads, setLeads] = useState([]);
  const [automations, setAutomations] = useState([]);
  const [automationRuns, setAutomationRuns] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [messageLogs, setMessageLogs] = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);

  const loadData = async () => {
    setLoading(true);
    const [evts, lds, autos, runs, staff, logs] = await Promise.all([
      base44.entities.Event.list("-date", 200),
      base44.entities.Lead.list("-created_date", 200),
      base44.entities.Automation.list(),
      base44.entities.AutomationRun.list("-started_at", 30),
      base44.entities.StaffMember.list(),
      base44.entities.AutomationMessageLog.filter({ status: "sent", channel: "whatsapp" }, "-sent_at", 500),
    ]);
    setEvents(evts || []);
    setLeads(lds || []);
    setAutomations(autos || []);
    setAutomationRuns(runs || []);
    setStaffMembers(staff || []);
    setMessageLogs(logs || []);
    setLastRefresh(new Date());
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  // ── Derived data ────────────────────────────────────────────────────────────
  const { score, penalties } = calcHealthScore({ events, automations, automationRuns, leads, staffMembers });
  const dailyTip = getDailyTip({ events, automations, automationRuns, leads });
  const priorityItems = getPriorityItems({ events, automations, automationRuns, leads });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeAutomations = automations.filter(a => a.isActive).length;

  const openIssues = [
    // missing crew upcoming
    events.filter(e => {
      const d = new Date(e.date);
      const sevenAhead = new Date(today.getTime() + 7 * 86400000);
      if (d < today || d > sevenAhead) return false;
      const required = e.requiredCrew || 3;
      const assigned = (e.team || []).filter(m => m.staffMemberName).length;
      return assigned < required;
    }).length,
    // failed runs last 3 days
    automationRuns.filter(r => {
      const threeDaysAgo = new Date(today.getTime() - 3 * 86400000).toISOString();
      return r.status === "error" && r.startedAt > threeDaysAgo;
    }).length,
    // open debts
    events.filter(e => new Date(e.date) < today && e.clientPaymentStatus !== "Paid").length,
  ].reduce((a, b) => a + b, 0);

  const totalDebt = events
    .filter(e => new Date(e.date) < today && e.clientPaymentStatus !== "Paid")
    .reduce((s, e) => s + (e.totalAmountGross || 0), 0);

  return (
    <div className="min-h-screen bg-gray-950 p-5" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────────── */}
        <SystemHeader
          score={score}
          openIssues={openIssues}
          activeAutomations={activeAutomations}
          totalAutomations={automations.length}
          inactiveAutomations={automations.length - activeAutomations}
          totalDebt={totalDebt}
          unpaidCount={events.filter(e => new Date(e.date) < today && e.clientPaymentStatus !== "Paid").length}
          lastRefresh={lastRefresh}
          loading={loading}
          onRefresh={loadData}
        />

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-4 border-gray-700 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ── Priority Queue ────────────────────────────────────────────── */}
            <PriorityQueueCard items={priorityItems} />

            {/* ── Health + Daily Tip ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <HealthScoreCard score={score} penalties={penalties} />
              <DailyTipCard tip={dailyTip} />
            </div>

            {/* ── Tabs ──────────────────────────────────────────────────────── */}
            <Tabs defaultValue="now" dir="rtl">
              <TabsList className="bg-gray-900 border border-gray-800 w-full">
                <TabsTrigger value="now" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400">
                  📅 עכשיו
                </TabsTrigger>
                <TabsTrigger value="ops" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400">
                  ⚙️ תפעול
                </TabsTrigger>
                <TabsTrigger value="finance" data-tab-trigger="business" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400">
                  💼 פיננסים
                </TabsTrigger>
                <TabsTrigger value="actions" className="flex-1 data-[state=active]:bg-blue-600 data-[state=active]:text-white text-gray-400">
                  ⚡ פעולות
                </TabsTrigger>
              </TabsList>

              {/* Tab: Now */}
              <TabsContent value="now" className="mt-4">
                <NowTab events={events} />
              </TabsContent>

              {/* Tab: Ops */}
              <TabsContent value="ops" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <AutomationsStatusCard automations={automations} runs={automationRuns} />
                  <DataAnomaliesCard events={events} leads={leads} staffMembers={staffMembers} messageLogs={messageLogs} />
                </div>
              </TabsContent>

              {/* Tab: Finance */}
              <TabsContent value="finance" className="mt-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <OpenDebtsCard events={events} />
                  <MissingCrewCard events={events} />
                </div>
              </TabsContent>

              {/* Tab: Actions (V4.0) */}
              <TabsContent value="actions" className="mt-4">
                <ActionsTab
                  events={events}
                  leads={leads}
                  automationRuns={automationRuns}
                  staffMembers={staffMembers}
                />
              </TabsContent>
            </Tabs>

            {/* ── Ask AI ────────────────────────────────────────────────────── */}
            <AskSystemPanelV2 />
          </>
        )}
      </div>
    </div>
  );
}