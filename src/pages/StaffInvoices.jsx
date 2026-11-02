import { useEffect, useMemo, useRef, useState } from "react";
import { downloadZip } from "client-zip";
import { Download, ExternalLink, FileText, Loader2, Mail, Plus, RefreshCw, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ENTITIES } from "@/lib/paymentEntity";
import { STAFF_PAYERS_KEY, MANUAL_CLOSE, DUPLICATE_NOTE, missingSummary, reminderMessage, daysSince, monthOf, docFileName } from "@/lib/staffInvoices";

// "חשבוניות מהצוות" (2026-11-02, the owner's request; 0106). Every transfer to a team member, with the invoice / receipt
// that closes it. Transfers open themselves (the owner's bank screenshot in the staff chat, "שולם" marks) and documents
// arrive by themselves (links and files the staff send on WhatsApp) — the scan (staff-invoices, and hourly in
// automation-engine) reads and matches them; here the owner sees what is missing, fixes what the scan couldn't (upload,
// "התקבל במייל", assign), and downloads a month's documents for Morning.

const BUCKET = "staff-invoices";
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const inputCls = "bg-gray-800 border-gray-700 text-white";
const STATUS = {
  waiting: { label: "ממתין למסמך", cls: "bg-amber-500/15 text-amber-300 border-amber-600/40" },
  received: { label: "התקבל", cls: "bg-emerald-500/15 text-emerald-300 border-emerald-600/40" },
  not_needed: { label: "לא נדרש", cls: "bg-gray-700/40 text-gray-400 border-gray-600" },
};
const SOURCE = { screenshot: "צילום העברה", paid_mark: "סימון שולם", manual: "ידני" };
const fmt = (n) => Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });
const day = (d) => (d ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(2, 4)}` : "");

async function openFile(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) return toast.error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

export default function StaffInvoices() {
  const { tenant } = useAuth();
  const [data, setData] = useState(null); // { transfers, invoices, links, staff, payers }
  const [filter, setFilter] = useState("waiting");
  const [scan, setScan] = useState("");
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const [t, i, l, s, p] = await Promise.all([
      supabase.from("staff_transfers").select("*").order("paid_on", { ascending: false }),
      supabase.from("staff_invoices").select("*").order("created_at", { ascending: false }),
      supabase.from("staff_invoice_transfers").select("invoice_id, transfer_id"),
      supabase.from("staff_members").select("id, name, phone_number, invoice_type, pay_cycle").order("order_index"),
      supabase.from("app_settings").select("value").eq("key", STAFF_PAYERS_KEY).maybeSingle(),
    ]);
    const err = t.error || i.error || l.error || s.error;
    if (err) return toast.error(err.message);
    let payers = {};
    try {
      payers = JSON.parse(p.data?.value || "{}");
    } catch {
      payers = {};
    }
    setData({ transfers: t.data || [], invoices: i.data || [], links: l.data || [], staff: s.data || [], payers });
  };

  // The scan, a few documents a call, until nothing is left (each call reads up to 6 with AI).
  const runScan = async ({ quiet } = {}) => {
    setScan("סורק את הצ'אטים עם הצוות…");
    try {
      let total = { transfers: 0, invoices: 0, matched: 0 };
      for (let round = 0; round < 20; round++) {
        const res = await base44.functions.invoke("staffInvoices", {});
        const r = res.data || {};
        if (r.error) throw new Error(r.error);
        total = { transfers: total.transfers + (r.transfers || 0), invoices: total.invoices + (r.invoices || 0), matched: total.matched + (r.matched || 0) };
        if (r.errors?.length) console.warn("[staff-invoices]", r.errors);
        if (!r.remaining || !r.read) break;
        setScan(`סורק… נשארו ${r.remaining} הודעות`);
      }
      if (!quiet) toast.success(`נמצאו ${total.transfers} העברות ו-${total.invoices} מסמכים חדשים · שויכו ${total.matched}`);
    } catch (e) {
      toast.error("הסריקה נכשלה: " + e.message);
    }
    setScan("");
    load();
  };

  useEffect(() => {
    load().then(() => runScan({ quiet: true }));
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const docsOf = (tid) => data.links.filter((l) => l.transfer_id === tid).map((l) => data.invoices.find((i) => i.id === l.invoice_id)).filter(Boolean);
    const linked = new Set(data.links.map((l) => l.invoice_id));
    const typeOf = Object.fromEntries(data.staff.map((s) => [s.name, s.invoice_type]));
    const unassigned = data.invoices.filter((i) => !linked.has(i.id) && i.read_status !== "not_invoice");
    const toSave = data.invoices.filter((i) => i.read_status === "manual" && i.link_url && !i.file_path);
    return { docsOf, typeOf, unassigned, toSave, summary: missingSummary(data.transfers, typeOf) };
  }, [data]);

  if (!data || !view) {
    return (
      <div className="min-h-screen bg-gray-950 grid place-items-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  const shown = data.transfers.filter((t) => filter === "all" || t.status === filter);
  const counts = Object.fromEntries(["waiting", "received", "not_needed"].map((k) => [k, data.transfers.filter((t) => t.status === k).length]));

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">חשבוניות מהצוות</h1>
            <p className="text-sm text-gray-400 mt-1">
              כל העברה לאיש צוות, עם החשבונית / הקבלה שסוגרת אותה. ההעברות נפתחות לבד מצילום ההעברה ששלחת בצ'אט או מסימון "שולם", והמסמכים נקלטים לבד מהוואטסאפ.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className={btn} onClick={() => setAdding(true)} data-testid="si-add">
              <Plus className="w-4 h-4 ml-1.5" /> העברה ידנית
            </Button>
            <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!!scan} onClick={() => runScan()} data-testid="si-scan">
              {scan ? <Loader2 className="w-4 h-4 ml-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-1.5" />} סריקה עכשיו
            </Button>
          </div>
        </div>
        {scan && <p className="text-sm text-brand-300">{scan}</p>}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="si-summary">
          <Stat label="ממתינות למסמך" value={view.summary.count} tone="text-amber-300" />
          <Stat label="סכום שממתין" value={`${fmt(view.summary.sum)} ₪`} />
          <Stat label="מע״מ שעוד לא חוזר" value={`${fmt(view.summary.vat)} ₪`} tone="text-red-300" />
          <Stat label="קישורים לשמור ידנית" value={view.toSave.length} tone={view.toSave.length ? "text-amber-300" : ""} />
        </div>

        <PayersCard payers={data.payers} tenantId={tenant?.id} onSaved={load} />

        <div className="flex flex-wrap gap-2">
          {[["waiting", "ממתינות"], ["received", "התקבלו"], ["not_needed", "לא נדרש"], ["all", "הכל"]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? "border-brand-400 bg-brand-400/15 text-brand-200" : "border-gray-700 text-gray-400 hover:text-white"}`} data-testid={`si-filter-${k}`}>
              {label} {k !== "all" && <span className="opacity-70">{counts[k]}</span>}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800" data-testid="si-transfers">
          {shown.length === 0 && <p className="p-6 text-center text-sm text-gray-500">{filter === "waiting" ? "אין העברות שממתינות למסמך 🎉" : "אין כאן העברות."}</p>}
          {shown.map((t) => (
            <TransferRow key={t.id} t={t} docs={view.docsOf(t.id)} staff={data.staff.find((s) => s.name === t.staff_member_name)} type={view.typeOf[t.staff_member_name]} tenantId={tenant?.id} onChange={load} onScan={runScan} />
          ))}
        </div>

        {view.unassigned.length > 0 && (
          <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3" data-testid="si-unassigned">
            <h2 className="font-semibold text-white">מסמכים שלא שויכו להעברה ({view.unassigned.length})</h2>
            <p className="text-xs text-gray-500">המערכת לא הייתה בטוחה לאיזו העברה המסמך שייך (סכום שלא תואם, או כמה העברות פתוחות). בוחרים העברה, או מסמנים שזה לא מסמך.</p>
            {view.unassigned.map((inv) => (
              <UnassignedDoc key={inv.id} inv={inv} transfers={data.transfers.filter((t) => t.staff_member_name === inv.staff_member_name)} tenantId={tenant?.id} onChange={load} onScan={runScan} />
            ))}
          </section>
        )}

        <ExportCard invoices={data.invoices} links={data.links} transfers={data.transfers} toSave={view.toSave} />

        {adding && <AddTransfer staff={data.staff} payers={data.payers} tenantId={tenant?.id} onClose={() => setAdding(false)} onSaved={() => (setAdding(false), runScan({ quiet: true }))} />}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "" }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-xl font-bold text-white ${tone}`}>{value}</div>
    </div>
  );
}

/** The studio's two businesses as invoices must name them; the scan uses them to know who paid and to check documents. */
function PayersCard({ payers, tenantId, onSaved }) {
  const empty = !payers.company?.id && !payers.sole_prop?.id;
  const [open, setOpen] = useState(empty);
  const [form, setForm] = useState(() =>
    Object.fromEntries(["company", "sole_prop"].map((k) => [k, { name: payers[k]?.name || "", id: payers[k]?.id || "", accounts: (payers[k]?.accounts || []).join(", ") }]))
  );
  const save = async () => {
    const value = {};
    for (const k of ["company", "sole_prop"]) {
      const f = form[k];
      if (f.name.trim() || f.id.trim()) value[k] = { name: f.name.trim(), id: f.id.replace(/\D/g, ""), accounts: f.accounts.split(/[,\n]/).map((a) => a.trim()).filter(Boolean) };
    }
    const { error } = await supabase.from("app_settings").upsert({ tenant_id: tenantId, key: STAFF_PAYERS_KEY, value: JSON.stringify(value) }, { onConflict: "tenant_id,key" });
    if (error) return toast.error(error.message);
    toast.success("הפרטים נשמרו");
    setOpen(false);
    onSaved();
  };
  return (
    <section className={`rounded-xl border p-4 ${empty ? "border-amber-600/50 bg-amber-950/20" : "border-gray-800 bg-gray-900"}`} data-testid="si-payers">
      <button type="button" className="flex w-full items-center justify-between text-right" onClick={() => setOpen(!open)}>
        <span className="font-semibold text-white">הפרטים של שני העסקים {empty && <span className="text-xs text-amber-300 font-normal">— צריך למלא פעם אחת</span>}</span>
        <span className="text-xs text-gray-400">{open ? "סגירה" : "עריכה"}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-400">לפי החשבון שממנו יצאה ההעברה המערכת יודעת איזה עסק שילם, ובודקת שהחשבונית יצאה על שמו.</p>
          {["company", "sole_prop"].map((k) => (
            <div key={k} className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input value={form[k].name} onChange={(e) => setForm({ ...form, [k]: { ...form[k], name: e.target.value } })} placeholder={`${ENTITIES[k].label} — השם בחשבונית`} className={inputCls} />
              <Input value={form[k].id} onChange={(e) => setForm({ ...form, [k]: { ...form[k], id: e.target.value } })} placeholder={k === "company" ? "ח.פ." : "ע.מ."} dir="ltr" className={inputCls} />
              <Input value={form[k].accounts} onChange={(e) => setForm({ ...form, [k]: { ...form[k], accounts: e.target.value } })} placeholder="מספר חשבון בנק (למשל 615-027088)" dir="ltr" className={inputCls} />
            </div>
          ))}
          <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={save} data-testid="si-payers-save">
            שמירה
          </Button>
        </div>
      )}
    </section>
  );
}

function TransferRow({ t, docs, staff, type, tenantId, onChange, onScan }) {
  const file = useRef(null);
  const [busy, setBusy] = useState(false);
  const st = STATUS[t.status] || STATUS.waiting;
  const waitingDays = daysSince(t.paid_on);
  const update = async (fields) => {
    const { error } = await supabase.from("staff_transfers").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", t.id);
    if (error) toast.error(error.message);
    onChange();
  };
  const addDoc = async (row) => {
    const { data: inv, error } = await supabase.from("staff_invoices").insert({ tenant_id: tenantId, staff_member_name: t.staff_member_name, ...row }).select("id").single();
    if (error) throw error;
    const { error: e2 } = await supabase.from("staff_invoice_transfers").insert({ invoice_id: inv.id, transfer_id: t.id, tenant_id: tenantId });
    if (e2) throw e2;
    return inv.id;
  };
  const upload = async (f) => {
    if (!f) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const ext = f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : "jpg";
      const path = `${tenantId}/${id}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type || "application/pdf" });
      if (error) throw error;
      await addDoc({ id, source: "upload", file_path: path, file_mime: f.type || "application/pdf", read_status: "pending" });
      toast.success("המסמך הועלה — המערכת קוראת אותו");
      await onScan({ quiet: true });
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
    if (file.current) file.current.value = "";
  };
  const byEmail = async () => {
    try {
      await addDoc({ source: "email", read_status: "manual", note: "התקבל במייל" });
      await update({ status: "received" });
    } catch (e) {
      toast.error(e.message);
    }
  };
  const remind = async () => {
    if (!staff?.phone_number) return toast.error("אין טלפון לאיש הצוות");
    const tpl = (await supabase.from("app_settings").select("value").eq("key", "template_staff_invoice_reminder").maybeSingle()).data?.value;
    const message = reminderMessage(tpl, { name: String(staff.name).split(" ")[0], amount: Number(t.amount), paidOn: t.paid_on });
    if (!(await confirmDialog({ title: `לשלוח תזכורת ל${staff.name}?`, message, confirmText: "שלח" }))) return;
    const res = await base44.functions.invoke("sendWhatsAppMessage", { to: staff.phone_number, message });
    if (res?.data?.error) return toast.error(res.data.error);
    toast.success("התזכורת נשלחה");
    update({ reminders_sent: Math.min(5, (t.reminders_sent || 0) + 1), last_reminder_at: new Date().toISOString() });
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: "למחוק את ההעברה?", message: "רק אם היא נפתחה בטעות או שהיא כפולה (למשל צילום שאינו העברה). המסמכים שלה עוברים ל\"מסמכים שלא שויכו\".", confirmText: "מחק", danger: true }))) return;
    await supabase.from("staff_invoice_transfers").delete().eq("transfer_id", t.id);
    // A transfer from "שולם" marks is kept as a "not needed" duplicate: deleted, the next scan would make it again from the marks.
    const { error } = (t.events || []).length
      ? await supabase.from("staff_transfers").update({ status: "not_needed", note: DUPLICATE_NOTE, updated_at: new Date().toISOString() }).eq("id", t.id)
      : await supabase.from("staff_transfers").delete().eq("id", t.id);
    if (error) toast.error(error.message);
    onChange();
  };
  // Documents short of the transfer (Yonatan: a 1,100 ₪ receipt for 1,200 ₪): the owner may close it as it is.
  const covered = docs.some((d) => d.amount === null) ? null : docs.reduce((s, d) => s + Number(d.amount || 0), 0);
  const short = t.status === "waiting" && docs.length > 0 && covered !== null && covered < Number(t.amount) - 1;
  const closeAnyway = async () => {
    if (!(await confirmDialog({ title: "לסגור את ההעברה כמו שהיא?", message: `המסמכים מכסים ${fmt(covered)} מתוך ${fmt(t.amount)} ₪. על ההפרש לא יהיה מסמך.`, confirmText: "סגירה" }))) return;
    update({ status: "received", note: `${MANUAL_CLOSE} — המסמכים מכסים ${fmt(covered)} מתוך ${fmt(t.amount)} ₪` });
  };
  const unlink = async (inv) => {
    await supabase.from("staff_invoice_transfers").delete().eq("invoice_id", inv.id).eq("transfer_id", t.id);
    if (t.status === "received") await supabase.from("staff_transfers").update({ status: "waiting" }).eq("id", t.id);
    onChange();
  };

  return (
    <div className="p-4 space-y-2" data-testid="si-transfer">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-white">{t.staff_member_name}</span>
        <span className="text-white">{fmt(t.amount)} ₪</span>
        <span className="text-xs text-gray-400">הועבר {day(t.paid_on)}</span>
        {t.entity && <span className={`rounded-full px-2 py-0.5 text-[11px] ${t.entity === "company" ? "bg-purple-500/15 text-purple-300" : "bg-emerald-500/15 text-emerald-300"}`}>{ENTITIES[t.entity]?.short}</span>}
        <span className="text-[11px] text-gray-500">{SOURCE[t.source]}</span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] ${st.cls}`}>
          {st.label}
          {t.status === "waiting" && waitingDays > 0 ? ` · ${waitingDays === 1 ? "יום אחד" : `${waitingDays} ימים`}` : ""}
        </span>
        {type === "none" && <span className="text-[11px] text-gray-500">לא מוציא מסמכים (לפי הסכם)</span>}
        {t.status === "waiting" && t.reminders_sent > 0 && <span className="text-[11px] text-gray-500">נשלחו {t.reminders_sent} תזכורות</span>}
        {t.status === "waiting" && !t.reminders_on && <span className="text-[11px] text-gray-600">בלי תזכורות אוטומטיות (העברה מלפני ההפעלה)</span>}
      </div>
      {(t.events || []).length > 0 && <div className="text-xs text-gray-500">{t.events.map((e) => `${day(e.date)} ${e.venue || ""}`.trim()).join(" · ")}</div>}
      {t.description && <div className="text-xs text-gray-500">"{t.description}"</div>}
      {short && <div className="text-xs text-amber-300">⚠️ המסמכים מכסים {fmt(covered)} מתוך {fmt(t.amount)} ₪ — חסרים {fmt(Number(t.amount) - covered)} ₪</div>}
      {t.note && (String(t.note).startsWith(MANUAL_CLOSE) || t.note === DUPLICATE_NOTE) && <div className="text-xs text-gray-500">{t.note}</div>}
      {docs.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-950/60 px-3 py-2 text-sm" data-testid="si-doc">
          <FileText className="w-4 h-4 text-gray-400" />
          <span className="text-gray-200">{d.doc_type || (d.source === "email" ? "התקבל במייל" : "מסמך")} {d.doc_number ? `${d.doc_number}` : ""}</span>
          {d.amount !== null && <span className="text-gray-400">{fmt(d.amount)} ₪</span>}
          {d.allocation_number && <span className="text-[11px] text-gray-500">הקצאה {d.allocation_number}</span>}
          {d.file_path && (
            <button type="button" className="text-brand-300 hover:underline text-xs" onClick={() => openFile(d.file_path)}>
              פתיחה
            </button>
          )}
          {!d.file_path && d.link_url && (
            <a href={d.link_url} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline text-xs inline-flex items-center gap-1">
              <ExternalLink className="w-3 h-3" /> קישור — לשמור PDF ידנית
            </a>
          )}
          <button type="button" className="mr-auto text-gray-500 hover:text-white" onClick={() => unlink(d)} aria-label="ניתוק המסמך מההעברה">
            <X className="w-3.5 h-3.5" />
          </button>
          {(d.warnings || []).map((w) => (
            <div key={w} className="w-full text-xs text-amber-300">⚠️ {w}</div>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <input ref={file} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        <Button size="sm" variant="outline" className={btn} disabled={busy} onClick={() => file.current?.click()}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 ml-1" />} העלאת מסמך
        </Button>
        {t.status === "waiting" && (
          <>
            <Button size="sm" variant="outline" className={btn} onClick={byEmail}>
              <Mail className="w-3.5 h-3.5 ml-1" /> התקבל במייל
            </Button>
            <Button size="sm" variant="outline" className={btn} onClick={remind}>
              <Send className="w-3.5 h-3.5 ml-1" /> תזכורת עכשיו
            </Button>
            <Button size="sm" variant="outline" className={btn} onClick={() => update({ status: "not_needed" })}>
              לא נדרש
            </Button>
            {short && (
              <Button size="sm" variant="outline" className={btn} onClick={closeAnyway} data-testid="si-close-anyway">
                סגירה ידנית
              </Button>
            )}
          </>
        )}
        {(t.status === "not_needed" || String(t.note || "").startsWith(MANUAL_CLOSE)) && (
          <Button size="sm" variant="outline" className={btn} onClick={() => update({ status: "waiting", note: null })}>
            החזרה לממתינות
          </Button>
        )}
        <button type="button" className="text-red-400/70 hover:text-red-300 text-xs mr-auto" onClick={remove}>
          <Trash2 className="inline w-3.5 h-3.5" /> מחיקה
        </button>
      </div>
    </div>
  );
}

function UnassignedDoc({ inv, transfers, tenantId, onChange, onScan }) {
  const [target, setTarget] = useState("");
  const file = useRef(null);
  const assign = async () => {
    if (!target) return;
    const { error } = await supabase.from("staff_invoice_transfers").insert({ invoice_id: inv.id, transfer_id: target, tenant_id: tenantId });
    if (error) return toast.error(error.message);
    await onScan({ quiet: true });
  };
  const attach = async (f) => {
    if (!f) return;
    const path = `${tenantId}/${inv.id}.${f.type === "application/pdf" ? "pdf" : "jpg"}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: true });
    if (error) return toast.error(error.message);
    await supabase.from("staff_invoices").update({ file_path: path, file_mime: f.type, read_status: "pending" }).eq("id", inv.id);
    await onScan({ quiet: true });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 p-3 text-sm" data-testid="si-unassigned-doc">
      <span className="font-semibold text-white">{inv.staff_member_name}</span>
      <span className="text-gray-300">{inv.doc_type || "מסמך"} {inv.doc_number || ""}</span>
      {inv.amount !== null && <span className="text-gray-400">{fmt(inv.amount)} ₪</span>}
      {inv.read_status === "failed" && <span className="text-xs text-red-300">לא נקרא</span>}
      {inv.file_path ? (
        <button type="button" className="text-brand-300 hover:underline text-xs" onClick={() => openFile(inv.file_path)}>
          פתיחה
        </button>
      ) : (
        inv.link_url && (
          <>
            <a href={inv.link_url} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline text-xs">
              פתיחת הקישור
            </a>
            <input ref={file} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => attach(e.target.files?.[0])} />
            <button type="button" className="text-brand-300 hover:underline text-xs" onClick={() => file.current?.click()}>
              העלאת ה-PDF ששמרת
            </button>
          </>
        )
      )}
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white mr-auto">
        <option value="">שיוך להעברה…</option>
        {transfers.map((t) => (
          <option key={t.id} value={t.id}>
            {day(t.paid_on)} · {fmt(t.amount)} ₪ {t.status === "received" ? "(כבר התקבל)" : ""}
          </option>
        ))}
      </select>
      <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!target} onClick={assign}>
        שיוך
      </Button>
      <button type="button" className="text-xs text-gray-500 hover:text-white" onClick={async () => (await supabase.from("staff_invoices").update({ read_status: "not_invoice" }).eq("id", inv.id), onChange())}>
        זה לא מסמך
      </button>
    </div>
  );
}

