import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Pin, PinOff, Archive, ArchiveRestore, Tag, Send, Loader2, BellOff, Trash2, Plus, X, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import MessageBubble from "@/components/whatsapp/MessageBubble";
import { groupMessagesByDay, formatMessageTime } from "@/components/whatsapp/whatsappInboxShared";
import { contactTypeLabel, effectiveStage, renderTemplate, eventDateFor, hasStage, displayType } from "@/lib/chatModel";
import DateAvailability from "./DateAvailability";
import { Avatar, conversationTitle } from "./ChatList";
import { typeColor, stageColor } from "@/lib/chatColors";
import { displayPhone } from "@/components/whatsapp/whatsappInboxShared";

function NoteBubble({ note, onDelete }) {
  return (
    <div className="flex justify-center">
      <div className="max-w-[85%] rounded-xl border border-dashed border-yellow-700/70 bg-yellow-950/40 px-3 py-2 text-yellow-100">
        <div className="mb-0.5 flex items-center justify-between gap-3 text-[11px] font-semibold text-yellow-400">
          <span>הערה פנימית · רק במערכת, לא נשלחת</span>
          <button type="button" onClick={() => onDelete(note)} aria-label="מחק הערה" className="text-yellow-600 hover:text-red-400">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{note.body}</div>
        <div className="mt-1 text-left text-[10px] text-yellow-600">{formatMessageTime(note.createdDate)}</div>
      </div>
    </div>
  );
}

