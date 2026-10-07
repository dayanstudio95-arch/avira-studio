import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, MessageCircle, Flame, Hourglass, Signature, ChevronLeft, Target, FileText } from "lucide-react";
import { useMeetings } from "@/components/meetings/MeetingsList";
import { kindLabel, utcToIsraelParts, todayIsrael } from "@/lib/meetings";
import { whatsappPulse, followUpSummary } from "@/lib/dashboardPulse";
import { isPostSignPending, STEPS, currentStep, SIGNED_STATUS } from "@/lib/postSignFlow";
import { todayInIsrael } from "@/lib/localDate";
import PostSignWizard from "@/components/postSign/PostSignWizard";

// The four "what do I do today" tiles of the dashboard (2026-10-07, the owner's choice):
// meetings today/tomorrow, WhatsApp waiting + hot leads, follow-ups, signed couples still in
// the post-sign wizard. Each one is a door: a click goes to where the work is done.

const shell = "dash-card h-full flex flex-col overflow-hidden";
const head = "text-white flex items-center gap-2 text-base font-semibold";
const rowBtn = "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-white/[0.04]";
// Design E: a faint outline illustration fills the empty lower part of a short tile, as in
// the reference. Decoration only (aria-hidden), no action.
const Ghost = ({ icon: Icon }) => (
  <div className="pointer-events-none mt-auto flex justify-center pb-4 pt-2" aria-hidden="true">
    <Icon className="h-12 w-12 text-slate-600/40" strokeWidth={1.25} />
  </div>
);

function useDashConversations() {
  return useQuery({
    queryKey: ["dashConversations"],
    queryFn: () => base44.entities.WhatsAppConversation.list("-lastMessageAt", 600),
    refetchInterval: 120000,
  });
}

