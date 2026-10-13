import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Search, Share, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { forwardCandidates, MAX_FORWARD_TARGETS } from "@/lib/forward";
import { previewText } from "@/lib/chatModel";
import { Avatar, conversationTitle } from "./ChatList";

// "↪️ העבר" (2026-10-13, the owner's request, like WhatsApp): one message to up to five
// chats. Nothing goes out before "העבר" and a confirmation. The forwarded copies come
// back through the webhook and appear in those chats by themselves.
export default function ForwardDialog({ message, source, conversations, onClose }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);
  const list = useMemo(
    () => forwardCandidates(conversations, source?.id, search, conversationTitle).slice(0, 60),
    [conversations, source?.id, search]
  );
  const byId = useMemo(() => Object.fromEntries((conversations || []).map((c) => [c.id, c])), [conversations]);

  const toggle = (id) =>
    setPicked((p) => {
      if (p.includes(id)) return p.filter((x) => x !== id);
      if (p.length >= MAX_FORWARD_TARGETS) {
        toast.info(`אפשר להעביר לעד ${MAX_FORWARD_TARGETS} שיחות בכל פעם`);
        return p;
      }
      return [...p, id];
    });

  const send = async () => {
    if (!picked.length) return;
    const names = picked.map((id) => conversationTitle(byId[id])).join(", ");
    if (!(await confirmDialog({ title: picked.length === 1 ? `להעביר ל${names}?` : `להעביר ל-${picked.length} שיחות?`, message: picked.length > 1 ? names : "", confirmText: "העבר" }))) return;
    setBusy(true);
    try {
      const res = await base44.functions.invoke("whatsappForwardMessage", {
        conversationId: source.id,
        idMessage: message.idMessage,
        targetConversationIds: picked,
      });
      const d = res?.data || {};
      if (d.failed) toast.warning(`הועבר ל-${d.sent} מתוך ${d.sent + d.failed}`, { description: "חלק מההעברות נכשלו" });
      else toast.success(picked.length === 1 ? "ההודעה הועברה" : `ההודעה הועברה ל-${d.sent} שיחות`);
      onClose();
    } catch (e) {
      toast.error("ההעברה נכשלה", { description: e?.message });
    } finally {
      setBusy(false);
    }
  };

  const preview = previewText(message.bodyText || message.typeMessage);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:items-center" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-label="העברת הודעה" dir="rtl" onClick={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full flex-col rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[440px] md:rounded-2xl md:border">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-bold text-white">↪️ העברת הודעה</span>
          <button type="button" onClick={onClose} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="mb-2 line-clamp-2 rounded-lg border-r-2 border-emerald-500 bg-gray-900 px-2 py-1.5 text-xs text-gray-300">{preview || "הודעה"}</div>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש שיחה לפי שם או מספר"
            className="w-full rounded-xl border border-gray-800 bg-gray-900 py-2 pe-3 ps-9 text-base text-white placeholder:text-gray-500 md:text-sm"
          />
        </div>
        {picked.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {picked.map((id) => (
              <button key={id} type="button" onClick={() => toggle(id)} className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-100">
                {conversationTitle(byId[id])} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && <div className="py-6 text-center text-sm text-gray-500">לא נמצאו שיחות</div>}
          {list.map((c) => {
            const on = picked.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-start ${on ? "bg-emerald-500/10" : "hover:bg-gray-900"}`}
              >
                <Avatar conversation={c} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{conversationTitle(c)}</span>
                  {c.phone && <span className="block text-xs text-gray-500" dir="ltr">{c.phone}</span>}
                </span>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${on ? "border-emerald-400 bg-emerald-500 text-gray-950" : "border-gray-600"}`}>
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={send} disabled={busy || picked.length === 0} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share className="h-4 w-4" />}
          העבר{picked.length ? ` (${picked.length})` : ""}
        </button>
      </div>
    </div>,
    document.body
  );
}
