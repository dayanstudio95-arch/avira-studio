import React, { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUpDown, Eye, ListChecks, Plus, MoreHorizontal, MessageSquare, X, LayoutGrid, SlidersHorizontal, LogOut, Bell, Flame, Hourglass, Settings2, History, CalendarClock } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import { BOXES, DEFAULT_BOX, boxCounts, matchesBox, matchesSearch, sortConversations, needsReply, isHotLead, orderBoxes, homeTypesFrom, mineSection, MINE_SECTIONS } from "@/lib/chatModel";
import { isAwaitingFollowUp, followUpsSentToday } from "@/lib/followUpQueue";
import WhatsAppFollowUpDialog from "@/components/whatsapp/WhatsAppFollowUpDialog";
import WhatsAppFollowUpSettingsDialog from "@/components/whatsapp/WhatsAppFollowUpSettingsDialog";
import MeetingDialog from "@/components/meetings/MeetingDialog";
import MeetingsList, { useMeetings, MEETINGS_KEY } from "@/components/meetings/MeetingsList";
import { nextSoon, kindLabel as meetingKindLabel, utcToIsraelParts, todayIsrael } from "@/lib/meetings";
import { shortCoupleNames } from "@/lib/chatModel";
import { useChatData } from "@/components/chat/useChatData";
import { useThread } from "@/components/chat/useThread";
import ChatSidebar from "@/components/chat/ChatSidebar";
import BoxOrderEditor from "@/components/chat/BoxOrderEditor";
import HomeTypesDialog from "@/components/chat/HomeTypesDialog";
import UnsignedContractsDialog from "@/components/chat/UnsignedContractsDialog";
import ForwardDialog from "@/components/chat/ForwardDialog";
import { sourceFromConversation } from "@/lib/leadSources";

const NO_LEADS = [];
import { dueContractReminders, DEFAULT_CONTRACT_REMINDER, CONTRACT_REMINDER_AFTER_DAYS, CONTRACT_REMINDER_MAX_DAYS } from "@/lib/contractReminder";
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

