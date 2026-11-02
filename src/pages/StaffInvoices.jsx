import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { downloadZip } from "client-zip";
import { Check, ChevronDown, Download, ExternalLink, FileText, Loader2, MoreHorizontal, RefreshCw, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ENTITIES } from "@/lib/paymentEntity";
import { STAFF_PAYERS_KEY, MANUAL_CLOSE, DUPLICATE_NOTE, AUTO_PDF, needsOwner, missingSummary, reminderMessage, daysSince, monthOf, docFileName, stuck, transferState } from "@/lib/staffInvoices";

// "חשבוניות מהצוות" (2026-11-02, the owner's request; 0106). Every transfer to a team member, with the invoice / receipt
// that closes it. Transfers open themselves ("שילמתי" on the payments page, the owner's bank screenshot in the staff
// chat, "שולם" marks) and documents arrive by themselves (links and files the staff send on WhatsApp) — the scan
// (staff-invoices, and hourly in automation-engine) reads and matches them.
//
// Laid out simpler the same day (the owner: "מרגיש לי קצת מסובך המסך"): how it works in four steps; "מחכה לך" — only
// what the system can't do alone (a document to assign, a page to save as PDF, a transfer the reminders are done
// with, documents short of the amount, an invoice asked for before paying that came); two numbers; the open and the
// closed by month, one main action a row and the rest under "⋯"; the settings under "עוד"; the month's ZIP for Morning.

const BUCKET = "staff-invoices";
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const inputCls = "bg-gray-800 border-gray-700 text-white";
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const fmt = (n) => Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 2 });
const day = (d) => (d ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}/${d.slice(2, 4)}` : "");
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

async function openFile(path) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error) return toast.error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

/** A PDF or photo the owner saved, for a document that came as a link: kept, and read by the scan. */
async function attachFile(inv, f, tenantId) {
  const path = `${tenantId}/${inv.id}.${f.type === "application/pdf" ? "pdf" : "jpg"}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: true });
  if (error) return toast.error(error.message), false;
  await supabase.from("staff_invoices").update({ file_path: path, file_mime: f.type, read_status: "pending" }).eq("id", inv.id);
  return true;
}

/** A hidden file input and the function that opens it. */
function useFilePicker(onFile) {
  const ref = useRef(null);
  const input = <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => (onFile(e.target.files?.[0]), (e.target.value = ""))} />;
  return [input, () => ref.current?.click()];
}

