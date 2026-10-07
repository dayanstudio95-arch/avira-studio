import React, { useMemo } from "react";
import { Camera, CheckCircle2, Image as ImageIcon, CreditCard, Film, Users } from "lucide-react";
import { isMissingTeam, israelToday, eventDay } from "@/lib/missingTeam";
import { progressPct } from "@/lib/eventProgress";

// Design E for the events page (2026-10-07, the owner's reference image): six counts above
// the table. Every number is counted from the events already loaded on the page, with the
// same rules the rest of the system uses — nothing new is calculated or stored.
//   סה"כ אירועים — the rows the table shows right now (year + search).
//   חוסר צוות    — the shared missing-team rule (src/lib/missingTeam.js), every upcoming event.
//   אלבומים       — events of the year already held whose album is not marked "נשלח".
//   תשלומים       — events of the year already held and not marked "שולם".
//   עריכה         — events of the year already held whose work is not 100% (eventProgress).
//   אירועי השנה   — held so far out of all events of the year.
const TONES = {
  purple: "border-[#A855F7]/50 bg-[#A855F7]/12 text-[#D8B4FE] shadow-[0_0_18px_-4px_rgba(168,85,247,0.6)]",
  green: "border-[#22C987]/50 bg-[#22C987]/12 text-[#6EE7B7] shadow-[0_0_18px_-4px_rgba(34,201,135,0.55)]",
  blue: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-[#93C5FD] shadow-[0_0_18px_-4px_rgba(59,130,246,0.6)]",
  amber: "border-[#F59E0B]/55 bg-[#F59E0B]/12 text-[#FCD34D] shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]",
  pink: "border-[#EC4899]/55 bg-[#EC4899]/12 text-[#F9A8D4] shadow-[0_0_18px_-4px_rgba(236,72,153,0.6)]",
  slate: "border-[#94A3B8]/30 bg-white/[0.05] text-slate-200",
};

function Tile({ icon: Icon, tone, value, label, labelClass }) {
  return (
    <div className="dash-card flex items-center justify-end gap-3 px-3 py-3 md:gap-4 md:px-5 md:py-4">
      <div className="min-w-0">
        <div className="text-xl md:text-2xl font-bold leading-tight text-white tabular-nums whitespace-nowrap">{value}</div>
        <div className={`text-xs md:text-sm whitespace-nowrap ${labelClass || "text-slate-400"}`}>{label}</div>
      </div>
      <div className={`flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl border ${TONES[tone]}`}>
        <Icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.75} />
      </div>
    </div>
  );
}

export default function EventsStatsRow({ events, shownCount, year }) {
  const s = useMemo(() => {
    const today = israelToday();
    const ofYear = (events || []).filter((e) => eventDay(e).slice(0, 4) === String(year));
    const held = ofYear.filter((e) => eventDay(e) < today);
    return {
      missing: (events || []).filter((e) => isMissingTeam(e, today)).length,
      albums: held.filter((e) => e.albumStatus !== "sent").length,
      unpaid: held.filter((e) => e.clientPaymentStatus !== "Paid").length,
      editing: held.filter((e) => progressPct(e) < 100).length,
      yearDone: held.length,
      yearTotal: ofYear.length,
    };
  }, [events, year]);

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile icon={Users} tone="slate" value={<>{s.yearDone} <span className="text-sm md:text-base font-medium text-slate-400">מתוך</span> {s.yearTotal}</>} label="אירועי השנה" />
      <Tile icon={Film} tone="pink" value={s.editing} label="עריכה" labelClass="text-pink-300/90" />
      <Tile icon={CreditCard} tone="amber" value={s.unpaid} label="תשלומים" />
      <Tile icon={ImageIcon} tone="blue" value={s.albums} label="אלבומים" />
      <Tile icon={CheckCircle2} tone="green" value={s.missing} label="חוסר צוות" />
      <Tile icon={Camera} tone="purple" value={shownCount} label='סה"כ אירועים' />
    </div>
  );
}
