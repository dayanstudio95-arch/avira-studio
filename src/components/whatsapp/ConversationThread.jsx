import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Send, UserPlus, MessageSquare, ExternalLink } from "lucide-react";
import MessageBubble from "./MessageBubble";
import {
  CONTACT_TYPE_COLORS,
  CONTACT_TYPE_LABELS,
  STATE_LABELS,
  conversationTitle,
  displayPhone,
  groupMessagesByDay,
} from "./whatsappInboxShared";

// Left-hand pane: one conversation, WhatsApp-style.
// Presentational + local draft state only; sending / toggling / lead creation are
// handled by the callbacks passed down from src/pages/WhatsAppInbox.jsx.

export default function ConversationThread({
  conversation,
  messages,
  isLoading,
  onSend,
  isSending,
  onToggleBot,
  isTogglingBot,
  onCreateLead,
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef(null);

  // Reset the draft when switching conversations — otherwise half a sentence meant
  // for one couple ends up in the box for another.
  useEffect(() => {
    setDraft("");
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length, conversation?.id]);

  if (!conversation) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-900/30 text-gray-500">
        <MessageSquare className="h-10 w-10 text-gray-700" />
        <p className="text-sm">בחרו שיחה מהרשימה</p>
      </div>
    );
  }

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isSending) return;
    onSend(text, () => setDraft(""));
  };

  const dayGroups = groupMessagesByDay(messages || []);

  return (
    <div className="flex h-full flex-col bg-gray-900/30">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-white">{conversationTitle(conversation)}</h2>
              <Badge
                variant="outline"
                className={`text-[10px] ${CONTACT_TYPE_COLORS[conversation.contactType] || CONTACT_TYPE_COLORS.unknown}`}
              >
                {CONTACT_TYPE_LABELS[conversation.contactType] || conversation.contactType}
              </Badge>
              <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-400">
                {STATE_LABELS[conversation.state] || conversation.state}
              </Badge>
            </div>
            <div className="mt-0.5 text-xs text-gray-500" dir="ltr">
              {displayPhone(conversation)}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {conversation.matchedLeadId && (
              <Link
                to="/Leads"
                className="inline-flex items-center gap-1 text-xs text-blue-300 underline hover:text-blue-200"
              >
                <ExternalLink className="h-3 w-3" />
                ליד קיים
              </Link>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={onCreateLead}
              className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
            >
              <UserPlus className="ml-1 h-4 w-4" />
              צור ליד
            </Button>

            {/* Per-conversation mute. Nothing sends automatically in Stage 1, so this
                is currently a forward-looking switch — it's shown now so its state is
                already correct (and visibly correct) by the time the bot goes live. */}
            <div className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-1.5">
              <span className="text-xs text-gray-400">בוט</span>
              <Switch
                checked={!!conversation.botEnabled}
                onCheckedChange={(checked) => onToggleBot(checked)}
                disabled={isTogglingBot}
              />
              <span className={`text-xs ${conversation.botEnabled ? "text-green-400" : "text-gray-500"}`}>
                {conversation.botEnabled ? "פעיל" : "מושתק"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {isLoading && <div className="text-center text-sm text-gray-500">טוען הודעות…</div>}
        {!isLoading && dayGroups.length === 0 && (
          <div className="text-center text-sm text-gray-500">אין הודעות בשיחה זו</div>
        )}
        {dayGroups.map((group) => (
          <div key={group.key} className="space-y-2">
            <div className="flex justify-center">
              <span className="rounded-full bg-gray-800/80 px-3 py-0.5 text-[11px] text-gray-400">{group.label}</span>
            </div>
            {group.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="border-t border-gray-800 bg-gray-900/80 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends, Shift+Enter is a newline — the convention people already
              // have in their fingers from WhatsApp Web.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="כתבו הודעה… (Enter לשליחה, Shift+Enter לשורה חדשה)"
            rows={2}
            className="min-h-[44px] resize-none border-gray-700 bg-gray-800 text-white placeholder:text-gray-500"
          />
          <Button
            onClick={handleSend}
            disabled={!draft.trim() || isSending}
            className="h-[44px] bg-yellow-400 text-gray-900 hover:bg-yellow-500"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[11px] text-gray-500">
          שליחה מכאן מגיעה מהמספר של הסטודיו, ומשתיקה את הבוט בשיחה הזו. ההודעה תופיע בשרשור תוך כמה שניות.
        </p>
      </div>
    </div>
  );
}
