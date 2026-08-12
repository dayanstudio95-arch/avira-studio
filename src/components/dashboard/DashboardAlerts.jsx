import React, { useState, useEffect } from "react";
import { AlertTriangle, Users, CreditCard, Clock, Bell } from "lucide-react";
import { format, addDays } from "date-fns";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import UnifiedSidePanel from "@/components/unified/UnifiedSidePanel";

const colorMap = {
  error: "border-red-500/40 bg-red-900/20 text-red-400 hover:bg-red-900/40",
  warning: "border-yellow-500/40 bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40",
  info: "border-blue-500/40 bg-blue-900/20 text-blue-400 hover:bg-blue-900/40",
};

export default function DashboardAlerts({ events }) {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [leads, setLeads] = useState([]);

  useEffect(() => {
    base44.entities.Lead.list().then(setLeads).catch(() => {});
  }, []);

  const now = new Date();
  const nextWeek = addDays(now, 7);

  const thisWeekEvents = events.filter(e => {
    const d = new Date(e.date);
    return d >= now && d <= nextWeek;
  });

  const noTeamAlerts = thisWeekEvents.filter(e => !e.team || e.team.length === 0).map(e => ({
    type: "error", icon: Users,
    message: `${e.coupleNames} (${format(new Date(e.date), "d/M")}) — אין צוות`,
    event: e,
  }));

  const balanceAlerts = events.filter(e => {
    const d = new Date(e.date);
    return d >= now && e.clientPaymentStatus !== "Paid";
  }).map(e => ({
    type: "warning", icon: CreditCard,
    message: `${e.coupleNames} (${format(new Date(e.date), "d/M")}) — יתרה לתשלום`,
    event: e,
  }));

  const pendingProgressAlerts = thisWeekEvents.filter(e => {
    const team = e.team || [];
    if (team.length === 0) return false;
    return team.every(m => m.progressStatus !== "sent");
  }).map(e => ({
    type: "info", icon: Clock,
    message: `${e.coupleNames} (${format(new Date(e.date), "d/M")}) — סטטוס ממתין`,
    event: e,
  }));

  const alerts = [...noTeamAlerts, ...balanceAlerts, ...pendingProgressAlerts];

  const handleAlertClick = (alert) => {
    const ev = alert.event;
    const lead = leads.find(l => l.id === ev.source_lead_id || l.linked_event_id === ev.id);
    setSelectedEvent(ev);
    setSelectedLead(lead || null);
    setPanelOpen(true);
  };

  return (
    <>
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm flex flex-col">
        <CardHeader className="border-b border-gray-800 pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Bell className="w-4 h-4 text-yellow-400" />
            התראות
            {alerts.length > 0 && (
              <span className="bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {alerts.length}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-y-auto" style={{ maxHeight: "260px" }}>
          {alerts.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">אין התראות פעילות ✅</div>
          ) : (
            <div className="divide-y divide-gray-800/60">
              {alerts.map((alert, idx) => {
                const Icon = alert.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => handleAlertClick(alert)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-colors ${colorMap[alert.type]}`}
                  >
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="text-xs">{alert.message}</span>
                  </button>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {panelOpen && (
        <UnifiedSidePanel
          isOpen={panelOpen}
          onClose={() => setPanelOpen(false)}
          event={selectedEvent}
          lead={selectedLead}
          staffMembers={[]}
          onEventUpdated={() => setPanelOpen(false)}
          onLeadUpdated={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}