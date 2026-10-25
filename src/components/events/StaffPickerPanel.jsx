import React, { useMemo, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { pickerRows, firstPickable, temporaryNameProblem } from "@/lib/staffPicker";

// The inside of the crew picker (2026-10-15): fixed header + search, ONE scrolling list,
// and "➕ צלם חד-פעמי" at the bottom. The parent does the saving.
export default function StaffPickerPanel({
  label, color, staffList, event, events, roleKey, member, checkBooked = true,
  onSelect, onAddTemporary, onPromoteTemporary,
}) {
  const [search, setSearch] = useState("");
  const [tempOpen, setTempOpen] = useState(false);
  const [temp, setTemp] = useState({ name: "", phone: "", cost: "" });
  const [tempError, setTempError] = useState(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(
    () => pickerRows({ staffList, event, events, roleKey, member, search, checkBooked }),
    [staffList, event, events, roleKey, member, search, checkBooked]
  );

  const pick = async (staff, isSelected) => {
    if (busy) return;
    setBusy(true);
    try { await onSelect(staff, isSelected); } finally { setBusy(false); }
  };

  const saveTemp = async () => {
    const problem = temporaryNameProblem(temp.name, staffList);
    if (problem) { setTempError(problem); return; }
    setBusy(true);
    try { await onAddTemporary(temp); } finally { setBusy(false); }
  };

  return (
    <div className="flex max-h-[min(70vh,var(--radix-popover-content-available-height,70vh))] flex-col" dir="rtl">
      <div className="mb-2 text-sm font-semibold text-gray-400">בחר {label}</div>
      {member?.isTemporary && (
        <div className="mb-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2 text-xs text-amber-200">
          {member.staffMemberName} — זמני (רק באירוע הזה)
          {onPromoteTemporary && (
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onPromoteTemporary(); } finally { setBusy(false); } }} className="ms-2 underline hover:text-white">
              הוסף לרשימת הצוות
            </button>
          )}
        </div>
      )}
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          // On a computer the cursor waits in the search box; on a phone the keyboard
          // would cover half the list, so there it opens only on a tap.
          autoFocus={!window.matchMedia?.("(pointer: coarse)").matches}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const first = firstPickable(rows);
              if (first) pick(first.staff, false);
            }
          }}
          placeholder="חיפוש לפי שם"
          className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pe-3 ps-8 text-base text-white placeholder:text-gray-500 md:text-sm"
        />
      </div>

      <div
        className="min-h-0 flex-1 space-y-1 overflow-y-auto pe-1"
        style={{ WebkitOverflowScrolling: "touch" }}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {rows.length === 0 ? (
          <div className="py-4 text-center text-sm text-gray-500">{search ? "לא נמצא" : `אין ${label} זמינים`}</div>
        ) : (
          rows.map(({ staff, isSelected, isBooked, bookedText }) => (
            <div key={staff.id} className={`flex items-center gap-3 rounded p-2 ${isBooked ? "opacity-60" : "hover:bg-gray-800/50"}`}>
              <button
                type="button"
                disabled={isBooked || busy}
                onClick={() => pick(staff, isSelected)}
                className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                  isSelected
                    ? "border border-amber-500/40 bg-amber-500/20 text-amber-400"
                    : isBooked
                    ? "cursor-not-allowed border border-gray-700 bg-gray-800 text-gray-600"
                    : "bg-amber-500 text-gray-900 hover:bg-amber-600"
                }`}
              >
                {isSelected ? "✓ נבחר" : "בחר"}
              </button>
              <div className="flex flex-1 items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${color}`}>
                  {staff.name.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm">
                  {staff.isFavorite ? "⭐ " : ""}{staff.name}
                  {bookedText
                    ? <span className="block text-[11px] text-amber-400/90">{bookedText}</span>
                    : isBooked && " (כבר משובץ)"}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {onAddTemporary && (
        <div className="mt-2 border-t border-gray-800 pt-2">
          {!tempOpen ? (
            <button type="button" onClick={() => { setTempOpen(true); setTemp((t) => ({ ...t, name: t.name || search })); }} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-600 py-2 text-sm text-gray-300 hover:text-white">
              <UserPlus className="h-4 w-4" /> {label === "עורך" || label === "עורך וידאו" ? "עורך חד-פעמי" : "צלם חד-פעמי"}
            </button>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-400">נשמר רק באירוע הזה — לא נכנס לרשימת הצוות.</div>
              <input type="text" value={temp.name} onChange={(e) => { setTemp({ ...temp, name: e.target.value }); setTempError(null); }} placeholder="שם" className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-base text-white md:text-sm" />
              <div className="grid grid-cols-2 gap-1.5">
                <input type="tel" dir="ltr" value={temp.phone} onChange={(e) => setTemp({ ...temp, phone: e.target.value })} placeholder="טלפון (לא חובה)" className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-base text-white md:text-sm" />
                <input type="number" inputMode="numeric" min="0" value={temp.cost} onChange={(e) => setTemp({ ...temp, cost: e.target.value })} placeholder="תשלום ₪" className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-base text-white md:text-sm" />
              </div>
              {tempError && <div className="text-xs text-red-400">{tempError}</div>}
              <div className="flex gap-1.5">
                <button type="button" disabled={busy} onClick={saveTemp} className="flex-1 rounded-lg bg-amber-500 py-1.5 text-sm font-semibold text-gray-900 hover:bg-amber-600 disabled:opacity-50">שבץ</button>
                <button type="button" onClick={() => { setTempOpen(false); setTempError(null); }} className="rounded-lg border border-gray-700 px-3 text-sm text-gray-300">ביטול</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