export default function StaffInvoices() {
  const { tenant } = useAuth();
  const [data, setData] = useState(null); // { transfers, invoices, links, staff, payers }
  const [tab, setTab] = useState("open");
  const [scan, setScan] = useState("");
  const [dialog, setDialog] = useState(""); // "payers" | "add" | ""

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
    setScan(quiet ? "מעדכן…" : "סורק את הצ'אטים עם הצוות…");
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
    const byId = new Map(data.invoices.map((i) => [i.id, i]));
    const docsOf = (tid) => data.links.filter((l) => l.transfer_id === tid).map((l) => byId.get(l.invoice_id)).filter(Boolean);
    const linked = new Set(data.links.map((l) => l.invoice_id));
    const typeOf = Object.fromEntries(data.staff.map((s) => [s.name, s.invoice_type]));
    const covered = (t) => {
      const docs = docsOf(t.id);
      return docs.some((d) => d.amount === null) ? null : docs.reduce((s, d) => s + Number(d.amount || 0), 0);
    };
    const arrived = (t) => {
      const c = covered(t);
      return docsOf(t.id).length > 0 && (c === null || c >= Number(t.amount) - 1);
    };
    const short = (t) => {
      const c = covered(t);
      return t.status === "waiting" && docsOf(t.id).length > 0 && c !== null && c < Number(t.amount) - 1;
    };
    const unassigned = data.invoices.filter((i) => !linked.has(i.id) && i.read_status !== "not_invoice");
    const toSave = data.invoices.filter((i) => i.read_status === "manual" && i.link_url && !i.file_path);
    // "מחכה לך": only what the system can't finish alone.
    const attention = [
      ...data.transfers.filter((t) => t.status === "requested" && arrived(t)).map((t) => ({ kind: "pay", t })),
      ...data.transfers.filter((t) => short(t)).map((t) => ({ kind: "short", t })),
      ...data.transfers.filter((t) => !short(t) && typeOf[t.staff_member_name] !== "none" && stuck(t)).map((t) => ({ kind: "stuck", t })),
      ...data.transfers.filter((t) => t.status === "waiting" && docsOf(t.id).some((d) => (d.warnings || []).length)).map((t) => ({ kind: "warning", t })),
      ...unassigned.map((inv) => ({ kind: "unassigned", inv })),
      ...toSave.filter((inv) => linked.has(inv.id) && needsOwner(inv)).map((inv) => ({ kind: "save", inv })),
    ];
    const open = data.transfers.filter((t) => t.status === "waiting" || t.status === "requested");
    const closed = data.transfers.filter((t) => t.status === "received" || t.status === "not_needed");
    return { docsOf, typeOf, arrived, short, covered, unassigned, toSave, attention, open, closed, summary: missingSummary(data.transfers, typeOf) };
  }, [data]);

  if (!data || !view) {
    return (
      <div className="min-h-screen bg-gray-950 grid place-items-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  const payersEmpty = !data.payers.company?.id && !data.payers.sole_prop?.id;
  const rowProps = { docsOf: view.docsOf, staff: data.staff, typeOf: view.typeOf, tenantId: tenant?.id, onChange: load, onScan: runScan };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-5xl mx-auto space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-white">חשבוניות מהצוות</h1>
            <p className="text-sm text-gray-400 mt-1">
              כל העברה לאיש צוות, עד שמגיעה החשבונית שלו. {scan && <span className="text-brand-300">{scan}</span>}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={btn} data-testid="si-more">
                <MoreHorizontal className="w-4 h-4 ml-1.5" /> עוד
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-gray-900 border-gray-700 text-gray-200" dir="rtl">
              <DropdownMenuItem onSelect={() => setDialog("payers")} data-testid="si-menu-payers">פרטי שני העסקים</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDialog("add")} data-testid="si-add">העברה ידנית</DropdownMenuItem>
              <DropdownMenuItem disabled={!!scan} onSelect={() => runScan()} data-testid="si-scan">סריקה עכשיו</DropdownMenuItem>
              <DropdownMenuItem onSelect={runMorningProbe} data-testid="si-morning-probe">בדיקת חיבור למורנינג (קריאה בלבד)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2" data-testid="si-steps">
          {[
            ["משלמים", 'בדף התשלומים: "שילמתי" + צילום ההעברה'],
            ["המערכת מחכה", "ושולחת תזכורת לבד"],
            ["החשבונית מגיעה", "בוואטסאפ, ונסגרת לבד"],
            ["סוף חודש", "קובץ אחד למורנינג"],
          ].map(([title, text], i) => (
            <div key={title} className="rounded-xl bg-gray-900 border border-gray-800 p-3">
              <div className="text-xs text-gray-500">{i + 1}</div>
              <div className="font-semibold text-white text-sm">{title}</div>
              <div className="text-xs text-gray-400">{text}</div>
            </div>
          ))}
        </div>

        <Attention items={view.attention} payersEmpty={payersEmpty} onPayers={() => setDialog("payers")} transfers={data.transfers} view={view} {...rowProps} />

        <div className="grid grid-cols-2 gap-3" data-testid="si-summary">
          <Stat label="חסרות חשבוניות על" value={`${fmt(view.summary.sum)} ₪`} hint={view.summary.count ? (view.summary.count === 1 ? "העברה אחת" : `${view.summary.count} העברות`) : "הכל התקבל"} />
          <Stat label="מע״מ שיחזור אליך כשיגיעו" value={`${fmt(view.summary.vat)} ₪`} />
        </div>

        <div>
          <div className="flex gap-2 mb-2">
            {[["open", "פתוחות", view.open.length], ["closed", "סגורות", view.closed.length]].map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full border px-4 py-1.5 text-sm ${tab === k ? "border-brand-400 bg-brand-400/15 text-brand-200" : "border-gray-700 text-gray-400 hover:text-white"}`} data-testid={`si-tab-${k}`}>
                {label} <span className="opacity-70">{n}</span>
              </button>
            ))}
          </div>
          {tab === "open" ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 divide-y divide-gray-800" data-testid="si-transfers">
              {view.open.length === 0 && <p className="p-6 text-center text-sm text-gray-500">אין העברות פתוחות 🎉</p>}
              {view.open.map((t) => (
                <TransferRow key={t.id} t={t} state={transferState(t, { arrived: view.arrived(t) })} short={view.short(t)} covered={view.covered(t)} {...rowProps} />
              ))}
            </div>
          ) : (
            <ClosedByMonth transfers={view.closed} rowProps={rowProps} />
          )}
        </div>

        <ExportCard invoices={data.invoices} links={data.links} transfers={data.transfers} toSave={view.toSave} />

        {dialog === "payers" && <PayersDialog payers={data.payers} tenantId={tenant?.id} onClose={() => setDialog("")} onSaved={() => (setDialog(""), load())} />}
        {dialog === "add" && <AddTransfer staff={data.staff} payers={data.payers} tenantId={tenant?.id} onClose={() => setDialog("")} onSaved={() => (setDialog(""), runScan({ quiet: true }))} />}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {hint && <div className="text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

/** "מחכה לך" — what only the owner can move; "הכל מסודר" when nothing. */
function Attention({ items, payersEmpty, onPayers, transfers, view, ...rowProps }) {
  const count = items.length + (payersEmpty ? 1 : 0);
  if (!count) {
    return (
      <div className="rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-4 text-emerald-200 text-sm flex items-center gap-2" data-testid="si-attention-clear">
        <Check className="w-4 h-4" /> הכל מסודר — אין שום דבר שמחכה לך
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 space-y-2" data-testid="si-attention">
      <h2 className="font-semibold text-amber-200">מחכה לך ({count})</h2>
      {payersEmpty && (
        <AttentionRow title="פרטי שני העסקים" text="צריך למלא פעם אחת — מהם בונים את הבקשה לחשבונית ובודקים שהיא יצאה על השם הנכון">
          <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={onPayers}>
            מילוי הפרטים
          </Button>
        </AttentionRow>
      )}
      {items.map((it) =>
        it.kind === "unassigned" ? (
          <UnassignedDoc key={`u${it.inv.id}`} inv={it.inv} transfers={transfers.filter((t) => t.staff_member_name === it.inv.staff_member_name)} {...rowProps} />
        ) : it.kind === "save" ? (
          <LinkDoc key={`s${it.inv.id}`} inv={it.inv} {...rowProps} />
        ) : (
          <AttentionTransfer key={`${it.kind}${it.t.id}`} kind={it.kind} t={it.t} covered={view.covered(it.t)} {...rowProps} />
        )
      )}
    </section>
  );
}

function AttentionRow({ title, amount, text, children, testid = "si-attention-item" }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-gray-900 p-3 text-sm" data-testid={testid}>
      <span className="font-semibold text-white">{title}</span>
      {amount != null && <span className="text-white">{fmt(amount)} ₪</span>}
      <span className="text-xs text-gray-400">{text}</span>
      <div className="flex flex-wrap items-center gap-2 mr-auto">{children}</div>
    </div>
  );
}

/** The actions on one transfer, shared by its row and its "מחכה לך" line. */
function useTransferActions(t, { staff, tenantId, onChange, onScan }) {
  const [busy, setBusy] = useState(false);
  const member = staff.find((s) => s.name === t.staff_member_name);
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
    if (!member?.phone_number) return toast.error("אין טלפון לאיש הצוות");
    const tpl = (await supabase.from("app_settings").select("value").eq("key", "template_staff_invoice_reminder").maybeSingle()).data?.value;
    const message = reminderMessage(tpl, { name: String(member.name).split(" ")[0], amount: Number(t.amount), paidOn: t.paid_on });
    if (!(await confirmDialog({ title: `לשלוח תזכורת ל${member.name}?`, message, confirmText: "שלח" }))) return;
    const res = await base44.functions.invoke("sendWhatsAppMessage", { to: member.phone_number, message });
    if (res?.data?.error) return toast.error(res.data.error);
    toast.success("התזכורת נשלחה");
    update({ reminders_sent: Math.min(5, (t.reminders_sent || 0) + 1), last_reminder_at: new Date().toISOString() });
  };
  const remove = async () => {
    const asked = t.status === "requested";
    const ok = await confirmDialog(
      asked
        ? { title: "לבטל את הבקשה לחשבונית?", message: "המעקב אחרי החשבונית שביקשת לפני התשלום יימחק. האירועים בדף התשלומים לא משתנים.", confirmText: "ביטול הבקשה", danger: true }
        : { title: "למחוק את ההעברה?", message: 'רק אם היא נפתחה בטעות או שהיא כפולה (למשל צילום שאינו העברה). המסמכים שלה עוברים ל"מחכה לך" לשיוך.', confirmText: "מחק", danger: true }
    );
    if (!ok) return;
    await supabase.from("staff_invoice_transfers").delete().eq("transfer_id", t.id);
    // A transfer holding paid works ("שולם" marks, "שילמתי") is kept as a "not needed" duplicate: deleted, the next scan
    // would make it again from the marks. An invoice asked for before paying holds no paid works yet: deleted.
    const { error } =
      !asked && (t.events || []).length
        ? await supabase.from("staff_transfers").update({ status: "not_needed", note: DUPLICATE_NOTE, updated_at: new Date().toISOString() }).eq("id", t.id)
        : await supabase.from("staff_transfers").delete().eq("id", t.id);
    if (error) toast.error(error.message);
    onChange();
  };
  const closeAnyway = async (covered) => {
    if (!(await confirmDialog({ title: "לסגור את ההעברה כמו שהיא?", message: `המסמכים מכסים ${fmt(covered)} מתוך ${fmt(t.amount)} ₪. על ההפרש לא יהיה מסמך.`, confirmText: "סגירה" }))) return;
    update({ status: "received", note: `${MANUAL_CLOSE} — המסמכים מכסים ${fmt(covered)} מתוך ${fmt(t.amount)} ₪` });
  };
  return { busy, member, update, upload, byEmail, remind, remove, closeAnyway };
}

function AttentionTransfer({ kind, t, covered, ...rest }) {
  const a = useTransferActions(t, rest);
  const [input, pick] = useFilePicker(a.upload);
  const docs = rest.docsOf(t.id);
  const text =
    kind === "pay"
      ? "📄 החשבונית שביקשת לפני התשלום הגיעה — אפשר להעביר"
      : kind === "short"
        ? `המסמכים מכסים ${fmt(covered)} מתוך ${fmt(t.amount)} ₪ — חסרים ${fmt(Number(t.amount) - covered)} ₪`
        : kind === "warning"
          ? `⚠️ ${docs.flatMap((d) => d.warnings || [])[0]}`
          : `שולם ${day(t.paid_on)} · ${transferState(t)}`;
  return (
    <AttentionRow title={t.staff_member_name} amount={Number(t.amount)} text={text}>
      {input}
      {kind === "pay" && (
        <Button asChild size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
          <Link to="/Payments">לדף התשלומים</Link>
        </Button>
      )}
      {kind === "short" && (
        <Button size="sm" variant="outline" className={btn} onClick={() => a.closeAnyway(covered)} data-testid="si-close-anyway">
          סגירה ידנית
        </Button>
      )}
      {kind === "warning" &&
        docs
          .filter((d) => d.file_path)
          .slice(0, 1)
          .map((d) => (
            <Button key={d.id} size="sm" variant="outline" className={btn} onClick={() => openFile(d.file_path)}>
              <FileText className="w-3.5 h-3.5 ml-1" /> פתיחת המסמך
            </Button>
          ))}
      {kind !== "pay" && (
        <>
          <Button size="sm" variant="outline" className={btn} disabled={a.busy} onClick={pick}>
            {a.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 ml-1" />} יש לי את המסמך
          </Button>
          {kind === "stuck" && (
            <Button size="sm" variant="outline" className={btn} onClick={a.remind}>
              <Send className="w-3.5 h-3.5 ml-1" /> תזכורת
            </Button>
          )}
        </>
      )}
      <RowMenu t={t} a={a} short={kind === "short"} covered={covered} />
    </AttentionRow>
  );
}

/** "⋯": the rarer actions of a transfer. */
function RowMenu({ t, a, short, covered }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="rounded-md border border-gray-700 px-2 py-1 text-gray-300 hover:text-white" aria-label="עוד פעולות" data-testid="si-row-menu">
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-gray-900 border-gray-700 text-gray-200" dir="rtl">
        {t.status === "waiting" && <DropdownMenuItem onSelect={a.byEmail}>התקבל במייל</DropdownMenuItem>}
        {t.status === "waiting" && <DropdownMenuItem onSelect={() => a.update({ status: "not_needed" })}>לא צריך מסמך</DropdownMenuItem>}
        {short && <DropdownMenuItem onSelect={() => a.closeAnyway(covered)}>סגירה ידנית</DropdownMenuItem>}
        {(t.status === "not_needed" || String(t.note || "").startsWith(MANUAL_CLOSE)) && <DropdownMenuItem onSelect={() => a.update({ status: "waiting", note: null })}>החזרה לפתוחות</DropdownMenuItem>}
        <DropdownMenuItem onSelect={a.remove} className="text-red-300">
          {t.status === "requested" ? "ביטול הבקשה" : "מחיקה"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TransferRow({ t, state, short, covered, compact, ...rest }) {
  const a = useTransferActions(t, rest);
  const [input, pick] = useFilePicker(a.upload);
  const [open, setOpen] = useState(false);
  const docs = rest.docsOf(t.id);
  const closed = t.status === "received" || t.status === "not_needed";
  const warned = docs.some((d) => (d.warnings || []).length);
  const firstFile = docs.find((d) => d.file_path);

  const unlink = async (inv) => {
    await supabase.from("staff_invoice_transfers").delete().eq("invoice_id", inv.id).eq("transfer_id", t.id);
    if (t.status === "received") await supabase.from("staff_transfers").update({ status: "waiting" }).eq("id", t.id);
    rest.onChange();
  };

  return (
    <div className={compact ? "px-4 py-2.5" : "p-4"} data-testid="si-transfer">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {closed && <Check className={`w-4 h-4 ${t.status === "received" ? "text-emerald-400" : "text-gray-600"}`} />}
        <button type="button" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-right" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="font-semibold text-white">{t.staff_member_name}</span>
          <span className="text-white">{fmt(t.amount)} ₪</span>
          <span className="text-xs text-gray-400">
            {t.status === "requested" ? "ביקשת" : "שולם"} {day(t.paid_on)}
            {t.entity ? ` · ${ENTITIES[t.entity]?.short}` : ""}
          </span>
          {closed && docs[0] ? (
            <span className="text-xs text-gray-400">
              {docs[0].doc_type || (docs[0].source === "email" ? "התקבל במייל" : "מסמך")} {docs[0].doc_number || ""}
              {docs.length > 1 ? ` ועוד ${docs.length - 1}` : ""}
            </span>
          ) : (
            <span className={`text-xs ${t.status === "waiting" && daysSince(t.paid_on) >= 7 ? "text-amber-300" : "text-gray-400"}`}>{state}</span>
          )}
          {warned && <span className="text-xs text-amber-300">⚠️</span>}
          <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        <div className="flex flex-wrap items-center gap-2 mr-auto">
          {input}
          {closed && firstFile && (
            <button type="button" className="text-brand-300 hover:underline text-xs" onClick={() => openFile(firstFile.file_path)}>
              פתיחה
            </button>
          )}
          {t.status === "requested" && (
            <Button asChild size="sm" variant="outline" className={btn}>
              <Link to="/Payments">לדף התשלומים</Link>
            </Button>
          )}
          {t.status === "waiting" && (
            <>
              <Button size="sm" variant="outline" className={btn} disabled={a.busy} onClick={pick} data-testid="si-upload">
                {a.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 ml-1" />} יש לי את המסמך
              </Button>
              <Button size="sm" variant="outline" className={btn} onClick={a.remind}>
                <Send className="w-3.5 h-3.5 ml-1" /> תזכורת
              </Button>
            </>
          )}
          <RowMenu t={t} a={a} short={short} covered={covered} />
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5" data-testid="si-transfer-details">
          {(t.events || []).length > 0 && <div className="text-xs text-gray-500">{t.events.map((e) => `${day(e.date)} ${e.venue || ""}`.trim()).join(" · ")}</div>}
          {t.description && <div className="text-xs text-gray-500">"{t.description}"</div>}
          {t.note && <div className="text-xs text-gray-500">{t.note}</div>}
          {short && <div className="text-xs text-amber-300">⚠️ המסמכים מכסים {fmt(covered)} מתוך {fmt(t.amount)} ₪</div>}
          {docs.length === 0 && <div className="text-xs text-gray-500">עוד לא הגיע מסמך.</div>}
          {docs.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-950/60 px-3 py-2 text-sm" data-testid="si-doc">
              <FileText className="w-4 h-4 text-gray-400" />
              <span className="text-gray-200">
                {d.doc_type || (d.source === "email" ? "התקבל במייל" : "מסמך")} {d.doc_number || ""}
              </span>
              {d.amount !== null && <span className="text-gray-400">{fmt(d.amount)} ₪</span>}
              {d.allocation_number && <span className="text-[11px] text-gray-500">הקצאה {d.allocation_number}</span>}
              {d.file_path && (
                <button type="button" className="text-brand-300 hover:underline text-xs" onClick={() => openFile(d.file_path)}>
                  פתיחה
                </button>
              )}
              {!d.file_path && d.link_url && (
                <span className="text-xs text-gray-400">{AUTO_PDF[d.provider] && !d.note ? "⏳ נשמר כ-PDF לבד" : "קישור — לשמור PDF ידנית"}</span>
              )}
              <button type="button" className="mr-auto text-gray-500 hover:text-white" onClick={() => unlink(d)} aria-label="ניתוק המסמך מההעברה">
                <X className="w-3.5 h-3.5" />
              </button>
              {(d.warnings || []).map((w) => (
                <div key={w} className="w-full text-xs text-amber-300">
                  ⚠️ {w}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The closed, a month at a time (newest open). */
function ClosedByMonth({ transfers, rowProps }) {
  const months = useMemo(() => {
    const m = new Map();
    for (const t of transfers) m.set(monthOf(t.paid_on), [...(m.get(monthOf(t.paid_on)) || []), t]);
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [transfers]);
  const [shown, setShown] = useState(() => new Set(months[0] ? [months[0][0]] : []));
  if (!months.length) return <p className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center text-sm text-gray-500">עוד אין העברות סגורות.</p>;
  return (
    <div className="space-y-2" data-testid="si-closed">
      {months.map(([m, list]) => (
        <div key={m} className="rounded-xl border border-gray-800 bg-gray-900">
          <button type="button" className="flex w-full items-center justify-between px-4 py-2.5 text-sm text-gray-300" onClick={() => setShown((s) => new Set(s.has(m) ? [...s].filter((x) => x !== m) : [...s, m]))}>
            <span>
              {monthName(m)} · {list.length === 1 ? "סגורה אחת" : `${list.length} סגורות`}
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${shown.has(m) ? "rotate-180" : ""}`} />
          </button>
          {shown.has(m) && (
            <div className="divide-y divide-gray-800 border-t border-gray-800">
              {list.map((t) => (
                <TransferRow key={t.id} t={t} state={transferState(t)} compact {...rowProps} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * A document that came as a link to a page and needs the owner (another provider's page, or one the system couldn't
 * save — Paperless's and Invoice4U's are saved as PDF by themselves): open the link, save as PDF, upload. "נסה שוב"
 * sends a failed one back to the system.
 */
function LinkDoc({ inv, tenantId, onChange, onScan }) {
  const auto = AUTO_PDF[inv.provider];
  const [input, pick] = useFilePicker(async (f) => {
    if (f && (await attachFile(inv, f, tenantId))) await onScan({ quiet: true });
  });
  const retry = async () => {
    const { error } = await supabase.from("staff_invoices").update({ note: null }).eq("id", inv.id);
    if (error) return toast.error(error.message);
    if (inv.provider === "invoice4u") {
      toast.success("המערכת תנסה שוב לשמור אותו כ-PDF בשעה הקרובה");
      return onChange();
    }
    await onScan({ quiet: true });
  };
  return (
    <AttentionRow title={inv.staff_member_name} amount={inv.amount} text={`${inv.doc_type || "מסמך"} ${inv.doc_number || ""} הגיע כקישור — ${inv.note || "צריך לשמור אותו כ-PDF"}`} testid="si-link-doc">
      {input}
      <a href={inv.link_url} target="_blank" rel="noopener noreferrer" className="text-amber-300 hover:underline text-xs inline-flex items-center gap-1">
        <ExternalLink className="w-3 h-3" /> פתיחת הקישור
      </a>
      <Button size="sm" variant="outline" className={btn} onClick={pick}>
        <Upload className="w-3.5 h-3.5 ml-1" /> העלאת PDF
      </Button>
      {auto && inv.note && (
        <Button size="sm" variant="outline" className={btn} onClick={retry} data-testid="si-link-retry">
          <RefreshCw className="w-3.5 h-3.5 ml-1" /> נסה שוב
        </Button>
      )}
    </AttentionRow>
  );
}

function UnassignedDoc({ inv, transfers, tenantId, onChange, onScan }) {
  const [target, setTarget] = useState("");
  const [input, pick] = useFilePicker(async (f) => {
    if (f && (await attachFile(inv, f, tenantId))) await onScan({ quiet: true });
  });
  const assign = async () => {
    if (!target) return;
    const { error } = await supabase.from("staff_invoice_transfers").insert({ invoice_id: inv.id, transfer_id: target, tenant_id: tenantId });
    if (error) return toast.error(error.message);
    await onScan({ quiet: true });
  };
  return (
    <AttentionRow title={inv.staff_member_name} amount={inv.amount} text={`${inv.doc_type || "מסמך"} ${inv.doc_number || ""} — ${inv.read_status === "failed" ? "לא הצלחנו לקרוא אותו" : "לא ברור לאיזו העברה הוא שייך"}`} testid="si-unassigned-doc">
      {input}
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
            <button type="button" className="text-brand-300 hover:underline text-xs" onClick={pick}>
              העלאת ה-PDF ששמרת
            </button>
          </>
        )
      )}
      <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white">
        <option value="">שיוך להעברה…</option>
        {transfers.map((t) => (
          <option key={t.id} value={t.id}>
            {day(t.paid_on)} · {fmt(t.amount)} ₪ {t.status === "received" ? "(כבר התקבל)" : t.status === "requested" ? "(ביקשת לפני תשלום)" : ""}
          </option>
        ))}
      </select>
      <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!target} onClick={assign}>
        שיוך
      </Button>
      <button type="button" className="text-xs text-gray-500 hover:text-white" onClick={async () => (await supabase.from("staff_invoices").update({ read_status: "not_invoice" }).eq("id", inv.id), onChange())}>
        זה לא מסמך
      </button>
    </AttentionRow>
  );
}

/** The studio's two businesses as invoices must name them; the scan uses them to know who paid and to check documents. */
function PayersDialog({ payers, tenantId, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    Object.fromEntries(["company", "sole_prop"].map((k) => [k, { name: payers[k]?.name || "", id: payers[k]?.id || "", email: payers[k]?.email || "", accounts: (payers[k]?.accounts || []).join(", ") }]))
  );
  const set = (k, field, v) => setForm({ ...form, [k]: { ...form[k], [field]: v } });
  const save = async () => {
    const value = {};
    for (const k of ["company", "sole_prop"]) {
      const f = form[k];
      if (f.name.trim() || f.id.trim())
        value[k] = { name: f.name.trim(), id: f.id.replace(/\D/g, ""), email: f.email.trim(), accounts: f.accounts.split(/[,\n]/).map((a) => a.trim()).filter(Boolean) };
    }
    const { error } = await supabase.from("app_settings").upsert({ tenant_id: tenantId, key: STAFF_PAYERS_KEY, value: JSON.stringify(value) }, { onConflict: "tenant_id,key" });
    if (error) return toast.error(error.message);
    toast.success("הפרטים נשמרו");
    onSaved();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-700 text-white max-w-2xl" data-testid="si-payers">
        <DialogHeader>
          <DialogTitle className="text-right">פרטי שני העסקים</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-400">מהם בונים את הבקשה לחשבונית (השם, ח.פ. / ע.מ. והמייל), ולפי מספר החשבון המערכת יודעת מאיזה עסק יצאה העברה שנשלחה בצ'אט.</p>
        {["company", "sole_prop"].map((k) => (
          <div key={k} className="space-y-2">
            <p className="text-sm font-semibold">{ENTITIES[k].label}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <Input value={form[k].name} onChange={(e) => set(k, "name", e.target.value)} placeholder="השם בחשבונית" className={inputCls} />
              <Input value={form[k].id} onChange={(e) => set(k, "id", e.target.value)} placeholder={k === "company" ? "ח.פ." : "ע.מ."} dir="ltr" className={inputCls} />
              <Input value={form[k].email} onChange={(e) => set(k, "email", e.target.value)} placeholder="מייל לחשבוניות" dir="ltr" className={inputCls} />
              <Input value={form[k].accounts} onChange={(e) => set(k, "accounts", e.target.value)} placeholder="מספר חשבון בנק (למשל 615-027088)" dir="ltr" className={inputCls} />
            </div>
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <Button variant="outline" className={btn} onClick={onClose}>
            ביטול
          </Button>
          <Button className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={save} data-testid="si-payers-save">
            שמירה
          </Button>
        </div>
      </DialogContent>
    </Dialog>
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
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-700 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-right">העברה ידנית</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-400">לרוב לא צריך: העברה נפתחת לבד מ"שילמתי" בדף התשלומים, מצילום ההעברה בצ'אט או מסימון "שולם".</p>
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
      </DialogContent>
    </Dialog>
  );
}

/**
 * "בדיקת חיבור למורנינג" (2026-11-02): a READ-ONLY look at both Morning accounts' expenses, before the team's invoices are
 * sent there as drafts — what came back is kept for the build (supabase/functions/_shared/morningExpensesProbe.ts).
 */
async function runMorningProbe() {
  const id = toast.loading("בודק את החיבור למורנינג…");
  try {
    const res = await base44.functions.invoke("staffInvoices", { action: "morning_probe" });
    const p = res.data?.probe;
    if (!p) throw new Error(res.data?.error || "אין תשובה");
    const line = (k, label) => {
      const e = p[k];
      if (e?.error) return `${label}: שגיאה (${e.error})`;
      if (!e?.connected) return `${label}: לא מחובר${e?.login ? ` (${e.login})` : ""}`;
      return `${label}: ${e.search?.status === 200 ? `נקראו ${e.search.count} הוצאות` : `שגיאה ${e.search?.status}`}`;
    };
    toast.success(`הבדיקה הסתיימה — ${line("company", "חברה")} · ${line("sole_prop", "עוסק מורשה")}${p.saveError ? ` · לא נשמרה (${p.saveError})` : ""}`, { id, duration: 15000 });
  } catch (e) {
    toast.error("הבדיקה נכשלה: " + e.message, { id });
  }
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
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2" data-testid="si-export">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white ml-1">סוף חודש למורנינג</span>
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white">
          {months.length === 0 && <option value="">אין עדיין מסמכים</option>}
          {months.map((m) => (
            <option key={m} value={m}>
              {m.slice(5)}/{m.slice(0, 4)}
            </option>
          ))}
        </select>
        {["company", "sole_prop", "all"].map((k) => (
          <Button key={k} size="sm" variant="outline" className={btn} disabled={!month || !!busy} onClick={() => download(k)} data-testid={`si-zip-${k}`}>
            {busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 ml-1.5" />}
            {k === "all" ? "הכל" : ENTITIES[k].label}
          </Button>
        ))}
      </div>
      <p className="text-xs text-gray-500">
        כל מסמכי החודש בקובץ ZIP אחד לכל עסק, בשמות מסודרים — להעלאה להוצאות במורנינג.
        {toSave.length > 0 && <span className="text-amber-300"> {toSave.length === 1 ? "מסמך אחד עוד מחכה" : `${toSave.length} מסמכים עוד מחכים`} ל-PDF ויכנסו אחרי שיישמרו.</span>}
      </p>
    </section>
  );
}
