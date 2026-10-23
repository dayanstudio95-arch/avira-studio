import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users } from "lucide-react";
import { format } from "date-fns";
import UnifiedSidePanel from "@/components/unified/UnifiedSidePanel";
import DashTitleLink from "./DashTitleLink";
import ShowMoreButton from "./ShowMoreButton";

const statusColors = {
  "חדש": "e-chip-blue",
  "נשלחה הצעה": "e-chip-pink",
  "פולו-אפ": "e-chip-orange",
  "נסגר/חתימה": "e-chip-green",
  "חוזה": "e-chip-yellow",
  "לא רלוונטי": "e-chip-gray",
};

// The phone (`compact`, 2026-10-24, the owner's request): a status filter like the one in
// "לא משולם", three leads, and "הצג עוד" for ten more at a time.
const STATUS_FILTERS = ["חדש", "נשלחה הצעה", "פולו-אפ", "חוזה", "נסגר/חתימה", "לא רלוונטי"];

export default function RecentLeadsCard({ compact = false }) {
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [shown, setShown] = useState(compact ? 3 : 5);

  useEffect(() => {
    // Best-effort 48h auto-follow-up sync (see sync-lead-followups edge function) so
    // the dashboard's status badges stay accurate too, not just the Leads page.
    base44.functions.invoke('syncLeadFollowups', {}).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    // One row more than shown tells whether "הצג עוד" has anything to add.
    const load = statusFilter === "all"
      ? base44.entities.Lead.list("-created_date", shown + 1)
      : base44.entities.Lead.filter({ status: statusFilter }, "-created_date", shown + 1);
    load.then((rows) => { if (!cancelled) setLeads(rows); }).catch(() => {});
    return () => { cancelled = true; };
  }, [statusFilter, shown]);

  const pickStatus = (key) => {
    setStatusFilter(key);
    setShown(compact ? 3 : 5);
  };

  return (
    <>
      <Card className="dash-card h-full flex flex-col overflow-hidden">
        <CardHeader className="dash-head pb-3">
          <CardTitle className="text-white flex items-center gap-2 text-base font-semibold"><DashTitleLink to="/Leads">
            <Users className="w-5 h-5 text-sky-400" />
            לידים אחרונים
          </DashTitleLink></CardTitle>
        </CardHeader>
        <CardContent className="e-scroll px-3 py-1 min-h-0 flex-1 overflow-y-auto">
          {compact && (
            <div className="mb-1 flex flex-wrap gap-1 px-1 pt-1">
              {[{ key: "all", label: "הכל" }, ...STATUS_FILTERS.map((s) => ({ key: s, label: s }))].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => pickStatus(f.key)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] ${statusFilter === f.key ? "border-amber-400 bg-amber-400/15 text-amber-200" : "border-slate-700 text-slate-400 hover:text-white"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          {leads.length === 0 ? (
            <div className="py-8 text-center text-gray-500 text-sm">{statusFilter === "all" ? "אין לידים" : "אין לידים בסטטוס הזה"}</div>
          ) : (
            <div>
              {leads.slice(0, shown).map(lead => (
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
              {compact && (
                <ShowMoreButton total={leads.length} limit={shown} expanded={false} onToggle={() => setShown((n) => n + 10)} label="הצג עוד" />
              )}
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
