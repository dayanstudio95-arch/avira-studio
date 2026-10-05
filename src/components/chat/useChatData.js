import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { FOLLOWUP_AFTER_DAYS_KEY } from "@/components/whatsapp/WhatsAppFollowUpDialog";
import { reverseOf, stageTarget, effectiveStage } from "@/lib/chatModel";

// All data of "אווירה צ'אט" (stage 1א, 2026-10-05) and every write it makes.
//
// Live updates: Supabase Realtime on the WhatsApp tables (migration 0068) invalidates
// the right query the moment a row changes; a slow poll stays underneath as a safety net
// (a dropped socket on a phone that slept must not leave the inbox frozen).
//
// Every sorting change is written together with a whatsapp_activity row holding the
// values it replaced, so any change — and any bulk change, as one batch — can be undone.

export const CONV_KEY = ["chatConversations"];
const POLL_MS = 60000;

const uuid = () =>
  (globalThis.crypto?.randomUUID?.() ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
    }));

const snake = (k) => k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const toRow = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [snake(k), v]));

export function useChatData() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const conversationsQ = useQuery({
    queryKey: CONV_KEY,
    queryFn: () => base44.entities.WhatsAppConversation.list("-lastMessageAt", 600),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const labelsQ = useQuery({
    queryKey: ["chatLabels"],
    queryFn: () => base44.entities.WhatsAppLabel.list("sortOrder", 200),
  });
  const convLabelsQ = useQuery({
    queryKey: ["chatConvLabels"],
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_conversation_labels").select("conversation_id, label_id");
      if (error) throw error;
      return data || [];
    },
    refetchInterval: POLL_MS,
  });
  const unreadQ = useQuery({
    queryKey: ["chatUnread"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("whatsapp_unread_counts");
      if (error) throw error;
      return Object.fromEntries((data || []).map((r) => [r.conversation_id, r.unread]));
    },
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const followUpDaysQ = useQuery({
    queryKey: ["whatsappFollowUpAfterDays"],
    queryFn: async () => {
      const rows = await base44.entities.AppSetting.filter({ key: FOLLOWUP_AFTER_DAYS_KEY });
      const n = parseInt(rows?.[0]?.value, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    },
  });
  const templatesQ = useQuery({
    queryKey: ["chatTemplates"],
    queryFn: () => base44.entities.WhatsAppTemplate.list("sortOrder", 100),
  });

  const conversations = conversationsQ.data || [];

  // The CRM leads linked to conversations — their status IS the stage.
  const leadIds = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.matchedLeadId).filter(Boolean))).sort(),
    [conversations]
  );
  const leadsQ = useQuery({
    queryKey: ["chatLeads", leadIds.join(",")],
    queryFn: async () => {
      const out = {};
      for (let i = 0; i < leadIds.length; i += 150) {
        const { data, error } = await supabase
          .from("leads")
          .select("id, couple_names, event_date, venue_name, status, phone_number")
          .in("id", leadIds.slice(i, i + 150));
        if (error) throw error;
        for (const l of data || []) {
          out[l.id] = { id: l.id, coupleNames: l.couple_names, eventDate: l.event_date, venueName: l.venue_name, status: l.status, phoneNumber: l.phone_number };
        }
      }
      return out;
    },
    enabled: leadIds.length > 0,
  });

  const labelsByConv = useMemo(() => {
    const out = {};
    for (const r of convLabelsQ.data || []) (out[r.conversation_id] ||= []).push(r.label_id);
    return out;
  }, [convLabelsQ.data]);

  // ---- Realtime ------------------------------------------------------------------
  const timers = useRef({});
  useEffect(() => {
    if (!user?.tenant_id) return undefined;
    const soon = (key, fn) => {
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(fn, 250);
    };
    const channel = supabase
      .channel(`chat-${user.tenant_id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversations" }, () =>
        soon("conv", () => {
          qc.invalidateQueries({ queryKey: CONV_KEY });
          qc.invalidateQueries({ queryKey: ["chatUnread"] });
        })
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "whatsapp_messages" }, (payload) =>
        soon("msg-" + payload.new?.conversation_id, () => {
          qc.invalidateQueries({ queryKey: ["chatMessages", payload.new?.conversation_id] });
          qc.invalidateQueries({ queryKey: ["chatUnread"] });
        })
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "whatsapp_messages" }, (payload) =>
        soon("msg-" + payload.new?.conversation_id, () => qc.invalidateQueries({ queryKey: ["chatMessages", payload.new?.conversation_id] }))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_message_status" }, () =>
        soon("status", () => qc.invalidateQueries({ queryKey: ["chatStatus"] }))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_notes" }, (payload) =>
        soon("notes", () => qc.invalidateQueries({ queryKey: ["chatNotes", (payload.new || payload.old)?.conversation_id] }))
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_conversation_labels" }, () =>
        soon("labels", () => qc.invalidateQueries({ queryKey: ["chatConvLabels"] }))
      )
      .subscribe();
    return () => {
      Object.values(timers.current).forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, qc]);

  // ---- Writes --------------------------------------------------------------------
  const refresh = () => {
    qc.invalidateQueries({ queryKey: CONV_KEY });
    qc.invalidateQueries({ queryKey: ["chatConvLabels"] });
    qc.invalidateQueries({ queryKey: ["chatLeads"] });
    qc.invalidateQueries({ queryKey: ["chatActivity"] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const logActivity = async (rows) => {
    if (!rows.length) return;
    const { error } = await supabase.from("whatsapp_activity").insert(
      rows.map((r) => ({ tenant_id: user?.tenant_id, actor: user?.id, ...toRow({ conversationId: r.conversationId, action: r.action, batchId: r.batchId || null }), before: r.before || null, after: r.after || null }))
    );
    if (error) console.error("activity log failed:", error.message);
  };

  const updateConversations = async (ids, values) => {
    if (!ids.length) return;
    const { error } = await supabase.from("whatsapp_conversations").update(toRow(values)).in("id", ids);
    if (error) throw error;
  };

  // Each returns the batch id (for undo).
  const actions = {
    async setType(convs, type) {
      const batchId = uuid();
      const nowIso = new Date().toISOString();
      const targets = convs.filter((c) => c.contactType !== "group" && c.contactType !== type);
      await updateConversations(targets.map((c) => c.id), { contactType: type, contactTypeManualAt: nowIso });
      await logActivity(targets.map((c) => ({
        conversationId: c.id, action: "set_type", batchId,
        before: { contactType: c.contactType, contactTypeManualAt: c.contactTypeManualAt || null },
        after: { contactType: type },
      })));
      refresh();
      return { batchId, count: targets.length };
    },

    async setStage(convs, stage, leadsById = {}) {
      const batchId = uuid();
      const toLead = convs.filter((c) => stageTarget(c) === "lead" && leadsById[c.matchedLeadId]);
      const toConv = convs.filter((c) => stageTarget(c) === "conversation");
      for (const c of toLead) {
        const { error } = await supabase.from("leads").update({ status: stage }).eq("id", c.matchedLeadId);
        if (error) throw error;
      }
      await updateConversations(toConv.map((c) => c.id), { leadStage: stage });
      await logActivity([
        ...toLead.map((c) => ({ conversationId: c.id, action: "set_stage", batchId, before: { leadId: c.matchedLeadId, leadStatus: leadsById[c.matchedLeadId].status }, after: { leadStatus: stage } })),
        ...toConv.map((c) => ({ conversationId: c.id, action: "set_stage", batchId, before: { leadStage: c.leadStage || null, shown: effectiveStage(c, null) }, after: { leadStage: stage } })),
      ]);
      refresh();
      return { batchId, count: toLead.length + toConv.length, crm: toLead.length };
    },

    async addLabel(convs, labelId) {
      const batchId = uuid();
      const have = new Set(convs.filter((c) => (labelsByConv[c.id] || []).includes(labelId)).map((c) => c.id));
      const targets = convs.filter((c) => !have.has(c.id));
      if (targets.length) {
        const { error } = await supabase.from("whatsapp_conversation_labels").insert(
          targets.map((c) => ({ tenant_id: user?.tenant_id, conversation_id: c.id, label_id: labelId }))
        );
        if (error) throw error;
      }
      await logActivity(targets.map((c) => ({ conversationId: c.id, action: "label_add", batchId, after: { labelId } })));
      refresh();
      return { batchId, count: targets.length };
    },

    async removeLabel(convs, labelId) {
      const batchId = uuid();
      const targets = convs.filter((c) => (labelsByConv[c.id] || []).includes(labelId));
      if (targets.length) {
        const { error } = await supabase.from("whatsapp_conversation_labels").delete()
          .eq("label_id", labelId).in("conversation_id", targets.map((c) => c.id));
        if (error) throw error;
      }
      await logActivity(targets.map((c) => ({ conversationId: c.id, action: "label_remove", batchId, before: { labelId } })));
      refresh();
      return { batchId, count: targets.length };
    },

    async setArchived(convs, archived) {
      const batchId = uuid();
      const value = archived ? new Date().toISOString() : null;
      const targets = convs.filter((c) => !!c.archivedAt !== archived);
      await updateConversations(targets.map((c) => c.id), { archivedAt: value });
      await logActivity(targets.map((c) => ({ conversationId: c.id, action: "archive", batchId, before: { archivedAt: c.archivedAt || null }, after: { archivedAt: value } })));
      refresh();
      return { batchId, count: targets.length };
    },

    // "טופל": out of "דורש מענה" until they write again.
    async setHandled(convs, handled) {
      const batchId = uuid();
      const value = handled ? new Date().toISOString() : null;
      await updateConversations(convs.map((c) => c.id), { handledAt: value });
      await logActivity(convs.map((c) => ({ conversationId: c.id, action: "handled", batchId, before: { handledAt: c.handledAt || null }, after: { handledAt: value } })));
      refresh();
      return { batchId, count: convs.length };
    },

    async setPinned(convs, pinned) {
      const batchId = uuid();
      const value = pinned ? new Date().toISOString() : null;
      const targets = convs.filter((c) => !!c.pinnedAt !== pinned);
      await updateConversations(targets.map((c) => c.id), { pinnedAt: value });
      await logActivity(targets.map((c) => ({ conversationId: c.id, action: "pin", batchId, before: { pinnedAt: c.pinnedAt || null }, after: { pinnedAt: value } })));
      refresh();
      return { batchId, count: targets.length };
    },

    async setOptedOut(conv, optedOut) {
      const batchId = uuid();
      const value = optedOut ? new Date().toISOString() : null;
      await updateConversations([conv.id], { optedOutAt: value, optedOutReason: optedOut ? "סומן ידנית" : null });
      await logActivity([{ conversationId: conv.id, action: "opt_out", batchId, before: { optedOutAt: conv.optedOutAt || null, optedOutReason: conv.optedOutReason || null }, after: { optedOutAt: value } }]);
      refresh();
      return { batchId, count: 1 };
    },

    async setBotEnabled(conv, enabled) {
      await updateConversations([conv.id], { botEnabled: enabled });
      refresh();
    },

    async markRead(conv) {
      if (!conv) return;
      const { error } = await supabase.from("whatsapp_conversations").update({ last_read_at: new Date().toISOString() }).eq("id", conv.id);
      if (!error) {
        qc.setQueryData(["chatUnread"], (old) => ({ ...(old || {}), [conv.id]: 0 }));
      }
    },

    async linkLead(conversationId, leadId) {
      await updateConversations([conversationId], { contactType: "lead", matchedLeadId: leadId });
      await logActivity([{ conversationId, action: "lead_created", after: { leadId } }]);
      refresh();
    },

    // Undo one batch: reverse every row of it, newest first.
    async undo(batchId) {
      const { data, error } = await supabase.from("whatsapp_activity").select("*").eq("batch_id", batchId).order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((r) => ({ action: r.action, conversationId: r.conversation_id, before: r.before, after: r.after }));
      for (const r of rows) {
        const rev = reverseOf(r);
        if (!rev) continue;
        if (rev.kind === "conversation") await updateConversations([rev.id], rev.values);
        else if (rev.kind === "lead") await supabase.from("leads").update(rev.values).eq("id", rev.id);
        else if (rev.kind === "label_remove") await supabase.from("whatsapp_conversation_labels").delete().eq("conversation_id", rev.conversationId).eq("label_id", rev.labelId);
        else if (rev.kind === "label_add") await supabase.from("whatsapp_conversation_labels").insert({ tenant_id: user?.tenant_id, conversation_id: rev.conversationId, label_id: rev.labelId });
      }
      await logActivity(Array.from(new Set(rows.map((r) => r.conversationId))).map((id) => ({ conversationId: id, action: "undo", after: { batchId } })));
      refresh();
      return rows.length;
    },

    async createLabel(name, color) {
      const created = await base44.entities.WhatsAppLabel.create({ name: name.trim(), color, sortOrder: ((labelsQ.data || []).length + 1) * 10 });
      qc.invalidateQueries({ queryKey: ["chatLabels"] });
      return created;
    },
    async deleteLabel(id) {
      await base44.entities.WhatsAppLabel.delete(id);
      qc.invalidateQueries({ queryKey: ["chatLabels"] });
      qc.invalidateQueries({ queryKey: ["chatConvLabels"] });
    },
  };

  return {
    user,
    conversations,
    isLoading: conversationsQ.isLoading,
    labels: labelsQ.data || [],
    labelsByConv,
    unread: unreadQ.data || {},
    leadsById: leadsQ.data || {},
    followUpAfterDays: followUpDaysQ.data ?? 0,
    templates: templatesQ.data || [],
    actions,
  };
}
