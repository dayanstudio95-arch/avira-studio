import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, X, LayoutGrid, SlidersHorizontal, LogOut, Bell, Flame, Hourglass, Settings2, History, Users, Phone, AlertCircle, BookImage, CalendarClock } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import { BOXES, DEFAULT_BOX, boxCounts, matchesBox, matchesSearch, sortConversations, needsReply } from "@/lib/chatModel";
import { isAwaitingFollowUp } from "@/lib/followUpQueue";
import WhatsAppFollowUpDialog from "@/components/whatsapp/WhatsAppFollowUpDialog";
import WhatsAppFollowUpSettingsDialog from "@/components/whatsapp/WhatsAppFollowUpSettingsDialog";
import MeetingDialog from "@/components/meetings/MeetingDialog";
import MeetingsList, { useMeetings, MEETINGS_KEY } from "@/components/meetings/MeetingsList";
import { nextSoon, kindLabel as meetingKindLabel, utcToIsraelParts } from "@/lib/meetings";
import { shortCoupleNames } from "@/lib/chatModel";
import { useChatData } from "@/components/chat/useChatData";
import { useThread } from "@/components/chat/useThread";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatList, { conversationTitle, AvatarUrlContext } from "@/components/chat/ChatList";
import ChatThread from "@/components/chat/ChatThread";
import ContactPanel from "@/components/chat/ContactPanel";
import NotificationSettings from "@/components/chat/NotificationSettings";
import { registerChatServiceWorker, setBadge } from "@/lib/push";

// "אווירה צ'אט" — the WhatsApp inbox as its own app (WhatsApp Pro stage 1א, 2026-10-05).
//
// Same data and same database as the system; opened at /chat, without the system's
// sidebar, and installable on the iPhone home screen (chat.html + manifest-chat.json).
// The old page (/WhatsAppInbox) is untouched and keeps working alongside it.
//
// Nothing here sends to more than one person: bulk SENDING is stage 2 (the safety
// rules agreed with the owner). Bulk SORTING is here, and every change can be undone.

