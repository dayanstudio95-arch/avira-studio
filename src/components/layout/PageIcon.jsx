import React from "react";

// Design E (2026-10-07): the glowing icon tile beside every page title.
const TONES = {
  blue: "border-[#3B82F6]/45 bg-[#3B82F6]/10 text-sky-300 shadow-[0_0_24px_-6px_rgba(59,130,246,0.7)]",
  amber: "border-[#F59E0B]/45 bg-[#F59E0B]/10 text-amber-300 shadow-[0_0_24px_-6px_rgba(245,158,11,0.7)]",
  cyan: "border-[#06B6D4]/45 bg-[#06B6D4]/10 text-cyan-300 shadow-[0_0_24px_-6px_rgba(6,182,212,0.7)]",
  pink: "border-[#EC4899]/45 bg-[#EC4899]/10 text-pink-300 shadow-[0_0_24px_-6px_rgba(236,72,153,0.7)]",
  purple: "border-[#A855F7]/45 bg-[#A855F7]/10 text-violet-300 shadow-[0_0_24px_-6px_rgba(168,85,247,0.7)]",
  green: "border-[#22C987]/45 bg-[#22C987]/10 text-emerald-300 shadow-[0_0_24px_-6px_rgba(34,201,135,0.7)]",
  slate: "border-[#94A3B8]/35 bg-white/[0.05] text-slate-200 shadow-[0_0_24px_-8px_rgba(148,163,184,0.5)]",
};

export default function PageIcon({ icon: Icon, tone = "blue" }) {
  return (
    <div className={`hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${TONES[tone]}`}>
      <Icon className="h-7 w-7" strokeWidth={1.75} />
    </div>
  );
}
