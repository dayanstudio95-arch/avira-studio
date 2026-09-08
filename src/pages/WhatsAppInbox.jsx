import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MessageSquare, AlertTriangle } from "lucide-react";
import ConversationList from "@/components/whatsapp/ConversationList";
import ConversationThread from "@/components/whatsapp/ConversationThread";
import LeadFormDialog from "@/components/leads/LeadFormDialog";
import { usePermission } from "@/lib/permissions";

// WhatsApp inbox — every conversation the studio's WhatsApp number is having, shown
// like WhatsApp itself, with the ability to reply from here.
//
// STAGE 1: nothing on this screen (or in the whatsapp-webhook Edge Function that fills
// it) sends an automatic reply to anyone. Messages appear here because Green API
// reports them; the only outbound message this screen can produce is one a human typed
// into the reply box and pressed send on. The automated lead bot is Stage 2.
//
// Lead creation is deliberately manual. The "צור ליד" button opens the normal
// LeadFormDialog pre-filled from the conversation — it does NOT create a lead by
// itself. That is a decision, not an omission: automation-engine's
// runQuestionnaireReminder (automation-engine/index.ts, runQuestionnaireReminder)
// selects leads purely by event_date falling 1-35 days out, with no status filter, so
// a lead auto-created for a couple marrying soon would immediately queue a "please
// fill in the questionnaire" message to a stranger who has only asked for a price.
//
// Polling rather than realtime: this is a low-traffic inbox on an app that has no
// Supabase realtime subscriptions anywhere else. A short refetch interval keeps the
// thread live without introducing a new connection model.
const CONVERSATIONS_REFETCH_MS = 15000;
const MESSAGES_REFETCH_MS = 10000;

