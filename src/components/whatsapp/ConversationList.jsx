import React from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ContactTypeBadge from "./ContactTypeBadge";
import { Search, BotOff, Bot, MessageSquare, Flame } from "lucide-react";
import {
  CONTACT_TYPE_LABELS,
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
  onChangeContactType,
}) {
  // The first two are not contact_types — they are work queues, and they are the two
  // filters worth opening every day:
  //   pricelist_sent — the bot has sent someone a price list and nobody has followed up
  //                    yet. This is the studio's actual sales queue, and the reason the
  //                    bot collects details before sending: each of these has a name, a
  //                    date and a venue attached, so "צור ליד" opens a filled-in form.
  //   would_reply    — every conversation the gate opened on, for auditing what it did.
  const filters = [
    { value: "hot", label: "🔥 ליד חם" },
    { value: "pricelist_sent", label: "🧾 נשלח מחירון" },
    // awaiting_followup — got the price list (from the bot, or flagged by hand) and
    //                     nobody has heard back. THE list to chase; the header button
    //                     "ממתינים לפולו-אפ" sends to exactly this set.
    { value: "awaiting_followup", label: "⏳ קיבלו מחירון ולא ענו" },
    // followup_sent — everyone who has already been nudged, so what happened after the
    //                 nudge can be read in one place (owner's request, 2026-09-15).
    { value: "followup_sent", label: "📨 נשלח פולו-אפ" },
    // Two holes found on 2026-09-15: mid-flow conversations that went quiet were in no
    // queue, and a stranger whose first message was a voice note got silence with
    // nobody told. Both predicates live in src/lib/needsAttention.js.
    { value: "stalled_flow", label: "🕐 לא סיימו פרטים" },
    { value: "media_stranger", label: "📎 מדיה ממספר לא מוכר" },
    { value: "would_reply", label: "🤖 הבוט היה עונה" },
    { value: "all", label: "הכל" },
    { value: "unknown", label: CONTACT_TYPE_LABELS.unknown },
    { value: "lead", label: CONTACT_TYPE_LABELS.lead },
    { value: "client", label: CONTACT_TYPE_LABELS.client },
    // Staff and groups are hidden from every other filter, including "הכל" — these
    // two chips are the only way to see them. See the filter in WhatsAppInbox.jsx.
    { value: "staff", label: CONTACT_TYPE_LABELS.staff },
    { value: "group", label: "קבוצות" },
  ];

  // `min-h-0` is load-bearing, not cosmetic. This is a grid item in an auto-sized row,
  // so its default `min-height: auto` lets the row grow to the full height of the
  // conversation list. `h-full` then resolves against that grown row, the scroll
  // container below never overflows, and the parent's `overflow-hidden` silently
  // truncates the list at the bottom of the panel — no scrollbar, no way to reach the
  // older conversations. Zeroing the minimum caps the row at the container height.
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border-gray-800 bg-gray-900/60 md:border-l">
      <div className="min-w-0 space-y-2 border-b border-gray-800 p-2 md:space-y-3 md:p-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="חיפוש לפי שם או מספר"
            className="border-gray-700 bg-gray-800 pr-9 text-base text-white placeholder:text-gray-500 md:text-sm"
          />
        </div>
        {/* Twelve chips wrapped into three rows on a phone and pushed the list off
            screen. There they are one swipeable row; desktop wraps as before. */}
        <div className="-mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onContactFilterChange(f.value)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors md:px-2.5 md:py-1 ${
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
            // A div, not a <button>: the contact-type tag inside is its own button
            // (a dropdown), and a button inside a button is invalid HTML that browsers
            // untangle unpredictably. Keyboard access is kept by hand.
            <div
              key={conv.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(conv.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(conv.id);
                }
              }}
              className={`w-full cursor-pointer border-b border-gray-800/70 px-3 py-3 text-right transition-colors ${
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
                    {/* Rated from the customer's reply to the price list. Only the hot
                        one gets an icon — a flame on every row would be wallpaper, and
                        the whole point is that this row is the one to open first. */}
                    {conv.leadTemperature === "hot" && (
                      <Flame
                        className="h-3.5 w-3.5 shrink-0 text-red-400"
                        title={conv.leadTemperatureReason || "ליד חם"}
                      />
                    )}
                  </div>
                  <div className="truncate text-xs text-gray-500" dir="ltr">
                    {displayPhone(conv)}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-gray-500">{formatListTime(conv.lastMessageAt)}</span>
              </div>

              {/* Why the rating came out that way, so a wrong one is caught by reading
                  rather than by trusting. Same principle as the dry run's skip reasons. */}
              {conv.leadTemperatureReason && conv.leadTemperature === "hot" && (
                <div className="mt-1 truncate text-[11px] text-red-300/80">{conv.leadTemperatureReason}</div>
              )}

              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-gray-400">{conv.lastMessagePreview || "—"}</span>
                {/* Came in through a Facebook/Instagram ad (migration 0060). Shown next to
                    the contact type because it changes what the row means: an "unknown"
                    who tapped the studio's wedding ad is a lead, not a stranger. */}
                {conv.followupFlaggedAt && (!conv.followupSentAt || new Date(conv.followupFlaggedAt) > new Date(conv.followupSentAt)) && (
                  <Badge variant="outline" className="shrink-0 text-[10px] border-yellow-500/50 text-yellow-300" title="סומן ידנית לפולו-אפ">
                    🏷️ פולו-אפ
                  </Badge>
                )}
                {conv.source === "facebook_ad" && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-[10px] border-blue-500/50 text-blue-300"
                    title={conv.sourceAdTitle ? `מודעה: ${conv.sourceAdTitle}` : "הגיע דרך מודעה"}
                  >
                    📣 מודעה
                  </Badge>
                )}
                <ContactTypeBadge
                  conversation={conv}
                  className="shrink-0"
                  onChange={onChangeContactType ? (type) => onChangeContactType(conv, type) : undefined}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
