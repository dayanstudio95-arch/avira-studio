import React, { useState } from "react";
import { toast } from "sonner";
import { Check, Loader2, Pencil, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { calculateNetProfit } from "@/lib/profitCalculations";
import { getStaffRateForRole, rateUpdateForRole } from "@/lib/staffRates";

const Event = base44.entities.Event;
const StaffMember = base44.entities.StaffMember;
const fmt = (n) => `₪${Math.round(Number(n) || 0).toLocaleString()}`;

// A team member's cost for ONE event, changed from the payments page (2026-11-06, the owner's request: "יונתן לקח על
// האירוע הזה 1150 במקום 1100"). events.team[].cost is what the event's profit is computed from (calculateNetProfit),
// so the event page, the dashboard and the reports follow by themselves. Owner's decisions: only events not paid yet
// (the open list); this event only, with "לעדכן גם את התעריף הקבוע" for the events assigned from now on.
// The first price is kept as team[].costWas, so the row can say "(היה ₪1,100)".
export default function EventCostEditor({ event, memberIndex, staffName, staff, requestOpen = false, onSaved }) {
  const member = event?.team?.[memberIndex];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [alsoDefault, setAlsoDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!member) return null;
  const cost = Number(member.cost) || 0;
  const was = member.costWas != null && Number(member.costWas) !== cost ? Number(member.costWas) : null;
  const next = Number(value);
  const valid = value !== "" && next > 0 && next <= 1000000;
  const fixedRate = staff ? Number(getStaffRateForRole(staff, member.role)) || 0 : 0;
  const withCost = (c) => ({ ...event, team: event.team.map((m, i) => (i === memberIndex ? { ...m, cost: c } : m)) });
  const profitNow = calculateNetProfit(event);
  const profitNext = valid ? calculateNetProfit(withCost(next)) : profitNow;

  const open = () => {
    setValue(String(cost));
    setAlsoDefault(false);
    setEditing(true);
  };

  const save = async () => {
    if (!valid) return toast.error("סכום לא תקין");
    if (next === cost && !alsoDefault) return setEditing(false);
    setBusy(true);
    try {
      const first = member.costWas != null ? Number(member.costWas) : cost;
      const team = event.team.map((m, i) => {
        if (i !== memberIndex) return m;
        const { costWas: _drop, ...rest } = m;
        return next === first ? { ...rest, cost: next } : { ...rest, cost: next, costWas: first };
      });
      await Event.update(event.id, { team });
      if (alsoDefault && staff) await StaffMember.update(staff.id, rateUpdateForRole(staff, member.role, next));
      toast.success(`העלות של ${staffName} ב${event.coupleNames || "אירוע"} עודכנה ל-${fmt(next)} · רווח האירוע עכשיו ${fmt(calculateNetProfit({ ...event, team }))}${alsoDefault && staff ? ` · גם התעריף הקבוע עודכן` : ""}`);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      toast.error("העדכון נכשל: " + (e?.message || ""));
    }
    setBusy(false);
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <button type="button" onClick={open} title="שינוי העלות של איש הצוות לאירוע הזה" className="inline-flex items-center gap-1 rounded px-0.5 text-yellow-400 text-xs font-semibold border-b border-dashed border-yellow-500/50 hover:text-yellow-300" data-testid="cost-edit">
          {fmt(cost)}
          <Pencil className="w-3 h-3" />
        </button>
        {was != null && <span className="text-[11px] text-gray-500" data-testid="cost-was">(היה {fmt(was)})</span>}
      </span>
    );
  }

  const diff = valid ? next - cost : 0;
  return (
    <div className="mt-1 w-full space-y-1.5 rounded-lg border border-yellow-500/30 bg-gray-900/70 p-2" onClick={(e) => e.stopPropagation()} data-testid="cost-editor">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-400">₪</span>
        <input
          type="number"
          min="1"
          step="10"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          dir="ltr"
          className="h-8 w-24 rounded border border-gray-600 bg-gray-950 px-2 text-sm text-white"
          data-testid="cost-input"
        />
        <button type="button" onClick={save} disabled={busy || !valid} aria-label="שמירה" className="flex h-8 w-8 items-center justify-center rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40" data-testid="cost-save">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} aria-label="ביטול" className="flex h-8 w-8 items-center justify-center rounded border border-gray-600 text-gray-300 hover:bg-gray-800">
          <X className="w-4 h-4" />
        </button>
      </div>
      {event.totalAmountGross > 0 && (
        <p className="text-xs text-gray-400" data-testid="cost-profit">
          רווח האירוע: {fmt(profitNow)} ←{" "}
          <span className={diff > 0 ? "text-red-400" : diff < 0 ? "text-emerald-400" : "text-gray-300"}>{fmt(profitNext)}</span>
          {diff !== 0 ? ` (${fmt(Math.abs(diff))} ${diff > 0 ? "פחות" : "יותר"})` : ""}
        </p>
      )}
      {staff && (
        <label className="flex items-center gap-1.5 text-xs text-gray-300">
          <input type="checkbox" checked={alsoDefault} onChange={(e) => setAlsoDefault(e.target.checked)} data-testid="cost-default" />
          לעדכן גם את התעריף הקבוע של {staffName}{fixedRate ? ` (היום ${fmt(fixedRate)})` : ""} — לאירועים שישובצו מעכשיו
        </label>
      )}
      {requestOpen && <p className="text-[11px] text-amber-300">כבר שלחת ל{staffName} פירוט עם בקשת חשבונית לפי הסכום הקודם — אחרי השינוי כדאי לשלוח פירוט מעודכן.</p>}
    </div>
  );
}