export function MeetingsTodayCard() {
  const navigate = useNavigate();
  const q = useMeetings();
  const today = todayIsrael();
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const list = (q.data || [])
    .filter((m) => m.status === "scheduled")
    .map((m) => ({ ...m, parts: utcToIsraelParts(m.startsAt) }))
    .filter((m) => m.parts.date === today || m.parts.date === tomorrow)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><CalendarDays className="w-5 h-5 text-amber-400" /> פגישות היום ומחר</CardTitle>
      </CardHeader>
      <CardContent className="e-scroll p-3 min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-slate-400">
            <CalendarDays className="h-11 w-11 text-slate-500/70" strokeWidth={1.25} />
            <span className="text-sm">אין פגישות היום ומחר</span>
          </div>
        )}
        {list.slice(0, 6).map((m) => (
          <button key={m.id} type="button" onClick={() => navigate("/Meetings")} className={rowBtn}>
            <span className="min-w-0 truncate text-gray-200">
              <span className="font-semibold text-white">{m.parts.date === today ? "" : "מחר "}{m.parts.time}</span> · {m.title}
            </span>
            <span className="e-chip e-chip-blue shrink-0">{kindLabel(m.kind)}</span>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function WhatsAppPulseCard() {
  const navigate = useNavigate();
  const q = useDashConversations();
  const p = useMemo(() => whatsappPulse(q.data || []), [q.data]);
  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><MessageCircle className="w-5 h-5 text-emerald-400" /> וואטסאפ</CardTitle>
      </CardHeader>
      <CardContent className="e-scroll p-3 space-y-0.5 min-h-0 flex-1 overflow-y-auto">
        <button type="button" onClick={() => navigate("/chat")} className={rowBtn}>
          <span className="text-slate-200">דורש מענה</span>
          <span className={`e-count ${p.waitingCount ? "e-count-red" : "bg-white/5 text-slate-400"}`}>{p.waitingCount}</span>
        </button>
        {p.oldest && (
          <button type="button" onClick={() => navigate(`/chat?c=${p.oldest.id}`)} className={`${rowBtn} text-xs text-slate-400`}>
            <span className="truncate">הכי ותיק: {p.oldest.title}</span><span className="shrink-0 text-rose-400">{p.oldest.label}</span>
          </button>
        )}
        <div className="flex items-center gap-1.5 px-2 pt-1.5 pb-0.5 text-sm font-semibold text-orange-400"><Flame className="h-4 w-4" /> לידים חמים · {p.hot.length}</div>
        {p.hot.slice(0, 3).map((h) => (
          <button key={h.id} type="button" onClick={() => navigate(`/chat?c=${h.id}`)} className={rowBtn} title={h.reason}>
            <span className="truncate text-slate-100">{h.title}</span><ChevronLeft className="h-4 w-4 shrink-0 text-slate-500" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

export function FollowUpCard() {
  const navigate = useNavigate();
  const convQ = useDashConversations();
  const leadsQ = useQuery({ queryKey: ["dashLeads"], queryFn: () => base44.entities.Lead.list("-updated_date", 400), refetchInterval: 300000 });
  const daysQ = useQuery({
    queryKey: ["whatsappFollowUpAfterDays"],
    queryFn: async () => Number((await base44.entities.AppSetting.filter({ key: "whatsapp_followup_after_days" }))?.[0]?.value) || 0,
  });
  const s = useMemo(() => followUpSummary(convQ.data || [], leadsQ.data || [], daysQ.data || 0), [convQ.data, leadsQ.data, daysQ.data]);
  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><Hourglass className="w-5 h-5 text-amber-400" /> פולו-אפ</CardTitle>
      </CardHeader>
      <CardContent className="e-scroll p-3 space-y-1 min-h-0 flex-1 flex flex-col overflow-y-auto">
        <button type="button" onClick={() => navigate("/chat?box=followup")} className={rowBtn}>
          <span className="text-slate-200">ממתינים בוואטסאפ</span>
          <span className="e-chip e-chip-orange rounded-full px-3 font-bold">{s.awaitingCount}</span>
        </button>
        <button type="button" onClick={() => navigate("/Leads")} className={rowBtn}>
          <span className="text-slate-200">לידים בלי קשר שבוע+</span>
          <span className="e-chip e-chip-gray rounded-full px-3 font-bold">{s.staleLeads.length}</span>
        </button>
        {s.staleLeads.slice(0, 2).map((l) => (
          <div key={l.key} className="flex justify-between px-2 text-xs text-slate-400"><span className="truncate">{l.name}</span><span>{l.days} ימים</span></div>
        ))}
        <button type="button" onClick={() => navigate("/chat?box=followup")} className="mt-2 w-full rounded-xl bg-gradient-to-b from-[#FF9A3D] to-[#F97316] py-2 text-sm font-bold text-white shadow-[0_8px_22px_-10px_rgba(249,115,22,0.9)] hover:brightness-110">
          שלח פולו-אפ
        </button>
        <Ghost icon={Target} />
      </CardContent>
    </Card>
  );
}

export function PostSignCard() {
  const [openLead, setOpenLead] = useState(null);
  const q = useQuery({
    queryKey: ["dashPostSign"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .or(`status.eq."${SIGNED_STATUS}",post_sign_flow.not.is.null`)
        .or(`event_date.is.null,event_date.gte.${todayInIsrael()}`)
        .limit(200);
      if (error) throw error;
      return (data || []).map(rowToRecord).filter((l) => isPostSignPending({ ...l, postSignSnoozedUntil: null }));
    },
    refetchInterval: 300000,
  });
  const list = q.data || [];
  const stepIndex = (l) => STEPS.findIndex((s) => s.key === currentStep(l.postSignFlow)) + 1;
  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><Signature className="w-5 h-5 text-emerald-400" /> חתמו · בתהליך</CardTitle>
      </CardHeader>
      <CardContent className="e-scroll p-3 min-h-0 flex-1 flex flex-col overflow-y-auto">
        {list.length === 0 && <p className="py-6 text-center text-sm text-slate-400">אין זוגות בתהליך ✅</p>}
        {list.slice(0, 5).map((l) => (
          <button key={l.id} type="button" onClick={() => setOpenLead(l)} className={rowBtn}>
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-100">{l.coupleNames}</span>
              <span className="block truncate text-xs text-slate-400">
                {l.eventDate ? String(l.eventDate).slice(0, 10).split("-").reverse().join("/") : "בלי תאריך"}{l.venueName ? ` · ${l.venueName}` : ""}
              </span>
            </span>
            <span className="e-chip e-chip-green shrink-0">שלב {stepIndex(l)}/{STEPS.length}</span>
          </button>
        ))}
        {list.length < 3 && <Ghost icon={FileText} />}
      </CardContent>
      {openLead && <PostSignWizard lead={openLead} isOpen onClose={() => { setOpenLead(null); q.refetch(); }} />}
    </Card>
  );
}