export default function WhatsAppInbox() {
  const { canUseWhatsAppInbox } = usePermission();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [contactFilter, setContactFilter] = useState("all");
  const [leadDialogValues, setLeadDialogValues] = useState(null);

  const { data: conversations = [], isLoading: isLoadingConversations } = useQuery({
    queryKey: ["whatsappConversations"],
    queryFn: () => base44.entities.WhatsAppConversation.list("-lastMessageAt", 300),
    refetchInterval: CONVERSATIONS_REFETCH_MS,
    enabled: canUseWhatsAppInbox,
  });

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  const { data: messages = [], isLoading: isLoadingMessages } = useQuery({
    queryKey: ["whatsappMessages", selectedId],
    queryFn: () => base44.entities.WhatsAppMessage.filter({ conversationId: selectedId }, "createdDate", 500),
    enabled: !!selectedId && canUseWhatsAppInbox,
    refetchInterval: MESSAGES_REFETCH_MS,
  });

  const filteredConversations = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return conversations.filter((c) => {
      if (contactFilter !== "all" && c.contactType !== contactFilter) return false;
      if (!q) return true;
      return (
        String(c.displayName || "").toLowerCase().includes(q) ||
        String(c.coupleNames || "").toLowerCase().includes(q) ||
        String(c.phone || "").includes(q) ||
        String(c.chatId || "").includes(q)
      );
    });
  }, [conversations, searchTerm, contactFilter]);

  // How much of the inbound traffic is actually new business — the single number
  // Stage 1 exists to measure before the bot is allowed to answer anybody.
  const unknownCount = useMemo(
    () => conversations.filter((c) => c.contactType === "unknown").length,
    [conversations]
  );

  const toggleBotMutation = useMutation({
    mutationFn: ({ id, botEnabled }) =>
      base44.entities.WhatsAppConversation.update(id, { botEnabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsappConversations"] }),
    onError: (err) => toast.error(err.message || "שגיאה בעדכון מצב הבוט"),
  });

  // Reply. Reuses the existing send-whatsapp-message Edge Function (Green API) rather
  // than adding a second send path — it already resolves the tenant's gateway/instance/
  // token and formats the phone number server-side.
  //
  // The sent message is NOT inserted here. Green API reports our own API sends back as
  // an `outgoingAPIMessageReceived` webhook, which whatsapp-webhook records with the
  // real idMessage; writing a row here too would produce a duplicate the dedupe
  // constraint can't catch (it would have no idMessage to match on). Hence the short
  // refetch interval above and the "תוך כמה שניות" hint in the reply box.
  const sendMutation = useMutation({
    mutationFn: async ({ conversation, text }) => {
      const phone = conversation.phone || String(conversation.chatId || "").split("@")[0];
      if (!phone) throw new Error("אין מספר טלפון תקין לשיחה זו");
      const result = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message: text });
      if (result.data?.error) throw new Error(result.data.error);
      // A human is now in this conversation — silence the bot in it immediately rather
      // than waiting for the outgoing webhook to come back and do it.
      if (conversation.botEnabled) {
        await base44.entities.WhatsAppConversation.update(conversation.id, { botEnabled: false }).catch(() => {});
      }
      return true;
    },
    onSuccess: (_data, variables) => {
      variables.onSent?.();
      queryClient.invalidateQueries({ queryKey: ["whatsappConversations"] });
      queryClient.invalidateQueries({ queryKey: ["whatsappMessages", selectedId] });
      toast.success("ההודעה נשלחה");
    },
    onError: (err) => toast.error(err.message || "שגיאה בשליחת ההודעה"),
  });

  const handleSend = (text, onSent) => {
    if (!selectedConversation) return;
    sendMutation.mutate({ conversation: selectedConversation, text, onSent });
  };

  // Pre-fills the standard lead form from whatever the conversation already knows.
  // guest_count has no column on `leads`, so it goes into the notes field along with a
  // pointer back to where this came from.
  const handleOpenCreateLead = () => {
    if (!selectedConversation) return;
    const c = selectedConversation;
    const noteParts = [];
    if (c.guestCount) noteParts.push(`כמות מוזמנים: ${c.guestCount}`);
    noteParts.push(`נוצר משיחת וואטסאפ עם ${c.phone || c.chatId}`);

    setLeadDialogValues({
      coupleNames: c.coupleNames || c.displayName || "",
      eventDate: c.eventDate || "",
      phoneNumber: c.callbackPhone || c.phone || "",
      venueName: c.venue || "",
      notes: noteParts.join(" | "),
    });
  };

  const handleLeadSaved = () => {
    setLeadDialogValues(null);
    // Re-classification happens server-side on the next inbound message, so the badge
    // will catch up on its own; refresh the list so the rest stays current.
    queryClient.invalidateQueries({ queryKey: ["whatsappConversations"] });
    toast.success("הליד נוצר. השיחה תסומן כ'ליד קיים' בהודעה הבאה");
  };

  // UI-layer gate only — the real boundary is 0054_whatsapp_bot.sql's RLS policies,
  // which restrict both tables to the same four roles regardless of what renders here.
  // Declared after every hook so hook order stays stable.
  if (!canUseWhatsAppInbox) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center" dir="rtl">
        <div className="text-4xl">🔒</div>
        <p className="text-gray-400">אין לך הרשאה לצפות בשיחות הוואטסאפ.</p>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-2rem)] flex-col p-4" dir="rtl">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-6 w-6 text-yellow-400" />
          <h1 className="text-2xl font-bold text-white">שיחות וואטסאפ</h1>
          <span className="text-sm text-gray-500">
            {conversations.length} שיחות · {unknownCount} ממספרים לא מוכרים
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-300">
          <AlertTriangle className="h-3.5 w-3.5" />
          מצב האזנה בלבד — לא נשלחת שום תשובה אוטומטית
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-xl border border-gray-800 md:grid-cols-[320px_1fr]">
        <ConversationList
          conversations={filteredConversations}
          isLoading={isLoadingConversations}
          selectedId={selectedId}
          onSelect={setSelectedId}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          contactFilter={contactFilter}
          onContactFilterChange={setContactFilter}
        />
        <ConversationThread
          conversation={selectedConversation}
          messages={messages}
          isLoading={isLoadingMessages}
          onSend={handleSend}
          isSending={sendMutation.isPending}
          onToggleBot={(botEnabled) =>
            selectedConversation && toggleBotMutation.mutate({ id: selectedConversation.id, botEnabled })
          }
          isTogglingBot={toggleBotMutation.isPending}
          onCreateLead={handleOpenCreateLead}
        />
      </div>

      {/* Nothing is written until the user presses שמור inside this dialog. */}
      <LeadFormDialog
        isOpen={!!leadDialogValues}
        onClose={() => setLeadDialogValues(null)}
        lead={null}
        initialValues={leadDialogValues}
        packagePrices={{}}
        onSaved={handleLeadSaved}
      />
    </div>
  );
}
