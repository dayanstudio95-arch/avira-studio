import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { format } from "date-fns";
import UnifiedSidePanel from "@/components/unified/UnifiedSidePanel";

const statusColors = {
  "חדש": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "נשלחה הצעה": "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  "פולו-אפ": "bg-orange-500/20 text-orange-400 border-orange-500/30",
  "נסגר/חתימה": "bg-green-500/20 text-green-400 border-green-500/30",
  "לא רלוונטי": "bg-gray-500/20 text-gray-400 border-gray-500/30",
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
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardHeader className="border-b border-gray-800 pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base">
            <Users className="w-4 h-4 text-blue-400" />
            לידים אחרונים
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {leads.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">אין לידים</div>
          ) : (
            <div className="divide-y divide-gray-800/60">
              {leads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => { setSelectedLead(lead); setPanelOpen(true); }}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/40 transition-colors text-right"
                >
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="text-white text-sm font-medium truncate">{lead.coupleNames}</span>
                    <span className="text-gray-500 text-xs">
                      {lead.created_date ? format(new Date(lead.created_date), "d/M/yyyy") : "—"}
                    </span>
                  </div>
                  <Badge variant="outline" className={`${statusColors[lead.status] || statusColors["חדש"]} border text-xs flex-shrink-0 ml-2`}>
                    {lead.status || "חדש"}
                  </Badge>
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