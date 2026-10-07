import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Bot, BotOff, Check, CheckCheck, AlertCircle } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { formatMessageDateTime, botDecisionLabel } from "./whatsappInboxShared";

// One message in the thread.
//
// Direction drives both side and color, exactly like WhatsApp:
//   inbound        — the other side, grey, right-hand side (RTL layout)
//   outbound_human — Daniel (from his phone or from this screen), green
//   outbound_bot   — this module's automated reply, blue + 🤖 marker. Nothing writes
//                    this in Stage 1; it exists so bot messages are never visually
//                    confusable with something a human actually said.
//
// Media: since 2026-10-05 the webhook copies each file into our private bucket and the
// thread shows it inline (StoredMedia). Messages from before that keep the old plain
// download link to Green API's own, temporary URL — never embedded.

// Media we copied into the private `whatsapp-media` bucket (2026-10-05) is shown in the
// thread through a short-lived signed URL — the bucket is private and the read policy
// limits it to the roles that can open the inbox. Older messages (no media_path) keep the
// old download link to Green API's temporary URL.
function useSignedMediaUrl(path) {
  const { data } = useQuery({
    queryKey: ["whatsappMediaUrl", path],
    queryFn: async () => {
      const { data: signed, error } = await supabase.storage.from("whatsapp-media").createSignedUrl(path, 3600);
      if (error) throw error;
      return signed?.signedUrl || null;
    },
    enabled: !!path,
    staleTime: 50 * 60 * 1000,
  });
  return data || null;
}

function StoredMedia({ path, mime, label }) {
  const url = useSignedMediaUrl(path);
  if (!url) return <div className="mt-1.5 h-10 w-40 animate-pulse rounded-lg bg-black/20" aria-label="טוען מדיה" />;
  const kind = String(mime || "").split("/")[0];
  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1.5 block">
        <img src={url} alt={label || "תמונה"} className="max-h-72 max-w-full rounded-lg object-cover" loading="lazy" />
      </a>
    );
  }
  if (kind === "audio") return <audio controls src={url} className="mt-1.5 w-60 max-w-full" />;
  if (kind === "video") return <video controls src={url} className="mt-1.5 max-h-72 max-w-full rounded-lg" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-yellow-300 underline hover:text-yellow-200">
      <Download className="h-3 w-3" />
      {label || "פתיחת הקובץ"}
    </a>
  );
}

// ✓ sent · ✓✓ delivered · blue ✓✓ read · red ! failed. Nothing when unknown (older
// messages, or receipts not switched on in Green API yet).
function DeliveryTick({ status }) {
  if (!status) return null;
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-400" aria-label="נקרא" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-gray-400" aria-label="נמסר" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5 text-gray-400" aria-label="נשלח, עוד לא נמסר" />;
  return <AlertCircle className="h-3.5 w-3.5 text-red-400" aria-label="לא נמסר" />;
}

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

        {message.senderName && (
          <div className="mb-0.5 text-[11px] font-semibold text-amber-300">{message.senderName}</div>
        )}

        {message.quotedText && (
          <div className="mb-1.5 rounded-md border-r-2 border-yellow-400 bg-black/20 px-2 py-1 text-xs text-gray-300 line-clamp-2">
            {message.quotedText}
          </div>
        )}

        {message.mediaPath && (
          <StoredMedia path={message.mediaPath} mime={message.mediaMime} label={message.bodyText} />
        )}

        {message.bodyText ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.bodyText}</div>
        ) : (
          <div className="text-sm italic text-gray-400">[{message.typeMessage || "הודעה"}]</div>
        )}

        {!message.mediaPath && message.mediaSize != null && (
          <div className="mt-1.5 text-xs italic text-gray-400">הקובץ כבר לא שמור במערכת (נמחק אחרי 18 חודשים). הוא עדיין בוואטסאפ בטלפון.</div>
        )}

        {message.mediaUrl && !message.mediaPath && message.mediaSize == null && (
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

        <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-current opacity-70" dir="ltr">
          <span className="tabular-nums">{formatMessageDateTime(message.createdDate || message.created_date)}</span>
          {isOutbound && <DeliveryTick status={message.deliveryStatus} />}
        </div>

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
