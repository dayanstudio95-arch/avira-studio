import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";

// One conversation's timeline: the newest 500 messages (oldest first on screen), their
// delivery receipts, and the internal notes, merged by time. Same message query as the
// old inbox (WhatsAppInbox.jsx) — every column except the heavy `raw`.
export const MESSAGE_COLUMNS =
  "id, tenant_id, conversation_id, id_message, direction, type_webhook, type_message, body_text, " +
  "media_url, created_at, bot_would_reply, bot_skip_reason, sender_chat_id, sender_name, " +
  "quoted_id_message, media_path, media_mime, media_size";

const POLL_MS = 30000;

export function useThread(conversationId) {
  const qc = useQueryClient();

  const messagesQ = useQuery({
    queryKey: ["chatMessages", conversationId],
    queryFn: async () => {
      const rows = await base44.entities.WhatsAppMessage.filter({ conversationId }, "-createdDate", 500, MESSAGE_COLUMNS);
      return rows.reverse();
    },
    enabled: !!conversationId,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const rawMessages = messagesQ.data || [];

  const outboundIds = useMemo(
    () => rawMessages.filter((m) => m.direction !== "inbound" && m.idMessage).map((m) => m.idMessage).slice(-200),
    [rawMessages]
  );
  const statusQ = useQuery({
    queryKey: ["chatStatus", conversationId, outboundIds.length, outboundIds[outboundIds.length - 1]],
    queryFn: async () => {
      const { data, error } = await supabase.from("whatsapp_message_status").select("id_message, status").in("id_message", outboundIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((r) => [r.id_message, r.status]));
    },
    enabled: outboundIds.length > 0,
    refetchInterval: POLL_MS,
  });

  const notesQ = useQuery({
    queryKey: ["chatNotes", conversationId],
    queryFn: () => base44.entities.WhatsAppNote.filter({ conversationId }, "createdDate", 200),
    enabled: !!conversationId,
  });

  const activityQ = useQuery({
    queryKey: ["chatActivity", conversationId],
    queryFn: () => base44.entities.WhatsAppActivity.filter({ conversationId }, "-createdDate", 30),
    enabled: !!conversationId,
  });

  const timeline = useMemo(() => {
    const statusById = statusQ.data || {};
    const textById = Object.fromEntries(rawMessages.map((m) => [m.idMessage, m.bodyText || m.typeMessage || ""]));
    // The entity layer names created_at "created_date" (src/api/entities.js
    // CASE_OVERRIDES_REVERSE), not "createdDate" — read as createdDate it was always empty,
    // so no bubble showed its time and the day separators never appeared (2026-10-07).
    const msgs = rawMessages.map((m) => ({
      kind: "message",
      at: m.created_date,
      ...m,
      createdDate: m.created_date,
      deliveryStatus: statusById[m.idMessage] || null,
      quotedText: m.quotedIdMessage ? textById[m.quotedIdMessage] || "הודעה קודמת" : null,
    }));
    const notes = (notesQ.data || []).map((n) => ({ kind: "note", at: n.created_date, ...n, createdDate: n.created_date }));
    return [...msgs, ...notes].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [rawMessages, statusQ.data, notesQ.data]);

  const addNote = async (body, tenantId, userId) => {
    const { error } = await supabase.from("whatsapp_notes").insert({
      tenant_id: tenantId, conversation_id: conversationId, body: body.trim(), created_by: userId,
    });
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["chatNotes", conversationId] });
  };

  const deleteNote = async (id) => {
    await base44.entities.WhatsAppNote.delete(id);
    qc.invalidateQueries({ queryKey: ["chatNotes", conversationId] });
  };

  // Send through the existing send-whatsapp-message (role-checked, chat id as-is). The
  // message row arrives by itself through the webhook's echo; Realtime shows it.
  const send = async (conversation, text) => {
    const res = await base44.functions.invoke("sendWhatsAppMessage", {
      chatId: conversation.chatId || null,
      to: conversation.phone || null,
      message: text,
    });
    if (res?.data?.error) throw new Error(res.data.error);
    // A human is in the conversation now — the bot steps aside at once.
    if (conversation.botEnabled) {
      await supabase.from("whatsapp_conversations").update({ bot_enabled: false }).eq("id", conversation.id);
    }
    setTimeout(() => qc.invalidateQueries({ queryKey: ["chatMessages", conversationId] }), 1500);
  };

  return {
    timeline,
    isLoading: messagesQ.isLoading,
    activity: activityQ.data || [],
    addNote,
    deleteNote,
    send,
  };
}
