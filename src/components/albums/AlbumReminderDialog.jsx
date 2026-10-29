import React, { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { ensurePortalLink, restorePortalLink } from "@/lib/albumPortalLink";
import { friendlySendError } from "@/lib/sendErrors";
import { renderReviewReminder, REVIEW_REMINDER_TEMPLATE_KEY } from "@/lib/albumPrintDetails";

const LINK_MARK = "{{link}}";

// "תזכורת" next to "בבדיקת הזוג" in the album orders list (2026-10-29, the owner's request):
// the reminder (Settings → תבניות → "תזכורת לבדיקת סקיצה"), editable, sent only on "שלח".
// The link is put in at send time — the current one when this browser has it, else a new
// one (ensurePortalLink) — so nothing changes before the click.
export default function AlbumReminderDialog({ order, names, phone, onClose, onSent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!order) return;
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: REVIEW_REMINDER_TEMPLATE_KEY }).catch(() => []);
      setText(renderReviewReminder(rows?.[0]?.value, { names, link: LINK_MARK }));
    })();
  }, [order, names]);

  if (!order) return null;

  const send = async () => {
    if (!phone || !text.trim() || sending) return;
    setSending(true);
    let link = null;
    try {
      link = await ensurePortalLink(order);
      const message = text.includes(LINK_MARK) ? text.replace(LINK_MARK, link.url) : `${text.trim()}\n${link.url}`;
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message });
      if (res?.data?.error) throw new Error(res.data.error);
      await base44.entities.AlbumOrder.update(order.id, { reviewReminderSentAt: new Date().toISOString() }).catch(() => {});
      toast.success(`התזכורת נשלחה ל${names}`);
      onSent?.();
      onClose();
    } catch (e) {
      console.error("album reminder failed:", e);
      // the message didn't go — the couple keeps the link they already have
      if (link?.minted) await restorePortalLink(order, link.previous).catch((err) => console.error("restore link failed:", err));
      toast.error("השליחה נכשלה", { description: friendlySendError(e?.message) });
    }
    setSending(false);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !sending) onClose(); }}>
      <DialogContent className="max-w-md border-gray-700 bg-gray-900 text-white" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-right">תזכורת ל{names}</DialogTitle>
          <p className="text-right text-xs text-gray-400">{phone ? <>יישלח ל-<span dir="ltr">{phone}</span></> : "אין טלפון להזמנה הזו"}</p>
        </DialogHeader>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} disabled={sending} className="w-full rounded-lg border border-gray-700 bg-gray-800 p-2.5 text-sm text-white" />
        <p className="text-xs text-gray-500">{LINK_MARK} יוחלף בקישור לזוג. הנוסח הקבוע: הגדרות ← תבניות ← "תזכורת לבדיקת סקיצה".</p>
        <div className="flex gap-2">
          <Button onClick={send} disabled={sending || !phone || !text.trim()} className="flex-1 gap-2 bg-green-600 text-white hover:bg-green-700">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח
          </Button>
          <Button variant="outline" onClick={onClose} disabled={sending} className="border-gray-700 bg-gray-800 text-gray-200">ביטול</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
