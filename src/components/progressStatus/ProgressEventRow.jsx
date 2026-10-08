import React from "react";
import { format } from "date-fns";
import { Calendar, Camera, Video, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EVENT_TEAM_ROLES } from "@/lib/staffRoles";

// One event's row on the work-status page (desktop), moved out of ProgressStatus.jsx
// unchanged on 2026-10-09 — the dashboard's progress window shows the very same row.
// `actions` = useProgressActions(...).
const ROLE_ICONS = { photographer1: Camera, photographer2: Camera, videographer: Video, videographer2: Video, editor: Scissors };
const ROLE_CONFIG = Object.fromEntries(
  EVENT_TEAM_ROLES.map(({ value, label, doneField }) => [value, { label, icon: ROLE_ICONS[value], doneField }])
);

const isRawCompleted   = (e) => !!(e?.rawLink  || e?.rawDoneManual);
const isFinalCompleted = (e) => !!(e?.finalLink || e?.finalDoneManual);

export const getProgress = (event, teamMembers) => {
  const items = [];
  (teamMembers || []).forEach(m => {
    const cfg = ROLE_CONFIG[m?.role];
    if (cfg) items.push(!!event?.[cfg.doneField]);
  });
  items.push(isRawCompleted(event));
  items.push(isFinalCompleted(event));
  const total = items.length;
  const completed = items.filter(Boolean).length;
  return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
};

