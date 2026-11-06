import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, CheckCircle2, ImageUp, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { ENTITIES } from "@/lib/paymentEntity";
import { todayInIsrael } from "@/lib/localDate";
import {
  CONFIRM_TEMPLATE_KEY, INVOICE_AFTER_KEY, addsVat, confirmMessage, fmt, paymentTotals, totalLine, transferEvents, israelDayOf,
} from "@/lib/staffPaymentMessages";

// "שילמתי" (2026-11-02, the owner's request; 0108). He pays a team member in the bank's app, comes back, and confirms
// here: the events he ticked, the bank screenshot, and the business the money left from. The transfer is recorded as
// he said it (no guessing the business from the account number later), the events are marked paid, and the team
// member gets the events, the screenshot and the invoice details on WhatsApp. The screenshot is read first (staff-
// invoices "read_transfer") so a wrong amount or the other business's account shows before anything is saved.
// 2026-11-06: one event's "שילמתי" opens this window too (its small button used to only mark the event, and the owner
// didn't notice that nothing went out); "רק לסמן שולם" here is the old mark-only. `alreadyPaid`: the events were marked
// "שולם" without the screenshot — this sends it now; the marks stay as they are, and `existing` (the transfer the scan
// opened for those marks, if any) becomes this payment instead of a second one.

