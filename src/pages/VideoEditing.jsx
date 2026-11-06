import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, HardDriveDownload, Loader2, MessageSquareText, Pencil, Scissors, Send, Wrench, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { israelToday } from "@/lib/dates";
import {
  DEFAULT_FILM_FIX_TEMPLATE, DEFAULT_FILM_TEMPLATE, FILM_FIX_TEMPLATE_KEY, FILM_TEMPLATE_KEY, cleanFilmLink, dayMonth,
  editorOf, editorPayOf, filmStateOf, lastFix, monthGroups, needsBackup, pendingFix, renderFilmMessage,
} from "@/lib/videoEditing";
import MonthHeader from "@/components/videoEditing/MonthHeader";

// "עריכת וידאו" (2026-11-06, the owner's request): the editor pastes the final film's link on his own page (/editor,
// phone + password), and here the owner sends it to the couple — in the editor's own words (template_film_link) —
// and marks that he backed it up. Sending lights the editor's square on work status, with the day; "סופי" / "→ זוג"
// there stay the photo gallery's. The editor's pay is read from the payments page (team[editor]).
// 2026-11-06 (round 2): the list by month; the editor's corrections ("עשיתי תיקונים" on his page) wait here under
// "תיקונים לשליחה" and go to the couple in their own short message (template_film_fix_link); "המלל לזוג" at the top
// edits both messages (the same settings as Settings ← תבניות הודעה).

const Event = base44.entities.Event;
const fmt = (n) => `₪${Math.round(Number(n) || 0).toLocaleString()}`;
const DAY = 24 * 60 * 60 * 1000;

const FILTERS = [
  { key: "ready", label: "ממתינים לשליחה", test: (e) => filmStateOf(e) === "ready" },
  { key: "fixes", label: "תיקונים לשליחה", test: (e) => Boolean(pendingFix(e)) },
  { key: "backup", label: "נשלחו ולא גובו", test: (e) => needsBackup(e) && !pendingFix(e) },
  { key: "work", label: "אצל העורך", test: (e) => ["editing", "no_raw"].includes(filmStateOf(e)) },
  { key: "sent", label: "נשלחו", test: (e) => filmStateOf(e) === "sent" && !pendingFix(e) },
];
const TEMPLATE_KEYS = [FILM_TEMPLATE_KEY, FILM_FIX_TEMPLATE_KEY];

const shortLink = (url) => {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 18 ? `${u.pathname.slice(0, 16)}…` : u.pathname;
    return `${u.host.replace(/^www\./, "")}${path}`;
  } catch {
    return url;
  }
};

