import React, { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Phone, Video, Users, Check, X, Pencil, Send, MessageSquare, Eye, Plus, Loader2 } from "lucide-react";
import { groupMeetings, GROUP_LABELS, kindLabel, startsInLabel, utcToIsraelParts, meetingMessageForCouple } from "@/lib/meetings";
import MeetingDialog from "./MeetingDialog";

const KIND_STYLE = {
  call: { icon: Phone, cls: "bg-blue-500/20 text-blue-200" },
  zoom: { icon: Video, cls: "bg-violet-500/20 text-violet-200" },
  in_person: { icon: Users, cls: "bg-teal-500/20 text-teal-200" },
};

export const MEETINGS_KEY = ["salesMeetings"];

// Upcoming meetings + the last 30 days. Shared by the chat app and the /Meetings page.
export function useMeetings() {
  return useQuery({
    queryKey: MEETINGS_KEY,
    queryFn: () =>
      base44.entities.SalesMeeting.filter(
        { startsAt: { $gte: new Date(Date.now() - 30 * 86400000).toISOString() } },
        "startsAt",
        500
      ),
    refetchInterval: 60000,
  });
}

// The list (2026-10-07): today / tomorrow / this week / later / past. Row actions: ראיתי
// (after a reminder), בוצע, בוטל, edit, send the couple the details (WhatsApp, only on a click
// and after a confirm), open the conversation or the lead.
export default function MeetingsList({ onOpenConversation, onOpenLead, showAdd = true }) {
  const qc = useQueryClient();
  const q = useMeetings();
  const [edit, setEdit] = useState(null); // { meeting } | { initial: {} }
  const [busy, setBusy] = useState(null);
  const groups = useMemo(() => groupMeetings(q.data || []), [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: MEETINGS_KEY });

  const update = async (m, values, done) => {
    setBusy(m.id);
    try {
      await base44.entities.SalesMeeting.update(m.id, { ...values, updatedAt: new Date().toISOString() });
      toast.success(done);
      refresh();
    } catch (e) {
      toast.error("העדכון נכשל", { description: e?.message });
    }
    setBusy(null);
  };

  const sendToCouple = async (m) => {
    if (!m.phone) { toast.error("אין טלפון לפגישה הזו"); return; }
    const text = meetingMessageForCouple(m);
    if (!window.confirm(`לשלוח ל-${m.title} (${m.phone}):\n\n${text}`)) return;
    setBusy(m.id);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: m.phone, message: text });
      if (res.data?.error) throw new Error(res.data.error);
      toast.success("פרטי הפגישה נשלחו לזוג");
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setBusy(null);
  };

  const row = (m) => {
    const k = KIND_STYLE[m.kind] || KIND_STYLE.call;
    const soon = m.status === "scheduled" ? startsInLabel(m.startsAt) : null;
    const urgent = soon && soon.includes("דק׳");
    const waitingAck = m.status === "scheduled" && m.reminderSentAt && !m.acknowledgedAt;
    const btn = "flex min-h-[32px] items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2.5 text-xs text-gray-200 hover:text-white disabled:opacity-40";
    return (
      <div key={m.id} className="border-b border-gray-800/70 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-base font-bold text-white">{utcToIsraelParts(m.startsAt).time}</span>
          <span className="min-w-0 flex-1 truncate font-semibold text-white">{m.title}</span>
          <span className={`flex shrink-0 items-center gap-1 rounded-full px-2 text-[11px] ${k.cls}`}>
            <k.icon className="h-3 w-3" /> {kindLabel(m.kind)}
          </span>
          {soon && <span className={`shrink-0 rounded-full px-2 text-[11px] ${urgent ? "bg-red-500/25 text-red-200" : "bg-gray-800 text-gray-300"}`}>{soon}</span>}
          {m.status === "done" && <span className="shrink-0 rounded-full bg-emerald-500/20 px-2 text-[11px] text-emerald-200">בוצע</span>}
          {m.status === "cancelled" && <span className="shrink-0 rounded-full bg-gray-700 px-2 text-[11px] text-gray-400 line-through">בוטל</span>}
        </div>
        <div className="mt-0.5 pr-14 text-xs text-gray-400">
          {!groups.today.includes(m) && !groups.tomorrow.includes(m) && `${utcToIsraelParts(m.startsAt).date.split("-").reverse().join(".")} · `}
          {[
            m.phone && <span key="p" dir="ltr">{m.phone}</span>,
            m.kind === "zoom" && m.zoomUrl && <a key="z" href={m.zoomUrl} target="_blank" rel="noopener noreferrer" className="text-violet-300 underline">קישור לזום</a>,
            m.kind === "in_person" && m.location && <span key="l">{m.location}</span>,
          ].filter(Boolean).reduce((acc, el, i) => (i ? [...acc, " · ", el] : [el]), [])}
          {m.notes && <div className="mt-0.5 whitespace-pre-wrap text-gray-500">{m.notes}</div>}
        </div>
        {m.status === "scheduled" && (
          <div className="mt-2 flex flex-wrap gap-1.5 pr-14">
            {waitingAck && (
              <button type="button" disabled={busy === m.id} onClick={() => update(m, { acknowledgedAt: new Date().toISOString() }, "סומן: ראיתי")} className={`${btn} border-yellow-600 text-yellow-200`}>
                <Eye className="h-3.5 w-3.5" /> ראיתי
              </button>
            )}
            <button type="button" disabled={busy === m.id} onClick={() => update(m, { status: "done", acknowledgedAt: m.acknowledgedAt || new Date().toISOString() }, "סומן: בוצע")} className={btn}>
              <Check className="h-3.5 w-3.5" /> בוצע
            </button>
            <button type="button" disabled={busy === m.id} onClick={() => setEdit({ meeting: m })} className={btn}>
              <Pencil className="h-3.5 w-3.5" /> עריכה
            </button>
            {m.phone && (
              <button type="button" disabled={busy === m.id} onClick={() => sendToCouple(m)} className={btn}>
                {busy === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} שלח לזוג את הפרטים
              </button>
            )}
            {m.conversationId && onOpenConversation && (
              <button type="button" onClick={() => onOpenConversation(m.conversationId)} className={btn}>
                <MessageSquare className="h-3.5 w-3.5" /> פתח שיחה
              </button>
            )}
            {m.leadId && onOpenLead && (
              <button type="button" onClick={() => onOpenLead(m.leadId)} className={btn}>פתח ליד</button>
            )}
            <button
              type="button"
              disabled={busy === m.id}
              onClick={() => window.confirm(`לבטל את הפגישה עם ${m.title}? לא תישלח תזכורת.`) && update(m, { status: "cancelled" }, "הפגישה בוטלה")}
              className={`${btn} text-red-300`}
            >
              <X className="h-3.5 w-3.5" /> בוטל
            </button>
          </div>
        )}
      </div>
    );
  };

  const order = ["today", "tomorrow", "week", "later", "past"];
  const empty = order.every((g) => groups[g].length === 0);

  return (
    <div className="min-h-0">
      {showAdd && (
        <div className="px-3.5 py-2.5">
          <button type="button" onClick={() => setEdit({ initial: {} })} className="flex min-h-[38px] items-center gap-1.5 rounded-full bg-yellow-400 px-4 text-sm font-semibold text-gray-900">
            <Plus className="h-4 w-4" /> פגישה חדשה
          </button>
        </div>
      )}
      {q.isLoading && <p className="px-4 py-6 text-center text-sm text-gray-500">טוען…</p>}
      {!q.isLoading && empty && <p className="px-4 py-10 text-center text-sm text-gray-500">אין פגישות. קובעים מתוך שיחה ← "📅 קבע פגישה", או "פגישה חדשה".</p>}
      {order.map((g) =>
        groups[g].length ? (
          <section key={g} aria-label={GROUP_LABELS[g]}>
            <h3 className="sticky top-0 z-10 bg-gray-950/95 px-3.5 py-1.5 text-xs font-semibold text-gray-400">
              {GROUP_LABELS[g]} · {groups[g].length}
            </h3>
            {groups[g].map(row)}
          </section>
        ) : null
      )}
      <MeetingDialog
        isOpen={!!edit}
        onClose={() => setEdit(null)}
        meeting={edit?.meeting || null}
        initial={edit?.initial}
        onSaved={refresh}
      />
    </div>
  );
}
