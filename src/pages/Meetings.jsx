import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, CalendarDays, Sunrise, CalendarRange, CheckCircle2 } from "lucide-react";
import MeetingsList, { useMeetings } from "@/components/meetings/MeetingsList";
import { groupMeetings } from "@/lib/meetings";

// 📅 פגישות (2026-10-07) — the sales calls / zooms / meetings booked with leads, the same list
// as in the chat app. The reminders are pushed to the phone by the server (meeting-reminders).
// Design E: the counts on top come from the same list (same query, same grouping) — scheduled
// today / tomorrow / the rest of the week, and the ones marked done in the last 30 days.
const TONES = {
  amber: "border-[#F59E0B]/50 bg-[#F59E0B]/12 text-amber-300 shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]",
  blue: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-sky-300 shadow-[0_0_18px_-4px_rgba(59,130,246,0.6)]",
  purple: "border-[#A855F7]/50 bg-[#A855F7]/12 text-violet-300 shadow-[0_0_18px_-4px_rgba(168,85,247,0.6)]",
  green: "border-[#22C987]/50 bg-[#22C987]/12 text-emerald-300 shadow-[0_0_18px_-4px_rgba(34,201,135,0.55)]",
};

function Tile({ icon: Icon, tone, value, label }) {
  return (
    <div className="dash-card flex items-center justify-end gap-3 px-4 py-3 md:gap-4 md:px-5 md:py-4">
      <div>
        <div className="text-xl font-bold leading-tight text-white tabular-nums md:text-2xl">{value}</div>
        <div className="text-xs text-slate-400 md:text-sm">{label}</div>
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border md:h-12 md:w-12 ${TONES[tone]}`}>
        <Icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.75} />
      </div>
    </div>
  );
}

export default function Meetings() {
  const navigate = useNavigate();
  const q = useMeetings();
  const counts = useMemo(() => {
    const g = groupMeetings(q.data || []);
    const sched = (list) => list.filter((m) => m.status === "scheduled").length;
    return {
      today: sched(g.today),
      tomorrow: sched(g.tomorrow),
      week: sched(g.week),
      done: (q.data || []).filter((m) => m.status === "done").length,
    };
  }, [q.data]);

  return (
    <div dir="rtl" className="e-page min-h-screen p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#F59E0B]/45 bg-[#F59E0B]/10 text-amber-300 shadow-[0_0_24px_-6px_rgba(245,158,11,0.7)]">
            <CalendarClock className="h-7 w-7" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white md:text-4xl">פגישות</h1>
            <p className="text-sm text-slate-400">שיחות, זום ופגישות עם לידים · תזכורת לטלפון 10 דק׳ לפני (באפליקציית "אווירה צ'אט")</p>
          </div>
        </div>
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile icon={CalendarDays} tone="amber" value={counts.today} label="היום" />
          <Tile icon={Sunrise} tone="blue" value={counts.tomorrow} label="מחר" />
          <Tile icon={CalendarRange} tone="purple" value={counts.week} label="בהמשך השבוע" />
          <Tile icon={CheckCircle2} tone="green" value={counts.done} label="בוצעו (30 יום)" />
        </div>
        <div className="dash-card overflow-hidden pb-2">
          <MeetingsList
            onOpenConversation={(id) => navigate(`/chat?c=${id}`)}
            onOpenLead={(id) => navigate(`/Leads?openLeadId=${id}`)}
          />
        </div>
      </div>
    </div>
  );
}
