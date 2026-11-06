import React, { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Check, Clock, ExternalLink, HardDriveDownload, Loader2, LogOut, Pencil, Scissors } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { cleanFilmLink, dayMonth, editorPayOf, filmStateOf } from "@/lib/videoEditing";

// The video editor's own page (2026-11-06, the owner's request) — public, /editor. He signs in with his phone and the
// password the owner set (Settings ← אנשי צוות), sees only his weddings, and pastes each final film's link; the owner
// sends it to the couple from "עריכת וידאו". Every request goes through the editor-portal Edge Function with the
// sign-in token kept in this browser — he has no user in the system and reaches nothing else.

const TOKEN_KEY = "avira_editor_portal_token";
const fmt = (n) => `₪${Math.round(Number(n) || 0).toLocaleString()}`;
const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
};
const writeToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private window — he signs in again next time */
  }
};
const call = (payload) => base44.functions.invoke("editorPortal", payload).then((r) => r?.data || {});

const TABS = [
  { key: "work", label: "לעבודה", test: (e) => ["editing", "no_raw"].includes(filmStateOf(e)) },
  { key: "ready", label: "ממתין לשליחה", test: (e) => filmStateOf(e) === "ready" },
  { key: "sent", label: "נשלחו", test: (e) => filmStateOf(e) === "sent" },
];