export default function ProgressEventRow({ event, actions }) {
  const {
    setPendingLinks, sendingEditor, sendingCouple, sendingGraphic, sendingAlbumCouple,
    updateField, saveLinkOnBlur, getLinkValue,
    handleSendToEditor, handleSendToCouple, handleSendAlbumToGraphic, handleSendAlbumToCouple,
  } = actions;
  const teamMembers = event?.team || [];
  const progress = getProgress(event, teamMembers);
  const rawDone = isRawCompleted(event);
  const finalDone = isFinalCompleted(event);

  return (
            <div id={`event-row-${event?.id}`} className="rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#0F1C36] to-[#0B1529] p-4 transition-colors hover:border-[#4F7BFF]/40">
              {/* Row: LTR so elements flow left→right */}
              <div className="flex items-start gap-3 flex-wrap" style={{ direction: "ltr" }}>

                {/* Event Info — forced RTL for Hebrew text */}
                <div className="flex items-center gap-3 min-w-fit" style={{ direction: "rtl" }}>
                  <Calendar className="w-5 h-5 text-amber-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-white">{event?.coupleNames || "—"}</p>
                    <p className="text-xs text-gray-400">
                      {event?.date ? format(new Date(event.date), "d/M/yyyy") : "—"}
                    </p>
                  </div>
                </div>

                {/* Crew Buttons with name below */}
                <div className="flex items-start gap-2 flex-wrap">
                  {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
                    const member = teamMembers.find(m => m?.role === roleKey);
                    if (!member) return null;
                    const isDone = !!event?.[config.doneField];
                    const Icon = config.icon;
                    return (
                      <div key={roleKey} className="flex flex-col items-center gap-0.5">
                        <button
                          onClick={() => updateField(event.id, config.doneField, !isDone)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
                            isDone
                              ? "bg-green-500/30 text-green-300 border-green-500/50 hover:bg-green-500/40"
                              : "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30"
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          <span>{config.label}</span>
                        </button>
                        {member?.staffMemberName && (
                          <span className="text-xs text-gray-400 max-w-[56px] truncate text-center">
                            {member.staffMemberName}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Raw Link + Status + Send to Editor */}
                <div className="flex items-center gap-1">
                  <Input
                    type="url"
                    placeholder="לינק גלם"
                    value={getLinkValue(event, "rawLink")}
                    onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-rawLink`]: e.target.value }))}
                    onBlur={() => saveLinkOnBlur(event.id, "rawLink")}
                    className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                    dir="ltr"
                  />
                  <button
                    onClick={() => updateField(event.id, "rawDoneManual", !event?.rawDoneManual)}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors ${
                      rawDone
                        ? "bg-green-500/30 text-green-300 border-green-500/50"
                        : "bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-400"
                    }`}
                    title="גלם — לחץ לסימון ידני"
                  >
                    גלם
                  </button>
                  <button
                    onClick={() => {
                      if (event?.rawSentToEditor) {
                        updateField(event.id, 'rawSentToEditor', false);
                      } else {
                        handleSendToEditor(event);
                      }
                    }}
                    disabled={!!sendingEditor[event.id]}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                      event?.rawSentToEditor
                        ? 'bg-green-500/30 text-green-300 border-green-500/50 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40'
                        : 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                    }`}
                    title={event?.rawSentToEditor ? 'לחץ לאיפוס הסטטוס' : 'שלח לעורך'}
                  >
                    {sendingEditor[event.id] ? '...' : event?.rawSentToEditor ? '✓ נשלח' : '→ עורך'}
                  </button>
                </div>

                {/* Final Link + Status + Send to Couple */}
                <div className="flex items-center gap-1">
                  <Input
                    type="url"
                    placeholder="לינק סופי"
                    value={getLinkValue(event, "finalLink")}
                    onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-finalLink`]: e.target.value }))}
                    onBlur={() => saveLinkOnBlur(event.id, "finalLink")}
                    className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                    dir="ltr"
                  />
                  <button
                    onClick={() => updateField(event.id, "finalDoneManual", !event?.finalDoneManual)}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors ${
                      finalDone
                        ? "bg-green-500/30 text-green-300 border-green-500/50"
                        : "bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-400"
                    }`}
                    title="סופי — לחץ לסימון ידני"
                  >
                    סופי
                  </button>
                  <button
                    onClick={() => handleSendToCouple(event)}
                    disabled={!!sendingCouple[event.id]}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                      event?.finalDoneManual
                        ? "bg-green-500/30 text-green-300 border-green-500/50"
                        : "bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30"
                    }`}
                    title="שלח סופי לזוג"
                  >
                    {sendingCouple[event.id] ? '...' : event?.finalDoneManual ? '✓ נשלח' : '→ זוג'}
                  </button>
                </div>

                {/* Album Sketch — link + graphic + couple */}
                <div className="flex items-center gap-1">
                  <Input
                    type="url"
                    placeholder="לינק אלבום"
                    value={getLinkValue(event, "albumSketchLink")}
                    onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-albumSketchLink`]: e.target.value }))}
                    onBlur={() => saveLinkOnBlur(event.id, "albumSketchLink")}
                    className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                    dir="ltr"
                  />
                  <button
                    onClick={() => {
                      if (event?.albumSketchGraphicNotified) {
                        updateField(event.id, 'albumSketchGraphicNotified', false);
                      } else {
                        handleSendAlbumToGraphic(event);
                      }
                    }}
                    disabled={!!sendingGraphic[event.id]}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                      event?.albumSketchGraphicNotified
                        ? 'bg-green-500/30 text-green-300 border-green-500/50 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40'
                        : 'bg-orange-600/20 text-orange-300 border-orange-500/40 hover:bg-orange-600/30'
                    }`}
                    title={event?.albumSketchGraphicNotified ? 'לחץ לאיפוס' : 'שלח לגרפיקאית'}
                  >
                    {sendingGraphic[event.id] ? '...' : event?.albumSketchGraphicNotified ? '✓ גרפיקה' : '→ גרפיקה'}
                  </button>
                  <button
                    onClick={() => handleSendAlbumToCouple(event)}
                    disabled={!!sendingAlbumCouple[event.id]}
                    className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                      event?.albumSketchCoupleNotified
                        ? 'bg-green-500/30 text-green-300 border-green-500/50'
                        : 'bg-teal-600/20 text-teal-300 border-teal-500/40 hover:bg-teal-600/30'
                    }`}
                    title="שלח סקיצה לזוג"
                  >
                    {sendingAlbumCouple[event.id] ? '...' : event?.albumSketchCoupleNotified ? '✓ זוג' : '→ זוג'}
                  </button>
                </div>

                {/* Album + Progress — pushed to end */}
                 <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => updateField(event.id, "albumStatus", event?.albumStatus === "sent" ? "pending" : "sent")}
                    className={`h-8 px-2 text-xs font-medium rounded-md whitespace-nowrap ${
                      event?.albumStatus === "sent"
                        ? "bg-green-500/30 text-green-300 border border-green-500/50"
                        : "bg-pink-500/20 text-pink-300 border border-pink-500/30"
                    }`}
                  >
                    📀 אלבום
                  </Button>
                  <div className="w-28 h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${progress.percentage === 100 ? "bg-[#22C987]" : progress.percentage >= 50 ? "bg-gradient-to-r from-[#06B6D4] to-[#3B82F6]" : "bg-gradient-to-r from-[#F59E0B] to-[#FACC15]"}`}
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                  <span className={`text-xs font-semibold w-8 text-left ${progress.percentage === 100 ? "text-emerald-400" : progress.percentage >= 50 ? "text-sky-300" : "text-amber-300"}`}>
                    {progress.percentage}%
                  </span>
                </div>

              </div>
            </div>
  );
}
