import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FILMS_BASE_URL, filmsApi, filmsConfigured } from "@/lib/filmsApi";
import { galleryKindOfPath } from "@/lib/galleryRoutes";
import { useAuth } from "@/lib/SupabaseAuthContext";
import FilmsNotConfigured from "@/components/films/FilmsNotConfigured";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/lib/confirmDialog";

// Gallery settings (/photos/settings and /films/settings, shared): default access days, the terms couples accept,
// the closed-gallery contact line, the studio's address in couple links, and the
// studio's own Dropbox connection, and (photo galleries) the slideshow songs. Name/logo/
// Instagram come from Studio Details.

const inputCls = "bg-gray-800 border-gray-700 text-white";

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

// The disconnect question, with what stops (the Worker's /api/admin/dropbox/impact; null = could not be counted).
function disconnectQuestion(impact) {
  const lines = ["לנתק את חשבון הדרופבוקס?", ""];
  if (impact) {
    const n = (count, one, many) => (count === 1 ? one : `${count} ${many}`);
    const parts = [];
    if (impact.photoGalleries) parts.push(n(impact.photoGalleries, "גלריית תמונות פתוחה אחת", "גלריות תמונות פתוחות"));
    if (impact.films) parts.push(`${n(impact.films, "סרט אחד", "סרטים")} ב${n(impact.filmGalleries, "גלריה פתוחה אחת", "גלריות פתוחות")}`);
    if (impact.studioFilms) parts.push(`${n(impact.studioFilms, "סרט אחד", "סרטים")} בדף הסטודיו`);
    lines.push(parts.length ? `יפסיקו לעבוד עד שתתחברו שוב: ${parts.join(", ")}.` : "אין כרגע גלריות פתוחות או סרטים שתלויים בחיבור.");
  } else {
    lines.push("לא הצלחנו לספור מה תלוי בחיבור. גלריות מתיקיות בדרופבוקס שלכם יפסיקו לעבוד עד שתתחברו שוב.");
  }
  lines.push("", "הגישה של המערכת תבוטל גם אצל דרופבוקס. קישורים ציבוריים שכבר שיתפתם מדרופבוקס לא משתנים.");
  return lines.join("\n");
}