function AddTransfer({ staff, payers, tenantId, onClose, onSaved }) {
  const [f, setF] = useState({ staff: "", amount: "", paid_on: new Date().toISOString().slice(0, 10), entity: "" });
  const save = async () => {
    if (!f.staff || !(Number(f.amount) > 0)) return toast.error("בוחרים איש צוות וסכום");
    const { error } = await supabase.from("staff_transfers").insert({ tenant_id: tenantId, staff_member_name: f.staff, amount: Number(f.amount), paid_on: f.paid_on, entity: f.entity || null, source: "manual" });
    if (error) return toast.error(error.message);
    toast.success("ההעברה נוספה");
    onSaved();
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl border border-gray-700 bg-gray-900 p-5" onClick={(e) => e.stopPropagation()} dir="rtl">
        <h3 className="font-bold text-white">העברה ידנית</h3>
        <p className="text-xs text-gray-400">לרוב לא צריך: העברה נפתחת לבד מצילום ההעברה בצ'אט או מסימון "שולם". למשל להעברה שלא צילמת.</p>
        <select value={f.staff} onChange={(e) => setF({ ...f, staff: e.target.value })} className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white">
          <option value="">איש צוות…</option>
          {staff.map((s) => (
            <option key={s.id} value={s.name}>
              {s.name}
            </option>
          ))}
        </select>
        <div className="grid grid-cols-2 gap-2">
          <Input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="סכום ₪" className={inputCls} />
          <Input type="date" value={f.paid_on} onChange={(e) => setF({ ...f, paid_on: e.target.value })} className={inputCls} />
        </div>
        <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white">
          <option value="">מאיזה עסק?</option>
          {["company", "sole_prop"].map((k) => (
            <option key={k} value={k}>
              {payers[k]?.name || ENTITIES[k].label}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <Button variant="outline" className={btn} onClick={onClose}>
            ביטול
          </Button>
          <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={save}>
            הוספה
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * "בדיקת חיבור למורנינג" (2026-11-02): a READ-ONLY look at both Morning accounts' expenses, before the team's invoices are
 * sent there as drafts — what came back is kept for the build (supabase/functions/_shared/morningExpensesProbe.ts).
 */
function MorningProbe() {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("staffInvoices", { action: "morning_probe" });
      const p = res.data?.probe;
      if (!p) throw new Error(res.data?.error || "אין תשובה");
      const line = (k, label) => {
        const e = p[k];
        if (!e?.connected) return `${label}: לא מחובר${e?.login ? ` (${e.login})` : ""}`;
        return `${label}: ${e.search?.status === 200 ? `נקראו ${e.search.count} הוצאות` : `שגיאה ${e.search?.status}`}`;
      };
      toast.success(`הבדיקה הסתיימה — ${line("company", "חברה")} · ${line("sole_prop", "עוסק מורשה")}`, { duration: 8000 });
    } catch (e) {
      toast.error("הבדיקה נכשלה: " + e.message);
    }
    setBusy(false);
  };
  return (
    <Button variant="outline" className={btn} disabled={busy} onClick={run} data-testid="si-morning-probe">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4 ml-1.5" />} בדיקת חיבור למורנינג (קריאה בלבד)
    </Button>
  );
}

/** A month's documents for Morning, one ZIP per business (client-side, like the print shop's album files). */
function ExportCard({ invoices, links, transfers, toSave }) {
  const months = useMemo(() => [...new Set(invoices.filter((i) => i.file_path).map((i) => monthOf(i.issued_on || i.created_at)))].sort().reverse(), [invoices]);
  const [month, setMonth] = useState(months[0] || "");
  const [busy, setBusy] = useState("");
  const entityOf = (inv) => transfers.find((t) => links.some((l) => l.invoice_id === inv.id && l.transfer_id === t.id) && t.entity)?.entity || "";
  const download = async (entity) => {
    const list = invoices.filter((i) => i.file_path && i.read_status !== "not_invoice" && monthOf(i.issued_on || i.created_at) === month && (entity === "all" || entityOf(i) === entity));
    if (!list.length) return toast.info("אין מסמכים לחודש הזה");
    setBusy(entity);
    try {
      const files = [];
      for (const inv of list) {
        const { data, error } = await supabase.storage.from(BUCKET).download(inv.file_path);
        if (error) throw error;
        files.push({ name: docFileName(inv), input: data, lastModified: new Date() });
      }
      const blob = await downloadZip(files).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `חשבוניות צוות ${month}${entity === "all" ? "" : ` ${ENTITIES[entity].short}`}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy("");
  };
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3" data-testid="si-export">
      <h2 className="font-semibold text-white">הורדה למורנינג</h2>
      <p className="text-xs text-gray-500">כל המסמכים של החודש בקובץ ZIP אחד לכל עסק, בשמות מסודרים (תאריך, איש צוות, מספר מסמך, סכום) — להעלאה להוצאות במורנינג.</p>
      <MorningProbe />
      {toSave.length > 0 && <p className="text-xs text-amber-300">⚠️ {toSave.length} מסמכים הגיעו כקישור לעמוד (Paperless / Invoice4U) ועוד לא נשמרו כ-PDF — הם לא ייכנסו לקובץ עד שתעלה אותם.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-white">
          {months.length === 0 && <option value="">אין עדיין מסמכים</option>}
          {months.map((m) => (
            <option key={m} value={m}>
              {m.slice(5)}/{m.slice(0, 4)}
            </option>
          ))}
        </select>
        {["company", "sole_prop", "all"].map((k) => (
          <Button key={k} variant="outline" className={btn} disabled={!month || !!busy} onClick={() => download(k)} data-testid={`si-zip-${k}`}>
            {busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 ml-1.5" />}
            {k === "all" ? "הכל" : ENTITIES[k].label}
          </Button>
        ))}
      </div>
    </section>
  );
}