const BUCKET = "staff-invoices";
const MIME_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_BYTES = 10 * 1024 * 1024;
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const day = (d) => (d ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(2, 4)}` : "");

export default function ConfirmStaffPaymentDialog({ open, onOpenChange, staffName, phone, rows, staffType, payers, request, alreadyPaid = false, existing = null, tenantId, onMarkPaid, onDone }) {
  const file = useRef(null);
  const [proof, setProof] = useState(null); // { path, name }
  const [reading, setReading] = useState(null); // null | "reading" | { read, isTransfer, amount, date, entity }
  const [entity, setEntity] = useState("");
  const [paid, setPaid] = useState("");
  const [send, setSend] = useState(true);
  const [templates, setTemplates] = useState({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // A screenshot uploaded and then not used (cancelled, or replaced) is removed — only a saved payment keeps one.
  const kept = useRef({ path: null, saved: false });
  const totals = useMemo(() => paymentTotals(rows, staffType), [rows, staffType]);

  useEffect(() => {
    if (!open) return;
    setProof(null);
    setReading(null);
    setEntity(request?.entity || existing?.entity || "");
    setPaid(String(totals.gross));
    setSend(!!phone);
    kept.current = { path: null, saved: false };
    let cancelled = false;
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", [CONFIRM_TEMPLATE_KEY, INVOICE_AFTER_KEY])
      .then(({ data }) => !cancelled && setTemplates(Object.fromEntries((data || []).map((r) => [r.key, r.value]))));
    return () => {
      cancelled = true;
      if (kept.current.path && !kept.current.saved) supabase.storage.from(BUCKET).remove([kept.current.path]);
    };
  }, [open]);

  // The message follows the business chosen (its invoice details); he can still edit it before sending.
  useEffect(() => {
    if (!open) return;
    setMessage(
      confirmMessage({
        template: templates[CONFIRM_TEMPLATE_KEY]?.trim() || undefined,
        afterTemplate: templates[INVOICE_AFTER_KEY]?.trim() || undefined,
        name: staffName,
        events: rows,
        type: staffType,
        payer: entity ? payers?.[entity] : null,
        invoiceArrived: !!request?.arrived,
      })
    );
  }, [open, entity, templates, rows, staffType, request]);

  const upload = async (f) => {
    if (!f) return;
    const ext = MIME_EXT[f.type];
    if (!ext) return toast.error("צריך תמונה (צילום מסך) או PDF");
    if (f.size > MAX_BYTES) return toast.error("הקובץ גדול מדי");
    const path = `${tenantId}/transfers/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type });
    if (error) return toast.error(error.message);
    if (kept.current.path) supabase.storage.from(BUCKET).remove([kept.current.path]);
    kept.current.path = path;
    setProof({ path, name: f.name });
    setReading("reading");
    try {
      const res = await base44.functions.invoke("staffInvoices", { action: "read_transfer", path });
      const r = res.data || {};
      setReading(r.read ? r : { read: false });
      if (r.read && r.entity && !entity) setEntity(r.entity);
    } catch {
      setReading({ read: false });
    }
    if (file.current) file.current.value = "";
  };

  const read = reading && reading !== "reading" && reading.read ? reading : null;
  const amount = Number(paid) || 0;
  const amountOff = read?.amount && Math.abs(read.amount - totals.gross) > 1;
  const otherBusiness = read?.entity && entity && read.entity !== entity;
  const payer = entity ? payers?.[entity] : null;

  const confirm = async () => {
    if (!entity) return toast.error("בוחרים מאיזה חשבון העברת");
    if (!(amount > 0)) return toast.error("חסר הסכום שהועבר");
    if (send && !message.trim()) return toast.error("ההודעה ריקה");
    setBusy(true);
    try {
      const today = todayInIsrael();
      const monthAgo = new Date(Date.parse(today) - 30 * 86400000).toISOString().slice(0, 10);
      // already marked: the day it was marked (or the transfer the scan opened for it), unless the screenshot says
      const markedOn = existing?.paid_on || rows.map((r) => israelDayOf(r.paidAt)).filter(Boolean).sort().pop() || today;
      const fromShot = read?.date && read.date <= today && read.date >= monthAgo ? read.date : null;
      const paidOn = fromShot || (alreadyPaid ? markedOn : today);
      const works = transferEvents(rows);
      const now = new Date().toISOString();
      let transferId = request?.id || existing?.id;
      if (existing) {
        // the transfer opened from the "שולם" mark: now with the screenshot, the business and the amount sent
        const have = new Set((existing.events || []).map((w) => `${w.eventId}|${w.role}`));
        const { error } = await supabase
          .from("staff_transfers")
          .update({
            source: "confirmed", amount, paid_on: paidOn, entity, proof_path: proof?.path || null,
            events: [...(existing.events || []), ...works.filter((w) => !have.has(`${w.eventId}|${w.role}`))], reminders_on: true, updated_at: now,
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else if (request) {
        // The invoice was asked for before paying: that row is now this payment.
        const have = new Set((request.events || []).map((w) => `${w.eventId}|${w.role}`));
        const { error } = await supabase
          .from("staff_transfers")
          .update({
            source: "confirmed", status: request.arrived ? "received" : "waiting", amount, paid_on: paidOn, entity, proof_path: proof?.path || null,
            events: [...(request.events || []), ...works.filter((w) => !have.has(`${w.eventId}|${w.role}`))], reminders_on: true, updated_at: now,
          })
          .eq("id", request.id);
        if (error) throw error;
      } else {
        transferId = crypto.randomUUID();
        const { error } = await supabase.from("staff_transfers").insert({
          id: transferId, tenant_id: tenantId, staff_member_name: staffName, amount, paid_on: paidOn, entity, source: "confirmed",
          events: works, proof_path: proof?.path || null, reminders_on: true,
        });
        if (error) throw error;
      }
      kept.current.saved = true;
      // The transfer first, then the marks: the scan never sees the marks without the transfer that holds them.
      if (!alreadyPaid) await onMarkPaid(rows);
      if (send && phone) {
        const res = await base44.functions.invoke("staffInvoices", { action: "send_payment", transferId, to: phone, message });
        if (res.data?.error) toast.warning(`התשלום נשמר, אבל ההודעה ל${staffName} לא נשלחה: ${res.data.error}`, { duration: 10000 });
        else toast.success(`נשמר ונשלח ל${staffName} ✓`);
      } else {
        toast.success("התשלום נשמר ✓");
      }
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error("השמירה נכשלה: " + (e?.message || ""));
    }
    setBusy(false);
  };

  // The old "שולם": the events marked paid, nothing recorded or sent here (the hourly scan opens the transfer).
  const markOnly = async () => {
    setBusy(true);
    try {
      await onMarkPaid(rows);
      toast.success(rows.length === 1 ? "סומן כשולם" : `${rows.length} אירועים סומנו כשולם`);
      onOpenChange(false);
      onDone?.();
    } catch (e) {
      toast.error("הסימון נכשל: " + (e?.message || ""));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-700 text-white max-w-lg max-h-[92vh] overflow-y-auto" data-testid="confirm-payment">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            {alreadyPaid ? `שליחת צילום ופירוט ל${staffName}` : `שילמתי ל${staffName}`}
          </DialogTitle>
          {alreadyPaid && <p className="text-right text-xs text-gray-400">{rows.length === 1 ? "האירוע כבר מסומן" : "האירועים כבר מסומנים"} &quot;שולם&quot;. כאן רק מוסיפים את צילום ההעברה ושולחים את הפירוט.</p>}
        </DialogHeader>

        <div className="space-y-4">
          <div className={`grid gap-2 text-sm ${totals.vat ? "grid-cols-3" : "grid-cols-2"}`}>
            <div className="rounded-lg bg-gray-800/60 p-2.5">
              <p className="text-xs text-gray-400">{rows.length === 1 ? "אירוע אחד" : `${rows.length} אירועים`}</p>
              <p className="font-bold">{fmt(totals.net)} ₪</p>
            </div>
            {totals.vat > 0 && (
              <div className="rounded-lg bg-gray-800/60 p-2.5">
                <p className="text-xs text-gray-400">מע״מ 18%</p>
                <p className="font-bold">{fmt(totals.vat)} ₪</p>
              </div>
            )}
            <div className="rounded-lg bg-gray-800/60 p-2.5">
              <p className="text-xs text-gray-400">להעביר</p>
              <p className="font-bold text-emerald-300">{fmt(totals.gross)} ₪</p>
            </div>
          </div>
          {!addsVat(staffType) && <p className="text-xs text-gray-400 -mt-2">{staffType === "exempt" ? "עוסק פטור — בלי מע״מ, מבקשים קבלה." : "לא מוציא מסמכים (לפי הסכם) — בלי מע״מ ובלי בקשת חשבונית."}</p>}
          {request?.arrived && <p className="text-xs text-emerald-300 -mt-2">📄 החשבונית שביקשת לפני התשלום כבר הגיעה — ההעברה תיסגר מיד.</p>}

          <div>
            <input ref={file} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="confirm-proof-input" />
            <button type="button" onClick={() => file.current?.click()} className="w-full rounded-lg border border-dashed border-gray-600 p-3 text-right hover:border-gray-400" data-testid="confirm-proof">
              <div className="flex items-center gap-3">
                <ImageUp className={`w-6 h-6 ${proof ? "text-emerald-400" : "text-gray-400"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{proof ? "צילום ההעברה" : "העלאת צילום ההעברה"}</p>
                  <p className="text-xs text-gray-400 truncate">
                    {!proof && "הצילום נשלח לאיש הצוות עם ההודעה"}
                    {proof && reading === "reading" && "קורא את הצילום…"}
                    {proof && read && (read.isTransfer ? `נקרא: ${read.amount ? `${fmt(read.amount)} ₪` : "בלי סכום"}${read.date ? ` · ${day(read.date)}` : ""}${read.entity ? ` · מ${ENTITIES[read.entity]?.label}` : ""}` : "זה לא נראה כמו צילום של העברה")}
                    {proof && reading && reading !== "reading" && !read && proof.name}
                  </p>
                </div>
                {proof && <span className="mr-auto text-xs text-brand-300">החלפה</span>}
              </div>
            </button>
            {amountOff && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amber-300" data-testid="confirm-amount-off">
                ⚠️ בצילום {fmt(read.amount)} ₪ — לפי האירועים צריך {fmt(totals.gross)} ₪.
                {Math.abs(read.amount - amount) > 1 && (
                  <button type="button" className="underline" onClick={() => setPaid(String(read.amount))}>
                    לרשום {fmt(read.amount)} ₪
                  </button>
                )}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm mb-1.5">מאיזה חשבון העברת?</p>
            <div className="grid grid-cols-2 gap-2">
              {["company", "sole_prop"].map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setEntity(k)}
                  className={`rounded-lg border p-2.5 text-right ${entity === k ? "border-brand-400 bg-brand-400/15 ring-1 ring-brand-400" : "border-gray-700 hover:border-gray-500"}`}
                  aria-pressed={entity === k}
                  data-testid={`confirm-entity-${k}`}
                >
                  <p className="font-medium text-sm flex items-center gap-1.5">
                    {entity === k && <Check className="w-4 h-4 text-brand-300" />}
                    {ENTITIES[k].label}
                  </p>
                  <p className="text-xs text-gray-400 truncate">{payers?.[k]?.name || "הפרטים לא מולאו"}</p>
                </button>
              ))}
            </div>
            {otherBusiness && <p className="mt-1.5 text-xs text-amber-300">⚠️ בצילום רואים שההעברה יצאה מ{ENTITIES[read.entity]?.label}.</p>}
            {entity && !payer?.id && staffType !== "none" && (
              <p className="mt-1.5 text-xs text-amber-300">חסרים הפרטים של {ENTITIES[entity].label} לחשבונית — ממלאים פעם אחת ב"חשבוניות מהצוות" ← עוד ← פרטי שני העסקים.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <p className="text-xs text-gray-400 mb-1">הועבר בפועל</p>
              <Input type="number" min="1" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} dir="ltr" className="bg-gray-800 border-gray-700 text-white" data-testid="confirm-amount" />
            </div>
            <p className="text-xs text-gray-500 pb-2">סה״כ: {totalLine(totals)}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={send} disabled={!phone} onCheckedChange={(v) => setSend(!!v)} className="border-gray-600" data-testid="confirm-send" />
            {phone ? `לשלוח ל${staffName} את הפירוט${proof ? " + הצילום" : ""}${staffType === "none" ? "" : request?.arrived ? "" : " + בקשה לחשבונית"}` : "אין טלפון לאיש הצוות — ההודעה לא תישלח"}
          </label>
          {send && phone && (
            <textarea
              className="w-full bg-gray-950 text-white text-sm border border-gray-700 rounded-lg p-3 resize-y focus:outline-none focus:border-brand-400"
              rows={9}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              dir="rtl"
              data-testid="confirm-message"
            />
          )}

          <div className="flex gap-2 justify-end items-center">
            {!alreadyPaid && !request && (
              <button type="button" onClick={markOnly} disabled={busy} className="ml-auto text-xs text-gray-400 underline hover:text-white disabled:opacity-50" data-testid="confirm-mark-only">
                רק לסמן שולם, בלי צילום והודעה
              </button>
            )}
            <Button variant="outline" className={btn} onClick={() => onOpenChange(false)} disabled={busy}>
              ביטול
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={confirm} disabled={busy || reading === "reading"} data-testid="confirm-save">
              {busy ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : send && phone ? <MessageCircle className="w-4 h-4 ml-2" /> : <CheckCircle2 className="w-4 h-4 ml-2" />}
              {send && phone ? `אישור ושליחה ל${staffName}` : "אישור"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
