import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/api/supabaseClient";
import { base44 } from "@/api/base44Client";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { generateRawToken, hashToken } from "@/lib/albumTokens";
import { expensesMailScript } from "@/lib/expensesMailScript";
import { EXPENSES_TRACK_SINCE, GROUP_CONFIRM_KEY, GROUP_KEY, mailboxShort } from "@/lib/expenses";

// "מרכז הוצאות" — where documents come from (2026-11-23; 0117): the "קבלות" WhatsApp group, the script in each Gmail
// mailbox (made here, shown once), and the two businesses' details the sorting uses (kept on "חשבוניות מהצוות").

const GROUP_NAME_KEY = "expenses_group_name";
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const when = (iso) => (iso ? new Date(iso).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export default function ExpenseSettings({ open, onClose, tenantId, payers, mailboxes, onChanged }) {
  const [vals, setVals] = useState({});
  const [ids, setIds] = useState({});
  const [groups, setGroups] = useState([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [script, setScript] = useState(null); // { label, text }

  useEffect(() => {
    if (!open) return;
    (async () => {
      const rows = await base44.entities.AppSetting.filter({ key: { $in: [GROUP_KEY, GROUP_NAME_KEY, GROUP_CONFIRM_KEY] } }).catch(() => []);
      setVals(Object.fromEntries(rows.map((r) => [r.key, r.value])));
      setIds(Object.fromEntries(rows.map((r) => [r.key, r.id])));
      const { data } = await supabase
        .from("whatsapp_conversations")
        .select("chat_id, display_name, last_message_at")
        .like("chat_id", "%@g.us")
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(300);
      setGroups(data || []);
    })();
  }, [open]);

  const upsert = async (key, value) => {
    if (ids[key]) await base44.entities.AppSetting.update(ids[key], { value });
    else {
      const created = await base44.entities.AppSetting.create({ key, value });
      setIds((m) => ({ ...m, [key]: created.id }));
    }
    setVals((v) => ({ ...v, [key]: value }));
  };

  const shown = useMemo(() => {
    const q = search.trim();
    // "קבלות" first, then the rest by last activity.
    const list = groups.filter((g) => !q || String(g.display_name || "").includes(q));
    return [...list.filter((g) => String(g.display_name || "").includes("קבלות")), ...list.filter((g) => !String(g.display_name || "").includes("קבלות"))].slice(0, 30);
  }, [groups, search]);

  const pickGroup = async (g) => {
    setBusy(true);
    try {
      await upsert(GROUP_KEY, g.chat_id);
      await upsert(GROUP_NAME_KEY, g.display_name || "");
      toast.success(`הקבוצה "${g.display_name}" נבחרה — מה שנשלח בה מעכשיו נקלט`);
      onChanged?.();
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const toggleConfirm = async () => {
    setBusy(true);
    try {
      await upsert(GROUP_CONFIRM_KEY, vals[GROUP_CONFIRM_KEY] === "off" ? "on" : "off");
    } catch (e) {
      toast.error("השמירה נכשלה", { description: e?.message });
    }
    setBusy(false);
  };

  const makeScript = async () => {
    const name = label.trim();
    if (!name) return toast.error("כתוב את כתובת המייל שבה יותקן הסקריפט");
    setBusy(true);
    try {
      const raw = generateRawToken();
      const { error } = await supabase.from("expense_mailboxes").insert({ tenant_id: tenantId, label: name.slice(0, 120), token_hash: await hashToken(raw) });
      if (error) throw error;
      setScript({ label: name, text: expensesMailScript({ url: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/expenses-mail`, token: raw, since: EXPENSES_TRACK_SINCE }) });
      setLabel("");
      toast.success("הסקריפט מוכן — העתק אותו עכשיו, הוא לא יוצג שוב");
      onChanged?.();
    } catch (e) {
      toast.error("לא הצלחתי ליצור סקריפט", { description: e?.message });
    }
    setBusy(false);
  };

  const revoke = async (box) => {
    if (!(await confirmDialog(`לנתק את המייל ${box.label}? הסקריפט שבו יפסיק לשלוח. מה שכבר נקלט נשאר.`))) return;
    const { error } = await supabase.from("expense_mailboxes").update({ revoked_at: new Date().toISOString() }).eq("id", box.id);
    if (error) return toast.error(error.message);
    toast.success("המייל נותק");
    onChanged?.();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(script.text);
      toast.success("הסקריפט הועתק");
    } catch {
      toast.error("לא הצלחתי להעתיק — סמן את הטקסט והעתק ידנית");
    }
  };

  const chosen = vals[GROUP_KEY];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-800 text-gray-200 max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="exp-settings">
        <DialogHeader>
          <DialogTitle className="text-white">מאיפה מגיעים המסמכים</DialogTitle>
        </DialogHeader>

        <section className="space-y-2">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-emerald-400" /> קבוצת "קבלות" בוואטסאפ
          </h3>
          <p className="text-xs text-gray-400">
            פותחים בוואטסאפ קבוצה בשם "קבלות" עם סבינה ועם מספר הסטודיו, ושולחים בה הודעה אחת — אז היא מופיעה כאן. כל צילום, PDF או קישור לחשבונית שנשלח בה נקלט לבד.
          </p>
          <div className="text-sm">
            {chosen ? (
              <>
                קבוצה: <b className="text-white">{vals[GROUP_NAME_KEY] || chosen}</b>
              </>
            ) : (
              <span className="text-amber-300">עוד לא נבחרה קבוצה</span>
            )}
          </div>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש קבוצה…" className="bg-gray-800 border-gray-700 text-white" />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-800">
            {shown.length === 0 && <div className="p-3 text-xs text-gray-500">אין קבוצות. אחרי שתשלח הודעה בקבוצה החדשה היא תופיע כאן.</div>}
            {shown.map((g) => (
              <button
                key={g.chat_id}
                type="button"
                disabled={busy}
                onClick={() => pickGroup(g)}
                className={`w-full text-right px-3 py-2 text-sm hover:bg-gray-800 ${g.chat_id === chosen ? "bg-emerald-500/10 text-emerald-200" : "text-gray-200"}`}
                data-testid="exp-group-option"
              >
                {g.display_name || g.chat_id} {g.chat_id === chosen && "✓"}
              </button>
            ))}
          </div>
          {chosen && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={vals[GROUP_CONFIRM_KEY] !== "off"} onChange={toggleConfirm} disabled={busy} />
              לענות בקבוצה "✅ נקלט: דלק ₪412 · עוסק" אחרי כל מסמך
            </label>
          )}
        </section>

        <section className="space-y-2 border-t border-gray-800 pt-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-400" /> המיילים
          </h3>
          <p className="text-xs text-gray-400">
            סקריפט קטן בכל תיבת מייל בודק כל 10 דקות מיילים מ-1.11.2026 שיש בהם חשבונית או קבלה, ושולח רק אותם. שאר המיילים לא יוצאים מהתיבה.
          </p>
          {mailboxes.length > 0 && (
            <div className="rounded-lg border border-gray-800 divide-y divide-gray-800">
              {mailboxes.map((b) => (
                <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm" data-testid="exp-mailbox">
                  <span className="flex-1 min-w-0 truncate text-white">{b.label}</span>
                  <span className={`text-xs ${b.last_seen_at ? "text-emerald-300" : "text-amber-300"}`}>{b.last_seen_at ? `פעיל · ${when(b.last_seen_at)}` : "עוד לא התחבר"}</span>
                  <Button size="sm" variant="ghost" className="text-gray-400 hover:text-red-300" onClick={() => revoke(b)} title="ניתוק">
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל avira.media1@gmail.com" className="bg-gray-800 border-gray-700 text-white" dir="ltr" data-testid="exp-mailbox-label" />
            <Button variant="outline" className={btn} disabled={busy} onClick={makeScript} data-testid="exp-make-script">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "יצירת סקריפט"}
            </Button>
          </div>
          {script && (
            <div className="space-y-2 rounded-lg border border-sky-500/40 bg-sky-500/5 p-3" data-testid="exp-script">
              <div className="text-sm text-sky-200">הסקריפט ל-{mailboxShort(script.label)} — מוצג פעם אחת:</div>
              <ol className="list-decimal pr-5 text-xs text-gray-300 space-y-1">
                <li>נכנסים ל-script.google.com כשמחוברים ל-{script.label}, ולוחצים "פרויקט חדש".</li>
                <li>מוחקים את מה שכתוב שם ומדביקים את הסקריפט.</li>
                <li>שומרים, בוחרים למעלה את הפונקציה setup, לוחצים "הפעלה" ומאשרים את ההרשאות.</li>
              </ol>
              <textarea readOnly value={script.text} className="w-full h-32 rounded-md bg-gray-950 border border-gray-800 p-2 text-[11px] text-gray-300 font-mono" dir="ltr" />
              <Button size="sm" variant="outline" className={btn} onClick={copy}>
                <Copy className="w-4 h-4 ml-1.5" /> העתקת הסקריפט
              </Button>
            </div>
          )}
        </section>

        <section className="space-y-1 border-t border-gray-800 pt-4 text-sm">
          <h3 className="font-semibold text-white">פרטי העסקים</h3>
          <p className="text-xs text-gray-400">מסמך שהונפק לח.פ. של החברה נכנס לחברה לבד. השאר — בחירה אחת לכל ספק.</p>
          {["company", "sole_prop"].map((k) => (
            <div key={k} className="text-gray-300">
              {k === "company" ? "החברה" : "עוסק מורשה"}: {payers?.[k]?.name ? <b className="text-white">{payers[k].name}</b> : <span className="text-amber-300">לא הוגדר</span>}
              {payers?.[k]?.id && <span className="text-gray-500"> · {payers[k].id}</span>}
            </div>
          ))}
          <p className="text-xs text-gray-500">לשינוי: "חשבוניות מהצוות" ← עוד ← פרטי שני העסקים.</p>
        </section>
      </DialogContent>
    </Dialog>
  );
}