export default function FilmsSettings() {
  const { hasModule, user } = useAuth();
  // Opened from "גלריות" (/photos/settings) or "סרטים" (/films/settings): the same shared settings, plus the
  // slideshow songs under "גלריות".
  const scope = galleryKindOfPath(useLocation().pathname);
  // "Disconnect every access" (P73): the owner and admins only, like gallery passwords (D12).
  const canRevoke = user?.role === "owner" || user?.role === "admin";
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    if (!filmsConfigured()) return;
    filmsApi("GET", "/api/admin/settings").then(setS).catch((e) => setError(e.message));
  }, []);

  // Back from Dropbox: finish the connection as the signed-in admin (the films
  // Worker checks it is the same studio and person who started it), then drop
  // the one-time code from the address bar.
  useEffect(() => {
    const code = params.get("dropbox_code");
    const state = params.get("dropbox_state");
    if (params.get("dropbox") === "error") setError("חיבור הדרופבוקס לא הצליח. נסו שוב.");
    if (!code || !state || !filmsConfigured()) return;
    setParams({}, { replace: true });
    setBusy("dropbox");
    filmsApi("POST", "/api/admin/dropbox/finish", { code, state })
      .then((next) => {
        setS(next);
        toast.success("דרופבוקס חובר בהצלחה");
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(""));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!filmsConfigured()) return <FilmsNotConfigured />;
  if (!s) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        {error ? <p className="text-red-400">{error}</p> : <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />}
      </div>
    );
  }

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setBusy("save");
    try {
      const next = await filmsApi("PUT", "/api/admin/settings", {
        defaultDays: s.defaultDays,
        termsText: s.termsText,
        contactLine: s.contactLine,
        slug: s.slug,
      });
      setS(next);
      toast.success("ההגדרות נשמרו");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const connect = async () => {
    setError("");
    setBusy("dropbox");
    try {
      const { url } = await filmsApi("GET", "/api/admin/dropbox/connect");
      window.location.assign(url);
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  };

  const revokeAll = async () => {
    if (
      !(await confirmDialog(
        "לנתק את כל הגישות לגלריות?\n\nכל מי שהקליד סיסמה או קוד הורדה בגלריה כלשהי של הסטודיו יצטרך להקליד אותם שוב, וכל קישור 'פתיחה כמו הזוג' שנפתח עד עכשיו יפסיק לעבוד. הקישורים לזוגות ולאורחים עצמם לא משתנים. מסכי גלריות פתוחים אצל הצוות צריכים רענון.",
      ))
    )
      return;
    setError("");
    setBusy("revoke");
    try {
      await filmsApi("POST", "/api/admin/access/revoke");
      toast.success("כל הגישות נותקו");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  // Before a disconnect the studio sees what stops (fix plan P65): open photo galleries and films that play only
  // through this connection. The connection is also ended at Dropbox itself.
  const disconnect = async () => {
    setError("");
    let impact = null;
    try {
      impact = await filmsApi("GET", "/api/admin/dropbox/impact");
    } catch {
      impact = null;
    }
    if (!(await confirmDialog(disconnectQuestion(impact)))) return;
    try {
      setS(await filmsApi("POST", "/api/admin/dropbox/disconnect"));
      toast.success("חשבון הדרופבוקס נותק");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <form className="max-w-3xl mx-auto space-y-5" onSubmit={save}>
        <h1 className="text-2xl font-bold text-white">{scope === "photos" ? "הגדרות גלריות" : "הגדרות סרטים"}</h1>
        {hasModule("films") && (
          <p className="text-sm text-gray-400" data-testid="settings-shared-note">
            ההגדרות כאן משותפות לגלריות ולסרטים: שינוי במסך הזה משנה גם ב{scope === "photos" ? "הגדרות הסרטים" : "הגדרות הגלריות"}.
          </p>
        )}
        <p className="text-sm text-gray-400">
          השם, הלוגו, הצבע והאינסטגרם שהזוגות רואים נלקחים מ
          <Link to="/Settings" className="text-brand-400 hover:underline mx-1">
            הגדרות ← פרטי הסטודיו
          </Link>
          .
        </p>

        <Section title="גלריות">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-gray-300">ימי גישה כברירת מחדל לגלריה חדשה</Label>
              <Input type="number" min={1} max={3650} value={s.defaultDays} onChange={(e) => setS({ ...s, defaultDays: Number(e.target.value) })} className={inputCls} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-300">הכתובת שלכם בקישור לזוג (באנגלית, בלי רווחים)</Label>
              <Input
                value={s.slug}
                onChange={(e) => setS({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
                dir="ltr"
                className={inputCls}
              />
              <p className="text-xs text-gray-500" dir="ltr">
                {FILMS_BASE_URL}/<b>{s.slug || "…"}</b>/a1b2c3d4…
              </p>
            </div>
          </div>
          <p className="text-xs text-gray-500" data-testid="slug-hint">
            שינוי הכתובת משנה את הקישורים שתעתיקו מעכשיו. קישורים לגלריות שכבר נשלחו ממשיכים לעבוד ועוברים לכתובת החדשה. עמוד הסטודיו בכתובת
            הישנה מפנה לחדשה, והכתובת הישנה שמורה לכם שנה; אחרי שנה סטודיו אחר יכול לקחת אותה. אפשר לשנות את הכתובת עד 3 פעמים ב-30 יום.
          </p>
          <div className="space-y-1.5">
            <Label className="text-gray-300">התקנון שהזוג מאשר בכניסה לגלריה</Label>
            <Textarea value={s.termsText} onChange={(e) => setS({ ...s, termsText: e.target.value })} className={`${inputCls} min-h-[160px]`} />
            <p className="text-xs text-gray-500">ריקון השדה ושמירה מחזירים את נוסח ברירת המחדל.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-gray-300">שורת קשר (מוצגת כשהגלריה נסגרה)</Label>
            <Input value={s.contactLine} onChange={(e) => setS({ ...s, contactLine: e.target.value })} placeholder="לשחזור הגישה אפשר לפנות אלינו בוואטסאפ 050-0000000" className={inputCls} />
          </div>
        </Section>

        <Section title="חיבור לדרופבוקס">
          {s.dropbox.connected ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-2 text-green-400">
                <CheckCircle2 className="w-4 h-4" />
                מחובר{s.dropbox.accountName ? ` (${s.dropbox.accountName})` : ""}
              </span>
              <Button type="button" size="sm" variant="destructive" onClick={disconnect} data-testid="dropbox-disconnect">
                ניתוק
              </Button>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-400">
                {hasModule("films")
                  ? "החיבור מאפשר להדביק קישור לתיקייה שלמה ולקבל את כל הסרטים אוטומטית, גם מתיקיות משותפות של אחרים. בלי חיבור אפשר להוסיף סרטים לפי קישור לכל קובץ."
                  : "החיבור מאפשר להדביק קישור לתיקייה בדרופבוקס ולקבל את כל התמונות שבה אוטומטית, גם מתיקיות משותפות של אחרים."}
              </p>
              {s.dropbox.appConfigured ? (
                <Button type="button" onClick={connect} disabled={busy === "dropbox"} className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
                  {busy === "dropbox" ? <Loader2 className="w-4 h-4 animate-spin" /> : "חיבור דרופבוקס"}
                </Button>
              ) : (
                <p className="text-amber-400 text-sm">חיבור דרופבוקס עדיין לא זמין במערכת.</p>
              )}
            </>
          )}
          {!s.google.hasKey && (
            <p className="text-xs text-gray-500">
              {hasModule("films") ? "צפייה בסרטים מגוגל דרייב עדיין לא זמינה במערכת; הם יוצגו להורדה בלבד." : "גלריות מגוגל דרייב עובדות גם בלי מפתח גוגל בשרת הגלריות, אבל דרך כתובות לא רשמיות של גוגל — עם מפתח זה יציב יותר."}
            </p>
          )}
        </Section>

        {scope === "photos" && hasModule("photos") && <Songs s={s} onChange={setS} />}

        {canRevoke && (
          <Section title="ניתוק כל הגישות">
            <p className="text-sm text-gray-400">
              אם קישור 'פתיחה כמו הזוג' הגיע למי שלא צריך, או שעובד עזב: הכפתור מנתק בבת אחת את כל מי שנכנס לגלריות עם סיסמה, קוד הורדה או קישור
              של הסטודיו. אחרי הניתוק הזוגות והאורחים מקלידים שוב את הסיסמה, והצוות פותח את הגלריות מחדש מהמערכת. כדי להחליף קישור אורחים שדלף, יש
              כפתור בדף הגלריה עצמה.
            </p>
            <Button type="button" variant="destructive" onClick={revokeAll} disabled={busy === "revoke"} data-testid="revoke-all">
              {busy === "revoke" ? <Loader2 className="w-4 h-4 animate-spin" /> : "נתק את כל הגישות"}
            </Button>
          </Section>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
        <Button disabled={busy === "save"} className="bg-brand-400 hover:bg-brand-500 text-brand-fg font-semibold px-6">
          {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמירת הגדרות"}
        </Button>
      </form>
    </div>
  );
}

/** Up to 3 songs for the photo slideshow; one is the default for every photo gallery. */
function Songs({ s, onChange }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const music = s.music || [];
  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await filmsApi("POST", "/api/admin/music", undefined, { blob: file, type: file.type || "audio/mpeg", fileName: file.name }));
      toast.success("השיר נוסף");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const remove = async (t) => {
    if (!(await confirmDialog(`למחוק את השיר "${t.name}"?`))) return;
    try {
      onChange(await filmsApi("DELETE", `/api/admin/music/${t.id}`));
    } catch (e) {
      toast.error(e.message);
    }
  };
  const setDefault = async (id) => {
    try {
      onChange(await filmsApi("PUT", "/api/admin/settings", { musicDefault: id }));
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <Section title="שירים למצגת (גלריות תמונות)">
      <p className="text-sm text-gray-400">עד 3 שירים (MP3 או M4A, עד 10MB). השיר המסומן מתנגן במצגת של כל גלריית תמונות, ובכל גלריה אפשר לבחור שיר אחר או מצגת שקטה.</p>
      {music.length > 0 && (
        <ul className="space-y-2" data-testid="songs">
          {music.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2">
              <label className="flex items-center gap-2 text-sm text-white cursor-pointer">
                <input type="radio" name="music-default" checked={s.musicDefault === t.id} onChange={() => setDefault(t.id)} />
                {t.name}
              </label>
              <span className="text-xs text-gray-500">{(t.size / 1024 / 1024).toFixed(1)}MB</span>
              {s.musicDefault === t.id && <span className="text-xs text-brand-300">ברירת המחדל</span>}
              <button type="button" onClick={() => remove(t)} className="mr-auto text-sm text-red-400 hover:text-red-300">
                מחיקה
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a" className="hidden" onChange={(e) => upload(e.target.files?.[0])} data-testid="song-file" />
      <Button type="button" variant="outline" disabled={busy || music.length >= 3} onClick={() => input.current?.click()} className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : music.length >= 3 ? "יש כבר 3 שירים" : "הוספת שיר"}
      </Button>
    </Section>
  );
}
