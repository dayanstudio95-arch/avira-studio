import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { ENTITIES, ENTITY_KEYS, defaultEntity, paymentMessageFor } from "@/lib/paymentEntity";

// "דרישת תשלום" with a choice of business (2026-10-14, the owner's request): first "מאיזה
// עסק לשלוח?" — עוסק מורשה / חברה בע״מ — then that business's template, editable, then
// send. The couple's remembered business is pre-selected but can always be changed. After a
// send the lead remembers the business (payment_entity) and when / from which business
// the request went (payment_request_entity / _sent_at). Used by the lead panel and by the
// dashboard's "לא משולם" card.
const TONE = {
  emerald: { on: "border-emerald-400 bg-emerald-600 text-white", off: "border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30" },
  purple: { on: "border-purple-400 bg-purple-600 text-white", off: "border-purple-700/60 text-purple-300 hover:bg-purple-900/30" },
};

export default function PaymentRequestComposer({ lead, names, balance, phone, onSent }) {
  const [templates, setTemplates] = useState(null);
  const [entity, setEntity] = useState(() => defaultEntity(lead));
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    base44.entities.AppSetting.list()
      .then((rows) => {
        if (cancelled) return;
        const out = {};
        for (const k of ENTITY_KEYS) out[ENTITIES[k].templateKey] = rows.find((r) => r.key === ENTITIES[k].templateKey)?.value || "";
        setTemplates(out);
      })
      .catch(() => !cancelled && setTemplates({}));
    return () => { cancelled = true; };
  }, []);

  // A new business (or the templates arriving) → that business's message.
  useEffect(() => {
    if (!templates || !entity) return;
    const m = paymentMessageFor(entity, templates, { names, balance });
    setText(m.text);
    setMissing(m.missingTemplate);
    setIncomplete(m.incomplete);
  }, [entity, templates, names, balance]);

  const send = async () => {
    if (!entity) return;
    if (!phone) {
      toast.error("אין מספר טלפון");
      return;
    }
    setSending(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: phone, message: text });
      if (res?.data?.error) throw new Error(res.data.error);
      if (lead?.id) {
        const { error } = await supabase
          .from("leads")
          .update({ payment_entity: entity, payment_request_entity: entity, payment_request_sent_at: new Date().toISOString() })
          .eq("id", lead.id);
        if (error) console.error("payment entity save failed:", error.message);
      }
      toast.success(`דרישת התשלום נשלחה (${ENTITIES[entity].label}) ✓`);
      onSent?.(entity);
    } catch (e) {
      toast.error("שגיאה בשליחה", { description: e?.message });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      <div>
        <div className="mb-1.5 text-sm text-gray-300">מאיזה עסק לשלוח?</div>
        <div className="grid grid-cols-2 gap-2">
          {ENTITY_KEYS.map((k) => {
            const e = ENTITIES[k];
            const on = entity === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setEntity(k)}
                aria-pressed={on}
                className={`min-h-[44px] rounded-xl border px-3 text-sm font-semibold transition ${on ? TONE[e.tone].on : TONE[e.tone].off}`}
              >
                {e.tone === "emerald" ? "🟢" : "🟣"} {e.label}
              </button>
            );
          })}
        </div>
        {defaultEntity(lead) && (
          <div className="mt-1 text-xs text-gray-500">סומן לפי העסק של הזוג — אפשר להחליף.</div>
        )}
      </div>

      {!entity ? (
        <div className="rounded-lg border border-dashed border-gray-700 p-3 text-center text-sm text-gray-400">בחרו עסק כדי לראות את ההודעה</div>
      ) : !templates ? (
        <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
      ) : (
        <>
          {missing && (
            <div className="rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
              התבנית "דרישת תשלום — {ENTITIES[entity].label}" עוד ריקה, אז ההודעה בלי פרטי בנק. אפשר להשלים כאן, או למלא פעם אחת ב
              <Link to="/Settings?tab=templates" className="underline">הגדרות ← תבניות</Link>.
            </div>
          )}
          {!missing && incomplete && (
            <div className="rounded-lg bg-amber-950/50 px-3 py-2 text-xs text-amber-200">
              חסרים פרטי בנק בהודעה (שורה ריקה אחרי "בנק:" / "סניף:" / "מספר חשבון:"). השלימו כאן, או פעם אחת ב
              <Link to="/Settings?tab=templates" className="underline">הגדרות ← תבניות</Link>.
            </div>
          )}
          <textarea
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-white focus:border-orange-500 focus:outline-none"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            dir="rtl"
          />
          <button
            type="button"
            onClick={send}
            disabled={sending || !text.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 py-2.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:bg-orange-800"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {sending ? "שולח..." : `אשר ושלח לזוג · ${ENTITIES[entity].short}`}
          </button>
        </>
      )}
    </div>
  );
}
