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
  awaitingCount = 0,
  hotCount = 0,
  onSendFollowUp,
}) {
  const [showMore, setShowMore] = React.useState(false);
  // Reorganised 2026-09-23 at the owner's request. The inbox opens on "לא מוכר" (new
  // people, the actual work) with everything about follow-up next to it; everything else
  // is one tap away under "עוד". Two chips were dropped — "לא סיימו פרטים" and "מדיה
  // ממספר לא מוכר": both populations still appear on the dashboard's needs-attention
  // card and in the morning digest, and the mid-flow nudge still runs.
  //
  //   awaiting_followup — got the price list (from the bot, or flagged by hand) and
  //                       nobody has heard back. THE list to chase: the bar above the
  //                       list sends to exactly this set.
  //   followup_sent     — already nudged, waiting for an answer.
  //   hot               — replied to the price list wanting to move forward.
  const primaryFilters = [
    { value: "unknown", label: CONTACT_TYPE_LABELS.unknown },
    { value: "awaiting_followup", label: "⏳ ממתינים לפולו-אפ", count: awaitingCount },
    { value: "followup_sent", label: "📨 נשלח פולו-אפ" },
    { value: "hot", label: "🔥 ליד חם", count: hotCount },
    { value: "all", label: "הכל" },
  ];
  const moreFilters = [
    { value: "lead", label: CONTACT_TYPE_LABELS.lead },
    { value: "client", label: CONTACT_TYPE_LABELS.client },
    // Staff and groups are hidden from every other filter, including "הכל" — these
    // two chips are the only way to see them. See the filter in WhatsAppInbox.jsx.
    { value: "staff", label: CONTACT_TYPE_LABELS.staff },
    { value: "group", label: "קבוצות" },
    { value: "pricelist_sent", label: "🧾 נשלח מחירון" },
    { value: "would_reply", label: "🤖 הבוט היה עונה" },
  ];
  const moreActive = moreFilters.some((f) => f.value === contactFilter);
  const showMoreRow = showMore || moreActive;

  const chipClass = (active) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors md:px-2.5 md:py-1 ${
      active
        ? "border-yellow-500/50 bg-yellow-500/20 text-yellow-300"
        : "border-gray-700 bg-gray-800 text-gray-400 hover:text-gray-200"
    }`;
  const chipStripClass =
    "-mx-2 flex gap-1.5 overflow-x-auto px-2 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden";

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
        <div className={chipStripClass}>
          {primaryFilters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onContactFilterChange(f.value)}
              className={chipClass(contactFilter === f.value)}
            >
              {f.label}
              {f.count > 0 && <span className="mr-1 font-semibold">{f.count}</span>}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className={chipClass(false)}
            aria-expanded={showMoreRow}
          >
            {showMoreRow ? "פחות ▴" : "עוד ▾"}
          </button>
        </div>
        {showMoreRow && (
          <div className={chipStripClass}>
            {moreFilters.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => onContactFilterChange(f.value)}
                className={chipClass(contactFilter === f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {/* The follow-up list and its send button are one thing (owner's request,
            2026-09-23): open the chip, see who is waiting, send to all of them from the
            top of the list. The header counter opens this same view. */}
        {contactFilter === "awaiting_followup" && awaitingCount > 0 && onSendFollowUp && (
          <button
            type="button"
            onClick={onSendFollowUp}
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-200 hover:bg-yellow-500/20"
          >
            <span>{awaitingCount} ממתינים לפולו-אפ</span>
            <span className="rounded-md bg-yellow-400 px-2.5 py-1 text-xs font-semibold text-gray-900">שלח פולו-אפ</span>
          </button>
        )}
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
                        title="השער של הבוט נפתח בשיחה הזו"
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
