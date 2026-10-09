import React, { useState } from "react";
import { Bot, ClipboardList, Loader2, Receipt, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

// "🤖" in the composer (2026-10-09, the owner's request): send the bot's first message (the
// details request) or the price list (image + text) by hand. Same text and image as the bot
// (Settings → the bot), shown first; nothing goes out until "שלח". Recorded as the bot's
// message, so the bot carries on from there (whatsapp-send-bot-message).
const KINDS = [
  { key: "greeting", label: "בקשת פרטים", icon: ClipboardList, hint: "ההודעה הראשונה של הבוט — מבקשת שמות, תאריך, אולם ומוזמנים. אחריה הבוט ממשיך לאסוף את הפרטים לבד." },
  { key: "pricelist", label: "מחירון", icon: Receipt, hint: "התמונה והטקסט של המחירון, כמו שהבוט שולח. השיחה עוברת ל\"נשלח מחירון\"." },
];

export default function BotSendPanel({ conversation, onClose, onSent }) {
  const [kind, setKind] = useState(null);
  const [preview, setPreview] = useState(null); // [{type, text|url, caption}]
  const [busy, setBusy] = useState(null); // 'preview' | 'send'

  const choose = async (k) => {
    setKind(k);
    setPreview(null);
    setBusy("preview");
    try {
      const res = await base44.functions.invoke("whatsappSendBotMessage", { conversationId: conversation.id, kind: k, preview: true });
      setPreview(res.data?.sends || []);
    } catch (e) {
      toast.error("לא ניתן להכין את ההודעה", { description: e?.message });
      setKind(null);
    }
    setBusy(null);
  };

  const send = async () => {
    setBusy("send");
    try {
      const res = await base44.functions.invoke("whatsappSendBotMessage", { conversationId: conversation.id, kind });
      if (res.data?.partial) toast.warning("התמונה נשלחה, הטקסט לא — פרטים בפעמון");
      else toast.success(kind === "pricelist" ? "המחירון נשלח" : "בקשת הפרטים נשלחה");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setBusy(null);
  };

  const info = KINDS.find((k) => k.key === kind);

  return (
    <div className="absolute bottom-full right-2 z-20 mb-2 w-[min(400px,calc(100%-1rem))] rounded-2xl border border-emerald-800/70 bg-gray-900 p-2.5 shadow-2xl">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-200"><Bot className="h-4 w-4" /> שליחה בשם הבוט</span>
        <button type="button" onClick={onClose} aria-label="סגור" className="text-gray-500 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => choose(k.key)}
            disabled={!!busy}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold disabled:opacity-50 ${kind === k.key ? "bg-emerald-700 text-white" : "border border-emerald-800 text-emerald-100 hover:bg-emerald-900/40"}`}
          >
            <k.icon className="h-4 w-4" /> {k.label}
          </button>
        ))}
      </div>
      {busy === "preview" && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {kind && preview && (
        <div className="mt-2 space-y-2">
          <p className="px-1 text-[11px] text-gray-400">{info?.hint}</p>
          <div className="max-h-[45vh] space-y-2 overflow-y-auto rounded-xl bg-gray-800/60 p-2">
            {preview.map((p, i) => (
              <div key={i} className="space-y-1">
                {p.type === "file" && <img src={p.url} alt="המחירון" className="max-h-48 w-full rounded-lg object-contain" />}
                {(p.caption || p.text) && <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-100">{p.caption || p.text}</div>}
              </div>
            ))}
          </div>
          {conversation.optedOutAt && <p className="rounded-md bg-red-950/50 px-2 py-1 text-xs text-red-200">שימו לב: ביקשו לא לקבל הודעות.</p>}
          <button type="button" onClick={send} disabled={busy === "send"} className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60">
            {busy === "send" && <Loader2 className="h-4 w-4 animate-spin" />} שלח {info?.label}
          </button>
          <p className="px-1 text-[10px] text-gray-500">הנוסח והתמונה מהגדרות הבוט (מרכז שליטה לבוט).</p>
        </div>
      )}
    </div>
  );
}
