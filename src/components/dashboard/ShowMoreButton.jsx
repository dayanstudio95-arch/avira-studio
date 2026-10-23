import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

// "הצג את כל N" under a dashboard list the phone shows only the first few rows of
// (2026-10-24, the owner's request). Nothing when the list already fits.
export default function ShowMoreButton({ total, limit, expanded, onToggle, label }) {
  if (!limit || total <= limit) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mb-2 mt-1 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-amber-400/40 py-2 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-400/10"
    >
      {expanded ? (
        <>הצג פחות <ChevronUp className="h-3.5 w-3.5" /></>
      ) : (
        <>{label || `הצג את כל ${total}`} <ChevronDown className="h-3.5 w-3.5" /></>
      )}
    </button>
  );
}
