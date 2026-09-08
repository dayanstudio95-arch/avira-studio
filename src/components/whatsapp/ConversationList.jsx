import React from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, BotOff, Bot, MessageSquare } from "lucide-react";
import {
  CONTACT_TYPE_LABELS,
  CONTACT_TYPE_COLORS,
  conversationTitle,
  displayPhone,
  formatListTime,
} from "./whatsappInboxShared";

// Right-hand pane of the WhatsApp inbox: the conversation list.
// Presentational only — all data loading, filtering state and selection live in
// src/pages/WhatsAppInbox.jsx.

export default function ConversationList({
  conversations,
  isLoading,
  selectedId,
  onSelect,
  searchTerm,
  onSearchChange,
  contactFilter,
  onContactFilterChange,
}) {
  // "would_reply" is not a contact_type — it's the dry-run review queue, and it is the
  // one filter worth opening every day: every conversation in it is one Stage 2 would
  // have answered on its own. Placed first because that review is the entire point of
  // running the gate without a send path.
  const filters = [
    { value: "would_reply", label: "🤖 הבוט היה עונה" },
    { value: "all", label: "הכל" },
    { value: "unknown", label: CONTACT_TYPE_LABELS.unknown },
    { value: "lead", label: CONTACT_TYPE_LABELS.lead },
    { value: "client", label: CONTACT_TYPE_LABELS.client },
    { value: "staff", label: CONTACT_TYPE_LABELS.staff },
  ];

  // `min-h-0` is load-bearing, not cosmetic. This is a grid item in an auto-sized row,
  // so its default `min-height: auto` lets the row grow to the full height of the
  // conversation list. `h-full` then resolves against that grown row, the scroll
  // container below never overflows, and the parent's `overflow-hidden` silently
  // truncates the list at the bottom of the panel — no scrollbar, no way to reach the
  // older conversations. Zeroing the minimum caps the row at the container height.
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-gray-800 bg-gray-900/60">
      <div className="space-y-3 border-b border-gray-800 p-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="חיפוש לפי שם או מספר"
            className="border-gray-700 bg-gray-800 pr-9 text-white placeholder:text-gray-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onContactFilterChange(f.value)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                contactFilter === f.value
                  ? "border-yellow-500/50 bg-yellow-500/20 text-yellow-300"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <div className="p-6 text-center text-sm text-gray-500">טוען שיחות…</div>}

        {!isLoading && conversations.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-gray-500">
            <MessageSquare className="h-8 w-8 text-gray-700" />
            <span>אין שיחות להצגה</span>
          </div>
        )}

        {conversations.map((conv) => {
          const isSelected = conv.id === selectedId;
          return (
            <button
              key={conv.id}
              type="button"
              onClick={() => onSelect(conv.id)}
              className={`w-full border-b border-gray-800/70 px-3 py-3 text-right transition-colors ${
                isSelected ? "bg-gray-800" : "hover:bg-gray-800/50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-white">{conversationTitle(conv)}</span>
                    {/* Dry run: the gate opened here at least once. Set once and never
                        cleared, so this stays visible as a "read this one" marker even
                        after the conversation has moved on. */}
                    {conv.botWouldReplyAt && (
                      <Bot
                        className="h-3.5 w-3.5 shrink-0 text-emerald-400"
                        title="הבוט היה עונה בשיחה הזו (מצב יבש — לא נשלח כלום)"
                      />
                    )}
                    {!conv.botEnabled && (
                      <BotOff className="h-3.5 w-3.5 shrink-0 text-gray-500" title="הבוט מושתק בשיחה זו" />
                    )}
                  </div>
                  <div className="truncate text-xs text-gray-500" dir="ltr">
                    {displayPhone(conv)}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">{formatListTime(conv.lastMessageAt)}</span>
              </div>

              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-gray-400">{conv.lastMessagePreview || "—"}</span>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${CONTACT_TYPE_COLORS[conv.contactType] || CONTACT_TYPE_COLORS.unknown}`}
                >
                  {CONTACT_TYPE_LABELS[conv.contactType] || conv.contactType}
                </Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
