import React, { useState } from "react";
import { Loader2, X, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

// "✨" in the composer (AI sales help, 2026-10-09): two drafted replies, or the owner's own
// draft improved. Nothing is sent from here — "השתמש" puts the text in the box.
function Card({ label, text, busy, onUse, onTweak }) {
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-800/70 p-2.5">
      {label && <div className="mb-1 text-[11px] font-semibold text-violet-300">{label}</div>}
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-100">{text}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onUse(text)} className="rounded-full bg-yellow-400 px-3 py-1 text-xs font-semibold text-gray-900">השתמש</button>
        <button type="button" disabled={busy} onClick={() => onTweak(text, "shorter")} className="rounded-full border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:text-white disabled:opacity-40">קצר יותר</button>
        <button type="button" disabled={busy} onClick={() => onTweak(text, "warmer")} className="rounded-full border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:text-white disabled:opacity-40">חם יותר</button>
      </div>
    </div>
  );
}

export default function AiAssistPanel({ conversation, draft, onUse, onClose }) {
  const [busy, setBusy] = useState(null); // 'suggest' | 'improve' | 'tweak'
  const [cards, setCards] = useState([]); // [{label, text}]
  const [note, setNote] = useState("");

  const call = async (kind, payload) => {
    setBusy(kind);
    try {
      const res = await base44.functions.invoke("whatsappAiAssist", payload);
      return res.data;
    } catch (e) {
      toast.error("העוזר לא הצליח", { description: e?.message });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const suggest = async () => {
    const data = await call("suggest", { action: "suggest", conversationId: conversation.id });
    if (!data) return;
    setCards(data.suggestions || []);
    setNote(data.note || "");
  };

  const improve = async () => {
    const data = await call("improve", { action: "improve", text: draft });
    if (data?.text) {
      setCards([{ label: "הניסוח שלך, משופר", text: data.text }]);
      setNote("");
    }
  };

  const tweak = async (text, how) => {
    const data = await call("tweak", { action: "improve", text, tweak: how });
    if (data?.text) setCards((list) => [{ label: how === "shorter" ? "קצר יותר" : "חם יותר", text: data.text }, ...list].slice(0, 4));
  };

  return (
    <div className="absolute bottom-full right-2 z-20 mb-2 w-[min(440px,calc(100vw-1rem))] rounded-2xl border border-violet-800/70 bg-gray-900 p-2.5 shadow-2xl">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-violet-200"><Sparkles className="h-4 w-4" /> עוזר מכירות</span>
        <button type="button" onClick={onClose} aria-label="סגור" className="text-gray-500 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <button type="button" onClick={suggest} disabled={!!busy} className="flex items-center justify-center gap-1.5 rounded-xl bg-violet-700/80 py-2 text-sm font-semibold text-white hover:bg-violet-600 disabled:opacity-50">
          {busy === "suggest" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} הצע תשובה
        </button>
        <button
          type="button"
          onClick={improve}
          disabled={!!busy || !draft?.trim()}
          title={draft?.trim() ? "משפר את מה שכתבת — בלי לשנות מחירים ותוכן" : "כתבו קודם טיוטה בתיבה"}
          className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-700 py-2 text-sm text-violet-100 hover:bg-violet-900/40 disabled:opacity-40"
        >
          {busy === "improve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} שפר את מה שכתבתי
        </button>
      </div>
      {busy === "tweak" && <div className="mb-2 flex items-center gap-2 px-1 text-xs text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> מנסח מחדש…</div>}
      {note && <div className="mb-2 rounded-lg bg-amber-950/50 px-2.5 py-1.5 text-xs text-amber-200">{note}</div>}
      <div className="max-h-[50vh] space-y-2 overflow-y-auto">
        {cards.map((c, i) => (
          <Card key={i + c.text.slice(0, 20)} label={c.label} text={c.text} busy={!!busy} onUse={onUse} onTweak={tweak} />
        ))}
      </div>
      <p className="mt-2 px-1 text-[10px] text-gray-500">רק מציע — שום דבר לא נשלח בלי שתלחצו שלח. מחירים לפי הטבלה בהגדרות.</p>
    </div>
  );
}
