import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Bot, BotOff, Check, CheckCheck, AlertCircle } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { formatMessageDateTime, botDecisionLabel } from "./whatsappInboxShared";
import { linkifyParts } from "@/lib/linkify";
import { isForwardableMessage } from "@/lib/forward";

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
  if (kind === "audio") return <VoiceNote url={url} />;
  if (kind === "video") return <video controls src={url} className="mt-1.5 max-h-72 max-w-full rounded-lg" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-yellow-300 underline hover:text-yellow-200">
      <Download className="h-3 w-3" />
      {label || "פתיחת הקובץ"}
    </a>
  );
}

// A voice note with WhatsApp's speed button (2026-10-13, the owner's request): 1× → 1.5× → 2×.
// The chosen speed is remembered on this device for every voice note.
const RATES = [1, 1.5, 2];
const RATE_KEY = "chat_audio_rate";
const readRate = () => {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return RATES.includes(r) ? r : 1;
  } catch {
    return 1;
  }
};
export function VoiceNote({ url }) {
  const ref = useRef(null);
  const [rate, setRate] = useState(readRate);
  useEffect(() => {
    if (ref.current) ref.current.playbackRate = rate;
  }, [rate, url]);
  const next = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(r);
    try { localStorage.setItem(RATE_KEY, String(r)); } catch { /* private mode */ }
  };
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <audio
        ref={ref}
        controls
        src={url}
        className="w-56 max-w-full"
        // Some browsers reset the speed when the file loads; set it again.
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = rate; }}
        onPlay={(e) => { e.currentTarget.playbackRate = rate; }}
      />
      <button
        type="button"
        onClick={next}
        aria-label={`מהירות ${rate}×, לחץ לשינוי`}
        className="min-h-[32px] min-w-[44px] shrink-0 rounded-full bg-black/30 px-2 text-xs font-bold tabular-nums text-white hover:bg-black/50"
        dir="ltr"
      >
        {rate}×
      </button>
    </div>
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

// Links in a message open in a new tab (2026-10-13, the owner's request) — src/lib/linkify.js.
function Linkified({ text }) {
  return linkifyParts(text).map((p, i) =>
    p.href ? (
      <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" dir="ltr" className="break-all text-sky-300 underline hover:text-sky-200">
        {p.text}
      </a>
    ) : (
      <React.Fragment key={i}>{p.text}</React.Fragment>
    )
  );
}

// Reactions on a message (2026-10-13): theirs and the owner's, like WhatsApp.
function Reactions({ items, isOutbound }) {
  if (!items?.length) return null;
  return (
    <div className={`-mt-2 flex ${isOutbound ? "justify-start ps-3" : "justify-end pe-3"}`}>
      <div className="relative z-10 flex items-center gap-1 rounded-full border border-gray-700 bg-gray-900 px-1.5 py-0.5 text-sm shadow">
        {items.map((r, i) => (
          <span key={i} title={r.mine ? "התגובה שלך" : r.by ? `תגובה של ${r.by}` : "התגובה שלהם"} className={r.mine ? "rounded-full bg-emerald-500/25 px-1" : "px-0.5"}>
            {r.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}

// Long-press (phone) or right-click (computer) on a bubble → onLongPress. A press that
// moves (a scroll) is not a long-press.
function PressArea({ onLongPress, className, children }) {
  const timer = useRef(null);
  const start = useRef(null);
  const clear = () => { clearTimeout(timer.current); timer.current = null; };
  if (!onLongPress) return <div className={className}>{children}</div>;
  return (
    <div
      className={className}
      onTouchStart={(e) => {
        const t = e.touches[0];
        start.current = { x: t.clientX, y: t.clientY };
        clear();
        timer.current = setTimeout(() => { timer.current = null; onLongPress(); }, 500);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 10) clear();
      }}
      onTouchEnd={clear}
      onTouchCancel={clear}
      onContextMenu={(e) => { e.preventDefault(); clear(); onLongPress(); }}
    >
      {children}
    </div>
  );
}

// `onForward` (2026-10-13): the chat passes it; long-press / right-click or the ↪ button
// on hover opens "העבר". The old inbox does not pass it.
export default function MessageBubble({ message, onForward }) {
  // A reaction whose message is not loaded (older than the last 500) — a small line.
  if (message.typeMessage === "reactionMessage") {
    const mine = message.direction !== "inbound";
    return (
      <div className="flex justify-center">
        <div className="rounded-full border border-gray-800 bg-gray-900/70 px-3 py-1 text-xs text-gray-300">
          {mine ? "הגבת" : message.senderName ? `${message.senderName} הגיב/ה` : "הגיבו"} {message.bodyText} להודעה קודמת · <span dir="ltr" className="tabular-nums">{formatMessageDateTime(message.createdDate || message.created_date)}</span>
        </div>
      </div>
    );
  }
  // A WhatsApp call nobody answered (2026-10-13) — a line in the middle, like WhatsApp.
  if (message.typeMessage === "missedCall") {
    return (
      <div className="flex justify-center">
        <div className="rounded-full border border-red-900/60 bg-red-950/40 px-3 py-1 text-xs text-red-200">
          {message.bodyText || "📞 שיחה שלא נענתה"} · <span dir="ltr" className="tabular-nums">{formatMessageDateTime(message.createdDate || message.created_date)}</span>
        </div>
      </div>
    );
  }
  const isOutbound = message.direction !== "inbound";
  const style = DIRECTION_STYLES[message.direction] || DIRECTION_STYLES.inbound;
  const forward = onForward && isForwardableMessage(message) ? () => onForward(message) : null;

  return (
    <div className={message.reactions?.length ? "pb-1" : undefined}>
    <div className={`group flex items-center gap-1 ${isOutbound ? "justify-start" : "flex-row-reverse justify-start"}`}>
      <PressArea onLongPress={forward} className={`max-w-[75%] rounded-2xl border px-3 py-2 shadow-sm ${style}`}>
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
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed"><Linkified text={message.bodyText} /></div>
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
      </PressArea>
      {forward && (
        <button
          type="button"
          onClick={forward}
          aria-label="העבר הודעה"
          title="העבר"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-800/80 text-sm text-gray-300 opacity-0 transition-opacity hover:text-white focus:opacity-100 group-hover:opacity-100 md:flex"
        >
          ↪
        </button>
      )}
    </div>
    <Reactions items={message.reactions} isOutbound={isOutbound} />
    </div>
  );
}
