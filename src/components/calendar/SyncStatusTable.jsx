import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Search,
  Users,
  ArrowUpDown,
  Filter,
} from "lucide-react";

const FILTER_OPTIONS = [
  { key: "all", label: "הכל" },
  { key: "synced", label: "מסונכרן" },
  { key: "pending", label: "ממתין" },
  { key: "teamComplete", label: "צוות מלא" },
  { key: "teamMissing", label: "חסר צוות" },
];

export default function SyncStatusTable({ events, leads, syncing, loading, onSync }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState(-1);

  // Build lead lookup
  const leadMap = {};
  (leads || []).forEach((l) => { leadMap[l.id] = l; });

  // Enhance events with computed fields
  const enhanced = events.map((e) => {
    const hasCal = e.googleCalendarEventId && !e.googleCalendarEventId.startsWith("creating_");
    const isLocked = e.googleCalendarEventId?.startsWith("creating_");
    const nonEditor = (e.team || []).filter((m) => m.role !== "editor" && m.staffMemberName);
    const required = e.requiredCrew || 3;
    const teamFull = nonEditor.length >= required;
    const lead = leadMap[e.leadId] || leadMap[e.source_lead_id] || null;
    const hasQuestionnaire = lead?.productionFormFilledAt;

    return {
      ...e,
      hasCal,
      isLocked,
      nonEditorCount: nonEditor.length,
      required,
      teamFull,
      lead,
      hasQuestionnaire,
    };
  });

  // Filter
  const filtered = enhanced.filter((e) => {
    if (search) {
      const s = search.toLowerCase();
      if (
        !e.coupleNames?.toLowerCase().includes(s) &&
        !e.venue?.toLowerCase().includes(s) &&
        !e.phoneNumber?.includes(s) &&
        !String(e.studio_id || "").includes(s)
      ) return false;
    }
    switch (filter) {
      case "synced": return e.hasCal;
      case "pending": return !e.hasCal && !e.isLocked;
      case "teamComplete": return e.teamFull;
      case "teamMissing": return !e.teamFull;
      default: return true;
    }
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortField === "date") {
      return sortDir * (new Date(b.date) - new Date(a.date));
    }
    if (sortField === "coupleNames") {
      return sortDir * (a.coupleNames || "").localeCompare(b.coupleNames || "");
    }
    if (sortField === "syncStatus") {
      const valA = a.hasCal ? 2 : a.isLocked ? 1 : 0;
      const valB = b.hasCal ? 2 : b.isLocked ? 1 : 0;
      return sortDir * (valA - valB);
    }
    return 0;
  });

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(-sortDir);
    else { setSortField(field); setSortDir(-1); }
  };

  const SortHeader = ({ field, children }) => (
    <TableHead
      className="cursor-pointer select-none text-right text-gray-400 hover:text-white"
      onClick={() => toggleSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className="w-3 h-3" />
      </div>
    </TableHead>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-gray-800">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-2.5 w-4 h-4 text-gray-500" />
          <Input
            placeholder="חיפוש לפי שם זוג, אולם, טלפון..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
          />
        </div>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map((opt) => (
            <Button
              key={opt.key}
              variant={filter === opt.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(opt.key)}
              className={
                filter === opt.key
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "border-gray-700 text-gray-400 hover:text-white hover:bg-gray-800"
              }
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <Badge className="bg-gray-800 text-gray-300 border-gray-700">
          {filtered.length} / {events.length}
        </Badge>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-gray-800 hover:bg-gray-900">
              <TableHead className="text-right text-gray-400 w-16">#</TableHead>
              <SortHeader field="coupleNames">שמות הזוג</SortHeader>
              <SortHeader field="date">תאריך</SortHeader>
              <TableHead className="text-right text-gray-400">אולם</TableHead>
              <TableHead className="text-right text-gray-400">צוות</TableHead>
              <TableHead className="text-right text-gray-400">שאלון</TableHead>
              <SortHeader field="syncStatus">סטטוס יומן</SortHeader>
              <TableHead className="text-right text-gray-400">צבע ביומן</TableHead>
              <TableHead className="text-right text-gray-400">פעולות</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-gray-500">
                  <Filter className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                  לא נמצאו אירועים
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((e) => (
                <SyncRow
                  key={e.id}
                  event={e}
                  syncing={syncing}
                  onSync={onSync}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SyncRow({ event, syncing, onSync }) {
  const e = event;
  const isSyncing = syncing === e.id || syncing === "missing";

  return (
    <TableRow className="border-gray-800 hover:bg-gray-800/50 transition-colors">
      <TableCell className="text-gray-500 font-mono text-sm">
        {e.studio_id || "—"}
      </TableCell>
      <TableCell className="font-medium text-white">
        {e.coupleNames || "—"}
      </TableCell>
      <TableCell className="text-gray-300">
        {e.date ? new Date(e.date).toLocaleDateString("he-IL") : "—"}
      </TableCell>
      <TableCell className="text-gray-400 text-sm">
        {e.venue || "—"}
      </TableCell>
      {/* Team */}
      <TableCell>
        <div className="flex items-center gap-2">
          <Users className={`w-4 h-4 ${e.teamFull ? "text-teal-400" : "text-yellow-400"}`} />
          <span className={`text-sm font-medium ${e.teamFull ? "text-teal-400" : "text-yellow-400"}`}>
            {e.nonEditorCount}/{e.required}
          </span>
          {e.teamFull && (
            <Badge className="bg-teal-500/10 text-teal-400 border-teal-500/30 text-xs">מלא</Badge>
          )}
        </div>
      </TableCell>
      {/* Questionnaire */}
      <TableCell>
        {e.hasQuestionnaire ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
            <CheckCircle2 className="w-3 h-3 ml-1" />
            מולא
          </Badge>
        ) : (
          <Badge className="bg-gray-700/50 text-gray-500 border-gray-600 text-xs">
            ממתין
          </Badge>
        )}
      </TableCell>
      {/* Calendar sync status */}
      <TableCell>
        {e.hasCal ? (
          <Badge className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">
            <CheckCircle2 className="w-3 h-3 ml-1" />
            מסונכרן
          </Badge>
        ) : e.isLocked ? (
          <Badge className="bg-yellow-500/10 text-yellow-400 border-yellow-500/30 text-xs">
            <Clock className="w-3 h-3 ml-1 animate-spin" />
            ביצירה...
          </Badge>
        ) : (
          <Badge className="bg-red-500/10 text-red-400 border-red-500/30 text-xs">
            <AlertCircle className="w-3 h-3 ml-1" />
            לא מסונכרן
          </Badge>
        )}
      </TableCell>
      {/* Calendar color */}
      <TableCell>
        {e.hasCal ? (
          <div className="flex items-center gap-2">
            <div className={`w-5 h-5 rounded-full ${e.teamFull ? "bg-teal-400" : "bg-yellow-400"}`} />
            <span className={`text-xs ${e.teamFull ? "text-teal-400" : "text-yellow-400"}`}>
              {e.teamFull ? "טורקיז" : "בננה"}
            </span>
          </div>
        ) : (
          <span className="text-gray-600">—</span>
        )}
      </TableCell>
      {/* Actions */}
      <TableCell>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSync(e.id)}
            disabled={isSyncing}
            className="border-gray-700 text-gray-300 hover:bg-blue-600 hover:text-white hover:border-blue-600 text-xs"
          >
            <RefreshCw className={`w-3 h-3 ml-1 ${isSyncing ? "animate-spin" : ""}`} />
            {e.hasCal ? "עדכון" : "סנכרן"}
          </Button>
          {e.hasCal && e.googleCalendarEventId && (
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-gray-400 hover:text-blue-400"
            >
              <a
                href={`https://calendar.google.com/calendar/event?eid=${btoa(e.googleCalendarEventId)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}