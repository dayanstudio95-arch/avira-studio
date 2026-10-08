import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { applyLeadTemplateVariables } from "@/lib/leadMessages";

// Same wording as the default in הגדרות ← תבניות הודעה ("שאלון הפקה").
const DEFAULT_TEMPLATE = `שלום {{names}},

נשמח אם תמלאו את השאלון הקצר לפני האירוע:
{{questionnaire_link}}

תודה! 📸`;

// "לא מולא" on the dashboard (2026-10-09, the owner's request): send the couple the
// questionnaire message again — the same "שאלון הפקה" template — after a preview he can edit.
// Nothing is sent until "שלח בוואטסאפ".
export default function QuestionnaireReminderDialog({ target, onClose }) {
  const { event, lead } = target || {};
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const phone = lead?.phoneNumber || event?.phoneNumber || "";
  const names = lead?.coupleNames || event?.coupleNames || "";

  useEffect(() => {
    if (!target) return;
    let alive = true;
    setLoading(true);
    base44.entities.AppSetting.filter({ key: "template_questionnaire" })
      .then((rows) => rows?.[0]?.value || DEFAULT_TEMPLATE)
      .catch(() => DEFAULT_TEMPLATE)
      .then((tpl) => {
        if (!alive) return;
        setText(applyLeadTemplateVariables(tpl, { ...lead, coupleNames: names }, { eventDate: event?.date, venue: event?.venue }));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!phone || !text.trim()) return;
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message: text });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success(`השאלון נשלח שוב ל${names || "זוג"}`);
      onClose();
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setSending(false);
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent dir="rtl" className="max-w-md border-gray-700 bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-right">לשלוח שוב את השאלון ל{names || "זוג"}?</DialogTitle>
        </DialogHeader>
        <div className="text-xs text-gray-400" dir="rtl">
          אל: <span dir="ltr">{phone || "אין מספר טלפון"}</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : (
          <>
            <div className="text-[11px] text-gray-400">כך ההודעה תיראה (אפשר לערוך לפני השליחה):</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 p-3 text-sm leading-relaxed text-white"
            />
            <p className="text-[11px] text-gray-500">הנוסח מהתבנית "שאלון הפקה" בהגדרות ← תבניות הודעה.</p>
          </>
        )}
        <DialogFooter className="flex-row-reverse gap-2">
          <button type="button" onClick={onClose} disabled={sending} className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300">
            ביטול
          </button>
          <button
            type="button"
            onClick={send}
            disabled={sending || loading || !phone || !text.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} שלח בוואטסאפ
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