export default function EditorPortal() {
  const [token, setToken] = useState(readToken);
  const [name, setName] = useState("");
  const [events, setEvents] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("work");

  const signOut = (msg = "") => {
    writeToken("");
    setToken("");
    setEvents(null);
    setError(msg);
  };

  useEffect(() => {
    if (!token) return;
    let alive = true;
    call({ action: "list", token })
      .then((d) => {
        if (!alive) return;
        if (d.relogin) return signOut("צריך להתחבר שוב");
        setName(d.name || "");
        setEvents(d.events || []);
      })
      .catch((e) => alive && setError(e?.message || "שגיאה בטעינה"));
    return () => {
      alive = false;
    };
  }, [token]);

  if (!token) {
    return (
      <Shell>
        <LoginForm
          initialError={error}
          onIn={(t, n) => {
            writeToken(t);
            setName(n);
            setError("");
            setToken(t);
          }}
        />
      </Shell>
    );
  }

  const counts = Object.fromEntries(TABS.map((t) => [t.key, (events || []).filter(t.test).length]));
  const rows = (events || []).filter(TABS.find((t) => t.key === tab).test);
  const ordered = tab === "sent" ? rows : [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            <Scissors className="h-5 w-5 text-amber-400" />
            {name ? `שלום ${name}` : "עריכת וידאו"}
          </h1>
          <p className="mt-0.5 text-xs text-slate-400">מדביקים כאן את הלינק של הסרט הסופי — והסטודיו שולח לזוג.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            call({ action: "logout", token }).catch(() => {});
            signOut();
          }}
          className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          <LogOut className="h-3.5 w-3.5" />
          התנתקות
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-full border px-3 py-1 text-xs ${tab === t.key ? "border-amber-400/60 bg-amber-400/15 text-amber-100" : "border-white/15 text-slate-300 hover:border-white/30"}`}
            data-testid={`ep-tab-${t.key}`}
          >
            {t.label} {counts[t.key]}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
      {events === null ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : ordered.length === 0 ? (
        <p className="py-12 text-center text-sm text-slate-500">{tab === "work" ? "אין כרגע אירועים שמחכים לעריכה" : tab === "ready" ? "אין סרטים שמחכים לשליחה" : "עוד אין כאן סרטים"}</p>
      ) : (
        <div className="space-y-2">
          {ordered.map((ev) => (
            <EventCard
              key={ev.id}
              ev={ev}
              token={token}
              onChange={(next) => setEvents((prev) => prev.map((e) => (e.id === next.id ? next : e)))}
              onRelogin={() => signOut("צריך להתחבר שוב")}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-[#070F1F] text-slate-100" dir="rtl">
      <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">{children}</div>
    </div>
  );
}

function LoginForm({ onIn, initialError }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError || "");

  const submit = async (e) => {
    e.preventDefault();
    if (!phone.trim() || !password) return setError("מספר טלפון וסיסמה");
    setBusy(true);
    setError("");
    try {
      const d = await call({ action: "login", phone, password });
      if (d.token) onIn(d.token, d.name);
      else setError(d.error || "הכניסה נכשלה");
    } catch (err) {
      setError(err?.message || "הכניסה נכשלה");
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-10 max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0B1529] p-6" data-testid="ep-login">
      <div className="text-center">
        <Scissors className="mx-auto h-8 w-8 text-amber-400" />
        <h1 className="mt-2 text-lg font-bold text-white">כניסת עורך וידאו</h1>
        <p className="text-xs text-slate-400">אווירה סטודיו</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">מספר טלפון</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="username"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          placeholder="05X-XXXXXXX"
          className="h-10 w-full rounded-lg border border-white/15 bg-[#070F1F] px-3 text-white"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-sm text-slate-300">סיסמה</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          dir="ltr"
          className="h-10 w-full rounded-lg border border-white/15 bg-[#070F1F] px-3 text-white"
        />
      </label>
      {error && <p className="text-sm text-rose-300">{error}</p>}
      <button type="submit" disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-amber-400 font-semibold text-gray-900 hover:bg-amber-300 disabled:opacity-60">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        כניסה
      </button>
    </form>
  );
}

function EventCard({ ev, token, onChange, onRelogin }) {
  const state = filmStateOf(ev);
  const pay = editorPayOf(ev);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(ev.filmLink || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = state === "editing" || state === "no_raw";
  const showInput = open || editing; // also before the raw link is in the system — it may have come another way
  const dateLabel = useMemo(() => (ev.date ? format(new Date(ev.date), "d/M/yy") : ""), [ev.date]);

  const save = async () => {
    const link = value.trim() ? cleanFilmLink(value) : "";
    if (value.trim() && !link) return setError("זה לא נראה כמו לינק — צריך להתחיל ב-https://");
    setBusy(true);
    setError("");
    try {
      const d = await call({ action: "set_link", token, eventId: ev.id, link });
      if (d.relogin) return onRelogin();
      if (d.event) {
        onChange(d.event);
        setEditing(false);
      } else setError(d.error || "השמירה נכשלה");
    } catch (e) {
      setError(e?.message || "השמירה נכשלה");
    }
    setBusy(false);
  };

  return (
    <div className={`rounded-xl border bg-[#0B1529] p-3 ${state === "ready" ? "border-amber-400/40" : "border-white/[0.08]"}`} data-testid="ep-event">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="min-w-[110px] text-sm font-semibold text-white">{ev.coupleNames || "—"}</span>
        <span className="text-xs text-slate-400">{dateLabel}{ev.venue ? ` · ${ev.venue}` : ""}</span>
        {ev.videographers?.map((v) => (
          <span key={v.label} className="text-xs text-slate-400">{v.label}: {v.name}</span>
        ))}
        <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] ${pay.isPaid ? "bg-green-500/15 text-green-300" : "bg-white/5 text-slate-400"}`} data-testid="ep-pay">
          {pay.isPaid ? `שולם${pay.paidAt ? ` ${dayMonth(pay.paidAt)}` : ""}` : "טרם שולם"}{pay.cost ? ` · ${fmt(pay.cost)}` : ""}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {ev.rawLink ? (
          <a href={ev.rawLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 px-2 py-0.5 text-sky-300 hover:bg-sky-400/10">
            <ExternalLink className="h-3 w-3" />
            חומרי הגלם
          </a>
        ) : (
          state !== "sent" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-slate-400">
              <Clock className="h-3 w-3" />
              הגלם עוד לא הגיע
            </span>
          )
        )}
        {state === "ready" && !editing && (
          <>
            <a href={ev.filmLink} target="_blank" rel="noreferrer" className="max-w-[220px] truncate text-sky-300 hover:underline" dir="ltr">{ev.filmLink}</a>
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-200">ממתין לשליחה לזוג</span>
            <button
              type="button"
              onClick={() => {
                setValue(ev.filmLink || "");
                setEditing(true);
              }}
              className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
            >
              <Pencil className="h-3 w-3" />
              שינוי
            </button>
          </>
        )}
        {state === "sent" && (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-green-300">
              <Check className="h-3 w-3" />
              {ev.filmSentAt ? `נשלח לזוג ${dayMonth(ev.filmSentAt)}` : "נשלח לזוג"}
            </span>
            {ev.filmBackedUpAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-green-300" data-testid="ep-backed">
                <HardDriveDownload className="h-3 w-3" />
                הסטודיו גיבה
              </span>
            )}
          </>
        )}
      </div>

      {showInput && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && save()}
            dir="ltr"
            placeholder="הדבק כאן את הלינק של הסרט הסופי"
            className="h-9 min-w-[220px] flex-1 rounded-lg border border-white/15 bg-[#070F1F] px-3 text-sm text-white placeholder:text-right placeholder:text-slate-500"
            data-testid="ep-link-input"
          />
          <button type="button" onClick={save} disabled={busy} className="flex h-9 items-center gap-1 rounded-lg bg-amber-400 px-3 text-sm font-semibold text-gray-900 hover:bg-amber-300 disabled:opacity-60" data-testid="ep-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            שמירה
          </button>
          {editing && (
            <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-lg border border-white/15 px-3 text-sm text-slate-300 hover:bg-white/5">
              ביטול
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
