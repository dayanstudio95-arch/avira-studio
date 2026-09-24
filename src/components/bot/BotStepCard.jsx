import React from "react";
import { Lock } from "lucide-react";

// One step of the bot's chain, as the control centre draws it (2026-09-24): a number,
// a title, two or three plain sentences about what happens here, and then the step's
// own settings. A `fixed` note names what is deliberately not a setting — hiding the
// hard-coded parts is how "what affects what?" became a question in the first place.
export default function BotStepCard({ number, title, icon: Icon, summary, fixed, tone = "default", children }) {
  const border =
    tone === "danger" ? "border-red-900/60" : tone === "warn" ? "border-amber-800/50" : "border-gray-800";
  return (
    <section className={`relative rounded-xl border ${border} bg-gray-900/50 p-5 space-y-4`}>
      <header className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-gray-900 font-bold">
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-white text-lg font-semibold flex items-center gap-2">
            {Icon && <Icon className="w-5 h-5 text-yellow-400 shrink-0" />}
            {title}
          </h2>
          {summary && <div className="text-gray-400 text-sm mt-1 space-y-1">{summary}</div>}
        </div>
      </header>

      {children && <div className="space-y-4">{children}</div>}

      {fixed && (
        <p className="flex items-start gap-2 text-xs text-gray-500 border-t border-gray-800 pt-3">
          <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium text-gray-400">קבוע בקוד:</span> {fixed}
          </span>
        </p>
      )}
    </section>
  );
}
