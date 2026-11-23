import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { downloadZip } from "client-zip";
import { AlertTriangle, ChevronDown, Download, ExternalLink, FileText, Loader2, Mail, MessageCircle, RefreshCw, Settings, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import ExpenseSettings from "@/components/expenses/ExpenseSettings";
import { STAFF_PAYERS_KEY } from "@/lib/staffInvoices";
import {
  ENTITY_INFO, ENTITY_ORDER, EXPENSES_BUCKET, EXPENSES_TRACK_SINCE, GROUP_KEY, MAX_UPLOAD_BYTES, MORNING_SYNCED_KEY, READABLE, TABS,
  chipOf, docFileName, docMonth, fmtMoney, inTab, monthsSince, reasonText, sourceText, summaryCsv, tabCounts, tabOf, uploadPath, zipList, zipName,
} from "@/lib/expenses";

// "מרכז הוצאות", step 1 (2026-11-23, the owner approved the mockup and the plan; 0117). Every expense document in one
// place: what was posted to the "קבלות" WhatsApp group, what the script in each mailbox sent, and what is dropped here.
// AI reads each one and it is sorted: issued to the company → the company; else the owner chooses once per supplier.
// "כבר במורנינג ✓" from a read-only copy of both Morning accounts. The month's ZIP per business for Morning (until
// step 2 sends there by itself).

const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthName = (m) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const day = (d) => (d ? `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}` : "");
const TONE = {
  purple: "bg-purple-500/15 text-purple-200 border-purple-500/40",
  emerald: "bg-emerald-500/15 text-emerald-200 border-emerald-500/40",
  amber: "bg-amber-500/15 text-amber-200 border-amber-500/40",
  orange: "bg-transparent text-orange-300 border-orange-400/60",
  sky: "bg-sky-500/15 text-sky-200 border-sky-500/40",
  gray: "bg-gray-700/40 text-gray-300 border-gray-600",
};

async function openDoc(d) {
  if (!d.file_path) return d.link_url && window.open(d.link_url, "_blank", "noopener");
  const { data, error } = await supabase.storage.from(EXPENSES_BUCKET).createSignedUrl(d.file_path, 600);
  if (error) return toast.error(error.message);
  window.open(data.signedUrl, "_blank", "noopener");
}

function SourceIcon({ d }) {
  if (d.warnings?.length) return <AlertTriangle className="w-[18px] h-[18px] text-orange-400 shrink-0" />;
  if (d.source === "whatsapp") return <MessageCircle className="w-[18px] h-[18px] text-emerald-400 shrink-0" />;
  if (d.source === "email") return <Mail className="w-[18px] h-[18px] text-sky-400 shrink-0" />;
  return <Upload className="w-[18px] h-[18px] text-violet-300 shrink-0" />;
}

function EntityButtons({ d, onPick, busy }) {
  const [remember, setRemember] = useState(!!d.supplier_key);
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {ENTITY_ORDER.map((k) => (
        <button
          key={k}
          type="button"
          disabled={busy}
          onClick={() => onPick(d, k, remember)}
          className={`text-xs px-2.5 py-1 rounded-md border ${d.entity === k || (!d.entity && d.suggested_entity === k) ? TONE[ENTITY_INFO[k].tone] : "border-gray-700 text-gray-300 hover:bg-gray-800"}`}
          data-testid={`exp-pick-${k}`}
        >
          {ENTITY_INFO[k].short}
          {!d.entity && d.suggested_entity === k && " (הצעה)"}
        </button>
      ))}
      {d.supplier_key && (
        <label className="flex items-center gap-1 text-[11px] text-gray-400 cursor-pointer mr-1">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          לזכור לספק הזה
        </label>
      )}
    </div>
  );
}

