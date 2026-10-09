import React, { useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Brain } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { offersLine, summaryIsStale } from "@/lib/aiAssist";

// The summary bar at the top of a lead's conversation (AI sales help, 2026-10-09):
// budget · what they want · what they asked · "מה כבר הצעתי". Made on click (it costs a
// few agorot), kept on the conversation until a new message arrives.
export default function AiSummaryBar({ conversation }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState(null);
  const summary = fresh?.id === conversation.id ? fresh.summary : conversation.aiSummary;
  const stale = !fresh || fresh.id !== conversation.id ? summaryIsStale(conversation) : false;

  const load = async (force) => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("whatsappAiAssist", { action: "summary", conversationId: conversation.id, force });
      setFresh({ id: conversation.id, summary: res.data.summary });
      setOpen(true);
    } catch (e) {
      toast.error("הסיכום לא הצליח", { description: e?.message });
    }
    setBusy(false);
  };

  const offers = offersLine(summary);

  if (!summary) {
    return (
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/40 px-4 py-1.5">
        <button type="button" onClick={() => load(false)} disabled={busy} className="flex items-center gap-1.5 text-xs text-violet-300 hover:text-violet-100 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />} סכם את השיחה
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-gray-800 bg-violet-950/20 px-4 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-violet-200">
          <Brain className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {summary.status || "סיכום"}
            {offers && <span className="text-amber-200"> · הוצע: {offers}</span>}
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={busy}
          title={stale ? "יש הודעות חדשות מאז הסיכום" : "סכם מחדש"}
          className={`flex shrink-0 items-center gap-1 ${stale ? "text-amber-300" : "text-gray-500"} hover:text-white disabled:opacity-50`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {stale && "רענן"}
        </button>
      </div>
      {open && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 pb-1 text-gray-300">
          {summary.budget && (<><dt className="text-gray-500">תקציב</dt><dd>{summary.budget}</dd></>)}
          {summary.wants && (<><dt className="text-gray-500">רוצים</dt><dd>{summary.wants}</dd></>)}
          {summary.asked && (<><dt className="text-gray-500">ביקשו</dt><dd>{summary.asked}</dd></>)}
          <dt className="text-gray-500">מה כבר הצעתי</dt>
          <dd className="text-amber-200">{offers || "עוד לא הוצע מחיר"}</dd>
        </dl>
      )}
    </div>
  );
}
