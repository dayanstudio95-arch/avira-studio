import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sortByTag } from "@films-shared/dropbox";
import { detectLink, PROVIDER_NAMES } from "@films-shared/providers";
import { parseEventLine } from "@films-shared/event";
import { withAmpersand } from "@films-shared/names";
import { galleryHome, galleryKindOfPath, galleryPath } from "@/lib/galleryRoutes";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { supabase } from "@/api/supabaseClient";
import { coupleLink, copyText, coverUrl, filmsApi, filmsConfigured, studioPreviewLink } from "@/lib/filmsApi";
import { compressImageForThumb } from "@/lib/imageCompress";
import FilmsEditor from "@/components/films/FilmsEditor";
import PhotosEditor from "@/components/films/PhotosEditor";
import DesignEditor from "@/components/films/DesignEditor";
import FilmsNotConfigured from "@/components/films/FilmsNotConfigured";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateShort, formatDateTime, israelToday } from "@/lib/dates";
import { confirmDialog } from "@/lib/confirmDialog";

// Create / edit one couple's gallery (/films/new, /films/:id): films or photos. Ported from
// the films app's admin: folder loading fills names/date/venue from the folder name,
// film titles lose the couple's name prefix, covers are shrunk in the browser. A photo
// gallery's photos are organized in PhotosEditor, below the form.

const todayIso = () => israelToday(); // fix plan P28: Israel's today, not UTC's

// Israel time, e.g. "26/9/2026 21:40" (one format since fix plan P28).
const formatWhen = (iso) => formatDateTime(iso);