// The conversation column: header, timeline (messages + internal notes), composer.
export default function ChatThread({
  conversation, lead, labels, thread, onBack, onTogglePanel, onPin, onArchive, onHandled, needsReplyNow, onToggleFollowUp, inFollowUp, onScheduleMeeting,
  templates, onSaveTemplate, onDeleteTemplate, userContext,
}) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("msg"); // 'msg' | 'note'
  const [busy, setBusy] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editing, setEditing] = useState(null); // {id?, name, body}
  const scrollRef = useRef(null);
  const textRef = useRef(null);

  // Draft per conversation, so switching chats never sends one person's text to another.
  const drafts = useRef({});
  useEffect(() => {
    setText(drafts.current[conversation.id] || "");
    setShowTemplates(false);
    setMode("msg");
  }, [conversation.id]);
  useEffect(() => {
    drafts.current[conversation.id] = text;
  }, [text, conversation.id]);

  const lastKey = thread.timeline.length + ":" + (thread.timeline[thread.timeline.length - 1]?.id || "");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastKey, conversation.id]);

  const stage = effectiveStage(conversation, lead);
  const isNote = mode === "note";

  const submit = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      if (isNote) {
        await thread.addNote(body, userContext.tenantId, userContext.userId);
      } else {
        await thread.send(conversation, body);
      }
      setText("");
      drafts.current[conversation.id] = "";
    } catch (e) {
      toast.error(isNote ? "שמירת ההערה נכשלה" : "השליחה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const onKeyDown = (e) => {
    // Enter sends on a computer; on a phone the keyboard's Enter is a new line and the
    // send button sends (the same as WhatsApp).
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    if (e.key === "Enter" && !e.shiftKey && !coarse) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    if (v === "/") setShowTemplates(true);
  };

  const applyTemplate = (t) => {
    setText(renderTemplate(t.body, conversation, lead));
    setShowTemplates(false);
    setMode("msg");
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const saveTemplate = async () => {
    if (!editing?.name?.trim() || !editing?.body?.trim()) return;
    await onSaveTemplate(editing);
    setEditing(null);
  };

  const dayGroups = groupMessagesByDay(thread.timeline);

  return (
    <section aria-label="שיחה" className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-950">
      <header className="flex items-center gap-2 border-b border-gray-800 bg-gray-900/70 px-2 py-2 md:px-4">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="חזרה לשיחות" className="flex h-11 w-11 shrink-0 items-center justify-center text-yellow-400 md:hidden">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
        <button type="button" onClick={onTogglePanel} className="flex min-w-0 flex-1 items-center gap-3 text-start">
          <Avatar conversation={conversation} size={40} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-bold text-white">{conversationTitle(conversation)}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px]">
              <span className={`rounded-full px-2 ${typeColor(displayType(conversation))}`}>{contactTypeLabel(displayType(conversation))}</span>
              {stage && <span className={`rounded-full border px-2 ${stageColor(stage).chip}`}>{stage}</span>}
              {labels.map((l) => (
                <span key={l.id} className="rounded-full px-2 text-white" style={{ background: l.color }}>{l.name}</span>
              ))}
              {displayPhone(conversation) && <span dir="ltr" className="text-gray-500">{displayPhone(conversation)}</span>}
            </span>
          </span>
        </button>
        {onToggleFollowUp && hasStage(conversation) && (
          <button
            type="button"
            onClick={() => onToggleFollowUp(!inFollowUp)}
            title="מכניס את השיחה לתור הפולו-אפ, גם אם הבוט לא שלח מחירון"
            className={`flex h-10 shrink-0 items-center gap-1 rounded-full border px-3 text-sm ${
              inFollowUp ? "border-orange-700 bg-orange-950/50 text-orange-200" : "border-gray-700 bg-gray-800 text-gray-300 hover:text-white"
            }`}
          >
            {inFollowUp ? "בפולו-אפ ✓" : "לפולו-אפ"}
          </button>
        )}
        {needsReplyNow && (
          <button type="button" onClick={onHandled} title="לא צריך מענה — יוצא מ'דורש מענה' עד שיכתבו שוב" className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-emerald-800 bg-emerald-950/50 px-3 text-sm text-emerald-200 hover:bg-emerald-900/60">
            ✓ טופל
          </button>
        )}
        <button type="button" onClick={onPin} aria-label={conversation.pinnedAt ? "בטל נעיצה" : "נעץ למעלה"} title={conversation.pinnedAt ? "בטל נעיצה" : "נעץ למעלה"} className="hidden h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white md:flex">
          {conversation.pinnedAt ? <PinOff className="h-5 w-5" /> : <Pin className="h-5 w-5" />}
        </button>
        <button type="button" onClick={onArchive} aria-label={conversation.archivedAt ? "החזר מהארכיון" : "העבר לארכיון"} title={conversation.archivedAt ? "החזר מהארכיון" : "ארכיון (חוזר לבד כשכותבים שוב)"} className="hidden h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-800 hover:text-white md:flex">
          {conversation.archivedAt ? <ArchiveRestore className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
        </button>
        {onScheduleMeeting && (
          <button type="button" onClick={onScheduleMeeting} aria-label="קבע פגישה" title="קבע פגישה / שיחה" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-200 hover:text-yellow-300">
            <CalendarPlus className="h-5 w-5" />
          </button>
        )}
        <button type="button" onClick={onTogglePanel} aria-label="תיוג ופרטים" title="תיוג ופרטים" className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-800 text-gray-200 hover:text-white">
          <Tag className="h-5 w-5" />
        </button>
      </header>

      {hasStage(conversation) && (
        <DateAvailability info={eventDateFor(conversation, lead, thread.timeline)} excludeLeadId={conversation.matchedLeadId} />
      )}

      {conversation.optedOutAt && (
        <div className="flex items-center gap-2 border-b border-red-900/50 bg-red-950/40 px-4 py-2 text-xs text-red-200">
          <BellOff className="h-4 w-4 shrink-0" />
          ביקש/ה לא לקבל הודעות. לא ייכלל/תיכלל בשליחה לכמה אנשים. אפשר עדיין לענות ידנית.
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4 md:px-6">
        {thread.isLoading && (
          <div className="flex justify-center py-10 text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}
        {dayGroups.map((g) => (
          <div key={g.key} className="space-y-2">
            <div className="flex justify-center">
              <span className="rounded-full bg-gray-800/80 px-3 py-0.5 text-xs text-gray-400">{g.label}</span>
            </div>
            {g.messages.map((item) =>
              item.kind === "note" ? (
                <NoteBubble
                  key={"n" + item.id}
                  note={item}
                  onDelete={async (n) => {
                    if (!window.confirm("למחוק את ההערה?")) return;
                    try { await thread.deleteNote(n.id); } catch (e) { toast.error("המחיקה נכשלה", { description: e?.message }); }
                  }}
                />
              ) : (
                <MessageBubble key={item.id} message={item} />
              )
            )}
          </div>
        ))}
      </div>

      <div className="relative border-t border-gray-800 bg-gray-900/80 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 md:px-4">
        {showTemplates && (
          <div className="absolute bottom-full right-2 z-20 mb-2 w-[min(380px,calc(100vw-1rem))] rounded-2xl border border-gray-700 bg-gray-900 p-2 shadow-2xl">
            <div className="flex items-center justify-between px-2 py-1">
              <span className="text-xs text-gray-400">תשובות מהירות · {"{{names}}"} {"{{event_date}}"} {"{{venue}}"} מתמלאים לבד</span>
              <button type="button" onClick={() => { setShowTemplates(false); setEditing(null); }} aria-label="סגור" className="text-gray-500 hover:text-white"><X className="h-4 w-4" /></button>
            </div>
            {editing ? (
              <div className="space-y-2 p-1">
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="שם קצר (למשל: תיאום שיחה)"
                  aria-label="שם התבנית"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-yellow-500"
                />
                <textarea
                  value={editing.body}
                  onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                  rows={4}
                  placeholder="היי {{names}}, ..."
                  aria-label="נוסח התבנית"
                  className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white outline-none focus:border-yellow-500"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={saveTemplate} className="flex-1 rounded-lg bg-yellow-400 py-2 text-sm font-semibold text-gray-900">שמור</button>
                  {editing.id && (
                    <button
                      type="button"
                      onClick={async () => { if (window.confirm("למחוק את התבנית?")) { await onDeleteTemplate(editing.id); setEditing(null); } }}
                      className="rounded-lg border border-red-900 px-3 text-sm text-red-300"
                    >
                      מחק
                    </button>
                  )}
                  <button type="button" onClick={() => setEditing(null)} className="rounded-lg px-3 text-sm text-gray-400">ביטול</button>
                </div>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {templates.map((t) => (
                  <div key={t.id} className="group flex items-start gap-1 rounded-xl hover:bg-gray-800">
                    <button type="button" onClick={() => applyTemplate(t)} className="flex min-w-0 flex-1 flex-col gap-0.5 px-2 py-2 text-start">
                      <span className="text-sm font-semibold text-white">{t.name}</span>
                      <span className="line-clamp-2 text-xs text-gray-400">{renderTemplate(t.body, conversation, lead)}</span>
                    </button>
                    <button type="button" onClick={() => setEditing({ id: t.id, name: t.name, body: t.body })} className="px-2 py-2 text-xs text-gray-500 hover:text-white">עריכה</button>
                  </div>
                ))}
                <button type="button" onClick={() => setEditing({ name: "", body: "" })} className="mt-1 flex w-full items-center gap-2 rounded-xl px-2 py-2 text-sm text-yellow-400 hover:bg-gray-800">
                  <Plus className="h-4 w-4" /> תבנית חדשה
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mb-1.5 flex gap-1.5" role="tablist" aria-label="סוג">
          <button type="button" role="tab" aria-selected={!isNote} onClick={() => setMode("msg")} className={`rounded-full px-3 py-1 text-xs ${!isNote ? "bg-emerald-900/70 text-emerald-100" : "text-gray-400"}`}>הודעת וואטסאפ</button>
          <button type="button" role="tab" aria-selected={isNote} onClick={() => setMode("note")} className={`rounded-full px-3 py-1 text-xs ${isNote ? "bg-yellow-900/60 text-yellow-200" : "text-gray-400"}`}>הערה פנימית</button>
        </div>
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => setShowTemplates((v) => !v)} aria-label="תשובות מהירות" title="תשובות מהירות" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xl font-bold text-yellow-400">/</button>
          <textarea
            ref={textRef}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            rows={1}
            aria-label={isNote ? "הערה פנימית" : "הודעה"}
            placeholder={isNote ? "הערה שרק אתה רואה — לא נשלחת" : "הודעה (הקלד / לתבניות)"}
            className={`max-h-40 min-h-[44px] min-w-0 flex-1 resize-none rounded-3xl px-4 py-2.5 text-base outline-none md:text-sm ${
              isNote ? "border border-dashed border-yellow-700 bg-yellow-950/40 text-yellow-100 placeholder:text-yellow-700" : "border border-gray-700 bg-gray-800 text-white placeholder:text-gray-500"
            }`}
            style={{ height: Math.min(160, 44 + Math.max(0, text.split("\n").length - 1) * 20) }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={busy || !text.trim()}
            aria-label={isNote ? "שמור הערה" : "שלח"}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-40 ${isNote ? "bg-yellow-600 text-gray-900" : "bg-yellow-400 text-gray-900"}`}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 -scale-x-100" />}
          </button>
        </div>
      </div>
    </section>
  );
}
