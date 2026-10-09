import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import MeetingDialog from "@/components/meetings/MeetingDialog";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { rowToRecord } from "@/api/entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays, MessageCircle, Flame, Hourglass, Signature, ChevronLeft, Target, FileText } from "lucide-react";
import { useMeetings, MEETINGS_KEY } from "@/components/meetings/MeetingsList";
import { kindLabel, utcToIsraelParts, todayIsrael } from "@/lib/meetings";
import { whatsappPulse, followUpSummary } from "@/lib/dashboardPulse";
import { fetchLeadPhoneIndex, LEAD_PHONE_INDEX_KEY, leadForPhone } from "@/lib/leadPhoneIndex";
import { isPostSignPending, STEPS, currentStep, SIGNED_STATUS } from "@/lib/postSignFlow";
import { todayInIsrael } from "@/lib/localDate";
import PostSignWizard from "@/components/postSign/PostSignWizard";
import DashTitleLink from "./DashTitleLink";

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

// A meeting opens its window right here (2026-10-09), with ✓ בוצע / ✕ בוטל beside it; the
// title goes to the /Meetings page.
export function MeetingsTodayCard() {
  const qc = useQueryClient();
  const q = useMeetings();
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(null);
  const setStatus = async (m, status) => {
    if (status === "cancelled" && !(await confirmDialog({ title: `לבטל את הפגישה עם ${m.title}?`, message: "לא תישלח תזכורת.", confirmText: "בטל פגישה", danger: true }))) return;
    setBusy(m.id);
    try {
      await base44.entities.SalesMeeting.update(m.id, { status, updatedAt: new Date().toISOString() });
      toast.success(status === "done" ? "הפגישה סומנה כבוצעה" : "הפגישה בוטלה");
      qc.invalidateQueries({ queryKey: MEETINGS_KEY });
    } catch (e) {
      toast.error("העדכון נכשל", { description: e?.message });
    }
    setBusy(null);
  };
  const today = todayIsrael();
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  const list = (q.data || [])
    .filter((m) => m.status === "scheduled")
    .map((m) => ({ ...m, parts: utcToIsraelParts(m.startsAt) }))
    .filter((m) => m.parts.date === today || m.parts.date === tomorrow)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));

  // The couple's wedding date and venue beside the name (2026-10-09): from the meeting's lead,
  // else the lead with that phone, else what the WhatsApp chat collected.
  const shown = list.slice(0, 6);
  const idxQ = useQuery({ queryKey: LEAD_PHONE_INDEX_KEY, queryFn: fetchLeadPhoneIndex, staleTime: 120000, enabled: shown.length > 0 });
  const leadIdOf = (m) => m.leadId || leadForPhone(idxQ.data, m.phone)?.id || null;
  const leadIds = [...new Set(shown.map(leadIdOf).filter(Boolean))].sort();
  const convIds = [...new Set(shown.map((m) => m.conversationId).filter(Boolean))].sort();
  const infoQ = useQuery({
    queryKey: ["dashMeetingInfo", leadIds.join(), convIds.join()],
    enabled: leadIds.length + convIds.length > 0,
    staleTime: 120000,
    queryFn: async () => {
      const [leads, convs] = await Promise.all([
        leadIds.length ? supabase.from("leads").select("id, event_date, venue_name").in("id", leadIds) : { data: [] },
        convIds.length ? supabase.from("whatsapp_conversations").select("id, event_date, venue").in("id", convIds) : { data: [] },
      ]);
      return {
        leads: Object.fromEntries((leads.data || []).map((l) => [l.id, { date: l.event_date, venue: l.venue_name }])),
        convs: Object.fromEntries((convs.data || []).map((c) => [c.id, { date: c.event_date, venue: c.venue }])),
      };
    },
  });
  const infoFor = (m) => {
    const l = infoQ.data?.leads[leadIdOf(m)] || {};
    const c = infoQ.data?.convs[m.conversationId] || {};
    const date = String(l.date || c.date || "").slice(0, 10);
    const venue = l.venue || c.venue || "";
    return [date ? date.split("-").reverse().map((x) => String(Number(x))).join(".") : "", venue].filter(Boolean).join(" · ");
  };

  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><DashTitleLink to="/Meetings"><CalendarDays className="w-5 h-5 text-amber-400" /> פגישות היום ומחר</DashTitleLink></CardTitle>
      </CardHeader>
      <CardContent className="e-scroll p-3 min-h-0 flex-1 overflow-y-auto">
        {list.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-slate-400">
            <CalendarDays className="h-11 w-11 text-slate-500/70" strokeWidth={1.25} />
            <span className="text-sm">אין פגישות היום ומחר</span>
          </div>
        )}
        {shown.map((m) => (
          <div key={m.id} className="rounded-lg pb-1.5 hover:bg-white/[0.04]">
            <button type="button" onClick={() => setOpen(m)} title="פרטי הפגישה" className="flex w-full min-w-0 items-center justify-between gap-2 px-2 pt-2 pb-1 text-start text-sm">
              <span className="min-w-0 text-gray-200">
                <span className="block truncate">
                  <span className="font-semibold text-white">{m.parts.date === today ? "" : "מחר "}{m.parts.time}</span> · {m.title}
                </span>
                {infoFor(m) && <span className="block truncate text-xs text-slate-400">💍 {infoFor(m)}</span>}
              </span>
              <span className="e-chip e-chip-blue shrink-0">{kindLabel(m.kind)}</span>
            </button>
            <div className="flex justify-end gap-1.5 px-2">
            <button type="button" disabled={busy === m.id} onClick={() => setStatus(m, "done")} title="בוצע" aria-label="בוצע" className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40">
              <Check className="h-3.5 w-3.5" /> בוצע
            </button>
            <button type="button" disabled={busy === m.id} onClick={() => setStatus(m, "cancelled")} title="ביטול" aria-label="ביטול" className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/15 px-2 text-xs font-medium text-red-300 hover:bg-red-500/30 disabled:opacity-40">
              <X className="h-3.5 w-3.5" /> ביטול
            </button>
            </div>
          </div>
        ))}
      </CardContent>
      {open && (
        <MeetingDialog
          isOpen
          meeting={open}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null);
            qc.invalidateQueries({ queryKey: MEETINGS_KEY });
          }}
        />
      )}
    </Card>
  );
}

export function WhatsAppPulseCard() {
  const navigate = useNavigate();
  const q = useDashConversations();
  const idxQ = useQuery({ queryKey: LEAD_PHONE_INDEX_KEY, queryFn: fetchLeadPhoneIndex, staleTime: 120000 });
  const p = useMemo(() => whatsappPulse(q.data || [], Date.now(), idxQ.data || null), [q.data, idxQ.data]);
  return (
    <Card className={shell}>
      <CardHeader className="dash-head pb-3">
        <CardTitle className={head}><DashTitleLink to="/chat"><MessageCircle className="w-5 h-5 text-emerald-400" /> וואטסאפ</DashTitleLink></CardTitle>
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
        <CardTitle className={head}><DashTitleLink to="/chat?box=followup"><Hourglass className="w-5 h-5 text-amber-400" /> פולו-אפ</DashTitleLink></CardTitle>
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
        <CardTitle className={head}><DashTitleLink to="/Leads"><Signature className="w-5 h-5 text-emerald-400" /> חתמו · בתהליך</DashTitleLink></CardTitle>
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
