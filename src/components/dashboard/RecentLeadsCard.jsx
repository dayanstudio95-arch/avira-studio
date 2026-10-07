import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { format } from "date-fns";
import UnifiedSidePanel from "@/components/unified/UnifiedSidePanel";

const statusColors = {
  "חדש": "e-chip-blue",
  "נשלחה הצעה": "e-chip-pink",
  "פולו-אפ": "e-chip-orange",
  "נסגר/חתימה": "e-chip-green",
  "חוזה": "e-chip-yellow",
  "לא רלוונטי": "e-chip-gray",
};

export default function RecentLeadsCard() {
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    // Best-effort 48h auto-follow-up sync (see sync-lead-followups edge function) so
    // the dashboard's status badges stay accurate too, not just the Leads page.
    base44.functions.invoke('syncLeadFollowups', {}).catch(() => {});
    base44.entities.Lead.list("-created_date", 5).then(setLeads).catch(() => {});
  }, []);

  return (
    <>
      <Card className="dash-card h-full flex flex-col overflow-hidden">
        <CardHeader className="dash-head pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
            <Users className="w-5 h-5 text-sky-400" />
            לידים אחרונים
          </CardTitle>
        </CardHeader>
        <CardContent className="e-scroll px-3 py-1 min-h-0 flex-1 overflow-y-auto">
          {leads.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">אין לידים</div>
          ) : (
            <div>
              {leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => { setSelectedLead(lead); setPanelOpen(true); }}
                  className="e-row w-full flex items-center justify-between px-2 py-3 rounded-lg hover:bg-white/[0.03] transition-colors text-right"
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-white text-sm font-medium truncate">{lead.coupleNames}</span>
                    <span className="text-slate-400 text-xs">
                      {lead.created_date ? format(new Date(lead.created_date), "d/M/yyyy") : "—"}
                    </span>
                  </div>
                  <span className={`e-chip ${statusColors[lead.status] || statusColors["חדש"]} flex-shrink-0 ml-1`}>
                    {lead.status || "חדש"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {panelOpen && (
        <UnifiedSidePanel
          isOpen={panelOpen}
          onClose={() => setPanelOpen(false)}
          lead={selectedLead}
          event={null}
          staffMembers={[]}
          onLeadUpdated={() => setPanelOpen(false)}
          onEventUpdated={() => setPanelOpen(false)}
        />
      )}
    </>
  );
}