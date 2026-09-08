import React from "react";
import { Download, Bot, BotOff } from "lucide-react";
import { formatMessageTime, botDecisionLabel } from "./whatsappInboxShared";

// One message in the thread.
//
// Direction drives both side and color, exactly like WhatsApp:
//   inbound        — the other side, grey, right-hand side (RTL layout)
//   outbound_human — Daniel (from his phone or from this screen), green
//   outbound_bot   — this module's automated reply, blue + 🤖 marker. Nothing writes
//                    this in Stage 1; it exists so bot messages are never visually
//                    confusable with something a human actually said.
//
// Media is rendered as a plain download link, never an inline player/preview: these
// files sit behind Green API's own URLs, and embedding them would silently pull
// customer media through the browser on every render.

const DIRECTION_STYLES = {
  inbound: "bg-gray-800 text-gray-100 border-gray-700",
  outbound_human: "bg-green-900/60 text-green-50 border-green-800/60",
  outbound_bot: "bg-blue-900/50 text-blue-50 border-blue-800/60",
};

export default function MessageBubble({ message }) {
  const isOutbound = message.direction !== "inbound";
  const style = DIRECTION_STYLES[message.direction] || DIRECTION_STYLES.inbound;

  return (
    <div className={`flex ${isOutbound ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[75%] rounded-2xl border px-3 py-2 shadow-sm ${style}`}>
        {message.direction === "outbound_bot" && (
          <div className="mb-1 text-[10px] font-medium text-blue-300">🤖 הודעה אוטומטית</div>
        )}

        {message.bodyText ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.bodyText}</div>
        ) : (
          <div className="text-sm italic text-gray-400">[{message.typeMessage || "הודעה"}]</div>
        )}

        {message.mediaUrl && (
          <a
            href={message.mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1.5 inline-flex items-center gap-1 text-xs text-yellow-300 underline hover:text-yellow-200"
          >
            <Download className="h-3 w-3" />
            הורדת הקובץ ({message.typeMessage || "קובץ"})
          </a>
        )}

        <div className="mt-1 text-left text-[10px] text-gray-400">{formatMessageTime(message.createdDate)}</div>

        {/* Dry-run verdict. `botWouldReply` is null on outbound messages and on any
            inbound row recorded before the dry run shipped, which is why this tests for
            null rather than falsiness — "the bot chose silence" and "the bot was never
            asked" must not look the same on screen.

            The green marker is the one to read carefully: it means Stage 2, had it been
            switched on, would have sent this person a greeting and then a price list.
            Every green marker on a message that isn't a genuine inquiry is a bug found
            for free, before it cost the studio anything. */}
        {message.botWouldReply !== null && message.botWouldReply !== undefined && (
          <div
            className={`mt-1.5 flex items-center gap-1 border-t pt-1.5 text-[10px] ${
              message.botWouldReply
                ? "border-emerald-800/50 text-emerald-300"
                : "border-gray-700/60 text-gray-500"
            }`}
          >
            {message.botWouldReply ? <Bot className="h-3 w-3 shrink-0" /> : <BotOff className="h-3 w-3 shrink-0" />}
            <span>{botDecisionLabel(message.botSkipReason)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
