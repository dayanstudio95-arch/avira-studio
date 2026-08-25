import React from "react";
import { TEMPLATE_VARIABLE_DESCRIPTIONS } from "@/lib/automationTemplateVariables";

// Shared chip list for message-template variables, used by both the
// fixed-automation editor (AutomationsDashboard.jsx) and the
// custom-audience automation builder (CreateCustomAutomationModal.jsx).
// Descriptions are always visible (not hover-only), per explicit user request.
export default function TemplateVariablesHelp({ vars, onInsert }) {
  if (!vars?.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {vars.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          title={TEMPLATE_VARIABLE_DESCRIPTIONS[v] || ""}
          className="flex items-center gap-1.5 text-xs px-2 py-1 bg-indigo-900/40 border border-indigo-700/50 text-indigo-300 rounded-lg hover:bg-indigo-800/60 transition-colors"
        >
          <span className="font-mono">{v}</span>
          {TEMPLATE_VARIABLE_DESCRIPTIONS[v] && (
            <span className="text-gray-400 font-normal">— {TEMPLATE_VARIABLE_DESCRIPTIONS[v]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