function Section({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-gray-300">{label}</Label>
      {children}
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

const inputCls = "bg-gray-800 border-gray-700 text-white";

// The event search (an ilike pattern): % * and \ become "_" (one character), so typing them never matches everything.
const cleanEventSearch = (text) => String(text || "").replace(/[%*\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);

/**
 * The studio's event this gallery belongs to (crm studios; fix plan P57): the couple's album order then joins the
 * order the studio opened for that wedding instead of making a second one. The films Worker checks the event is
 * this studio's.
 */
function EventPicker({ eventId, label, onPick }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(cleanEventSearch(search)), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (!query) {
      setFound([]);
      return;
    }
    let live = true;
    supabase
      .from("events")
      .select("id, couple_names, date")
      .ilike("couple_names", `%${query}%`)
      .order("date", { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (live && !error) setFound(data || []);
      });
    return () => {
      live = false;
    };
  }, [query]);
  return (
    <div className="space-y-2" data-testid="gallery-event">
      {eventId ? (
        <div className="flex items-center gap-2 text-sm text-gray-200">
          <span data-testid="gallery-event-label">{label || "אירוע מקושר"}</span>
          <button type="button" className="text-gray-400 hover:underline" onClick={() => onPick("", "")} data-testid="gallery-event-clear">
            ביטול הקישור
          </button>
        </div>
      ) : (
        <>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם הזוג" className={inputCls} data-testid="gallery-event-search" />
          {found.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-800 p-1">
              {found.map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="block w-full rounded p-1.5 text-right text-sm text-gray-300 hover:bg-gray-800"
                  onClick={() => {
                    onPick(ev.id, `${ev.couple_names || ""}${ev.date ? ` · ${formatDateShort(ev.date)}` : ""}`);
                    setSearch("");
                  }}
                  data-testid="gallery-event-option"
                >
                  {ev.couple_names} {ev.date ? `· ${formatDateShort(ev.date)}` : ""}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function FilmsGalleryForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant, hasModule, user } = useAuth();
  // Gallery passwords and download codes: the owner and admins only (D12); others see whether they exist.
  const seesSecrets = user?.role === "owner" || user?.role === "admin";
  const slug = tenant?.slug;
  const canFilms = hasModule("films");
  const canPhotos = hasModule("photos");
  // Galleries are linked to the studio's events only where there are events and album orders (the crm module).
  const canEvents = hasModule("crm");
  // The kind comes from the menu the page was opened from: /photos/... or /films/... (an old /films/new?kind=photos too).
  const [kind, setKind] = useState(() => {
    const asked = new URLSearchParams(location.search).get("kind");
    const fromPath = asked === "photos" ? "photos" : galleryKindOfPath(location.pathname);
    if (fromPath === "photos") return canPhotos || !canFilms ? "photos" : "films";
    return canFilms || !canPhotos ? "films" : "photos";
  });
  // A new gallery is shown under its own menu (an old /films/new?kind=photos, or a studio with only the other module).
  useEffect(() => {
    if (isNew && galleryKindOfPath(location.pathname) !== kind) navigate(`${galleryHome(kind)}/new`, { replace: true });
  }, [isNew, kind, location.pathname, navigate]);
  const [photoFolder, setPhotoFolder] = useState("");
  const [music, setMusic] = useState("");
  const [password, setPassword] = useState("");
  const [downloadPin, setDownloadPin] = useState("");
  const [songs, setSongs] = useState({ list: [], defaultId: "" });
  const [others, setOthers] = useState([]);

  const [coupleName, setCoupleName] = useState("");
  // "X וY" → "X & Y": offered under the field; the studio takes it or keeps the name as typed (P72, D15).
  const [ampDeclined, setAmpDeclined] = useState("");
  const [studioName, setStudioName] = useState("");
  const [venue, setVenue] = useState("");
  const [dateTouched, setDateTouched] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [days, setDays] = useState(30);
  // The days go to the Worker only when edited (or for a new gallery): a form sent back never reopens a gallery
  // that was closed or extended meanwhile (P71).
  const [daysTouched, setDaysTouched] = useState(false);
  // The gallery's event (P57); sent only when the studio changed it.
  const [eventId, setEventId] = useState("");
  const [eventLabel, setEventLabel] = useState("");
  const [eventTouched, setEventTouched] = useState(false);
  const [folderUrl, setFolderUrl] = useState("");
  const [films, setFilms] = useState([]);
  const [cover, setCover] = useState("");
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [singleUrl, setSingleUrl] = useState("");
  const [gallery, setGallery] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(isNew);
  const fileInput = useRef(null);
  // A new gallery made by an earlier click whose cover then failed: "save" again updates it (P71), never a second one.
  const created = useRef(null);
  const folderLink = folderUrl.trim() ? detectLink(folderUrl) : null;
  const singleLink = singleUrl.trim() ? detectLink(singleUrl) : null;
  const defaultStudio = tenant?.display_name_to_clients || tenant?.name || "";
  const ampCandidate = withAmpersand(coupleName);
  const ampSuggestion = ampCandidate !== coupleName.replace(/\s+/g, " ").trim() && coupleName !== ampDeclined ? ampCandidate : "";

  useEffect(() => {
    if (!filmsConfigured()) return;
    filmsApi("GET", "/api/admin/settings")
      .then((s) => {
        if (isNew) setDays(s.defaultDays);
        setSongs({ list: s.music || [], defaultId: s.musicDefault || "" });
      })
      .catch(() => {});
    if (isNew) return;
    filmsApi("GET", `/api/admin/galleries/${id}`)
      .then((g) => {
        setGallery(g);
        setCoupleName(g.coupleName);
        setStudioName(g.studioName || "");
        setVenue(g.venue || "");
        setDateTouched(true);
        setDate(g.date || todayIso());
        setDays(g.days);
        setFolderUrl(g.folderUrl || "");
        setFilms(g.films);
        setCover(g.hasCover ? coverUrl(g.id, Date.now(), g.previewToken) : "");
        setKind(g.kind === "photos" ? "photos" : "films");
        setMusic(g.music || "");
        setEventId(g.eventId || "");
        if (g.eventId) {
          supabase
            .from("events")
            .select("id, couple_names, date")
            .eq("id", g.eventId)
            .maybeSingle()
            .then(({ data }) => data && setEventLabel(`${data.couple_names || ""}${data.date ? ` · ${formatDateShort(data.date)}` : ""}`));
        }
        setPassword(g.password || "");
        setDownloadPin(g.downloadPin || "");
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
    // The couple's gallery of the other kind can be linked (films ↔ photos): a few fields of every gallery (P70).
    filmsApi("GET", "/api/admin/galleries/options")
      .then(setOthers)
      .catch(() => {});
  }, [id, isNew]);

  // An old /films/<id> link to a photo gallery (or the other way round): show it under its own menu.
  useEffect(() => {
    if (gallery?.id && galleryKindOfPath(location.pathname) !== (gallery.kind === "photos" ? "photos" : "films")) {
      navigate(galleryPath(gallery), { replace: true });
    }
  }, [gallery, location.pathname, navigate]);

  if (!filmsConfigured()) return <FilmsNotConfigured />;

  const loadFolder = async () => {
    setError("");
    setBusy("folder");
    try {
      const r = await filmsApi("POST", "/api/admin/resolve-folder", { url: folderUrl });
      // "רוני ורז - 11.8.26 - אלה" → couple, date, venue. Only empty fields are filled.
      const parsed = parseEventLine(r.folderName);
      // As the folder spells it; the form offers "X & Y" below the field (P72: a suggestion, not automatic).
      const guessedName = parsed.coupleName;
      const name = coupleName || guessedName;
      if (!coupleName && guessedName) setCoupleName(guessedName);
      if (!dateTouched && parsed.date) setDate(parsed.date);
      if (!venue && parsed.venue) setVenue(parsed.venue);
      // "רוני ורז - הייליטס" → "הייליטס": the couple's name is already on the screen.
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const variants = [...new Set([name, parsed.coupleName, withAmpersand(name)].filter(Boolean))].map(esc);
      const prefix = new RegExp(`^(?:${variants.join("|") || "(?!)"})\\s*[-–:]\\s*`);
      setFilms(sortByTag(r.films.map((f) => ({ ...f, title: name ? f.title.replace(prefix, "") || f.title : f.title }))));
      toast.success(`נמצאו ${r.films.length} סרטים בתיקייה "${r.folderName}"`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const addSingle = async () => {
    setError("");
    setBusy("single");
    try {
      const f = await filmsApi("POST", "/api/admin/check-link", { url: singleUrl });
      setFilms((list) => [...list, f]);
      setSingleUrl("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  // A new guests' link (P73): the old one stops working at once; the couple's link stays.
  const rotateGuest = async () => {
    if (!(await confirmDialog("להחליף את הקישור לאורחים?\n\nהקישור הנוכחי יפסיק לעבוד מיד, גם אצל מי שכבר קיבל אותו. הקישור של הזוג לא משתנה. את הקישור החדש צריך לשלוח שוב למי שצריך."))) return;
    setError("");
    setBusy("guest");
    try {
      const r = await filmsApi("POST", `/api/admin/galleries/${gallery.id}/rotate-guest`);
      setGallery((prev) => ({ ...prev, guestId: r.guestId }));
      toast.success("נוצר קישור חדש לאורחים");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  const pickCover = async (file) => {
    if (!file) return;
    try {
      const blob = await compressImageForThumb(file, { maxDimension: 2000, quality: 0.86 });
      setCoverFile(blob);
      setCoverPreview(URL.createObjectURL(blob));
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    setError("");
    setBusy("save");
    try {
      const details = {
        coupleName,
        studioName,
        date,
        venue,
        ...(isNew || daysTouched ? { days } : {}),
        ...(seesSecrets ? { password, downloadPin } : {}),
        ...(canEvents && eventTouched ? { eventId } : {}),
      };
      // A photo gallery's folder and photos are saved by the photo tools, not here.
      const body = kind === "photos" ? { ...details, music } : { ...details, folderUrl, films };
      const madeBefore = created.current;
      const existing = id || madeBefore;
      const g = existing ? await filmsApi("PUT", `/api/admin/galleries/${existing}`, body) : await filmsApi("POST", "/api/admin/galleries", { ...body, kind });
      if (isNew) created.current = g.id;
      if (isNew && !madeBefore && kind === "photos" && photoFolder.trim()) {
        try {
          const d = await filmsApi("POST", `/api/admin/galleries/${g.id}/photos/load`, { url: photoFolder });
          toast.success(`נטענו ${d.items.length.toLocaleString("he-IL")} תמונות`);
        } catch (loadErr) {
          toast.error(loadErr.message);
        }
      }
      if (coverFile) {
        try {
          await filmsApi("POST", `/api/admin/galleries/${g.id}/cover`, undefined, { blob: coverFile, type: "image/jpeg" });
        } catch {
          // The gallery is saved; the cover is kept in the form, so "save" again sends it (and updates this gallery).
          setError(isNew ? "הגלריה נוצרה אבל השער נכשל — לחצו שמירה שוב" : "הפרטים נשמרו אבל השער נכשל — לחצו שמירה שוב");
          if (!isNew) setGallery((prev) => ({ ...g, terms: prev?.terms, previewToken: prev?.previewToken }));
          return;
        }
        setCoverFile(null);
      }
      toast.success(isNew ? "הגלריה נוצרה" : "נשמר");
      if (isNew) navigate(galleryPath({ ...g, kind }), { replace: true });
      else {
        setGallery((prev) => ({ ...g, terms: prev?.terms, previewToken: prev?.previewToken }));
        if (coverFile) setCover(coverUrl(g.id, Date.now(), gallery?.previewToken));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  };

  if (!loaded) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        {error ? <p className="text-red-400">{error}</p> : <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />}
      </div>
    );
  }

  const link = gallery ? coupleLink(slug, gallery.id) : "";
  // "Open as the couple" skips the password and the download code (a 12-hour studio pass).
  const previewLink = gallery ? studioPreviewLink(slug, gallery.id, gallery.previewToken) : "";
  const guestLink = gallery?.guestId ? coupleLink(slug, gallery.guestId) : "";

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <form className="max-w-4xl mx-auto space-y-5" onSubmit={save}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-white">{isNew ? (kind === "photos" ? "גלריית תמונות חדשה" : "גלריית סרטים חדשה") : coupleName || "עריכת גלריה"}</h1>
          {gallery && (
            <div className="flex gap-2">
              <Button type="button" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyText(link).then((ok) => ok && toast.success("הקישור הועתק"))}>
                <Copy className="w-4 h-4 ml-2" />
                העתקת קישור לזוג
              </Button>
              <Button asChild variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
                <a href={previewLink} target="_blank" rel="noopener noreferrer" data-testid="open-as-couple">
                  <ExternalLink className="w-4 h-4 ml-2" />
                  פתיחה כמו הזוג
                </a>
              </Button>
            </div>
          )}
        </div>

        {gallery && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-2 text-sm text-gray-300" dir="ltr">
            {link}
          </div>
        )}
        {gallery?.terms && (
          <p className="text-sm text-gray-400" data-testid="terms-accepted">
            {gallery.terms.count > 0
              ? `הזוג אישר את התנאים ב-${formatWhen(gallery.terms.first)}${gallery.terms.count > 1 ? ` (${gallery.terms.count} אישורים, האחרון ב-${formatWhen(gallery.terms.last)})` : ""}`
              : "הזוג עוד לא אישר את התנאים."}
            {/* Guests accept through their own link; records from before didn't say who accepted. */}
            {gallery.terms.guests > 0 && ` אורחים אישרו ${gallery.terms.guests} פעמים.`}
            {gallery.terms.unknown > 0 && ` ${gallery.terms.unknown} אישורים ישנים בלי פירוט מי אישר.`}
          </p>
        )}

        <Section title="פרטי הזוג">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="שמות הזוג (כפי שיופיע על השער)">
              <Input value={coupleName} onChange={(e) => setCoupleName(e.target.value)} placeholder="נועה & תומר" required className={inputCls} />
              {ampSuggestion && (
                <p className="text-xs text-gray-400" data-testid="amp-suggestion">
                  להציג כ־<b className="text-gray-200">{ampSuggestion}</b>?{" "}
                  <button type="button" className="text-brand-400 hover:underline" onClick={() => setCoupleName(ampSuggestion)} data-testid="amp-accept">
                    כן
                  </button>
                  {" · "}
                  <button type="button" className="text-gray-400 hover:underline" onClick={() => setAmpDeclined(coupleName)} data-testid="amp-decline">
                    להשאיר כך
                  </button>
                </p>
              )}
            </Field>
            <Field label="אולם / מקום (מוצג מתחת לתאריך)">
              <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="חוות אלבני" className={inputCls} />
            </Field>
            <Field label="תאריך החתונה">
              <Input
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setDateTouched(true);
                }}
                className={inputCls}
              />
            </Field>
            <Field label="ימי גישה" hint={gallery ? `נסגרת ב־${formatDateShort(gallery.expiresAt)}` : "נספר מרגע היצירה"}>
              <Input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => {
                  setDays(Number(e.target.value));
                  setDaysTouched(true);
                }}
                className={inputCls}
                data-testid="gallery-days"
              />
            </Field>
            <Field label="שם סטודיו אחר לזוג הזה (לא חובה)" hint={`ריק = שם הסטודיו מפרטי הסטודיו (${defaultStudio}).`}>
              <Input value={studioName} onChange={(e) => setStudioName(e.target.value)} placeholder={defaultStudio} className={inputCls} />
            </Field>
            {canEvents && (
              <Field label="האירוע של הזוג (לא חובה)" hint="כשהזוג שולח אלבום שעיצב, הוא מצטרף להזמנת האלבום הפתוחה של האירוע, בלי הזמנה שנייה.">
                <EventPicker
                  eventId={eventId}
                  label={eventLabel}
                  onPick={(idPicked, labelPicked) => {
                    setEventId(idPicked);
                    setEventLabel(labelPicked);
                    setEventTouched(true);
                  }}
                />
              </Field>
            )}
          </div>
        </Section>

        {kind === "films" && (
          <>
        <Section title="תמונת שער (לא חובה)">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="aspect-video rounded-lg border border-dashed border-gray-700 bg-gray-800/50 bg-cover bg-center text-gray-500 text-sm"
              style={{ backgroundImage: coverPreview || cover ? `url(${coverPreview || cover})` : undefined }}
            >
              {!(coverPreview || cover) && "אין תמונה: יוצג ההייליטס רץ"}
            </button>
            <div className="space-y-3">
              <p className="text-sm text-gray-400">
                בלי תמונה, מסך הפתיחה מציג את ההייליטס רץ מהשנייה הראשונה. תמונה מוצגת רק לרגע עד שהסרטון נטען, ומומלצת לאינטרנט איטי.
              </p>
              <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={(e) => pickCover(e.target.files?.[0])} />
              <Button type="button" variant="outline" onClick={() => fileInput.current?.click()} className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
                בחירת תמונה מהמחשב
              </Button>
            </div>
          </div>
        </Section>

        <Section title="הסרטים">
          <Field
            label="קישור לתיקייה של הזוג: דרופבוקס, גוגל דרייב, pCloud או MyAirBridge"
            hint={
              folderUrl.trim() && !folderLink
                ? "הקישור לא מזוהה. אפשר להדביק קישור מדרופבוקס, מגוגל דרייב, מ-pCloud או מ-MyAirBridge."
                : 'הקישור משמש גם לכפתור "הורדת הכל" אצל הזוג. טעינת הסרטים מחליפה את הרשימה למטה.'
            }
          >
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                className={`${inputCls} flex-1 min-w-[240px]`}
                value={folderUrl}
                onChange={(e) => setFolderUrl(e.target.value)}
                placeholder="https://www.dropbox.com/scl/fo/…"
                dir="ltr"
              />
              {folderLink && <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">{PROVIDER_NAMES[folderLink.provider]}</span>}
              <Button type="button" disabled={!folderUrl || busy === "folder"} onClick={loadFolder} className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
                {busy === "folder" ? <Loader2 className="w-4 h-4 animate-spin" /> : "טעינת סרטים מהתיקייה"}
              </Button>
            </div>
          </Field>
          <p className="text-xs text-gray-500">
            טיפ: אם בתיקייה יש את אותו סרט גם ב-1080p (למשל "היילייטס 4K.mp4" ו"היילייטס 1080p.mp4"), הזוג יוכל לבחור איכות והפתיחה תרוץ חלק יותר.
          </p>
          {folderLink?.provider === "gdrive" && (
            <p className="text-xs text-amber-400">בגוגל דרייב: התיקייה חייבת להיות משותפת ל"כל מי שיש לו את הקישור", אחרת הזוג לא יוכל לצפות.</p>
          )}

          <FilmsEditor films={films} onChange={setFilms} withChapters />

          <Field label="או הוספת סרט בודד לפי קישור לקובץ">
            <div className="flex flex-wrap gap-2 items-center">
              <Input
                className={`${inputCls} flex-1 min-w-[240px]`}
                value={singleUrl}
                onChange={(e) => setSingleUrl(e.target.value)}
                placeholder="https://www.dropbox.com/scl/fi/…"
                dir="ltr"
              />
              {singleLink && <span className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300">{PROVIDER_NAMES[singleLink.provider]}</span>}
              <Button type="button" variant="outline" disabled={!singleUrl || busy === "single"} onClick={addSingle} className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
                {busy === "single" ? <Loader2 className="w-4 h-4 animate-spin" /> : "בדיקה והוספה"}
              </Button>
            </div>
          </Field>
        </Section>
          </>
        )}

        {kind === "photos" && isNew && (
          <Section title="התמונות">
            <Field label="קישור לתיקייה עם התמונות: דרופבוקס, גוגל דרייב או pCloud (אפשר גם אחרי היצירה)" hint={'תיקיות בשם של סט ("02 התארגנות") ממלאות את הסט הזה. MyAirBridge נתמך רק לסרטים.'}>
              <Input className={inputCls} value={photoFolder} onChange={(e) => setPhotoFolder(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/…" dir="ltr" data-testid="new-photo-folder" />
            </Field>
          </Section>
        )}

        <Section title="גישה">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {seesSecrets ? (
              <>
                <Field label="סיסמה לגלריה (לא חובה)" hint="מי שנכנס צריך להקליד אותה. סיסמה חדשה מנתקת את כל מי שכבר נכנס.">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} maxLength={40} autoComplete="off" className={inputCls} data-testid="gallery-password-field" />
                </Field>
                <Field
                  label="קוד הורדה (לא חובה, לפחות 6 תווים)"
                  hint="צפייה פתוחה, והקוד נדרש להורדה באיכות מלאה. בסרטים הקוד מסתיר את כפתור ההורדה בלבד (סרט בכמה גדלים מתנגן בלי הקוד רק בגודל הקטן). למשל: עד שהזוג משלם."
                >
                  <Input value={downloadPin} onChange={(e) => setDownloadPin(e.target.value)} maxLength={40} autoComplete="off" className={inputCls} data-testid="download-pin-field" />
                </Field>
              </>
            ) : (
              <p className="text-sm text-gray-400 md:col-span-2" data-testid="gallery-secrets-hidden">
                {gallery?.hasPassword ? "לגלריה יש סיסמה." : "לגלריה אין סיסמה."} {gallery?.hasDownloadPin ? "יש קוד הורדה." : "אין קוד הורדה."} רק הבעלים או מנהל מערכת רואים ומשנים סיסמה וקוד הורדה.
              </p>
            )}
          </div>
          {guestLink && (
            <div className="space-y-1.5" data-testid="guest-link">
              <Label className="text-gray-300">הקישור לאורחים (צפייה והורדה בלבד, בלי הלבבות והבחירות של הזוג)</Label>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex-1 min-w-[240px] rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300" dir="ltr">
                  {guestLink}
                </div>
                <Button type="button" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={() => copyText(guestLink).then((ok) => ok && toast.success("הקישור לאורחים הועתק"))}>
                  <Copy className="w-4 h-4 ml-2" />
                  העתקה
                </Button>
                <Button asChild variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
                  <a href={`https://wa.me/?text=${encodeURIComponent(`התמונות מהחתונה של ${coupleName}: ${guestLink}`)}`} target="_blank" rel="noopener noreferrer">
                    שליחה בוואטסאפ
                  </a>
                </Button>
              </div>
              <p className="text-xs text-gray-500">הזוג רואה גם כפתור "שתפו עם האורחים" בגלריה שלו. הסיסמה, אם יש, חלה גם על הקישור הזה.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" className="border-red-900 bg-gray-900 text-red-300 hover:bg-red-950" onClick={rotateGuest} disabled={busy === "guest"} data-testid="rotate-guest">
                  {busy === "guest" ? <Loader2 className="w-4 h-4 animate-spin" /> : "קישור חדש לאורחים"}
                </Button>
                <span className="text-xs text-gray-500">אם הקישור לאורחים הגיע למי שלא צריך: הקישור הישן יפסיק לעבוד מיד. אפשר להוסיף גם סיסמה לגלריה.</span>
              </div>
            </div>
          )}
        </Section>

        {kind === "photos" && songs.list.length > 0 && (
          <Section title="שיר למצגת">
            <select value={music} onChange={(e) => setMusic(e.target.value)} className="w-full md:w-96 rounded-md bg-gray-800 border border-gray-700 text-white px-3 py-2" data-testid="gallery-music">
              <option value="">ברירת המחדל של הסטודיו ({songs.list.find((t) => t.id === songs.defaultId)?.name || "ללא"})</option>
              {songs.list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              <option value="none">מצגת בלי שיר</option>
            </select>
          </Section>
        )}

        {gallery && (
          <Section title={kind === "photos" ? "הסרטים של הזוג" : "התמונות של הזוג"}>
            <LinkPicker gallery={gallery} others={others} onLinked={(linkedId) => setGallery((g) => ({ ...g, linkedId }))} />
          </Section>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy === "save"} className="bg-brand-400 hover:bg-brand-500 text-brand-fg font-semibold px-6">
            {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : isNew ? "יצירת הגלריה" : "שמירת שינויים"}
          </Button>
          {gallery?.expired && <span className="text-amber-400 text-sm">הגלריה סגורה. כדי לפתוח מחדש, הגדילו את ימי הגישה או השתמשו ב"הארכה" ברשימה.</span>}
        </div>
      </form>
      {gallery && kind === "photos" && (
        <div className="max-w-4xl mx-auto mt-5">
          <PhotosEditor galleryId={gallery.id} initialFolder={gallery.folderUrl || ""} coupleName={coupleName} coupleUrl={link} guestUrl={guestLink} />
        </div>
      )}
      {gallery && kind === "photos" && (
        <div className="max-w-6xl mx-auto mt-5">
          <DesignEditor galleryId={gallery.id} coupleUrl={link} coupleName={coupleName} />
        </div>
      )}
    </div>
  );
}

/** Links this gallery with the same couple's gallery of the other kind (films ↔ photos). */
function LinkPicker({ gallery, others, onLinked }) {
  const otherKind = gallery.kind === "photos" ? "films" : "photos";
  // Not a gallery in the trash (unless it is the one linked now).
  const choices = others.filter((g) => (g.kind === "photos" ? "photos" : "films") === otherKind && (!g.deletedAt || g.id === gallery.linkedId));
  const [busy, setBusy] = useState(false);
  const change = async (linkedId) => {
    setBusy(true);
    try {
      const r = await filmsApi("PUT", `/api/admin/galleries/${gallery.id}/link`, { linkedId });
      onLinked(r.linkedId || undefined);
      toast.success(r.linkedId ? "הגלריות קושרו" : "הקישור בוטל");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-400">
        {otherKind === "films" ? "אם יש לזוג גם גלריית סרטים, קשרו אותה: בגלריית התמונות יופיע כפתור לסרטים." : "אם יש לזוג גם גלריית תמונות, קשרו אותה: בגלריית הסרטים יופיע כפתור לתמונות."}
      </p>
      <select
        value={gallery.linkedId || ""}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="w-full md:w-96 rounded-md bg-gray-800 border border-gray-700 text-white px-3 py-2"
        data-testid="link-picker"
      >
        <option value="">בלי קישור</option>
        {choices.map((g) => (
          <option key={g.id} value={g.id}>
            {g.coupleName}
            {g.date ? ` · ${formatDateShort(g.date)}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
