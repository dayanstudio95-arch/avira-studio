import { ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { yearOptions, FIRST_YEAR, LAST_YEAR } from "@/lib/yearOptions";

// The year picker of every page (2026-10-09, the owner's choice "א"): arrows on both sides step
// one year back / ahead across the whole range (2025–2050), and the list in the middle stays
// short (src/lib/yearOptions.js). RTL: the right arrow goes back in time, the left one ahead.
export default function YearPicker({ value, onChange, dates = [], triggerClassName = "", icon = null, before, after }) {
  const year = Number(value);
  const opts = yearOptions({ dates, selected: year, before, after });
  const arrow =
    "flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-[#2A3B57] bg-[#0B1529] text-slate-300 hover:bg-white/[0.06] hover:text-white disabled:opacity-30 disabled:hover:bg-[#0B1529]";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={arrow} disabled={year <= FIRST_YEAR} onClick={() => onChange(year - 1)} title="שנה קודמת" aria-label="שנה קודמת">
        <ChevronRight className="h-4 w-4" />
      </button>
      <Select value={String(year)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className={triggerClassName}>
          {icon}
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-gray-900 border-gray-700 text-white">
          {opts.map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button type="button" className={arrow} disabled={year >= LAST_YEAR} onClick={() => onChange(year + 1)} title="שנה הבאה" aria-label="שנה הבאה">
        <ChevronLeft className="h-4 w-4" />
      </button>
    </div>
  );
}