function DocRow({ d, open, onToggle, mailboxes, act, busy }) {
  const chip = chipOf(d);
  const tab = tabOf(d);
  const title = d.issuer || d.doc_type || (tab === "reading" ? "בקריאה…" : d.mail_subject || "מסמך");
  const kind = [d.issuer ? d.doc_type : "", d.doc_number].filter(Boolean).join(" ");
  return (
    <div className={`border-b border-gray-800 last:border-0 ${open ? "bg-gray-950/60 rounded-lg" : ""}`} data-testid="exp-row">
      <button type="button" onClick={onToggle} className="w-full grid grid-cols-[22px_minmax(0,1fr)_auto] sm:grid-cols-[22px_minmax(0,1fr)_86px_auto] gap-x-3 gap-y-1 items-center text-right py-2.5 px-1">
        <SourceIcon d={d} />
        <div className="min-w-0">
          <div className="text-sm text-white truncate">
            {title}
            {kind && <span className="text-gray-400"> · {kind}</span>}
          </div>
          <div className={`text-[11px] truncate ${d.warnings?.length ? "text-orange-300" : "text-gray-500"}`}>
            {d.warnings?.length ? d.warnings[0] : `${sourceText(d, mailboxes)} · ${day(d.doc_date || String(d.received_at || "").slice(0, 10))}`}
          </div>
        </div>
        <span className="hidden sm:block text-sm text-gray-200 text-left">{fmtMoney(d.amount)}</span>
        <span className={`text-[11px] px-2 py-1 rounded-md border whitespace-nowrap ${TONE[chip.tone]}`} data-testid="exp-chip">
          {chip.text}
        </span>
      </button>
      {tab === "decide" && d.read_status === "done" && !open && (
        <div className="pb-2.5 pr-8">
          <EntityButtons d={d} onPick={act.pick} busy={busy} />
        </div>
      )}
      {open && (
        <div className="px-3 pb-3 space-y-2.5 text-xs" data-testid="exp-detail">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-gray-300">
            <div><span className="text-gray-500">ספק: </span>{d.issuer || "—"}{d.issuer_tax_id && <span className="text-gray-500"> ({d.issuer_tax_id})</span>}</div>
            <div><span className="text-gray-500">סכום: </span>{fmtMoney(d.amount)}{d.currency && !/ils/i.test(d.currency) && ` ${d.currency}`}</div>
            <div><span className="text-gray-500">מע״מ: </span>{fmtMoney(d.vat)}</div>
            <div><span className="text-gray-500">תאריך: </span>{d.doc_date ? d.doc_date.split("-").reverse().join(".") : "—"}</div>
            <div><span className="text-gray-500">הונפק ל: </span>{d.issued_to || "—"}</div>
            <div><span className="text-gray-500">מה: </span>{d.description || "—"}</div>
          </div>
          {d.source === "email" && d.mail_subject && <div className="text-gray-500">מייל: {d.mail_subject}{d.mail_from && ` · ${d.mail_from}`}</div>}
          {reasonText(d) && <div className="rounded-md bg-purple-500/10 text-purple-200 px-2 py-1.5">{reasonText(d)}</div>}
          {d.warnings?.map((w) => (
            <div key={w} className="rounded-md bg-orange-500/10 text-orange-200 px-2 py-1.5">{w}</div>
          ))}
          {(d.note || d.read_error) && <div className="text-gray-400">{d.note || d.read_error}</div>}
          {d.read_status === "done" && <EntityButtons d={d} onPick={act.pick} busy={busy} />}
          <div className="flex flex-wrap gap-1.5">
            {(d.file_path || d.link_url) && (
              <Button size="sm" variant="outline" className={btn} onClick={() => openDoc(d)}>
                <ExternalLink className="w-3.5 h-3.5 ml-1" /> פתיחת המסמך
              </Button>
            )}
            {["failed", "manual"].includes(d.read_status) && (
              <Button size="sm" variant="outline" className={btn} disabled={busy} onClick={() => act.retry(d)}>
                <RefreshCw className="w-3.5 h-3.5 ml-1" /> לקרוא שוב
              </Button>
            )}
            {["done", "failed", "manual"].includes(d.read_status) && (
              <Button size="sm" variant="outline" className={btn} disabled={busy} onClick={() => act.mark(d, "not_expense")}>
                לא הוצאה
              </Button>
            )}
            {["not_expense", "duplicate"].includes(d.read_status) && (
              <Button size="sm" variant="outline" className={btn} disabled={busy} onClick={() => act.mark(d, "done")}>
                להחזיר לרשימה
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-gray-500 hover:text-red-300" disabled={busy} onClick={() => act.remove(d)}>
              <Trash2 className="w-3.5 h-3.5 ml-1" /> מחיקה
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({ onFiles, busy }) {
  const ref = useRef(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => (e.preventDefault(), setOver(false), onFiles([...e.dataTransfer.files]))}
      onClick={() => ref.current?.click()}
      className={`rounded-xl border border-dashed px-4 py-3 text-center text-sm cursor-pointer ${over ? "border-violet-400 bg-violet-500/10 text-violet-200" : "border-gray-700 text-gray-400 hover:bg-gray-800/40"}`}
      data-testid="exp-drop"
    >
      <input ref={ref} type="file" multiple accept="application/pdf,image/*" className="hidden" onChange={(e) => (onFiles([...(e.target.files || [])]), (e.target.value = ""))} />
      {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : <Upload className="w-4 h-4 inline ml-1.5" />} גוררים לכאן PDF או תמונה של קבלה — או לוחצים לבחירה
    </div>
  );
}

function ZipCard({ docs, month }) {
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [busy, setBusy] = useState("");
  const download = async (entity) => {
    const list = zipList(docs, month, entity, { onlyMissing });
    if (!list.length) return toast.info(onlyMissing ? "אין מסמכים שעוד לא במורנינג" : "אין מסמכים לחודש הזה");
    setBusy(entity);
    try {
      const files = [{ name: "סיכום.csv", input: summaryCsv(list), lastModified: new Date() }];
      for (const d of list) {
        const { data, error } = await supabase.storage.from(EXPENSES_BUCKET).download(d.file_path);
        if (error) throw error;
        files.push({ name: docFileName(d), input: data, lastModified: new Date() });
      }
      const blob = await downloadZip(files).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = zipName(month, entity);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy("");
  };
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2" data-testid="exp-zip">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-white ml-1">קובץ לחודש {monthName(month)} למורנינג</span>
        {["company", "sole_prop"].map((k) => (
          <Button key={k} size="sm" variant="outline" className={btn} disabled={!!busy} onClick={() => download(k)} data-testid={`exp-zip-${k}`}>
            {busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4 ml-1.5" />}
            {ENTITY_INFO[k].label} ({zipList(docs, month, k, { onlyMissing }).length})
          </Button>
        ))}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          רק מה שעוד לא במורנינג
        </label>
      </div>
      <p className="text-xs text-gray-500">כל מסמכי העסק לחודש בקובץ ZIP אחד, בשמות מסודרים ועם סיכום — להעלאה להוצאות במורנינג, עד שהשלב הבא ישלח לבד.</p>
    </section>
  );
}

export default function Expenses() {
  const { tenant } = useAuth();
  const [data, setData] = useState(null); // { docs, mailboxes, payers, settings, staff }
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [scan, setScan] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const months = useMemo(() => monthsSince(EXPENSES_TRACK_SINCE), []);

  const load = async () => {
    const [docs, boxes, sets, staff] = await Promise.all([
      supabase.from("expense_docs").select("*").order("received_at", { ascending: false }).limit(3000),
      supabase.from("expense_mailboxes").select("id, label, created_at, last_seen_at").is("revoked_at", null).order("created_at"),
      supabase.from("app_settings").select("key, value").in("key", [GROUP_KEY, MORNING_SYNCED_KEY, STAFF_PAYERS_KEY]),
      supabase.from("staff_invoices").select("id, issued_on, created_at, read_status").gte("created_at", `${EXPENSES_TRACK_SINCE}T00:00:00`),
    ]);
    const err = docs.error || boxes.error || sets.error;
    if (err) return toast.error(err.message);
    const settings = Object.fromEntries((sets.data || []).map((r) => [r.key, r.value]));
    let payers = {};
    try {
      payers = JSON.parse(settings[STAFF_PAYERS_KEY] || "{}");
    } catch {
      payers = {};
    }
    setData({ docs: docs.data || [], mailboxes: boxes.data || [], payers, settings, staff: staff.data || [] });
  };

  // The refresh, a few documents a call (each read is one AI call), until nothing is left to read.
  const refresh = async ({ quiet, morning } = {}) => {
    setScan(quiet ? "מעדכן…" : "אוסף וקורא מסמכים…");
    try {
      let read = 0;
      for (let round = 0; round < 15; round++) {
        const res = await base44.functions.invoke("expenses", morning && round === 0 ? { action: "morning" } : {});
        const r = res.data || {};
        if (r.error) throw new Error(r.error);
        if (r.errors?.length) console.warn("[expenses]", r.errors);
        read += r.read || 0;
        if (morning && round === 0) {
          toast.success("עודכן מהמורנינג");
          continue;
        }
        if (!r.remaining || !r.read) break;
        setScan(`קורא… נשארו ${r.remaining} מסמכים`);
        await load();
      }
      if (!quiet && read) toast.success(read === 1 ? "נקרא מסמך אחד" : `נקראו ${read} מסמכים`);
    } catch (e) {
      toast.error("העדכון נכשל: " + e.message);
    }
    setScan("");
    load();
  };

  useEffect(() => {
    load().then(() => refresh({ quiet: true }));
  }, []);

  const call = async (body, ok) => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("expenses", body);
      if (res.data?.error) throw new Error(res.data.error);
      if (ok) toast.success(typeof ok === "function" ? ok(res.data) : ok);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy(false);
    load();
  };

  const act = {
    pick: (d, entity, remember) =>
      call({ action: "set_entity", id: d.id, entity, remember }, (r) =>
        remember && r.updated > 1 ? `${ENTITY_INFO[entity].label} — וגם ${r.updated - 1} מסמכים נוספים של הספק הזה` : `נכנס ל${ENTITY_INFO[entity].label}${remember ? " · מעכשיו לבד לספק הזה" : ""}`,
      ),
    retry: (d) => call({ action: "retry", id: d.id }, "נקרא שוב"),
    mark: (d, status) => call({ action: "mark", id: d.id, status }, status === "done" ? "הוחזר לרשימה" : "סומן: לא הוצאה"),
    remove: async (d) => {
      if (!(await confirmDialog("למחוק את המסמך מהמערכת? הקובץ יימחק. אם הוא הגיע במייל או בקבוצה — הוא לא ייקלט שוב לבד."))) return;
      setBusy(true);
      if (d.file_path) await supabase.storage.from(EXPENSES_BUCKET).remove([d.file_path]).catch(() => {});
      const { error } = await supabase.from("expense_docs").delete().eq("id", d.id);
      if (error) toast.error(error.message);
      else toast.success("נמחק");
      setBusy(false);
      load();
    },
  };

  const upload = async (files) => {
    const ok = files.filter((f) => READABLE.includes(f.type) && f.size <= MAX_UPLOAD_BYTES);
    if (ok.length < files.length) toast.error("רק PDF או תמונה (JPG / PNG) עד 10MB");
    if (!ok.length || !tenant?.id) return;
    setBusy(true);
    try {
      for (const f of ok) {
        const id = crypto.randomUUID();
        const path = uploadPath(tenant.id, id, f.type);
        const { error: upErr } = await supabase.storage.from(EXPENSES_BUCKET).upload(path, f, { contentType: f.type });
        if (upErr) throw upErr;
        const { error } = await supabase.from("expense_docs").insert({
          id, tenant_id: tenant.id, source: "upload", source_ref: `up:${id}`, file_path: path, file_mime: f.type, file_size: f.size, read_status: "pending",
        });
        if (error) throw error;
      }
      toast.success(ok.length === 1 ? "הקובץ עלה — קורא אותו" : `${ok.length} קבצים עלו — קורא אותם`);
    } catch (e) {
      toast.error("ההעלאה נכשלה: " + e.message);
    }
    setBusy(false);
    await load();
    refresh({ quiet: true });
  };

  const view = useMemo(() => {
    if (!data) return null;
    const monthDocs = data.docs.filter((d) => docMonth(d) === month);
    const counts = tabCounts(monthDocs);
    const sums = Object.fromEntries(
      ENTITY_ORDER.map((k) => {
        const list = monthDocs.filter((d) => d.read_status === "done" && d.entity === k);
        return [k, { count: list.length, total: list.reduce((s, d) => s + Number(d.amount || 0), 0), missing: list.filter((d) => !d.morning_expense_id).length }];
      }),
    );
    const staffThisMonth = data.staff.filter((s) => String(s.issued_on || s.created_at || "").slice(0, 7) === month && s.read_status !== "not_invoice").length;
    return { list: inTab(monthDocs, tab), counts, sums, staffThisMonth, monthDocs };
  }, [data, month, tab]);

  if (!data || !view) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  const groupSet = !!data.settings[GROUP_KEY];
  const synced = data.settings[MORNING_SYNCED_KEY];

  return (
    <div dir="rtl" className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto" data-testid="expenses-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">הוצאות</h1>
          <p className="text-sm text-gray-400">כל קבלה וחשבונית — מהקבוצה, מהמיילים ומכאן — ממוינת לחברה, לעוסק או לבית</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-md border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-white" data-testid="exp-month">
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m)}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" className={btn} disabled={!!scan} onClick={() => refresh()} data-testid="exp-refresh">
            {scan ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
          <Button size="sm" variant="outline" className={btn} onClick={() => setSettingsOpen(true)} data-testid="exp-settings-open">
            <Settings className="w-4 h-4 ml-1.5" /> מאיפה מגיעים
          </Button>
        </div>
      </div>
      {scan && <div className="text-xs text-sky-300">{scan}</div>}

      {(!groupSet || data.mailboxes.length === 0) && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm space-y-1.5" data-testid="exp-setup">
          <div className="font-semibold text-amber-200">כדי שהמסמכים יגיעו לבד</div>
          <div className={groupSet ? "text-emerald-300" : "text-gray-300"}>{groupSet ? "✓" : "1."} קבוצת "קבלות" בוואטסאפ — אתה, סבינה ומספר הסטודיו</div>
          <div className={data.mailboxes.length ? "text-emerald-300" : "text-gray-300"}>
            {data.mailboxes.length ? "✓" : "2."} סקריפט בכל אחד מהמיילים{data.mailboxes.length === 1 && " (מחובר אחד)"}
          </div>
          <Button size="sm" variant="outline" className={btn} onClick={() => setSettingsOpen(true)}>
            להגדרה
          </Button>
        </section>
      )}

      <DropZone onFiles={upload} busy={busy} />

      <div className="grid grid-cols-3 gap-2">
        {ENTITY_ORDER.map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg border p-2.5 text-center ${tab === k ? TONE[ENTITY_INFO[k].tone] : "border-gray-800 bg-gray-900"}`} data-testid={`exp-tile-${k}`}>
            <div className="text-[11px] text-gray-400">{ENTITY_INFO[k].label}</div>
            <div className="text-lg font-semibold text-white">{fmtMoney(view.sums[k].total)}</div>
            <div className="text-[11px] text-gray-500">
              {view.sums[k].count} מסמכים{k !== "home" && view.sums[k].missing > 0 && <span className="text-amber-300"> · {view.sums[k].missing} עוד לא במורנינג</span>}
            </div>
          </button>
        ))}
      </div>

      <section className="rounded-xl border border-gray-800 bg-gray-900 p-3 sm:p-4">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${tab === t.key ? "bg-sky-500/15 border-sky-500 text-sky-100" : t.key === "decide" && view.counts.decide ? "border-orange-400/60 text-orange-300" : "border-gray-700 text-gray-400"}`}
              data-testid={`exp-tab-${t.key}`}
            >
              {t.label} {view.counts[t.key] || 0}
            </button>
          ))}
        </div>
        {view.list.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">{tab === "decide" ? "אין מסמכים שמחכים להחלטה ✓" : "אין מסמכים בחודש הזה"}</div>
        ) : (
          view.list.map((d) => <DocRow key={d.id} d={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} mailboxes={data.mailboxes} act={act} busy={busy} />)
        )}
        <Link to="/StaffInvoices" className="flex items-center gap-2 border-t border-gray-800 mt-1 pt-2.5 text-xs text-gray-400 hover:text-gray-200">
          <FileText className="w-4 h-4" /> חשבוניות מהצוות החודש: {view.staffThisMonth} — במסך שלהן, בלי כפילות
          <ChevronDown className="w-3.5 h-3.5 -rotate-90 mr-auto" />
        </Link>
      </section>

      <ZipCard docs={data.docs} month={month} />

      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span>{synced ? `"כבר במורנינג" לפי עדכון מ-${new Date(synced).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}` : "עוד לא עודכן מהמורנינג"} · המערכת רק קוראת מהמורנינג</span>
        <Button size="sm" variant="ghost" className="text-gray-400 hover:text-white h-7" disabled={!!scan} onClick={() => refresh({ morning: true })} data-testid="exp-morning">
          עדכון מהמורנינג
        </Button>
      </div>

      <ExpenseSettings open={settingsOpen} onClose={() => (setSettingsOpen(false), load())} tenantId={tenant?.id} payers={data.payers} mailboxes={data.mailboxes} onChanged={load} />
    </div>
  );
}