// The tab rows above the list (2026-10-07, as in the old inbox). On a phone: two rows —
// לא מוכר · לידים · ליד חם / לא נקראו · פולו אפ · הכל · עוד. Everything else is under "עוד".
// Once the owner arranges the boxes himself ("סדר את התיבות", 2026-10-09) the rows follow
// his top section, three per row.
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

  // The owner's own order of the boxes (profiles.chat_prefs.boxOrder, 2026-10-09) — per user,
  // so the computer and the iPhone match.
  const prefsKey = ["chatPrefs", data.user?.id];
  const prefsQ = useQuery({
    queryKey: prefsKey,
    enabled: !!data.user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: row, error } = await supabase.from("profiles").select("chat_prefs").eq("id", data.user.id).maybeSingle();
      if (error) throw error;
      return row?.chat_prefs || {};
    },
  });
  // "📝 חוזים שלא נחתמו" (2026-10-13): couples who got the contract 3+ days ago and did not
  // sign — a ready reminder in "מה מחכה לי", sent only by the owner's click.
  const contractsKey = ["unsignedContracts"];
  const contractsQ = useQuery({
    queryKey: contractsKey,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const now = Date.now();
      const [{ data: rows, error }, { data: tpl }] = await Promise.all([
        supabase
          .from("leads")
          .select("id, couple_names, event_date, venue_name, status, phone_number, signed_at, contract_sent, contract_sent_at, contract_viewed_at, contract_view_count, contract_reminder_done_at")
          .eq("contract_sent", true)
          .is("signed_at", null)
          .is("contract_reminder_done_at", null)
          .lte("contract_sent_at", new Date(now - CONTRACT_REMINDER_AFTER_DAYS * 86400000).toISOString())
          .gte("contract_sent_at", new Date(now - CONTRACT_REMINDER_MAX_DAYS * 86400000).toISOString())
          .limit(200),
        supabase.from("app_settings").select("value").eq("key", "template_lead_followup").maybeSingle(),
      ]);
      if (error) throw error;
      const leads = (rows || []).map((l) => ({
        id: l.id, coupleNames: l.couple_names, eventDate: l.event_date, venueName: l.venue_name, status: l.status,
        phoneNumber: l.phone_number, signedAt: l.signed_at, contractSent: l.contract_sent, contractSentAt: l.contract_sent_at,
        contractViewedAt: l.contract_viewed_at, contractViewCount: l.contract_view_count, contractReminderDoneAt: l.contract_reminder_done_at,
      }));
      return { leads: dueContractReminders(leads), template: tpl?.value?.trim() || DEFAULT_CONTRACT_REMINDER };
    },
  });
  const dueContracts = contractsQ.data?.leads || NO_LEADS;
  const [contractsOpen, setContractsOpen] = useState(false);
  const [forwardMsg, setForwardMsg] = useState(null); // { message, source } — "↪️ העבר"

  const savedOrder = prefsQ.data?.boxOrder || null;
  const ordered = useMemo(() => orderBoxes(savedOrder), [savedOrder]);
  const [orderOpen, setOrderOpen] = useState(false);
  const [homeTypesOpen, setHomeTypesOpen] = useState(false);
  const [rowMenu, setRowMenu] = useState(null); // the chat whose long-press menu is open
  // Any key of chat_prefs, merged into what is saved (box order, home types…).
  const savePrefs = async (patch, doneText) => {
    if (!prefsQ.isSuccess) {
      toast.error("ההגדרות עוד נטענות — נסו שוב בעוד רגע");
      return false;
    }
    try {
      const next = { ...(prefsQ.data || {}), ...patch };
      const { error } = await supabase.from("profiles").update({ chat_prefs: next }).eq("id", data.user.id);
      if (error) throw error;
      qc.setQueryData(prefsKey, next);
      toast.success(doneText);
      return true;
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
      return false;
    }
  };
  const saveBoxOrder = async (order) => {
    if (!prefsQ.isSuccess) {
      toast.error("ההגדרות עוד נטענות — נסו שוב בעוד רגע");
      return false;
    }
    if (!order.primary.length) {
      toast.error('השאירו לפחות תיבה אחת ב"למעלה"');
      return false;
    }
    try {
      const next = { ...(prefsQ.data || {}), boxOrder: order };
      const { error } = await supabase.from("profiles").update({ chat_prefs: next }).eq("id", data.user.id);
      if (error) throw error;
      qc.setQueryData(prefsKey, next);
      toast.success("הסדר נשמר");
      return true;
    } catch (e) {
      toast.error("שמירת הסדר נכשלה", { description: e?.message });
      return false;
    }
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
    const prevTitle = document.title;
    document.title = "אווירה צ'אט";
    // Notifications only (it caches nothing). Registered on every open so a tap on a
    // notification always finds it.
    registerChatServiceWorker();
    // back to the full system → its own title again (2026-10-09)
    return () => { document.title = prevTitle; };
  }, []);


  const labelsById = useMemo(() => Object.fromEntries(data.labels.map((l) => [l.id, l])), [data.labels]);
  // Which contact types "שיחות" shows (2026-10-12): the owner's choice, saved per user —
  // groups are left out until he adds them in "מה מופיע בשיחות".
  const homeTypes = useMemo(() => homeTypesFrom(prefsQ.data?.homeTypes), [prefsQ.data]);
  const ctx = { unread: data.unread, labelsByConv: data.labelsByConv, followUpAfterDays: data.followUpAfterDays, leadsById: data.leadsById, homeTypes };
  const counts = useMemo(
    () => boxCounts(data.conversations, ctx, data.labels.map((l) => l.id)),
     
    [data.conversations, data.unread, data.labelsByConv, data.followUpAfterDays, data.labels, data.leadsById, homeTypes]
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
    if (box === "mine" && !q) {
      // "מה מחכה לי": by section (waiting for me → hot → follow-up → return), the longest
      // wait first inside "waiting for me".
      const order = Object.fromEntries(MINE_SECTIONS.map((x, i) => [x.key, i]));
      const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
      return [...list].sort((a, b) => {
        const sa = order[mineSection(a, ctx)] ?? 9, sb = order[mineSection(b, ctx)] ?? 9;
        if (sa !== sb) return sa - sb;
        if (sa === 0) return ms(a.lastInboundAt) - ms(b.lastInboundAt);
        return 0;
      });
    }
    return sortConversations(list);
     
  }, [data.conversations, box, q, searchHits, data.unread, data.labelsByConv, data.followUpAfterDays, data.leadsById, homeTypes]);

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
          source: sourceFromConversation(c),
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

  // The filter chips (2026-10-12, WhatsApp-style): one row under the search — הכל · לא נקראו ·
  // חמים · פולו-אפ by default (the owner's own "למעלה" boxes once he arranged them), and "+"
  // to add or arrange. Scrolls sideways on a phone like WhatsApp's.
  const CHIP_LABEL = { all: "הכל" };
  const chip = (key) => {
    const b = BOXES.find((x) => x.key === key);
    if (!b) return null;
    const on = box === key && !q;
    const n = counts[key] || 0;
    const Icon = CHIP_ICONS[key];
    return (
      <button
        key={key}
        type="button"
        onClick={() => { setBox(key); setSearch(""); }}
        className={`flex min-h-[34px] shrink-0 items-center gap-1 rounded-full px-3 text-sm md:min-h-[30px] md:text-xs ${on ? "bg-emerald-500/20 font-semibold text-emerald-200 ring-1 ring-emerald-500/50" : "bg-gray-800/80 text-gray-300"}`}
      >
        {Icon && <Icon className={`h-3.5 w-3.5 shrink-0 ${key === "hot" ? "text-orange-400" : ""}`} aria-hidden="true" />}
        <span>{CHIP_LABEL[key] || b.label}</span>
        {key !== "all" && n > 0 && (
          <span className={`rounded-full px-1.5 text-[11px] font-bold ${on ? "bg-emerald-500 text-gray-950" : "bg-gray-700 text-gray-200"}`}>{n}</span>
        )}
      </button>
    );
  };
  const chips = (
    <div className="-mx-3.5 flex gap-1.5 overflow-x-auto px-3.5 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
      {ordered.primary.map((b) => chip(b.key))}
      {data.user?.id && (
        <button
          type="button"
          onClick={() => setOrderOpen(true)}
          aria-label="הוסף או סדר מסננים"
          title="להוסיף מסנן או לסדר"
          className="flex min-h-[34px] shrink-0 items-center justify-center rounded-full bg-gray-800/80 px-3 text-gray-400 hover:text-white md:min-h-[30px]"
        >
          <Plus className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  // "מה מחכה לי" — the row at the top of "שיחות" (like WhatsApp's "בארכיון" row).
  const mineCounts = useMemo(() => {
    const out = { needs: 0, hot: 0, followup: 0, return: 0 };
    for (const c of data.conversations) {
      const k = mineSection(c, ctx);
      if (k) out[k]++;
    }
    return out;
     
  }, [data.conversations, data.unread, data.followUpAfterDays, data.leadsById]);
  const mineTotal = mineCounts.needs + mineCounts.hot + mineCounts.followup + mineCounts.return + dueContracts.length;
  // The number on the home-screen icon (2026-10-13, the owner's choice): how many people are
  // waiting for an answer — not unread chats, which also counts what needs nothing.
  useEffect(() => {
    setBadge(mineCounts.needs);
  }, [mineCounts.needs]);
  const mineRow = box === "all" && !q && mineTotal > 0 && (
    <button
      type="button"
      onClick={() => setBox("mine")}
      className="flex w-full items-center gap-3 border-b border-gray-800 bg-amber-500/[0.07] px-4 py-2.5 text-start hover:bg-amber-500/[0.12]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-300"><ListChecks className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-amber-200">מה מחכה לי</span>
        <span className="block truncate text-xs text-amber-200/80">
          {[
            mineCounts.needs && `${mineCounts.needs} מחכים לתשובה`,
            mineCounts.hot && `${mineCounts.hot} חמים`,
            mineCounts.followup && `${mineCounts.followup} פולו-אפ`,
            mineCounts.return && `${mineCounts.return} לחזור אליהם`,
            dueContracts.length && (dueContracts.length === 1 ? "חוזה אחד לא נחתם" : `${dueContracts.length} חוזים לא נחתמו`),
          ].filter(Boolean).join(" · ")}
        </span>
      </span>
      <span className="text-amber-300">‹</span>
    </button>
  );
  const mineLabels = Object.fromEntries(MINE_SECTIONS.map((x) => [x.key, x.label]));
  const contractsBar = box === "mine" && !q && dueContracts.length > 0 && (
    <button
      type="button"
      onClick={() => setContractsOpen(true)}
      className="flex w-full items-center gap-2 border-b border-gray-800 bg-sky-950/40 px-3.5 py-2 text-start text-sm text-sky-100 hover:bg-sky-950/60"
    >
      <span aria-hidden="true">📝</span>
      <span className="min-w-0 flex-1 truncate">
        {dueContracts.length === 1 ? "חוזה אחד לא נחתם" : `${dueContracts.length} חוזים לא נחתמו`} · תזכורת מוכנה לשליחה
      </span>
      <span className="shrink-0 text-xs text-sky-300">פתח ›</span>
    </button>
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

  // The bottom bar on a phone (2026-10-12, WhatsApp-like): שיחות · מחכה לי · פגישות · עוד.
  // The owner's labels and every other box are under "עוד".
  const bottomTabs = [
    { key: "all", label: "שיחות", icon: MessageSquare, count: counts.unread || 0 },
    { key: "mine", label: "מחכה לי", icon: ListChecks, count: mineTotal },
    { action: () => setMeetingsOpen(true), key: "meetings", label: "פגישות", icon: CalendarClock },
    { action: () => setMoreOpen(true), key: "more", label: "עוד", icon: MoreHorizontal },
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
        primaryBoxes={ordered.primary}
        moreBoxes={ordered.more}
        onSaveOrder={data.user?.id ? saveBoxOrder : undefined}
        onOpenHomeTypes={data.user?.id ? () => setHomeTypesOpen(true) : undefined}
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
          topBar={<>{meetingBanner}{mineRow}{contractsBar}{followUpBar}</>}
          sectionOf={box === "mine" && !q ? (c) => mineLabels[mineSection(c, ctx)] || null : undefined}
          onSwipeHandled={(c) => run(data.actions.setHandled([c], true), () => '✓ טופל · יחזור כשיכתבו שוב')}
          onSwipeArchive={(c) => run(data.actions.setArchived([c], !c.archivedAt), () => (c.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון · יחזור לבד כשיכתבו שוב"))}
          onRowMenu={(c) => setRowMenu(c)}
          compact
        />
        {!selectMode && (
          <nav aria-label="ניווט" className="flex border-t border-gray-800 bg-gray-950 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden">
            {bottomTabs.map((t) => {
              const on = !t.action && box === t.key && !q;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => (t.action ? t.action() : (setBox(t.key), setSearch("")))}
                  className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${on ? "font-semibold text-emerald-300" : "text-gray-400"}`}
                >
                  <t.icon className="h-6 w-6" aria-hidden="true" />
                  {t.label}
                  {t.count > 0 && (
                    <span className="absolute right-[calc(50%-22px)] top-1 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-gray-950">{t.count}</span>
                  )}
                </button>
              );
            })}
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
            isHot={isHotLead(active, activeLead)}
            onMarkFollowUpSent={() => run(data.actions.markFollowUpSent([active]), () => 'סומן: נשלח פולו-אפ · עבר ל"פולו-אפ · לא ענו"')}
            onClearHot={() => run(data.actions.clearHot([active]), () => 'הוסר מ"ליד חם"')}
            onScheduleMeeting={() => openMeetingFor(active)}
            onForwardMessage={(m) => setForwardMsg({ message: m, source: active })}
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
          {/* Inner scroll area: .chat-col is overflow:hidden (rounded column), which beat
              overflow-y-auto here — the bottom of the panel could not be reached. */}
          <aside aria-label="פרטים ותיוג" className="chat-col hidden min-h-0 w-[320px] shrink-0 flex-col bg-gray-950 xl:flex">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <ContactPanel {...panelProps} />
            </div>
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

      {/* Long-press / right-click on a row (2026-10-13, like WhatsApp) */}
      {rowMenu && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center" onClick={() => setRowMenu(null)}>
          <div role="menu" aria-label="פעולות לשיחה" onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl border-t border-gray-800 bg-gray-950 p-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[320px] md:rounded-2xl md:border">
            <div className="truncate px-2 pb-2 text-sm font-semibold text-white">{conversationTitle(rowMenu)}</div>
            {[
              { label: rowMenu.pinnedAt ? "בטל נעיצה" : "📌 נעץ למעלה", act: () => run(data.actions.setPinned([rowMenu], !rowMenu.pinnedAt), () => (rowMenu.pinnedAt ? "בוטלה הנעיצה" : "ננעץ למעלה")) },
              rowMenu.leadTemperature === "hot" && { label: "🔥 לא חם", act: () => run(data.actions.clearHot([rowMenu]), () => 'הוסר מ"ליד חם"') },
              needsReply(rowMenu) && { label: "✓ טופל", act: () => run(data.actions.setHandled([rowMenu], true), () => '✓ טופל · יחזור כשיכתבו שוב') },
              ["unknown", "lead", "client", "past_client"].includes(rowMenu.contactType || "unknown") && {
                label: isAwaitingFollowUp(rowMenu, data.followUpAfterDays || 0) ? "הוצא מפולו-אפ" : "⏳ לפולו-אפ",
                act: () => {
                  const on = !isAwaitingFollowUp(rowMenu, data.followUpAfterDays || 0);
                  return run(data.actions.setFollowUpFlag([rowMenu], on), () => (on ? "נוסף לתור הפולו-אפ" : "הוסר מתור הפולו-אפ"));
                },
              },
              { label: rowMenu.archivedAt ? "החזר מהארכיון" : "🗄 ארכיון", act: () => run(data.actions.setArchived([rowMenu], !rowMenu.archivedAt), () => (rowMenu.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון")) },
            ].filter(Boolean).map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => { setRowMenu(null); item.act(); }}
                className="flex min-h-[48px] w-full items-center rounded-xl px-3 text-start text-base text-gray-200 hover:bg-gray-800/70 md:min-h-[40px] md:text-sm"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {forwardMsg && (
        <ForwardDialog
          message={forwardMsg.message}
          source={forwardMsg.source}
          conversations={data.conversations}
          onClose={() => setForwardMsg(null)}
        />
      )}

      {contractsOpen && (
        <UnsignedContractsDialog
          leads={dueContracts}
          template={contractsQ.data?.template || DEFAULT_CONTRACT_REMINDER}
          onDone={() => qc.invalidateQueries({ queryKey: contractsKey })}
          onClose={() => setContractsOpen(false)}
        />
      )}

      {homeTypesOpen && (
        <HomeTypesDialog
          value={homeTypes}
          onClose={() => setHomeTypesOpen(false)}
          onSave={(types) => savePrefs({ homeTypes: types }, "נשמר — הרשימה מתעדכנת")}
        />
      )}

      {/* "סדר את התיבות" from the button next to the chips — the same editor as the sidebar */}
      {orderOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center" onClick={() => setOrderOpen(false)}>
          <div
            role="dialog"
            aria-label="סדר את התיבות"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full flex-col rounded-t-3xl border-t border-gray-800 bg-gray-950 pb-[env(safe-area-inset-bottom)] md:w-[380px] md:rounded-2xl md:border"
          >
            <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3">
              <span className="font-bold text-white">סדר את התיבות</span>
              <button type="button" onClick={() => setOrderOpen(false)} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
            <BoxOrderEditor
              primary={ordered.primary}
              more={ordered.more}
              onCancel={() => setOrderOpen(false)}
              onSave={async (order) => {
                if (await saveBoxOrder(order)) setOrderOpen(false);
              }}
            />
          </div>
        </div>
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
              {[...ordered.primary, ...ordered.more].map((b) => (
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
              {data.user?.id && (
                <button type="button" onClick={() => { setMoreOpen(false); setHomeTypesOpen(true); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-gray-300">
                  <Eye className="h-5 w-5" /> מה מופיע ב"שיחות"
                </button>
              )}
              {data.user?.id && (
                <button type="button" onClick={() => { setMoreOpen(false); setOrderOpen(true); }} className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 text-gray-300">
                  <ArrowUpDown className="h-5 w-5" /> סדר את המסננים
                </button>
              )}
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
        leadsById={data.leadsById}
        sentToday={followUpsSentToday(data.conversations, todayIsrael())}
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
