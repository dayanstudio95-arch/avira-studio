import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, Loader2, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useChatData } from "@/components/chat/useChatData";
import { useThread } from "@/components/chat/useThread";
import ChatThread from "@/components/chat/ChatThread";
import { conversationTitle } from "@/components/chat/ChatList";
import { needsReply, isHotLead } from "@/lib/chatModel";
import { isAwaitingFollowUp } from "@/lib/followUpQueue";

// WhatsApp from the dashboard without leaving it (2026-10-09, the owner's request): one
// conversation, or a short list (the hot leads) with the chosen conversation beside it. It is
// the chat app's own ChatThread on the chat app's data, so a reply sent here is the same
// message there; the header's ↗ opens the full chat for tags, meetings and the rest.
// `items` = [{ id, title?, sub? }] in display order; one item = no list column.
export default function QuickChatDialog({ open, items = [], initialId, heading, onClose }) {
  if (!open) return null;
  return <QuickChatBody items={items} initialId={initialId} heading={heading} onClose={onClose} />;
}

function QuickChatBody({ items, initialId, heading, onClose }) {
  const data = useChatData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [activeId, setActiveId] = useState(initialId || items[0]?.id || null);
  const many = items.length > 1;
  const active = data.conversations.find((c) => c.id === activeId) || null;
  const lead = active?.matchedLeadId ? data.leadsById[active.matchedLeadId] : null;
  const thread = useThread(active?.id);

  useEffect(() => {
    if (active && document.visibilityState === "visible") data.actions.markRead(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active ? data.unread[active.id] : 0]);

  const run = async (promise, text) => {
    try {
      await promise;
      toast.success(text);
    } catch (e) {
      toast.error("הפעולה נכשלה", { description: e?.message });
    }
  };
  const saveTemplate = async (t) => {
    try {
      if (t.id) await base44.entities.WhatsAppTemplate.update(t.id, { name: t.name.trim(), body: t.body.trim(), updatedAt: new Date().toISOString() });
      else await base44.entities.WhatsAppTemplate.create({ name: t.name.trim(), body: t.body.trim(), sortOrder: (data.templates.length + 1) * 10 });
      qc.invalidateQueries({ queryKey: ["chatTemplates"] });
      toast.success("התבנית נשמרה");
    } catch (e) {
      toast.error("שמירת התבנית נכשלה", { description: e?.message });
    }
  };
  const deleteTemplate = async (id) => {
    await base44.entities.WhatsAppTemplate.delete(id);
    qc.invalidateQueries({ queryKey: ["chatTemplates"] });
  };
  const openFull = () => {
    onClose();
    navigate(active ? `/chat?c=${active.id}` : "/chat");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className={`flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden border-gray-700 bg-gray-950 p-0 text-white [&>button.absolute]:hidden ${many ? "max-w-[980px]" : "max-w-[640px]"}`}>
        <div className="flex items-center justify-between gap-2 border-b border-gray-800 px-3 py-2">
          <DialogTitle className="truncate text-right text-sm font-semibold">{heading || (active ? conversationTitle(active) : "שיחה")}</DialogTitle>
          <div className="flex items-center gap-1">
            <button type="button" onClick={openFull} title="פתח באווירה צ'אט (תיוג, פגישה, פולו-אפ)" className="flex items-center gap-1 rounded-lg border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:text-white">
              פתח בצ'אט <ExternalLink className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={onClose} aria-label="סגירה" className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1">
          {many && (
            <div className={`w-full shrink-0 overflow-y-auto border-l border-gray-800 md:w-[260px] ${active ? "hidden md:block" : ""}`}>
              {items.map((it) => {
                const c = data.conversations.find((x) => x.id === it.id);
                const on = it.id === activeId;
                const unread = data.unread[it.id] || 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setActiveId(it.id)}
                    className={`block w-full border-b border-gray-800/70 px-3 py-2.5 text-right hover:bg-white/[0.04] ${on ? "bg-sky-500/15" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${on ? "font-semibold text-sky-200" : "text-gray-100"}`}>{it.title || (c ? conversationTitle(c) : "…")}</span>
                      {unread > 0 && <span className="shrink-0 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">{unread}</span>}
                    </div>
                    {(it.sub || c?.lastMessagePreview) && <div className="truncate text-xs text-gray-400">{it.sub || c?.lastMessagePreview}</div>}
                  </button>
                );
              })}
            </div>
          )}
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${many && !active ? "hidden md:flex" : ""}`}>
            {active ? (
              <ChatThread
                conversation={active}
                lead={lead}
                labels={(data.labelsByConv[active.id] || []).map((id) => data.labels.find((l) => l.id === id)).filter(Boolean)}
                thread={thread}
                onBack={many ? () => setActiveId(null) : onClose}
                onTogglePanel={openFull}
                onPin={() => run(data.actions.setPinned([active], !active.pinnedAt), active.pinnedAt ? "בוטלה הנעיצה" : "ננעץ למעלה")}
                onArchive={() => run(data.actions.setArchived([active], !active.archivedAt), active.archivedAt ? "הוחזר מהארכיון" : "הועבר לארכיון")}
                needsReplyNow={needsReply(active)}
                onHandled={() => run(data.actions.setHandled([active], true), 'סומן "טופל"')}
                inFollowUp={isAwaitingFollowUp(active, data.followUpAfterDays || 0)}
                isHot={isHotLead(active, lead)}
                onMarkFollowUpSent={() => run(data.actions.markFollowUpSent([active]), "סומן: נשלח פולו-אפ")}
                onClearHot={() => run(data.actions.clearHot([active]), 'הוסר מ"ליד חם"')}
                onToggleFollowUp={(on) => run(data.actions.setFollowUpFlag([active], on), on ? "נוסף לתור הפולו-אפ" : "הוסר מתור הפולו-אפ")}
                templates={data.templates}
                onSaveTemplate={saveTemplate}
                onDeleteTemplate={deleteTemplate}
                userContext={{ tenantId: data.user?.tenant_id, userId: data.user?.id }}
              />
            ) : data.isLoading ? (
              <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gray-500" /></div>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-gray-500">בחר שיחה מהרשימה</div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
