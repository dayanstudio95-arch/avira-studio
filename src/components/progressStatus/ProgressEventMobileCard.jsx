import React from "react";
import { Calendar, Camera, Video, Scissors } from "lucide-react";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { EVENT_TEAM_ROLES } from "@/lib/staffRoles";

// Icons stay local (the shared staffRoles.js list uses emoji, not lucide components).
// Was previously missing "videographer2" entirely (real bug — a videographer2 team
// member got no status button here and was silently excluded from the progress %
// below) — now built from the same shared role list as every other consumer, so this
// can't drift out of sync again.
const ROLE_ICONS = { photographer1: Camera, photographer2: Camera, videographer: Video, videographer2: Video, editor: Scissors };
const ROLE_CONFIG = Object.fromEntries(
  EVENT_TEAM_ROLES.map(({ value, label, doneField }) => [value, { label, icon: ROLE_ICONS[value], doneField }])
);

const isRawCompleted   = (e) => !!(e?.rawLink  || e?.rawDoneManual);
const isFinalCompleted = (e) => !!(e?.finalLink || e?.finalDoneManual);

export default function ProgressEventMobileCard({
  event,
  pendingLinks,
  setPendingLinks,
  updateField,
  saveLinkOnBlur,
  getLinkValue,
  handleSendToEditor,
  handleSendToCouple,
  handleSendAlbumToGraphic,
  handleSendAlbumToCouple,
  sendingEditor,
  sendingCouple,
  sendingGraphic,
  sendingAlbumCouple,
}) {
  const teamMembers = event?.team || [];
  const rawDone = isRawCompleted(event);
  const finalDone = isFinalCompleted(event);

  // progress
  const items = [];
  teamMembers.forEach(m => {
    const cfg = ROLE_CONFIG[m?.role];
    if (cfg) items.push(!!event?.[cfg.doneField]);
  });
  items.push(rawDone);
  items.push(finalDone);
  const total = items.length;
  const completed = items.filter(Boolean).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div id={`event-row-${event?.id}`} className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 space-y-3" dir="rtl">

      {/* Header: name + date + progress */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar className="w-4 h-4 text-yellow-400 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white truncate">{event?.coupleNames || "—"}</p>
            <p className="text-xs text-gray-400">
              {event?.date ? format(new Date(event.date), "d/M/yyyy") : "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-yellow-400 to-yellow-500 transition-all duration-300"
              style={{ width: `${percentage}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-yellow-400 w-7 text-left">{percentage}%</span>
        </div>
      </div>

      {/* Crew buttons */}
      {teamMembers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
            const member = teamMembers.find(m => m?.role === roleKey);
            if (!member) return null;
            const isDone = !!event?.[config.doneField];
            const Icon = config.icon;
            return (
              <div key={roleKey} className="flex flex-col items-center gap-0.5">
                <button
                  onClick={() => updateField(event.id, config.doneField, !isDone)}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    isDone
                      ? "bg-green-500/30 text-green-300 border-green-500/50"
                      : "bg-red-500/20 text-red-300 border-red-500/30"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{config.label}</span>
                </button>
                {member?.staffMemberName && (
                  <span className="text-[10px] text-gray-400 max-w-[56px] truncate text-center">
                    {member.staffMemberName}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Raw link row */}
      <div className="flex items-center gap-2">
        <Input
          type="url"
          placeholder="לינק גלם"
          value={getLinkValue(event, "rawLink")}
          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-rawLink`]: e.target.value }))}
          onBlur={() => saveLinkOnBlur(event.id, "rawLink")}
          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 flex-1"
          dir="ltr"
        />
        <button
          onClick={() => updateField(event.id, "rawDoneManual", !event?.rawDoneManual)}
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 transition-colors ${
            rawDone
              ? "bg-green-500/30 text-green-300 border-green-500/50"
              : "bg-gray-800 text-gray-400 border-gray-600"
          }`}
        >גלם</button>
        <button
          onClick={() => {
            if (event?.rawSentToEditor) {
              updateField(event.id, 'rawSentToEditor', false);
            } else {
              handleSendToEditor(event);
            }
          }}
          disabled={!!sendingEditor[event.id]}
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 whitespace-nowrap transition-colors ${
            event?.rawSentToEditor
              ? 'bg-green-500/30 text-green-300 border-green-500/50'
              : 'bg-blue-600/20 text-blue-300 border-blue-500/40'
          }`}
        >
          {sendingEditor[event.id] ? '...' : event?.rawSentToEditor ? '✓ נשלח' : '→ עורך'}
        </button>
      </div>

      {/* Final link row */}
      <div className="flex items-center gap-2">
        <Input
          type="url"
          placeholder="לינק סופי"
          value={getLinkValue(event, "finalLink")}
          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-finalLink`]: e.target.value }))}
          onBlur={() => saveLinkOnBlur(event.id, "finalLink")}
          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 flex-1"
          dir="ltr"
        />
        <button
          onClick={() => updateField(event.id, "finalDoneManual", !event?.finalDoneManual)}
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 transition-colors ${
            finalDone
              ? "bg-green-500/30 text-green-300 border-green-500/50"
              : "bg-gray-800 text-gray-400 border-gray-600"
          }`}
        >סופי</button>
        <button
          onClick={() => handleSendToCouple(event)}
          disabled={!!sendingCouple[event.id]}
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 whitespace-nowrap transition-colors ${
            event?.finalDoneManual
              ? "bg-green-500/30 text-green-300 border-green-500/50"
              : "bg-purple-600/20 text-purple-300 border-purple-500/40"
          }`}
        >
          {sendingCouple[event.id] ? '...' : event?.finalDoneManual ? '✓ נשלח' : '→ זוג'}
        </button>
      </div>

      {/* Album sketch row */}
      <div className="flex items-center gap-2">
        <Input
          type="url"
          placeholder="לינק אלבום"
          value={getLinkValue(event, "albumSketchLink")}
          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-albumSketchLink`]: e.target.value }))}
          onBlur={() => saveLinkOnBlur(event.id, "albumSketchLink")}
          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 flex-1"
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
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 whitespace-nowrap transition-colors ${
            event?.albumSketchGraphicNotified
              ? 'bg-green-500/30 text-green-300 border-green-500/50'
              : 'bg-orange-600/20 text-orange-300 border-orange-500/40'
          }`}
        >
          {sendingGraphic[event.id] ? '...' : event?.albumSketchGraphicNotified ? '✓ גרפיקה' : '→ גרפיקה'}
        </button>
        <button
          onClick={() => handleSendAlbumToCouple(event)}
          disabled={!!sendingAlbumCouple[event.id]}
          className={`h-8 px-2 text-xs rounded border font-medium flex-shrink-0 whitespace-nowrap transition-colors ${
            event?.albumSketchCoupleNotified
              ? 'bg-green-500/30 text-green-300 border-green-500/50'
              : 'bg-teal-600/20 text-teal-300 border-teal-500/40'
          }`}
        >
          {sendingAlbumCouple[event.id] ? '...' : event?.albumSketchCoupleNotified ? '✓ זוג' : '→ זוג'}
        </button>
      </div>

      {/* Album status toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-800">
        <button
          onClick={() => updateField(event.id, "albumStatus", event?.albumStatus === "sent" ? "pending" : "sent")}
          className={`h-8 px-3 text-xs font-medium rounded-md border transition-colors ${
            event?.albumStatus === "sent"
              ? "bg-green-500/30 text-green-300 border-green-500/50"
              : "bg-pink-500/20 text-pink-300 border-pink-500/30"
          }`}
        >
          📀 אלבום {event?.albumStatus === "sent" ? "✓" : ""}
        </button>
      </div>
    </div>
  );
}