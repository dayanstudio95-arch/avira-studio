import React, { useState } from "react";
import { AlarmClock } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { RETURN_OPTIONS, returnAtFor, returnChip } from "@/lib/aiAssist";

// "⏰ מתי לחזור אליהם" (AI sales help, 2026-10-09). Set automatically when a lead says they
// need time (3 days); set or cleared here by hand. When it comes due the conversation is
// back in "דורש מענה" and the bell + phone get a reminder.
export default function ReturnReminderButton({ conversation, onChanged }) {
  const [open, setOpen] = useState(false);
  const chip = returnChip(conversation);

  const save = async (returnAt) => {
    setOpen(false);
    try {
      await base44.entities.WhatsAppConversation.update(conversation.id, { returnAt, returnNotifiedAt: null });
      toast.success(returnAt ? `תזכורת נקבעה ל-${new Date(returnAt).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })} 10:00` : "התזכורת בוטלה");
      onChanged?.();
    } catch (e) {
      toast.error("לא נשמר", { description: e?.message });
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="מתי לחזור אליהם"
        title={chip || "מתי לחזור אליהם"}
        className={`flex h-10 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 ${chip ? "bg-amber-900/60 text-amber-200" : "w-10 bg-gray-800 text-gray-200 hover:text-amber-300"}`}
      >
        <AlarmClock className="h-5 w-5" />
        {chip && <span className="hidden text-xs md:inline">{chip.replace("⏰ ", "")}</span>}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-44 rounded-xl border border-gray-700 bg-gray-900 p-1 shadow-2xl">
          <div className="px-2 py-1 text-[11px] text-gray-500">להזכיר לי לחזור אליהם</div>
          {RETURN_OPTIONS.map((o) => (
            <button key={o.key} type="button" onClick={() => save(returnAtFor(o.days))} className="block w-full rounded-lg px-2 py-1.5 text-start text-sm text-gray-200 hover:bg-gray-800">
              {o.label}
            </button>
          ))}
          {conversation.returnAt && (
            <button type="button" onClick={() => save(null)} className="block w-full rounded-lg px-2 py-1.5 text-start text-sm text-red-300 hover:bg-gray-800">
              בטל תזכורת
            </button>
          )}
        </div>
      )}
    </div>
  );
}