// The bottom bar on a phone (the owner's choice, 2026-10-07): clients and three of his own
// labels, found by name — a label that doesn't exist (renamed, deleted) is simply left out.
const BOTTOM_LABEL_TABS = [
  { name: "לחזור בטלפון", icon: Phone },
  { name: "דחוף", icon: AlertCircle },
  { name: "אלבומים", icon: BookImage },
];
// The tab rows above the list (2026-10-07, as in the old inbox). On a phone: two rows —
// לא מוכר · לידים · ליד חם / לא נקראו · פולו אפ · הכל · עוד. Everything else is under "עוד".
const PRIMARY_BOXES = BOXES.filter((b) => b.primary);
const CHIP_ROWS = [["unknown", "lead", "hot"], ["unread", "followup", "all"]];
const CHIP_ICONS = { followup: Hourglass, hot: Flame };

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function ChatApp() {
  const data = useChatData();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get("c");
  const setActiveId = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set("c", id);
    else next.delete("c");
    setParams(next, { replace: !id });
  };

  // ?box=followup (the dashboard's "שלח פולו-אפ") opens on that box.
  const [box, setBox] = useState(() => {
    const b = new URLSearchParams(window.location.search).get("box");
    return b && BOXES.some((x) => x.key === b) ? b : DEFAULT_BOX;
  });
  const [search, setSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState({});
  const [panelOpen, setPanelOpen] = useState(() => window.matchMedia?.("(min-width: 1280px)").matches ?? false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [leadDialog, setLeadDialog] = useState(null); // { conversationId, values }
  const [notifOpen, setNotifOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpSettingsOpen, setFollowUpSettingsOpen] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [meetingDialog, setMeetingDialog] = useState(null); // { initial }
  const meetingsQ = useMeetings();
  const soonMeeting = nextSoon(meetingsQ.data || []);

  // A tap on a meeting reminder opens /chat?meeting=<id>: that tap IS "ראיתי" (no second
  // reminder), and the meetings list opens.
  const meetingParam = params.get("meeting");
  useEffect(() => {
    if (!meetingParam) return;
    base44.entities.SalesMeeting.update(meetingParam, { acknowledgedAt: new Date().toISOString() })
      .then(() => qc.invalidateQueries({ queryKey: MEETINGS_KEY }))
      .catch(() => {});
    setMeetingsOpen(true);
    const next = new URLSearchParams(params);
    next.delete("meeting");
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingParam]);

  // The chat lives outside Layout, so the menu's "hot lead" badge (notification type
  // whatsapp_hot_lead → /chat) is cleared here, as Layout does for every other page.
  useEffect(() => {
    if (!isAdmin(data.user)) return;
    base44.entities.Notification.filter({ type: "whatsapp_hot_lead", isRead: false })
      .then((rows) => {
        const readAt = new Date().toISOString();
        return Promise.all((rows || []).map((n) => base44.entities.Notification.update(n.id, { isRead: true, readAt })));
      })
      .catch(() => {});
  }, [data.user]);

  // Opened from the system (index.html, white page) the area under the bottom bar on an
  // iPhone showed white. The page behind the app is dark while the chat is open.
  useEffect(() => {
    const html = document.documentElement, body = document.body;
    const prev = [html.style.background, body.style.background];
    html.style.background = "#030712";
    body.style.background = "#030712";
    return () => { html.style.background = prev[0]; body.style.background = prev[1]; };
  }, []);

  useEffect(() => {
    document.title = "אווירה צ'אט";
    // Notifications only (it caches nothing). Registered on every open so a tap on a
    // notification always finds it.
    registerChatServiceWorker();
  }, []);

  // The number on the home-screen icon: conversations with unread messages.
  const unreadConversations = Object.values(data.unread).filter((n) => n > 0).length;
  useEffect(() => {
    setBadge(unreadConversations);
  }, [unreadConversations]);

  const labelsById = useMemo(() => Object.fromEntries(data.labels.map((l) => [l.id, l])), [data.labels]);
  const ctx = { unread: data.unread, labelsByConv: data.labelsByConv, followUpAfterDays: data.followUpAfterDays };
  const counts = useMemo(
    () => boxCounts(data.conversations, ctx, data.labels.map((l) => l.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.conversations, data.unread, data.labelsByConv, data.followUpAfterDays, data.labels]
  );

  // The follow-up queue, for the bulk send (WhatsAppFollowUpDialog, from the old inbox).
  const followUpQueue = useMemo(
    () => data.conversations.filter((c) => !c.archivedAt && !c.optedOutAt && isAwaitingFollowUp(c, data.followUpAfterDays || 0)),
    [data.conversations, data.followUpAfterDays]
  );

  // Message search on the server (the text of every message), names/numbers locally.
  const q = useDebounced(search.trim(), 300);
  const searchQ = useQuery({
    queryKey: ["chatSearch", q],
    queryFn: async () => {
      const { data: rows, error } = await supabase.rpc("whatsapp_search_messages", { q });
      if (error) throw error;
      const hits = {};
      for (const r of rows || []) if (!hits[r.conversation_id]) hits[r.conversation_id] = r.body_text;
      return hits;
    },
    enabled: q.length >= 2,
  });
  const searchHits = q.length >= 2 ? searchQ.data || {} : null;

  const visible = useMemo(() => {
    const list = q
      ? data.conversations.filter((c) => matchesSearch(c, q) || searchHits?.[c.id])
      : data.conversations.filter((c) => matchesBox(c, box, ctx));
    return sortConversations(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.conversations, box, q, searchHits, data.unread, data.labelsByConv, data.followUpAfterDays]);

  // Profile pictures: one signed-URL request for every picture on screen (private bucket).
  const avatarPaths = useMemo(
    () => Array.from(new Set(data.conversations.map((c) => c.avatarPath).filter(Boolean))).sort(),
    [data.conversations]
  );
  const avatarQ = useQuery({
    queryKey: ["chatAvatarUrls", avatarPaths.join("|")],
    queryFn: async () => {
      const out = {};
      for (let i = 0; i < avatarPaths.length; i += 200) {
        const { data: signed, error } = await supabase.storage.from("whatsapp-media").createSignedUrls(avatarPaths.slice(i, i + 200), 6 * 3600);
        if (error) throw error;
        for (const s of signed || []) if (s.signedUrl) out[s.path] = s.signedUrl;
      }
      return out;
    },
    enabled: avatarPaths.length > 0,
    staleTime: 5 * 3600 * 1000,
  });
  const avatarUrls = avatarQ.data || {};

  const active = data.conversations.find((c) => c.id === activeId) || null;
  const activeLead = active?.matchedLeadId ? data.leadsById[active.matchedLeadId] : null;
  const thread = useThread(active?.id);

  // Opening a conversation reads it; a new message while it is open and visible too.
  const activeUnread = active ? data.unread[active.id] || 0 : 0;
  useEffect(() => {
    if (!active) return;
    if (document.visibilityState === "visible") data.actions.markRead(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, activeUnread]);

  // Back from the background on a phone: catch up at once instead of waiting for a poll.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        qc.invalidateQueries({ queryKey: ["chatConversations"] });
        qc.invalidateQueries({ queryKey: ["chatUnread"] });
        if (activeId) qc.invalidateQueries({ queryKey: ["chatMessages", activeId] });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [qc, activeId]);

  // ---- Actions with undo -------------------------------------------------------
  const run = async (promise, doneText) => {
    try {
      const res = await promise;
      if (res?.count === 0) {
        toast.info("לא היה מה לשנות");
        return;
      }
      toast(doneText(res), {
        duration: 10000,
        action: res?.batchId
          ? {
              label: "בטל",
              onClick: async () => {
                try {
                  await data.actions.undo(res.batchId);
                  toast.success("בוטל");
                } catch (e) {
                  toast.error("הביטול נכשל", { description: e?.message });
                }
              },
            }
          : undefined,
      });
    } catch (e) {
      toast.error("הפעולה נכשלה", { description: e?.message });
    }
  };

  const convsByIds = (ids) => data.conversations.filter((c) => ids.includes(c.id));

  const onBulk = async (kind, value, ids) => {
    const convs = convsByIds(ids);
    const n = (r) => r?.count ?? convs.length;
    if (kind === "type") {
      await run(data.actions.setType(convs, value), (r) => `${n(r)} שיחות סומנו · נרשם בהיסטוריה`);
    } else if (kind === "stage") {
      await run(data.actions.setStage(convs, value, data.leadsById), (r) => `${n(r)} שיחות → "${value}"${r?.crm ? ` · ${r.crm} מהן עודכנו גם בדף הלידים` : ""}`);
    } else if (kind === "label") {
      await run(data.actions.addLabel(convs, value), (r) => `התווית "${labelsById[value]?.name}" נוספה ל-${n(r)} שיחות`);
    } else if (kind === "unlabel") {
      await run(data.actions.removeLabel(convs, value), (r) => `התווית "${labelsById[value]?.name}" הוסרה מ-${n(r)} שיחות`);
    } else if (kind === "followup") {
      await run(data.actions.setFollowUpFlag(convs, value), (r) => (value ? `${n(r)} שיחות נכנסו לפולו-אפ` : `${n(r)} שיחות הוסרו מהפולו-אפ`));
    } else if (kind === "archive") {
      await run(data.actions.setArchived(convs, true), (r) => `${n(r)} שיחות הועברו לארכיון`);
    } else if (kind === "handled") {
      await run(data.actions.setHandled(convs, true), (r) => `${n(r)} שיחות סומנו "טופל" · יחזרו לבד כשיכתבו שוב`);
    } else if (kind === "pin") {
      await run(data.actions.setPinned(convs, true), (r) => `${n(r)} שיחות ננעצו למעלה`);
    }
    setSelected({});
    setSelectMode(false);
  };

  const one = active ? [active] : [];
  const openMeetingFor = (c) => {
    const lead = c.matchedLeadId ? data.leadsById[c.matchedLeadId] : null;
    setMeetingDialog({
      initial: {
        title: lead?.coupleNames || shortCoupleNames(c.coupleNames) || c.displayName || c.phone || "",
        phone: c.callbackPhone || c.phone || lead?.phoneNumber || "",
        conversationId: c.id,
        leadId: c.matchedLeadId || null,
      },
    });
  };
  const panelProps = active && {
    conversation: active,
    lead: activeLead,
    labels: data.labels,
    labelsById,
    convLabelIds: data.labelsByConv[active.id] || [],
    activity: thread.activity,
    onSetType: (type) => run(data.actions.setType(one, type), () => "סוג השיחה עודכן"),
    onSetStage: (stage) =>
      run(data.actions.setStage(one, stage, data.leadsById), (r) => (r?.crm ? `השלב עודכן ל"${stage}" — גם בדף הלידים` : `השלב נשמר בשיחה בלבד. אין ליד ב-CRM עד שתלחץ "צור ליד"`)),
    onToggleLabel: (labelId, on) =>
      run(on ? data.actions.removeLabel(one, labelId) : data.actions.addLabel(one, labelId), () => (on ? "התווית הוסרה" : "התווית נוספה")),
    onToggleBot: async (enabled) => {
      try {
        await data.actions.setBotEnabled(active, enabled);
        toast.success(enabled ? "הבוט פעיל בשיחה" : "הבוט מושתק בשיחה");
      } catch (e) {
        toast.error("השינוי נכשל", { description: e?.message });
      }
    },
    onToggleOptOut: (on) => run(data.actions.setOptedOut(active, on), () => (on ? "סומן: לא לשלוח הודעות מרוכזות" : "הסימון הוסר")),
    onArchive: () => run(data.actions.setArchived(one, !active.archivedAt), () => (active.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון · יחזור לבד כשיכתבו שוב")),
    onPin: () => run(data.actions.setPinned(one, !active.pinnedAt), () => (active.pinnedAt ? "בוטלה הנעיצה" : "ננעץ למעלה")),
    onScheduleMeeting: () => openMeetingFor(active),
    onCreateLead: () => {
      const c = active;
      const notes = [];
      if (c.guestCount) notes.push(`כמות מוזמנים: ${c.guestCount}`);
      if (c.source === "facebook_ad") notes.push(`הגיע דרך מודעה בפייסבוק${c.sourceAdTitle ? ` (${c.sourceAdTitle})` : ""}`);
      notes.push(`נוצר משיחת וואטסאפ עם ${c.phone || c.chatId}`);
      setLeadDialog({
        conversationId: c.id,
        values: {
          coupleNames: c.coupleNames || c.displayName || "",
          eventDate: c.eventDate || "",
          phoneNumber: c.callbackPhone || c.phone || "",
          venueName: c.venue || "",
          notes: notes.join(" | "),
          ...(c.leadStage ? { status: c.leadStage } : {}),
        },
      });
    },
  };

  // ---- Templates -----------------------------------------------------------------
  const saveTemplate = async (t) => {
    try {
      if (t.id) await base44.entities.WhatsAppTemplate.update(t.id, { name: t.name.trim(), body: t.body.trim(), updatedAt: new Date().toISOString() });
      else await base44.entities.WhatsAppTemplate.create({ name: t.name.trim(), body: t.body.trim(), sortOrder: (data.templates.length + 1) * 10 });
      qc.invalidateQueries({ queryKey: ["chatTemplates"] });
      toast.success("התבנית נשמרה");
    } catch (e) {
      toast.error("שמירת התבנית נכשלה", { description: e?.message });
    }
  };
  const deleteTemplate = async (id) => {
    await base44.entities.WhatsAppTemplate.delete(id);
    qc.invalidateQueries({ queryKey: ["chatTemplates"] });
  };

  // ---- Keyboard (computer): j/k next/previous, e archive, Esc closes ------------
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (["input", "textarea", "select"].includes(tag) || e.target?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = visible.findIndex((c) => c.id === activeId);
      if (e.key === "j" || e.key === "ArrowDown") {
        const next = visible[Math.min(visible.length - 1, idx + 1)];
        if (next) { e.preventDefault(); setActiveId(next.id); }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const prev = visible[Math.max(0, idx - 1)];
        if (prev) { e.preventDefault(); setActiveId(prev.id); }
      } else if (e.key === "d" && active && needsReply(active)) {
        e.preventDefault();
        run(data.actions.setHandled([active], true), () => 'סומן "טופל"');
      } else if (e.key === "e" && active) {
        e.preventDefault();
        panelProps.onArchive();
      } else if (e.key === "Escape") {
        if (selectMode) { setSelectMode(false); setSelected({}); } else if (panelOpen) setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const title = q ? `חיפוש: ${q}` : box.startsWith("label:") ? `תווית: ${labelsById[box.slice(6)]?.name || ""}` : BOXES.find((b) => b.key === box)?.label;

  const chip = (key) => {
    const b = BOXES.find((x) => x.key === key);
    const on = box === key && !q;
    const n = counts[key] || 0;
    const Icon = CHIP_ICONS[key];
    const alert = key === "hot" && n > 0;
    return (
      <button
        key={key}
        type="button"
        onClick={() => { setBox(key); setSearch(""); }}
        className={`flex min-h-[36px] items-center justify-center gap-1 rounded-full text-sm md:min-h-[30px] md:flex-none md:px-2.5 md:text-xs ${key === "all" ? "flex-none px-3.5" : "min-w-0 flex-1 px-2"} ${on ? "bg-yellow-400 font-semibold text-gray-900" : "border border-gray-800 bg-gray-800/70 text-gray-300"}`}
      >
        {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${key === "hot" && !on ? "text-orange-400" : ""}`} aria-hidden="true" />}
        <span className="truncate">{b.label}</span>
        {key !== "all" && n > 0 && (
          <span className={`shrink-0 rounded-full px-1.5 text-[11px] font-bold ${on ? "bg-gray-900/20" : alert ? "bg-red-500 text-white" : "bg-gray-700 text-gray-200"}`}>{n}</span>
        )}
      </button>
    );
  };
  const onMoreBox = !PRIMARY_BOXES.some((b) => b.key === box) && !q;
  const chips = (
    <div className="space-y-1.5 md:flex md:flex-wrap md:gap-1.5 md:space-y-0">
      {CHIP_ROWS.map((row, i) => (
        <div key={i} className="flex gap-1.5 md:contents">
          {row.map(chip)}
          {i === CHIP_ROWS.length - 1 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={`flex min-h-[36px] flex-none items-center justify-center rounded-full border px-3 text-sm md:hidden ${onMoreBox ? "border-yellow-500 bg-yellow-400/10 text-yellow-300" : "border-gray-800 bg-gray-800/70 text-gray-400"}`}
            >
              עוד ▾
            </button>
          )}
        </div>
      ))}
    </div>
  );

  // A meeting in the next hour: a bar above the list, so it can't be missed.
  const meetingBanner = soonMeeting && (
    <button
      type="button"
      onClick={() => setMeetingsOpen(true)}
      className="flex w-full items-center gap-2 border-b border-red-900/60 bg-red-950/40 px-3.5 py-2 text-start text-sm text-red-100"
    >
      <CalendarClock className="h-4 w-4 shrink-0 text-red-300" />
      <span className="min-w-0 flex-1 truncate">
        {utcToIsraelParts(soonMeeting.startsAt).time} · {meetingKindLabel(soonMeeting.kind)} עם {soonMeeting.title}
      </span>
      <span className="shrink-0 text-xs text-red-300">לפגישות ›</span>
    </button>
  );

  const bottomTabs = [
    { key: "client", label: "לקוחות", icon: Users },
    ...BOTTOM_LABEL_TABS.map((t) => {
      const l = data.labels.find((x) => x.name === t.name);
      return l ? { key: "label:" + l.id, label: t.name, icon: t.icon, color: l.color } : null;
    }).filter(Boolean),
  ];

  // In the follow-up box: the bulk send and its settings (from the old inbox).
  const followUpBar = box === "followup" && !q && (
    <div className="flex items-center justify-between gap-2 border-b border-gray-800 bg-orange-950/30 px-3.5 py-2 text-sm">
      <span className="text-orange-100">{followUpQueue.length} ממתינים לפולו-אפ</span>
      <span className="flex gap-1.5">
        <button type="button" onClick={() => setFollowUpSettingsOpen(true)} className="flex min-h-[32px] items-center gap-1 rounded-full border border-gray-700 px-3 text-xs text-gray-300 hover:text-white">
          <Settings2 className="h-3.5 w-3.5" /> הגדרות
        </button>
        <button
          type="button"
          disabled={followUpQueue.length === 0}
          onClick={() => setFollowUpOpen(true)}
          className="min-h-[32px] rounded-full bg-orange-500 px-3 text-xs font-semibold text-white disabled:opacity-40"
        >
          שלח פולו-אפ
        </button>
      </span>
    </div>
  );

  return (
    <AvatarUrlContext.Provider value={avatarUrls}>
    <div dir="rtl" className="avira-d avira-chat e-page fixed inset-0 flex w-full overflow-hidden text-gray-100 md:gap-3 md:p-3">
      <ChatSidebar
        className="chat-col hidden w-60 shrink-0 md:flex"
        box={q ? "" : box}
        setBox={(k) => { setBox(k); setSearch(""); setSelected({}); }}
        counts={counts}
        labels={data.labels}
        onCreateLabel={async (name, color) => {
          try { await data.actions.createLabel(name, color); toast.success("התווית נוצרה"); } catch (e) { toast.error("יצירת התווית נכשלה", { description: e?.message }); }
        }}
        onOpenNotifications={() => setNotifOpen(true)}
        onOpenMeetings={() => setMeetingsOpen(true)}
        onDeleteLabel={async (id) => {
          try { await data.actions.deleteLabel(id); if (box === "label:" + id) setBox(DEFAULT_BOX); toast.success("התווית נמחקה"); } catch (e) { toast.error("המחיקה נכשלה", { description: e?.message }); }
        }}
      />

      {/* List: full screen on a phone when no conversation is open */}
      <div className={`chat-col min-h-0 min-w-0 flex-col md:flex md:w-[360px] md:flex-none md:shrink-0 ${active ? "hidden" : "flex flex-1"} pt-[env(safe-area-inset-top)] md:pt-0`}>
        <ChatList
          title={title}
          conversations={visible}
          activeId={activeId}
          onOpen={(c) => setActiveId(c.id)}
          unread={data.unread}
          labelsById={labelsById}
          labelsByConv={data.labelsByConv}
          leadsById={data.leadsById}
          search={search}
          setSearch={setSearch}
          searchHits={searchHits}
          selectMode={selectMode}
          setSelectMode={setSelectMode}
          selected={selected}
          setSelected={setSelected}
          labels={data.labels}
          onBulk={onBulk}
          mobileChips={chips}
          topBar={<>{meetingBanner}{followUpBar}</>}
          compact
        />
        {!selectMode && (
          <nav aria-label="ניווט" className="flex border-t border-gray-800 bg-gray-950 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden">
            {bottomTabs.map((t) => {
              const on = box === t.key && !q;
              const n = counts[t.key] || 0;
              return (
                <button key={t.key} type="button" onClick={() => { setBox(t.key); setSearch(""); }} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-yellow-400" : "text-gray-400"}`}>
                  <t.icon className="h-6 w-6" aria-hidden="true" style={!on && t.color ? { color: t.color } : undefined} />
                  {t.label}
                  {n > 0 && (
                    <span className="absolute right-[calc(50%-22px)] top-1 rounded-full bg-yellow-400 px-1.5 text-[10px] font-bold text-gray-900">{n}</span>
                  )}
                </button>
              );
            })}
            {/* "עוד" is the last tab chip above the list (2026-10-07: the bottom bar is the
                owner's four boxes — לקוחות · לחזור בטלפון · דחוף · אלבומים). */}
          </nav>
        )}
      </div>

      {/* Thread */}
      {active ? (
        <div className="chat-col chat-thread flex min-h-0 min-w-0 flex-1 flex-col pt-[env(safe-area-inset-top)] md:pt-0">
          <ChatThread
            conversation={active}
            lead={activeLead}
            labels={(data.labelsByConv[active.id] || []).map((id) => labelsById[id]).filter(Boolean)}
            thread={thread}
            onBack={() => setActiveId(null)}
            onTogglePanel={() => setPanelOpen((v) => !v)}
            onPin={panelProps.onPin}
            onArchive={panelProps.onArchive}
            needsReplyNow={needsReply(active)}
            onHandled={() => run(data.actions.setHandled([active], true), () => 'סומן "טופל" · יחזור ל"דורש מענה" כשיכתבו שוב')}
            inFollowUp={isAwaitingFollowUp(active, data.followUpAfterDays || 0)}
            onScheduleMeeting={() => openMeetingFor(active)}
            onToggleFollowUp={(on) => run(data.actions.setFollowUpFlag([active], on), () => (on ? "נוסף לתור הפולו-אפ" : "הוסר מתור הפולו-אפ"))}
            templates={data.templates}
            onSaveTemplate={saveTemplate}
            onDeleteTemplate={deleteTemplate}
            userContext={{ tenantId: data.user?.tenant_id, userId: data.user?.id }}
          />
        </div>
      ) : (
        <div className="chat-col chat-thread hidden flex-1 flex-col items-center justify-center gap-3 text-gray-500 md:flex">
          <MessageSquare className="h-12 w-12 text-gray-700" />
          <p>בחר שיחה מהרשימה</p>
          <p className="text-xs text-gray-600">קיצורים: J / K מעבר בין שיחות · D טופל · E ארכיון · Esc סגירה</p>
        </div>
      )}

      {/* Contact panel: a column on a wide screen, a bottom sheet on a phone */}
      {active && panelOpen && (
        <>
          <aside aria-label="פרטים ותיוג" className="chat-col hidden w-[320px] shrink-0 overflow-y-auto bg-gray-950 p-4 xl:block">
            <ContactPanel {...panelProps} />
          </aside>
          <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 xl:hidden" onClick={() => setPanelOpen(false)}>
            <div
              role="dialog"
              aria-label="פרטים ותיוג"
              onClick={(e) => e.stopPropagation()}
              className="max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:mx-auto md:w-[480px] md:rounded-3xl md:border"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="mx-auto h-1.5 w-10 rounded-full bg-gray-700" />
                <button type="button" onClick={() => setPanelOpen(false)} className="min-h-[36px] rounded-full bg-gray-800 px-4 text-sm text-yellow-400">סיום</button>
              </div>
              <ContactPanel {...panelProps} />
            </div>
          </div>
        </>
      )}

      {/* "עוד" on a phone: every box, the labels, the way back to the system */}
      {moreOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 md:hidden" onClick={() => setMoreOpen(false)}>
          <div role="dialog" aria-label="עוד" onClick={(e) => e.stopPropagation()} className="max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-lg font-bold">תיבות</span>
              <button type="button" onClick={() => setMoreOpen(false)} aria-label="סגור" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {BOXES.map((b) => (
                <button key={b.key} type="button" onClick={() => { setBox(b.key); setSearch(""); setMoreOpen(false); }} className={`flex min-h-[48px] items-center justify-between rounded-xl px-3 text-sm ${box === b.key ? "bg-yellow-400/15 text-yellow-300" : "bg-gray-900 text-gray-200"}`}>
                  <span>{b.label}</span><span className="text-xs text-gray-500">{counts[b.key] || 0}</span>
                </button>
              ))}
              {data.labels.map((l) => (
                <button key={l.id} type="button" onClick={() => { setBox("label:" + l.id); setSearch(""); setMoreOpen(false); }} className="flex min-h-[48px] items-center justify-between rounded-xl bg-gray-900 px-3 text-sm text-gray-200">
                  <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />{l.name}</span>
                  <span className="text-xs text-gray-500">{counts["label:" + l.id] || 0}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-1 border-t border-gray-800 pt-3">
              <Link to="/BotControlCenter" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-gray-300"><SlidersHorizontal className="h-5 w-5" /> מרכז שליטה לבוט</Link>
              <button type="button" onClick={() => { setMoreOpen(false); setMeetingsOpen(true); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-yellow-300"><CalendarClock className="h-5 w-5" /> פגישות</button>
              <Link to="/" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-gray-300"><LayoutGrid className="h-5 w-5" /> למערכת המלאה</Link>
              <Link to="/WhatsAppInbox" className="flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-gray-500"><History className="h-5 w-5" /> מסך השיחות הישן (גיבוי)</Link>
              <button type="button" onClick={() => logout()} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-gray-400"><LogOut className="h-5 w-5" /> התנתקות</button>
            </div>
            <button type="button" onClick={() => { setMoreOpen(false); setNotifOpen(true); }} className="mt-1 flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-gray-300"><Bell className="h-5 w-5" /> התראות במכשיר הזה</button>
          </div>
        </div>
      )}

      {notifOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 md:items-center md:justify-center" onClick={() => setNotifOpen(false)}>
          <div role="dialog" aria-label="התראות" onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:w-[460px] md:rounded-3xl md:border">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-lg font-bold">התראות</span>
              <button type="button" onClick={() => setNotifOpen(false)} aria-label="סגור" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <NotificationSettings tenantId={data.user?.tenant_id} userId={data.user?.id} />
          </div>
        </div>
      )}

      {meetingsOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/60 md:items-center md:justify-center" onClick={() => setMeetingsOpen(false)}>
          <div role="dialog" aria-label="פגישות" onClick={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-gray-800 bg-gray-950 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[560px] md:rounded-3xl md:border">
            <div className="flex items-center justify-between px-4 pt-4">
              <span className="flex items-center gap-2 text-lg font-bold"><CalendarClock className="h-5 w-5 text-yellow-400" /> פגישות</span>
              <button type="button" onClick={() => setMeetingsOpen(false)} aria-label="סגור" className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <MeetingsList onOpenConversation={(id) => { setMeetingsOpen(false); setActiveId(id); }} />
            </div>
          </div>
        </div>
      )}

      <MeetingDialog
        isOpen={!!meetingDialog}
        onClose={() => setMeetingDialog(null)}
        meeting={null}
        initial={meetingDialog?.initial}
        onSaved={() => qc.invalidateQueries({ queryKey: MEETINGS_KEY })}
      />

      <WhatsAppFollowUpSettingsDialog
        isOpen={followUpSettingsOpen}
        onClose={() => setFollowUpSettingsOpen(false)}
        onSaved={() => qc.invalidateQueries({ queryKey: ["whatsappFollowUpAfterDays"] })}
      />

      <WhatsAppFollowUpDialog
        isOpen={followUpOpen}
        onClose={() => setFollowUpOpen(false)}
        conversations={followUpQueue}
        onSent={() => qc.invalidateQueries({ queryKey: ["chatConversations"] })}
      />

      <LeadFormDialog
        isOpen={!!leadDialog}
        onClose={() => setLeadDialog(null)}
        lead={null}
        initialValues={leadDialog?.values}
        packagePrices={{}}
        onSaved={async (created) => {
          const id = leadDialog?.conversationId;
          setLeadDialog(null);
          if (id && created?.id) {
            try {
              await data.actions.linkLead(id, created.id);
              toast.success(`הליד נוצר בדף הלידים וקושר לשיחה עם ${conversationTitle(active)}`);
            } catch {
              toast.success("הליד נוצר. השיחה תקושר אליו בהודעה הבאה");
            }
          }
        }}
      />
    </div>
    </AvatarUrlContext.Provider>
  );
}
