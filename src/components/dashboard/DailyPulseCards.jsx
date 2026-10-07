import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarClock, MessageCircle, Flame, Hourglass, Signature, ChevronLeft } from "lucide-react";
import { useMeetings } from "@/components/meetings/MeetingsList";
import { kindLabel, utcToIsraelParts, todayIsrael } from "@/lib/meetings";
import { whatsappPulse, followUpSummary } from "@/lib/dashboardPulse";
import { isPostSignPending, STEPS, currentStep, SIGNED_STATUS } from "@/lib/postSignFlow";
import { todayInIsrael } from "@/lib/localDate";
import PostSignWizard from "@/components/postSign/PostSignWizard";

// The four "what do I do today" tiles of the dashboard (2026-10-07, the owner's choice):
// meetings today/tomorrow, WhatsApp waiting + hot leads, follow-ups, signed couples still in
// the post-sign wizard. Each one is a door: a click goes to where the work is done.

const shell = "bg-gray-900/50 border-gray-800 backdrop-blur-sm h-full";
const head = "text-white flex items-center gap-2 text-sm font-semibold";
const rowBtn = "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-start text-sm hover:bg-gray-800/60";

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
      <CardHeader className="border-b border-gray-800 pb-3">
        <CardTitle className={head}><CalendarClock className="w-4 h-4 text-yellow-400" /> פגישות היום ומחר</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {list.length === 0 && <p className="py-6 text-center text-sm text-gray-500">אין פגישות היום ומחר</p>}
        {list.slice(0, 6).map((m) => (
          <button key={m.id} type="button" onClick={() => navigate("/Meetings")} className={rowBtn}>
            <span className="min-w-0 truncate text-gray-200">
              <span className="font-semibold text-white">{m.parts.date === today ? "" : "מחר "}{m.parts.time}</span> · {m.title}
            </span>
            <span className="shrink-0 rounded-full bg-blue-500/15 px-2 text-[11px] text-blue-200">{kindLabel(m.kind)}</span>
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
      <CardHeader className="border-b border-gray-800 pb-3">
        <CardTitle className={head}><MessageCircle className="w-4 h-4 text-green-400" /> וואטסאפ</CardTitle>
      </CardHeader>
      <CardContent className="p-2 space-y-1">
        <button type="button" onClick={() => navigate("/chat")} className={rowBtn}>
          <span className="text-gray-200">דורש מענה</span>
          <span className={`rounded-full px-2 text-xs font-bold ${p.waitingCount ? "bg-red-500 text-white" : "bg-gray-800 text-gray-400"}`}>{p.waitingCount}</span>
        </button>
        {p.oldest && (
          <button type="button" onClick={() => navigate(`/chat?c=${p.oldest.id}`)} className={`${rowBtn} text-xs text-gray-400`}>
            <span className="truncate">הכי ותיק: {p.oldest.title}</span><span className="shrink-0 text-red-300">{p.oldest.label}</span>
          </button>
        )}
        <div className="flex items-center gap-1.5 px-2 pt-1 text-xs font-semibold text-orange-300"><Flame className="h-3.5 w-3.5" /> לידים חמים · {p.hot.length}</div>
        {p.hot.slice(0, 3).map((h) => (
          <button key={h.id} type="button" onClick={() => navigate(`/chat?c=${h.id}`)} className={rowBtn} title={h.reason}>
            <span className="truncate text-gray-200">{h.title}</span><ChevronLeft className="h-4 w-4 shrink-0 text-gray-500" />
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
      <CardHeader className="border-b border-gray-800 pb-3">
        <CardTitle className={head}><Hourglass className="w-4 h-4 text-orange-400" /> פולו-אפ</CardTitle>
      </CardHeader>
      <CardContent className="p-2 space-y-1">
        <button type="button" onClick={() => navigate("/chat?box=followup")} className={rowBtn}>
          <span className="text-gray-200">ממתינים בוואטסאפ</span>
          <span className="rounded-full bg-orange-500/20 px-2 text-xs font-bold text-orange-200">{s.awaitingCount}</span>
        </button>
        <button type="button" onClick={() => navigate("/Leads")} className={rowBtn}>
          <span className="text-gray-200">לידים בלי קשר שבוע+</span>
          <span className="rounded-full bg-gray-800 px-2 text-xs font-bold text-gray-200">{s.staleLeads.length}</span>
        </button>
        {s.staleLeads.slice(0, 2).map((l) => (
          <div key={l.key} className="flex justify-between px-2 text-xs text-gray-400"><span className="truncate">{l.name}</span><span>{l.days} ימים</span></div>
        ))}
        <button type="button" onClick={() => navigate("/chat?box=followup")} className="mt-1 w-full rounded-lg bg-orange-500 py-1.5 text-sm font-semibold text-white hover:bg-orange-600">
          שלח פולו-אפ
        </button>
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
      <CardHeader className="border-b border-gray-800 pb-3">
        <CardTitle className={head}><Signature className="w-4 h-4 text-emerald-400" /> חתמו · בתהליך</CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {list.length === 0 && <p className="py-6 text-center text-sm text-gray-500">אין זוגות בתהליך ✅</p>}
        {list.slice(0, 5).map((l) => (
          <button key={l.id} type="button" onClick={() => setOpenLead(l)} className={rowBtn}>
            <span className="min-w-0">
              <span className="block truncate text-gray-200">{l.coupleNames}</span>
              <span className="block truncate text-xs text-gray-500">
                {l.eventDate ? String(l.eventDate).slice(0, 10).split("-").reverse().join("/") : "בלי תאריך"}{l.venueName ? ` · ${l.venueName}` : ""}
              </span>
            </span>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 text-[11px] text-emerald-200">שלב {stepIndex(l)}/{STEPS.length}</span>
          </button>
        ))}
      </CardContent>
      {openLead && <PostSignWizard lead={openLead} isOpen onClose={() => { setOpenLead(null); q.refetch(); }} />}
    </Card>
  );
}
