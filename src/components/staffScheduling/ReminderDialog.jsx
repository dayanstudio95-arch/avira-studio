import React, { useMemo, useState } from "react";
import { toast } from "sonner";
import { Bell, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reminderMessage, reminderPlans } from "@/lib/staffAvailabilityBatch";
import { sendAvailabilityReminder, LINK_MARK } from "@/lib/availabilityBatchSend";
import { friendlySendError } from "@/lib/sendErrors";
import { formatDateWithWeekday } from "@/lib/chatModel";

/**
 * "תזכורת לכולם" (2026-11-11, the owner: "שאני יוכל לסמן את שניהם ולשלוח לשניהם ביחד הודעה ... אפילו מכמה אירועים
 * שונים"): the unanswered rows ticked on "תשובות זמינות". One WhatsApp per person with all his dates and one link
 * (his choice; split only by role), each message shown first and editable; nothing goes out before "שליחה".
 * `items` = [{ request, date, venue, couple }]; `onSent(requestIds)` after each person who got it.
 */
export default function ReminderDialog({ items, staffMembers, onClose, onSent }) {
  const plans = useMemo(() => reminderPlans({ items, staffMembers }), [items, staffMembers]);
  const [texts, setTexts] = useState({});
  const [openKey, setOpenKey] = useState(null);
  const [status, setStatus] = useState({}); // plan key → 'sending' | 'sent' | error text
  const [sending, setSending] = useState(false);

  const nameOf = (p) => p.staff?.name || p.name;
  const textFor = (p) => texts[p.key] ?? reminderMessage({ name: nameOf(p), slot: p.slot, role: p.role, items: p.items, link: LINK_MARK });
  const sendable = plans.filter((p) => p.staff?.phoneNumber);

  const sendAll = async () => {
    if (sending || !sendable.length) return;
    setSending(true);
    let ok = 0;
    for (const p of sendable) {
      if (status[p.key] === "sent") {
        ok++;
        continue;
      }
      setStatus((st) => ({ ...st, [p.key]: "sending" }));
      try {
        await sendAvailabilityReminder({ staff: p.staff, slot: p.slot, requests: p.items.map((x) => x.request), text: textFor(p) });
        setStatus((st) => ({ ...st, [p.key]: "sent" }));
        onSent?.(p.items.map((x) => x.request.id));
        ok++;
      } catch (e) {
        console.error("availability reminder failed:", e);
        setStatus((st) => ({ ...st, [p.key]: friendlySendError(e?.message) }));
      }
    }
    setSending(false);
    if (ok === sendable.length) {
      toast.success(ok === 1 ? `התזכורת נשלחה ל${nameOf(sendable[0])}` : `נשלחו תזכורות ל-${ok} אנשי צוות`);
      onClose();
    } else if (ok) toast.warning(`נשלחו ${ok} מתוך ${sendable.length}. מי שלא קיבל מסומן באדום.`);
  };

  const people = new Set(plans.map((p) => p.staff?.id || p.name)).size;
  return (
    <Dialog open onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent dir="rtl" className="max-w-lg border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-pink-300" /> תזכורת ל{people === 1 ? nameOf(plans[0] || {}) : `-${people} אנשי צוות`}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-400">
          כל אחד מקבל הודעה אחת עם כל התאריכים שלו וקישור אחד, שבו הוא מסמן פנוי או לא פנוי. הקישורים הקודמים שנשלחו אליו על התאריכים האלה יפסיקו לעבוד.
        </p>
        <div className="divide-y divide-white/[0.06] rounded-lg border border-gray-700" data-testid="reminder-plans">
          {plans.map((p) => {
            const st = status[p.key];
            const open = openKey === p.key;
            return (
              <div key={p.key} className="px-3 py-2.5" data-testid="reminder-plan">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{nameOf(p)}</div>
                    <div className="text-[11px] text-gray-400">
                      {p.items.map((x) => `${formatDateWithWeekday(x.date)}${x.couple ? ` · ${x.couple}` : ""}`).join(" | ")}
                    </div>
                  </div>
                  {!p.staff ? (
                    <span className="text-xs text-rose-300">לא ברשימת הצוות, לא יישלח</span>
                  ) : !p.staff.phoneNumber ? (
                    <span className="text-xs text-rose-300">אין טלפון, לא יישלח</span>
                  ) : st === "sent" ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> נשלח</span>
                  ) : st === "sending" ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : st ? (
                    <span className="max-w-[12rem] text-xs text-rose-300">{st}</span>
                  ) : (
                    <button type="button" onClick={() => setOpenKey(open ? null : p.key)} className="flex items-center gap-1 text-xs text-gray-300 hover:text-white">
                      ההודעה <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                    </button>
                  )}
                </div>
                {open && !st && (
                  <textarea
                    value={textFor(p)}
                    onChange={(e) => setTexts((t) => ({ ...t, [p.key]: e.target.value }))}
                    rows={8}
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-white"
                    data-testid="reminder-text"
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500">{"{{link}}"} מתחלף בקישור האישי שלו.</p>
        <div className="flex flex-row-reverse gap-2">
          <button
            type="button"
            onClick={sendAll}
            disabled={sending || !sendable.length}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            data-testid="reminder-send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            {sendable.length === 1 ? "שליחה בוואטסאפ" : `שליחה ל-${sendable.length} בוואטסאפ`}
          </button>
          <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300">
            ביטול
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
