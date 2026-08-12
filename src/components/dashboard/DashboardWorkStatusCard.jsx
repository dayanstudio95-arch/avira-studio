import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Clapperboard, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { base44 } from "@/api/base44Client";

// same fields as ProgressStatus
const ROLE_DONE_FIELDS = {
  photographer1: "photographer1_done",
  photographer2: "photographer2_done",
  videographer: "video1_done",
  videographer2: "video1_done",
  editor: "editor_done",
};

const FIELD_LABELS = {
  photographer1_done: "צלם 1",
  photographer2_done: "צלם 2",
  video1_done: "וידאו",
  editor_done: "עריכה",
  raw_done_manual: "גלם",
  final_done_manual: "סופי",
};

export function getProgress(event) {
  const team = event.team || [];
  const items = [];
  team.forEach((m) => {
    const field = ROLE_DONE_FIELDS[m?.role];
    if (field) items.push(!!event[field]);
  });
  items.push(!!(event.raw_link || event.raw_done_manual));
  items.push(!!(event.final_link || event.final_done_manual));

  const total = items.length;
  if (total === 0) return { label: "ממתין", pct: 0, color: "bg-red-500/20 text-red-400 border-red-500/30" };
  const completed = items.filter(Boolean).length;
  const pct = Math.round((completed / total) * 100);

  if (pct === 100) return { label: `הושלם (${pct}%)`, pct, color: "bg-green-500/20 text-green-400 border-green-500/30" };
  if (pct > 0) return { label: `בתהליך (${pct}%)`, pct, color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" };
  return { label: "ממתין", pct: 0, color: "bg-red-500/20 text-red-400 border-red-500/30" };
}

function getRelevantFields(event) {
  const fields = [];
  const seenFields = new Set();
  (event.team || []).forEach((m) => {
    const field = ROLE_DONE_FIELDS[m?.role];
    if (field && !seenFields.has(field)) {
      seenFields.add(field);
      fields.push(field);
    }
  });
  fields.push("raw_done_manual");
  fields.push("final_done_manual");
  return fields;
}

function EventWorkRow({ event, onUpdated }) {
  const [expanded, setExpanded] = useState(false);
  const [localEvent, setLocalEvent] = useState(event);
  const [saving, setSaving] = useState(null);

  const progress = getProgress(localEvent);
  const relevantFields = getRelevantFields(localEvent);

  async function toggleField(field) {
    const newVal = !localEvent[field];
    setSaving(field);
    const updated = { ...localEvent, [field]: newVal };
    setLocalEvent(updated);
    await base44.entities.Event.update(localEvent.id, { [field]: newVal });
    setSaving(null);
    onUpdated();
  }

  return (
    <div className="border-b border-gray-800/60 last:border-0">
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-800/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{localEvent.coupleNames}</p>
          <p className="text-xs text-gray-400">{format(new Date(localEvent.date), "d/M/yyyy")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className={`${progress.color} border text-xs whitespace-nowrap`}>
            {progress.label}
          </Badge>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 flex flex-wrap gap-2">
          {relevantFields.map((field) => {
            const isDone = !!(localEvent[field]);
            const isSaving = saving === field;
            return (
              <button
                key={field}
                onClick={() => toggleField(field)}
                disabled={isSaving}
                className={`text-xs px-2 py-1 rounded-md border transition-colors font-medium disabled:opacity-50 ${
                  isDone
                    ? "bg-green-500/20 text-green-400 border-green-500/40 hover:bg-green-500/30"
                    : "bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700"
                }`}
              >
                {isSaving ? "..." : (isDone ? "✓ " : "")}
                {FIELD_LABELS[field] || field}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DashboardWorkStatusCard({ events, onRefresh }) {
  const now = new Date();

  const incompleteEvents = events.filter((e) => {
    if (new Date(e.date) >= now) return false;
    const { pct } = getProgress(e);
    return pct < 100;
  });

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm flex flex-col h-full">
      <CardHeader className="border-b border-gray-800 pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-sm font-semibold">
          <Clapperboard className="w-4 h-4 text-yellow-400" />
          סטטוס עבודה
          {incompleteEvents.length > 0 && (
            <span className="bg-yellow-500 text-gray-900 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {incompleteEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-y-auto flex-grow" style={{ maxHeight: "260px" }}>
        {incompleteEvents.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-sm">כל האירועים הושלמו ✅</div>
        ) : (
          <div>
            {incompleteEvents.map((event) => (
              <EventWorkRow key={event.id} event={event} onUpdated={onRefresh} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}