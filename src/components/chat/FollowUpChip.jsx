import React from "react";
import { followUpOutcome } from "@/lib/chatModel";

// "פולו-אפ נשלח · 7.10" / "ענו אחרי פולו-אפ ✓" (2026-10-07) — on the row and in the thread.
export default function FollowUpChip({ conversation, className = "" }) {
  const outcome = followUpOutcome(conversation);
  if (!outcome) return null;
  const d = new Date(conversation.followupSentAt);
  const date = `${d.getDate()}.${d.getMonth() + 1}`;
  return outcome === "replied" ? (
    <span title={`פולו-אפ נשלח ב-${date}`} className={`rounded-full bg-emerald-500/20 px-2 text-[11px] text-emerald-200 ${className}`}>ענו אחרי פולו-אפ ✓</span>
  ) : (
    <span className={`rounded-full bg-orange-500/15 px-2 text-[11px] text-orange-200 ${className}`}>פולו-אפ נשלח · {date}</span>
  );
}