export default function VideoEditing() {
  const [events, setEvents] = useState([]);
  // { key: { id, value } } — the two messages to the couple (the film, a correction)
  const [templates, setTemplates] = useState({});
  const [editTexts, setEditTexts] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(null);
  const [sendFor, setSendFor] = useState(null);

  const load = async () => {
    try {
      const [all, tpl] = await Promise.all([
        Event.list("-date"),
        base44.entities.AppSetting.filter({ key: { $in: TEMPLATE_KEYS } }).catch(() => []),
      ]);
      const today = israelToday();
      const since = Date.now() - 120 * DAY;
      setEvents(
        (all || []).filter((e) => {
          if (!editorOf(e?.team) || !e?.date || String(e.date).slice(0, 10) > today) return false;
          return filmStateOf(e) !== "sent" || needsBackup(e) || pendingFix(e) || new Date(e.date).getTime() >= since;
        })
      );
      setTemplates(Object.fromEntries((tpl || []).map((t) => [t.key, { id: t.id, value: t.value || "" }])));
    } catch {
      toast.error("שגיאה בטעינת האירועים");
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, []);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, events.filter(f.test).length])), [events]);
  const active = filter || (counts.ready ? "ready" : counts.fixes ? "fixes" : counts.backup ? "backup" : "work");
  const shown = useMemo(() => {
    const f = FILTERS.find((x) => x.key === active);
    const rows = events.filter(f.test);
    // what waits longest first, the archive newest first
    return active === "sent" ? rows : [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [events, active]);

  const patch = (id, fields) => setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, ...fields } : e)));

  const save = async (ev, fields, done) => {
    try {
      await Event.update(ev.id, fields);
      patch(ev.id, fields);
      if (done) toast.success(done);
      return true;
    } catch (e) {
      toast.error("השמירה נכשלה: " + (e?.message || ""));
      return false;
    }
  };

  const askSend = async (ev, mode = "film") => {
    if (!ev.phoneNumber) return toast.error("חסר טלפון זוג לאירוע");
    if (mode === "fix") return setSendFor({ ev, mode });
    // Daniel's decision R4: a second send only after asking.
    if (filmStateOf(ev) === "sent" && !(await confirmDialog({ title: `הסרט כבר נשלח ל${ev.coupleNames || "זוג"}`, message: "לשלוח אותו שוב?", confirmText: "כן, שוב" }))) return;
    setSendFor({ ev, mode });
  };

  const editorLink = `${window.location.origin}/editor`;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Scissors className="w-6 h-6 text-amber-400" />
            עריכת וידאו
          </h1>
          <p className="text-sm text-gray-400 mt-1">העורך מדביק את הסרט בדף שלו, ואתה שולח מכאן לזוג ומסמן גיבוי. השליחה צובעת את משבצת העורך בסטטוס עבודה.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-gray-400 space-y-1">
          <div className="flex items-center gap-2">
            <span>הדף של העורך:</span>
            <a href={editorLink} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline" dir="ltr">{editorLink.replace(/^https?:\/\//, "")}</a>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(editorLink).then(() => toast.success("הקישור הועתק"), () => {})}
              className="rounded p-1 hover:bg-white/10"
              aria-label="העתקת הקישור"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <div>הסיסמה שלו: הגדרות ← אנשי צוות ← עריכה ← "כניסה לדף העורך"</div>
        </div>
        <Button variant="outline" onClick={() => setEditTexts(true)} className="border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20" data-testid="ve-edit-texts">
          <MessageSquareText className="w-4 h-4 ml-1" />
          המלל לזוג
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-xl border px-3 py-2 text-right transition-colors ${active === f.key ? "border-amber-400/60 bg-amber-400/10" : "border-white/[0.07] bg-[#0F1C36] hover:border-white/20"}`}
            data-testid={`ve-filter-${f.key}`}
          >
            <div className="text-xs text-gray-400">{f.label}</div>
            <div className={`text-xl font-semibold ${f.key !== "sent" && counts[f.key] ? "text-amber-300" : "text-white"}`}>{counts[f.key]}</div>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-500" /></div>
      ) : shown.length === 0 ? (
        <p className="text-center text-gray-500 py-10">אין כאן כרגע אירועים</p>
      ) : (
        <div className="space-y-2">
          {monthGroups(shown).map((m) => (
            <React.Fragment key={m.key}>
              <MonthHeader label={m.label} count={m.items.length} />
              {m.items.map((ev) => (
                <FilmRow key={ev.id} ev={ev} onSave={save} onSend={askSend} />
              ))}
            </React.Fragment>
          ))}
        </div>
      )}

      <SendFilmDialog
        ev={sendFor?.ev}
        mode={sendFor?.mode}
        template={templates[sendFor?.mode === "fix" ? FILM_FIX_TEMPLATE_KEY : FILM_TEMPLATE_KEY]?.value || ""}
        onClose={() => setSendFor(null)}
        onSent={(ev, mode) => {
          const now = new Date().toISOString();
          if (mode === "fix") patch(ev.id, { filmFixes: (ev.filmFixes || []).map((f, i, all) => (i === all.length - 1 && !f.sentAt ? { ...f, sentAt: now } : f)) });
          else patch(ev.id, { filmSentAt: now, editorDone: true });
          setSendFor(null);
        }}
      />
      {editTexts && <TextsDialog templates={templates} onClose={() => setEditTexts(false)} onSaved={(key, row) => setTemplates((prev) => ({ ...prev, [key]: row }))} />}
    </div>
  );
}

function FilmRow({ ev, onSave, onSend }) {
  const state = filmStateOf(ev);
  const pay = editorPayOf(ev);
  const editor = editorOf(ev.team)?.staffMemberName || "העורך";
  const videos = (ev.team || []).filter((m) => ["videographer", "videographer2"].includes(m?.role) && m?.staffMemberName).map((m) => m.staffMemberName);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const saveLink = async () => {
    const link = value.trim() ? cleanFilmLink(value) : null;
    if (value.trim() && !link) return toast.error("זה לא נראה כמו לינק — צריך להתחיל ב-https://");
    setBusy(true);
    if (await onSave(ev, { filmLink: link, filmLinkAt: link ? new Date().toISOString() : null }, link ? "הלינק נשמר" : "הלינק הוסר")) setEditing(false);
    setBusy(false);
  };
  const toggleBackup = () => onSave(ev, { filmBackedUpAt: ev.filmBackedUpAt ? null : new Date().toISOString() }, ev.filmBackedUpAt ? "הסימון בוטל" : "סומן שגובה ✓");
  const fix = pendingFix(ev);
  const last = lastFix(ev);

  return (
    <div className={`rounded-xl border bg-gradient-to-b from-[#0F1C36] to-[#0B1529] p-3 ${state === "ready" ? "border-amber-400/40" : "border-white/[0.07]"}`} data-testid="ve-row">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-sm font-semibold text-white min-w-[110px]">{ev.coupleNames || "—"}</span>
        <span className="text-xs text-gray-400">{ev.date ? format(new Date(ev.date), "d/M/yy") : ""}{ev.venue ? ` · ${ev.venue}` : ""}{videos.length ? ` · ${videos.join(", ")}` : ""}</span>
        {state === "no_raw" && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-gray-400">הגלם עוד לא נשלח ל{editor}</span>}
        {state === "editing" && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-300">אצל {editor}{ev.rawSentAt ? ` מ-${dayMonth(ev.rawSentAt)}` : ""}</span>}
        {ev.filmLink && !editing && (
          <a href={ev.filmLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline" dir="ltr">
            <ExternalLink className="w-3 h-3" />
            {shortLink(ev.filmLink)}
          </a>
        )}
        {ev.filmLinkAt && state === "ready" && <span className="text-[11px] text-gray-500">הודבק {dayMonth(ev.filmLinkAt)}</span>}
        {state === "sent" && (
          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] text-green-300">
            {ev.filmSentAt ? `נשלח לזוג ${dayMonth(ev.filmSentAt)}` : "נשלח (סומן בסטטוס עבודה)"}
          </span>
        )}
        {fix && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200" data-testid="ve-fix">
            <Wrench className="w-3 h-3" />
            {editor} סיים תיקון {fix.n} · {dayMonth(fix.at)} · {fix.newLink ? "בקישור חדש" : "באותו קישור"}
          </span>
        )}
        {fix?.note && <span className="text-[11px] text-gray-400">"{fix.note}"</span>}
        {!fix && last?.sentAt && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] text-green-300">
            <Wrench className="w-3 h-3" />
            תיקון {last.n} נשלח {dayMonth(last.sentAt)}
          </span>
        )}
        <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] ${pay.isPaid ? "bg-green-500/15 text-green-300" : "bg-white/5 text-gray-400"}`} title="לפי דף תשלומים">
          {editor}: {pay.isPaid ? `שולם${pay.paidAt ? ` ${dayMonth(pay.paidAt)}` : ""}` : "טרם שולם"}{pay.cost ? ` · ${fmt(pay.cost)}` : ""}
        </span>
      </div>

      {(state !== "sent" || ev.filmLink) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {editing ? (
            <>
              <input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveLink();
                  if (e.key === "Escape") setEditing(false);
                }}
                dir="ltr"
                placeholder="https://my-wedd.com/watch/…"
                className="h-8 min-w-[240px] flex-1 rounded border border-gray-600 bg-gray-950 px-2 text-xs text-white"
                data-testid="ve-link-input"
              />
              <button type="button" onClick={saveLink} disabled={busy} aria-label="שמירה" className="flex h-8 w-8 items-center justify-center rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => setEditing(false)} aria-label="ביטול" className="flex h-8 w-8 items-center justify-center rounded border border-gray-600 text-gray-300 hover:bg-gray-800">
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              {fix && (
                <Button size="sm" onClick={() => onSend(ev, "fix")} className="bg-purple-600 hover:bg-purple-700 text-white text-xs" data-testid="ve-send-fix">
                  <Wrench className="w-3.5 h-3.5 ml-1" />
                  שלח לזוג את התיקון
                </Button>
              )}
              {ev.filmLink && !fix && (
                <Button size="sm" onClick={() => onSend(ev)} className={state === "sent" ? "bg-gray-700 hover:bg-gray-600 text-gray-200 text-xs" : "bg-purple-600 hover:bg-purple-700 text-white text-xs"} data-testid="ve-send">
                  <Send className="w-3.5 h-3.5 ml-1" />
                  {state === "sent" ? "שליחה שוב" : "שלח לזוג"}
                </Button>
              )}
              {ev.filmLink && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={toggleBackup}
                  className={`text-xs ${ev.filmBackedUpAt ? "border-green-500/50 bg-green-500/15 text-green-300 hover:bg-green-500/25" : needsBackup(ev) ? "border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20" : "border-gray-600 bg-transparent text-gray-300 hover:bg-gray-800"}`}
                  title={ev.filmBackedUpAt ? "לחיצה מבטלת את הסימון" : "אחרי שהורדת את הסרטים למחשב וגיבית"}
                  data-testid="ve-backup"
                >
                  <HardDriveDownload className="w-3.5 h-3.5 ml-1" />
                  {ev.filmBackedUpAt ? `גובה ${dayMonth(ev.filmBackedUpAt)} ✓` : "סימון גיבוי"}
                </Button>
              )}
              {state !== "sent" && (
                <button
                  type="button"
                  onClick={() => {
                    setValue(ev.filmLink || "");
                    setEditing(true);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
                >
                  <Pencil className="w-3 h-3" />
                  {ev.filmLink ? "שינוי הלינק" : "הדבקת לינק בעצמי"}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SendFilmDialog({ ev, mode = "film", template, onClose, onSent }) {
  const [busy, setBusy] = useState(false);
  if (!ev) return null;
  const isFix = mode === "fix";
  const link = (isFix && pendingFix(ev)?.link) || ev.filmLink || "";
  const day = ev.date ? new Date(ev.date).toLocaleDateString("he-IL") : "";
  const message = renderFilmMessage(template, { link, names: ev.coupleNames || "", event_date: day, venue: ev.venue || "" }, isFix ? DEFAULT_FILM_FIX_TEMPLATE : DEFAULT_FILM_TEMPLATE);

  const send = async () => {
    setBusy(true);
    try {
      const res = await base44.functions.invoke("sendToCouple", {
        eventId: ev.id,
        coupleNames: ev.coupleNames,
        eventDate: ev.date,
        venue: ev.venue,
        phoneNumber: ev.phoneNumber,
        finalLink: link,
        template: isFix ? "film_fix" : "film",
      });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success(`${isFix ? "התיקון" : "הסרט"} נשלח ל${ev.coupleNames || "זוג"} ✅`);
      onSent(ev, mode);
    } catch (e) {
      toast.error("השליחה נכשלה: " + (e?.message || ""));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{isFix ? `שליחת הסרט המתוקן ל${ev.coupleNames || "זוג"}` : `שליחת הסרט ל${ev.coupleNames || "זוג"}`}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-gray-400">
          בוואטסאפ מהמספר של הסטודיו, ל-<span dir="ltr">{ev.phoneNumber}</span>. {isFix ? "אחרי השליחה התיקון מסומן כנשלח." : "אחרי השליחה משבצת העורך בסטטוס עבודה נצבעת בירוק."} את הנוסח משנים ב"המלל לזוג" בראש הדף.
        </p>
        {!link && <p className="text-xs text-rose-300">אין קישור לסרט — אי אפשר לשלוח.</p>}
        <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-gray-100" data-testid="ve-preview">
          {message}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy} className="border-gray-700 bg-gray-800 text-gray-300">ביטול</Button>
          <Button onClick={send} disabled={busy || !link} className="bg-purple-600 hover:bg-purple-700 text-white" data-testid="ve-send-confirm">
            {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Send className="w-4 h-4 ml-1" />}
            שליחה
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "המלל לזוג" (2026-11-06, the owner's request): the two messages that go with the link — the film and a correction —
// edited right here; the same app_settings rows as Settings ← תבניות הודעה. A preview with a sample couple.
const TEXTS = [
  { key: FILM_TEMPLATE_KEY, label: "הסרט לזוג", fallback: DEFAULT_FILM_TEMPLATE },
  { key: FILM_FIX_TEMPLATE_KEY, label: "סרט מתוקן", fallback: DEFAULT_FILM_FIX_TEMPLATE },
];
const SAMPLE = { link: "https://my-wedd.com/watch/…", names: "נועה ונועם", event_date: "22.10.2026", venue: "חוות צאן קידר" };

function TextsDialog({ templates, onClose, onSaved }) {
  const [tab, setTab] = useState(TEXTS[0].key);
  const [drafts, setDrafts] = useState(() => Object.fromEntries(TEXTS.map((t) => [t.key, templates[t.key]?.value || t.fallback])));
  const [busy, setBusy] = useState(false);
  const t = TEXTS.find((x) => x.key === tab);
  const value = drafts[tab];

  const save = async () => {
    if (!value.trim()) return toast.error("ההודעה ריקה");
    if (!value.includes("{{link}}") && !(await confirmDialog({ title: "אין {{link}} בהודעה", message: "הזוג יקבל את ההודעה בלי הקישור לסרט. לשמור בכל זאת?", confirmText: "לשמור" }))) return;
    setBusy(true);
    try {
      const id = templates[tab]?.id;
      const row = id ? await base44.entities.AppSetting.update(id, { value }) : await base44.entities.AppSetting.create({ key: tab, value });
      onSaved(tab, { id: row?.id || id, value });
      toast.success(`הנוסח של "${t.label}" נשמר`);
    } catch (e) {
      toast.error("השמירה נכשלה: " + (e?.message || ""));
    }
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-3xl" dir="rtl" data-testid="ve-texts">
        <DialogHeader>
          <DialogTitle className="text-right">המלל שנשלח לזוג עם הקישור</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          {TEXTS.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={`rounded-full border px-3 py-1 text-xs ${tab === x.key ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/15 text-gray-300 hover:border-white/30"}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-400">
          <span className="font-mono text-amber-300" dir="ltr">{"{{link}}"}</span> = הקישור לסרט ·
          <span className="font-mono text-amber-300 mx-1" dir="ltr">{"{{names}}"}</span> = שמות הזוג ·
          <span className="font-mono text-amber-300 mx-1" dir="ltr">{"{{event_date}}"}</span> = תאריך ·
          <span className="font-mono text-amber-300 mx-1" dir="ltr">{"{{venue}}"}</span> = אולם
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <textarea
            value={value}
            onChange={(e) => setDrafts((d) => ({ ...d, [tab]: e.target.value }))}
            rows={14}
            className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm leading-relaxed text-white"
            data-testid="ve-texts-input"
          />
          <div>
            <p className="mb-1 text-xs text-gray-500">כך זה ייראה (זוג לדוגמה):</p>
            <div className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-gray-100" data-testid="ve-texts-preview">
              {renderFilmMessage(value, SAMPLE, t.fallback)}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2 sm:justify-between">
          <button type="button" onClick={() => setDrafts((d) => ({ ...d, [tab]: t.fallback }))} className="text-xs text-gray-400 hover:text-white">
            {tab === FILM_TEMPLATE_KEY ? "חזרה למלל המקורי של העורך" : "חזרה לנוסח ההתחלתי"}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy} className="border-gray-700 bg-gray-800 text-gray-300">סגירה</Button>
            <Button onClick={save} disabled={busy} className="bg-amber-400 hover:bg-amber-300 text-gray-900" data-testid="ve-texts-save">
              {busy ? <Loader2 className="w-4 h-4 ml-1 animate-spin" /> : <Check className="w-4 h-4 ml-1" />}
              שמירה
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
