import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, Send, X } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { FILMS_BASE_URL } from "@/lib/filmsApi";

// "שליחת דף צלם" from the chat (2026-11-02, the owner's request; 0102): a couple who asks to see a photographer's work
// gets his page (גלריות ← דפי צלמים) — the message from template "template_photographer_page", shown first and
// editable, sent into this chat, like "שלח חוזה בוואטסאפ".
export const DEFAULT_PHOTOGRAPHER_PAGE_MESSAGE =
  "היי {{names}} 😊\nכמו שביקשתם, הנה הדף של {{photographer}} — חתונות שצילמנו והמלצות של זוגות:\n{{link}}\nנשמח לשמוע מה דעתכם! אווירה סטודיו";

/** The template with the couple's names, the photographer and the page's link; "היי  😊" when there are no names. */
export function photographerPageMessage(template, { names, photographer, link }) {
  return template
    .replace(/\{\{names\}\}/g, names || "")
    .replace(/\{\{photographer\}\}/g, photographer || "")
    .replace(/\{\{link\}\}/g, link)
    .replace(/[ \t]{2,}/g, " ");
}

export default function SendPhotographerPageButton({ conversation, names }) {
  const qc = useQueryClient();
  const [pages, setPages] = useState(null);
  const [pageId, setPageId] = useState("");
  const [template, setTemplate] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const fill = (list, id, raw) => {
    const page = list.find((p) => p.id === id);
    setPageId(id);
    setText(page ? photographerPageMessage(raw, { names, photographer: page.display_name || page.staff_name, link: `${FILMS_BASE_URL}/photographer/${page.token}` }) : "");
  };

  const start = async () => {
    setLoading(true);
    try {
      const [{ data, error }, settings] = await Promise.all([
        supabase.from("photographer_pages").select("id, staff_name, display_name, token").eq("published", true).order("created_at"),
        base44.entities.AppSetting.filter({ key: "template_photographer_page" }),
      ]);
      if (error) throw error;
      if (!data?.length) {
        toast.error('אין עדיין דף צלם פעיל — יוצרים ב"גלריות" ← "דפי צלמים"');
        return;
      }
      const raw = settings?.[0]?.value?.trim() || DEFAULT_PHOTOGRAPHER_PAGE_MESSAGE;
      setPages(data);
      setTemplate(raw);
      fill(data, data[0].id, raw);
    } catch (e) {
      toast.error("לא הצלחנו להכין את ההודעה", { description: e?.message });
    } finally {
      setLoading(false);
    }
  };

  const send = async () => {
    const message = text.trim();
    const page = pages?.find((p) => p.id === pageId);
    if (!message || !page) return;
    const to = conversation?.phone || null;
    if (!(await confirmDialog({ title: `לשלוח את הדף של ${page.display_name || page.staff_name}?`, message: `בשיחה הזו${to ? ` (${to})` : ""}`, confirmText: "שלח" }))) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { chatId: conversation?.chatId || null, to, message });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success("הדף נשלח");
      setPages(null);
      if (conversation?.id) setTimeout(() => qc.invalidateQueries({ queryKey: ["chatMessages", conversation.id] }), 1500);
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-700 bg-gray-900 py-3 text-sm font-semibold text-gray-100 hover:border-yellow-500 disabled:opacity-60"
        data-testid="send-photographer-page"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        שליחת דף צלם
      </button>

      {pages &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 md:items-center" onClick={() => !sending && setPages(null)}>
            <div role="dialog" aria-label="שליחת דף צלם" onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[460px] md:rounded-2xl md:border" dir="rtl">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-bold text-white">שליחת דף צלם</span>
                <button type="button" onClick={() => setPages(null)} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="mb-2 text-xs text-gray-400">ההודעה מהתבנית "שליחת דף צלם". אפשר לערוך לפני השליחה.</p>
              {pages.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {pages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => fill(pages, p.id, template)}
                      className={`rounded-full px-3 py-1 text-sm ${p.id === pageId ? "bg-yellow-400 font-semibold text-gray-900" : "border border-gray-700 text-gray-300"}`}
                      data-testid="photographer-page-choice"
                    >
                      {p.display_name || p.staff_name}
                    </button>
                  ))}
                </div>
              )}
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} dir="rtl" className="w-full resize-y rounded-lg border border-gray-800 bg-gray-900 p-2 text-sm text-gray-100" data-testid="photographer-page-text" />
              <button type="button" onClick={send} disabled={sending || !text.trim()} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 disabled:opacity-50" data-testid="photographer-page-send">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
