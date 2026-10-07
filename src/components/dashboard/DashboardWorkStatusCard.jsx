import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { Clapperboard, ChevronDown, ChevronUp } from "lucide-react";
import { base44 } from "@/api/base44Client";

// same fields as ProgressStatus
const ROLE_DONE_FIELDS = {
  photographer1: "photographer1Done",
  photographer2: "photographer2Done",
  videographer: "video1Done",
  videographer2: "video2Done",
  editor: "editorDone",
};

const FIELD_LABELS = {
  photographer1Done: "צלם 1",
  photographer2Done: "צלם 2",
  video1Done: "וידאו",
  video2Done: "וידאו 2",
  editorDone: "עריכה",
  rawDoneManual: "גלם",
  finalDoneManual: "סופי",
};

export function getProgress(event) {
  const team = event.team || [];
  const items = [];
  team.forEach((m) => {
    const field = ROLE_DONE_FIELDS[m?.role];
    if (field) items.push(!!event[field]);
  });
  items.push(!!(event.rawLink || event.rawDoneManual));
  items.push(!!(event.finalLink || event.finalDoneManual));

  const total = items.length;
  if (total === 0) return { label: "ממתין", pct: 0, color: "e-chip-red" };
  const completed = items.filter(Boolean).length;
  const pct = Math.round((completed / total) * 100);

  if (pct === 100) return { label: `הושלם (${pct}%)`, pct, color: "e-chip-green" };
  if (pct > 0) return { label: `בתהליך (${pct}%)`, pct, color: "e-chip-yellow" };
  return { label: "ממתין", pct: 0, color: "e-chip-red" };
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
  fields.push("rawDoneManual");
  fields.push("finalDoneManual");
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
    <div className="e-row">
      <div
        className="flex items-center justify-between gap-2 px-2 py-3 cursor-pointer rounded-lg hover:bg-white/[0.03] transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{localEvent.coupleNames}</p>
          <p className="text-xs text-slate-400">{format(new Date(localEvent.date), "d/M/yyyy")}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`e-chip ${progress.color}`}>
            {progress.label}
          </span>
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
    <Card className="dash-card flex flex-col h-full">
      <CardHeader className="dash-head pb-3 flex-shrink-0">
        <CardTitle className="text-white flex items-center gap-2 text-base font-semibold">
          <Clapperboard className="w-5 h-5 text-amber-400" />
          סטטוס עבודה
          {incompleteEvents.length > 0 && (
            <span className="e-count e-count-yellow">
              {incompleteEvents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="e-scroll px-3 py-1 overflow-y-auto flex-grow" style={{ maxHeight: "260px" }}>
        {incompleteEvents.length === 0 ? (
          <div className="py-8 text-center text-slate-400 text-sm">כל האירועים הושלמו ✅</div>
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