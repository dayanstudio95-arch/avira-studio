import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Clapperboard, Copy, ExternalLink, Images, LayoutGrid, List, Loader2, Pencil, Plus, RotateCcw, Search, Timer, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { parseEventList } from "@films-shared/event";
import { withAmpersand } from "@films-shared/names";
import { galleryHome, galleryKindOfPath, galleryPath } from "@/lib/galleryRoutes";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { useBottomBar } from "@/lib/bottomBar";
import { coupleLink, copyText, filmsApi, filmsConfigured, FILMS_BASE_URL, studioPreviewLink } from "@/lib/filmsApi";
import { batchMessages, needsConfirm, readAllGalleries, runBatch, withoutSkipped } from "@/lib/filmsBatch";
import { makeFilmThumb } from "@/lib/filmThumbs";
import FilmsNotConfigured from "@/components/films/FilmsNotConfigured";
import GalleriesSummary from "@/components/films/GalleriesSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { confirmDialog } from "@/lib/confirmDialog";

// The couples' galleries: photo galleries under "גלריות" (/photos), film galleries under "סרטים" (/films).
// Ported from the films app's admin: same filters, month grouping and actions; data from the
// films Worker via filmsApi.

const FILTERS = [
  { key: "all", label: "הכל" },
  { key: "nofilms", label: "ריקות" },
  { key: "open", label: "פתוחות" },
  { key: "soon", label: "נסגרות בקרוב" },
  { key: "closed", label: "נסגרו" },
  { key: "trash", label: "סל מחזור" },
];

function matches(g, f) {
  // The trash is its own list: 30 days to restore, then removed for good.
  if (f === "trash") return Boolean(g.deletedAt);
  if (g.deletedAt) return false;
  switch (f) {
    case "nofilms":
      return isEmpty(g);
    case "open":
      return !g.expired && g.daysLeft > 7;
    case "soon":
      return !g.expired && g.daysLeft <= 7;
    case "closed":
      return g.expired;
    default:
      return true;
  }
}

const kindOf = (g) => (g.kind === "photos" ? "photos" : "films");
const contentCount = (g) => (kindOf(g) === "photos" ? g.photoCount || 0 : g.films.length);
const isEmpty = (g) => contentCount(g) === 0;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Newest wedding first; galleries without a date go last, newest created first. */
function byEventDate(a, b) {
  const da = ISO.test(a.date) ? a.date : "";
  const db = ISO.test(b.date) ? b.date : "";
  if (da && db) return db.localeCompare(da) || b.createdAt.localeCompare(a.createdAt);
  if (da) return -1;
  if (db) return 1;
  return b.createdAt.localeCompare(a.createdAt);
}

const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
function monthOf(date) {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date || "");
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "ללא תאריך";
}

export function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!m) return value || "";
  return `${Number(m[3])}.${Number(m[2])}.${m[1].slice(2)}`;
}

function readFilter() {
  try {
    const f = localStorage.getItem("films:filter");
    return FILTERS.some((x) => x.key === f) ? f : "all";
  } catch {
    return "all";
  }
}

function State({ g }) {
  const base = "inline-block rounded-full px-2 py-0.5 text-xs border";
  if (g.expired) return <span className={`${base} border-gray-600 text-gray-400`}>נסגרה</span>;
  if (isEmpty(g)) return <span className={`${base} border-gray-600 text-gray-300`}>{kindOf(g) === "photos" ? "ללא תמונות" : "ללא סרטים"}</span>;
  // Calendar days in Israel (P72): 0 = it closes at the end of today.
  const when = g.daysLeft <= 0 ? "היום" : g.daysLeft === 1 ? "מחר" : `בעוד ${g.daysLeft} ימים`;
  if (g.daysLeft <= 7) return <span className={`${base} border-amber-500/40 bg-amber-500/10 text-amber-300`}>נסגרת {when}</span>;
  return <span className={`${base} border-green-500/30 bg-green-500/10 text-green-300`}>פתוחה · {g.daysLeft} ימים</span>;
}

/** The gallery's picture on the films site (a photo, the film cover or a frame); '' when none yet. */
function thumbSrc(g, big = false) {
  if (!g.thumb) return "";
  return FILMS_BASE_URL + (big ? g.thumb.replace("?s=m", "?s=md") : g.thumb);
}

/** A picture of the couple next to the name (like Pixieset's collections). */
function Thumb({ g }) {
  const src = thumbSrc(g);
  return (
    <Link to={galleryPath(g)} tabIndex={-1} aria-hidden="true" className="shrink-0 w-24 h-[68px] rounded-md overflow-hidden bg-gray-800 border border-gray-700/60 flex items-center justify-center" data-testid="g-thumb">
      {src ? <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" /> : kindOf(g) === "photos" ? <Images className="w-5 h-5 text-gray-600" /> : <Clapperboard className="w-5 h-5 text-gray-600" />}
    </Link>
  );
}

function readCards() {
  try {
    return localStorage.getItem("films:cards") === "1";
  } catch {
    return false;
  }
}

export default function FilmsGalleries() {
  const { tenant, hasModule } = useAuth();
  // "גלריות" (/photos) lists the photo galleries, "סרטים" (/films) the film galleries.
  const kind = galleryKindOfPath(useLocation().pathname);
  // A studio with only the other gallery module goes to its own list (an old link, a notification).
  const otherKind = kind === "photos" ? "films" : "photos";
  const goOther = !hasModule(kind) && hasModule(otherKind);
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState(readFilter);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [extending, setExtending] = useState(null); // galleries to extend (one, or the picked ones)
  // Reopened galleries (extended, restored) whose face search went off when its data was deleted (fix plan P68).
  const [faceOff, setFaceOff] = useState([]);
  const slug = tenant?.slug;
  // Table or cards (like Pixieset's collections), remembered on this computer.
  const [cards, setCards] = useState(readCards);
  const toggleCards = (on) => {
    setCards(on);
    try {
      localStorage.setItem("films:cards", on ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  // Film galleries without a picture: take a frame from their highlights, a few per visit, one at a time.
  const tried = useRef(new Set());
  useEffect(() => {
    if (kind !== "films" || !list) return;
    const todo = list.filter((g) => kindOf(g) === "films" && !g.thumb && g.previewToken && !g.deletedAt && g.films.some((f) => f.playable) && !tried.current.has(g.id)).slice(0, 8);
    if (todo.length === 0) return;
    let stop = false;
    (async () => {
      for (const g of todo) {
        if (stop) return;
        tried.current.add(g.id);
        const thumb = await makeFilmThumb(g);
        if (thumb && !stop) setList((l) => l?.map((x) => (x.id === g.id ? { ...x, thumb, hasThumb: true } : x)) ?? l);
      }
    })();
    return () => {
      stop = true;
    };
  }, [kind, list]);

  // Every gallery, 500 per request (fix plan P70).
  const load = () =>
    readAllGalleries((path) => filmsApi("GET", path))
      .then(setList)
      .catch((e) => setError(e.message));
  useEffect(() => {
    if (filmsConfigured()) load();
  }, []);

  const pickFilter = (f) => {
    setFilter(f);
    setPicked(new Set());
    try {
      localStorage.setItem("films:filter", f);
    } catch {
      /* ignore */
    }
  };

  const shown = useMemo(() => {
    if (!list) return [];
    const q = query.trim().toLowerCase();
    return [...list]
      .sort(byEventDate)
      .filter((g) => kindOf(g) === kind)
      .filter((g) => matches(g, filter))
      .filter((g) => !q || `${g.coupleName} ${g.venue || ""} ${formatDate(g.date)} ${g.date}`.toLowerCase().includes(q));
  }, [list, query, filter, kind]);

  // The bulk bar is fixed at the bottom: the Layout floats its "המשך הקמה" pill above it.
  const bulkBarRef = useBottomBar();
  if (!filmsConfigured()) return <FilmsNotConfigured />;

  const remove = async (g) => {
    if (!(await confirmDialog(`להעביר את הגלריה של ${g.coupleName} לסל המחזור? הקישור יפסיק לעבוד מיד. אפשר לשחזר עד 30 יום, ואחר כך היא נמחקת לגמרי. הקבצים בענן לא נמחקים.`))) return;
    try {
      try {
        await filmsApi("DELETE", `/api/admin/galleries/${g.id}`);
      } catch (e) {
        // The couple sent the album they designed here (P71): only with an explicit yes.
        if (e.code !== "album_submitted" || !(await confirmDialog(e.message))) throw e;
        await filmsApi("DELETE", `/api/admin/galleries/${g.id}?force=1`);
      }
      toast.success("הגלריה הועברה לסל המחזור");
      load();
    } catch (e) {
      if (e.code !== "album_submitted") toast.error(e.message);
    }
  };

  const restore = async (g) => {
    try {
      const r = await filmsApi("POST", `/api/admin/galleries/${g.id}/restore`);
      toast.success("הגלריה שוחזרה");
      if (r?.faceSearchOff) setFaceOff([{ id: g.id, coupleName: g.coupleName }]);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const removeForever = async (g) => {
    if (!(await confirmDialog(`למחוק לצמיתות את הגלריה של ${g.coupleName}? אי אפשר לבטל. הקבצים בענן לא נמחקים.`))) return;
    try {
      await filmsApi("DELETE", `/api/admin/galleries/${g.id}?forever=1`);
      toast.success("הגלריה נמחקה לצמיתות");
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  /**
   * Several at once (the bar at the bottom). The Worker answers how many it did and which it skipped and why;
   * photo galleries whose face data waits for another request are sent again by runBatch (fix plan P70).
   */
  const batch = async (action, galleries, extra = {}) => {
    try {
      const send = (body) => filmsApi("POST", "/api/admin/galleries/batch", body);
      let r = await runBatch(send, action, galleries.map((g) => g.id), extra);
      // Galleries whose couple sent a designed album go to the trash only after an explicit yes (P71): asked once, then sent with `force`.
      const ask = action === "trash" ? needsConfirm(r) : [];
      if (ask.length) {
        const names = galleries.filter((g) => ask.includes(g.id)).map((g) => g.coupleName);
        const shown = names.slice(0, 3).join(", ") + (names.length > 3 ? ` ועוד ${names.length - 3}` : "");
        r = withoutSkipped(r, "album_submitted");
        if (await confirmDialog(`${ask.length === 1 ? "בגלריה אחת" : `ב-${ask.length} גלריות`} (${shown}) הזוג כבר שלח אלבום שעיצב. בסל המחזור הקישור יפסיק לעבוד ואחרי 30 יום העיצוב יימחק. להעביר גם אותן?`)) {
          const again = await runBatch(send, action, ask, { ...extra, force: true });
          r = { ...r, done: r.done + again.done, doneIds: [...r.doneIds, ...again.doneIds], skipped: [...r.skipped, ...again.skipped] };
        } else r = { ...r, skipped: [...r.skipped, ...ask.map((id) => ({ id, reason: "album_submitted" }))] };
      }
      const { success, warning } = batchMessages(r, action, Object.fromEntries(galleries.map((g) => [g.id, g.coupleName])));
      if (success) toast.success(success);
      if (warning) toast.warning(warning, { duration: 10000 });
      if (r.faceSearchOff?.length) setFaceOff(galleries.filter((g) => r.faceSearchOff.includes(g.id)).map((g) => ({ id: g.id, coupleName: g.coupleName })));
      setPicked(new Set());
      load();
    } catch (e) {
      toast.error(e.message);
      load();
    }
  };
  const pickedList = shown.filter((g) => picked.has(g.id));
  const togglePick = (id) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allPicked = shown.length > 0 && shown.every((g) => picked.has(g.id));
  const copyLinks = () => {
    const text = pickedList.map((g) => `${g.coupleName}: ${coupleLink(slug, g.id)}`).join("\n");
    copyText(text).then((ok) => ok && toast.success(`${pickedList.length} קישורים הועתקו, עם השמות`));
  };
  const inTrash = filter === "trash";
  // "פתיחה כמו הזוג" (U1): the list carries only a thumbs token, which does not open a gallery as the studio, so the
  // gallery's own preview token is asked for first and the link is built exactly as on the gallery's page. A plain
  // couple's link counted a couple's view and a terms acceptance. The tab opens at once (no popup block), then loads.
  const openAsCouple = async (g) => {
    const tab = window.open("", "_blank");
    try {
      const { previewToken } = await filmsApi("GET", `/api/admin/galleries/${g.id}`);
      if (!previewToken) throw new Error("לא ניתן לפתוח את הגלריה כמו הזוג כרגע. נסו שוב.");
      const href = studioPreviewLink(slug, g.id, previewToken);
      if (tab) {
        tab.opener = null;
        tab.location.href = href;
      } else window.open(href, "_blank", "noopener,noreferrer");
    } catch (e) {
      tab?.close();
      toast.error(e.message || "לא ניתן לפתוח את הגלריה כמו הזוג כרגע. נסו שוב.");
    }
  };

  if (goOther) return <Navigate to={galleryHome(otherKind)} replace />;
  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-8" dir="rtl">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            {kind === "photos" ? <Images className="w-6 h-6 text-brand-400" /> : <Clapperboard className="w-6 h-6 text-brand-400" />}
            {kind === "photos" ? "גלריות תמונות" : "גלריות סרטים"}
          </h1>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImporting(true)} className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
              <Upload className="w-4 h-4 ml-2" />
              ייבוא רשימה
            </Button>
            <Button asChild className="bg-brand-400 hover:bg-brand-500 text-brand-fg font-semibold">
              <Link to={`${galleryHome(kind)}/new`}>
                <Plus className="w-4 h-4 ml-2" />
                {kind === "photos" ? "גלריה חדשה" : "סרט חדש"}
              </Link>
            </Button>
          </div>
        </div>

        {faceOff.length > 0 && (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-3 text-sm text-amber-200 flex flex-wrap items-center gap-2" data-testid="face-off-notice">
            <span>זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש:</span>
            {faceOff.map((g) => (
              <Link key={g.id} to={galleryPath(g)} className="underline text-amber-100 hover:text-white" data-testid="face-off-link">
                {g.coupleName}
              </Link>
            ))}
            <button type="button" className="ms-auto text-amber-300 hover:text-white" onClick={() => setFaceOff([])} aria-label="סגירה">
              ✕
            </button>
          </div>
        )}

        <GalleriesSummary
          kind={kind}
          refreshKey={list}
          onExtend={(g) => setExtending([g])}
        />

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {!list && !error && (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
          </div>
        )}

        {list && list.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-gray-500 absolute right-3 top-1/2 -translate-y-1/2" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="חיפוש לפי שמות, אולם או תאריך"
                className="bg-gray-900 border-gray-800 text-white pr-9"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => pickFilter(f.key)}
                  className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                    filter === f.key ? "border-brand-400 bg-brand-400/15 text-brand-300" : "border-gray-700 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {f.label} <span className="opacity-70">{list.filter((g) => kindOf(g) === kind && matches(g, f.key)).length}</span>
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden" role="group" aria-label="תצוגה">
              <button type="button" onClick={() => toggleCards(false)} aria-pressed={!cards} title="טבלה" className={`px-2.5 py-1.5 ${!cards ? "bg-brand-400/15 text-brand-300" : "text-gray-400 hover:text-gray-200"}`} data-testid="view-table">
                <List className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => toggleCards(true)} aria-pressed={cards} title="כרטיסים" className={`px-2.5 py-1.5 ${cards ? "bg-brand-400/15 text-brand-300" : "text-gray-400 hover:text-gray-200"}`} data-testid="view-cards">
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {list && list.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center text-gray-400">
            עוד אין גלריות. צרו את הראשונה מהכפתור למעלה, או ייבאו רשימה שלמה.
          </div>
        )}
        {list && list.length > 0 && shown.length === 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-10 text-center text-gray-400">אין גלריות שמתאימות לחיפוש.</div>
        )}

        {shown.length > 0 && cards && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="gallery-cards">
            {shown.map((g) => {
              const src = thumbSrc(g, true);
              const link = coupleLink(slug, g.id);
              return (
                <div key={g.id} className={`relative rounded-xl border bg-gray-900 overflow-hidden ${picked.has(g.id) ? "border-brand-400" : "border-gray-800"}`} data-testid="gallery-card">
                  <Link to={galleryPath(g)} className="block aspect-[3/2] bg-gray-800" aria-label={`עריכת ${g.coupleName}`}>
                    {src ? (
                      <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                      <span className="w-full h-full flex items-center justify-center text-sm text-gray-500">{kindOf(g) === "photos" ? "ללא תמונות" : "ללא תמונת שער"}</span>
                    )}
                  </Link>
                  <input type="checkbox" className="absolute top-2 right-2 w-4 h-4" checked={picked.has(g.id)} onChange={() => togglePick(g.id)} aria-label={`בחירת ${g.coupleName}`} />
                  <div className="p-3 space-y-2">
                    <Link to={galleryPath(g)} className="block font-semibold text-white hover:text-brand-400 truncate">
                      {g.coupleName}
                    </Link>
                    <div className="text-xs text-gray-400 truncate">
                      {kindOf(g) === "photos" ? `${(g.photoCount || 0).toLocaleString("he-IL")} תמונות` : `${g.films.length} סרטים`}
                      {g.date && <> · {formatDate(g.date)}</>}
                      {g.venue && <> · {g.venue}</>}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      {g.deletedAt ? <TrashState g={g} /> : <State g={g} />}
                      {g.deletedAt ? (
                        <Button size="sm" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={() => restore(g)}>
                          שחזור
                        </Button>
                      ) : (
                        <div className="flex gap-1">
                          <IconButton onClick={() => copyText(link).then((ok) => ok && toast.success("הקישור הועתק"))} title="העתקת הקישור לזוג" icon={Copy} />
                          <IconButton onClick={() => openAsCouple(g)} title="פתיחה כמו הזוג" icon={ExternalLink} />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {shown.length > 0 && !cards && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 overflow-x-auto">
            <table className="w-full text-sm text-white">
              <thead className="text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="p-3 w-8">
                    <input
                      type="checkbox"
                      className="w-4 h-4"
                      aria-label="בחירת כל הגלריות ברשימה"
                      checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(shown.slice(0, 50).map((g) => g.id)))}
                      data-testid="pick-all"
                    />
                  </th>
                  <th className="p-3 text-right font-medium">זוג</th>
                  <th className="p-3 text-right font-medium">אולם</th>
                  <th className="p-3 text-right font-medium">תאריך</th>
                  <th className="p-3 text-right font-medium">מצב</th>
                  <th className="p-3 text-right font-medium">{kind === "photos" ? "תמונות" : "סרטים"}</th>
                  <th className="p-3 text-right font-medium">צפיות / הורדות</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((g, i) => {
                  const month = monthOf(g.date);
                  const newMonth = i === 0 || monthOf(shown[i - 1].date) !== month;
                  const inMonth = newMonth ? shown.filter((x) => monthOf(x.date) === month).length : 0;
                  const link = coupleLink(slug, g.id);
                  return (
                    <Fragment key={g.id}>
                      {newMonth && (
                        <tr className="bg-gray-950/60">
                          <td colSpan={8} className="px-3 py-2 text-xs text-gray-400">
                            <bdi className="font-semibold text-gray-300">{month}</bdi> · {inMonth === 1 ? "אירוע אחד" : `${inMonth} אירועים`}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-gray-800 hover:bg-gray-800/40" data-testid="gallery-row">
                        <td className="p-3">
                          <input type="checkbox" className="w-4 h-4" aria-label={`בחירת ${g.coupleName}`} checked={picked.has(g.id)} onChange={() => togglePick(g.id)} data-testid="pick" />
                        </td>
                        <td className="p-2 font-medium">
                          <div className="flex items-center gap-3 min-w-[220px]">
                            <Thumb g={g} />
                            <div className="min-w-0">
                              <Link to={galleryPath(g)} className="hover:text-brand-400">
                                {g.coupleName}
                              </Link>
                              {g.studioName && <div className="text-xs text-gray-500">{g.studioName}</div>}
                            </div>
                          </div>
                        </td>
                        <td className="p-3 text-gray-400">{g.venue || ""}</td>
                        <td className="p-3">{formatDate(g.date)}</td>
                        <td className="p-3">
                          {g.deletedAt ? <TrashState g={g} /> : <State g={g} />}
                        </td>
                        <td className="p-3">{contentCount(g).toLocaleString("he-IL")}</td>
                        <td className="p-3">
                          <span title={g.guestViews ? `הזוג: ${g.views} · אורחים: ${g.guestViews}` : undefined}>
                            {g.views}
                            {g.guestViews ? <span className="text-gray-500"> (+{g.guestViews} אורחים)</span> : null}
                          </span>{" "}
                          / {g.downloads}
                        </td>
                        <td className="p-3">
                          {g.deletedAt ? (
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={() => restore(g)} data-testid="restore">
                                <RotateCcw className="w-3.5 h-3.5 ml-1" />
                                שחזור
                              </Button>
                              <IconButton onClick={() => removeForever(g)} title="מחיקה לצמיתות" icon={Trash2} danger />
                            </div>
                          ) : (
                          <div className="flex gap-1 justify-end whitespace-nowrap">
                            {isEmpty(g) ? (
                              <Button asChild size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
                                <Link to={galleryPath(g)}>{kindOf(g) === "photos" ? "הוספת תמונות" : "הוספת סרטים"}</Link>
                              </Button>
                            ) : (
                              <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyText(link).then((ok) => ok && toast.success("הקישור הועתק"))}>
                                <Copy className="w-3.5 h-3.5 ml-1" />
                                קישור לזוג
                              </Button>
                            )}
                            <IconButton onClick={() => openAsCouple(g)} title="פתיחה כמו הזוג" icon={ExternalLink} />
                            <IconButton onClick={() => setExtending([g])} title="הארכה" icon={Timer} />
                            <IconLink to={galleryPath(g)} title="עריכה" icon={Pencil} />
                            <IconButton onClick={() => remove(g)} title="העברה לסל המחזור" icon={Trash2} danger />
                          </div>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pickedList.length > 0 && (
        <>
          <div style={{ height: 80 }} aria-hidden="true" />
          <div ref={bulkBarRef} className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-700 bg-gray-950/95 backdrop-blur p-3" data-testid="bulk-bar" dir="rtl">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center gap-2">
              <b className="text-white ml-2">נבחרו {pickedList.length}</b>
              {inTrash ? (
                <>
                  <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => batch("restore", pickedList)} data-testid="bulk-restore">
                    שחזור
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/40 bg-gray-800 text-red-300 hover:bg-gray-700"
                    onClick={async () => (await confirmDialog(`למחוק לצמיתות ${pickedList.length} גלריות? אי אפשר לבטל.`)) && batch("purge", pickedList)}
                    data-testid="bulk-purge"
                  >
                    מחיקה לצמיתות
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => setExtending(pickedList)} data-testid="bulk-extend">
                    הארכה
                  </Button>
                  <Button size="sm" variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={copyLinks} data-testid="bulk-copy">
                    העתקת הקישורים
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
                    onClick={async () => (await confirmDialog(`לסגור עכשיו ${pickedList.length} גלריות? הזוגות לא יוכלו לצפות עד שתאריכו.`)) && batch("close", pickedList)}
                    data-testid="bulk-close"
                  >
                    סגירה עכשיו
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/40 bg-gray-800 text-red-300 hover:bg-gray-700"
                    onClick={async () => (await confirmDialog(`להעביר ${pickedList.length} גלריות לסל המחזור? הקישורים יפסיקו לעבוד מיד. אפשר לשחזר עד 30 יום.`)) && batch("trash", pickedList)}
                    data-testid="bulk-trash"
                  >
                    העברה לסל
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="text-gray-400 mr-auto" onClick={() => setPicked(new Set())}>
                ביטול הבחירה
              </Button>
            </div>
          </div>
        </>
      )}

      {extending && (
        <ExtendDialog
          galleries={extending}
          onClose={() => setExtending(null)}
          onExtend={async (days) => {
            // With the closing time this screen showed: the Worker extends only while it still holds, so a
            // second click (or another tab) never extends twice (P70).
            if (extending.length === 1) {
              try {
                const r = await filmsApi("POST", `/api/admin/galleries/${extending[0].id}/extend`, { days, expiresAt: extending[0].expiresAt });
                toast.success("הגלריה הוארכה");
                if (r?.faceSearchOff) setFaceOff([{ id: extending[0].id, coupleName: extending[0].coupleName }]);
              } catch (e) {
                toast.error(e.message);
              }
              load();
            } else await batch("extend", extending, { days, seen: Object.fromEntries(extending.map((g) => [g.id, g.expiresAt])) });
            setExtending(null);
          }}
        />
      )}

      {importing && (
        <BulkImport
          kind={kind}
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false);
            pickFilter("nofilms");
            load();
          }}
        />
      )}
    </div>
  );
}

function TrashState({ g }) {
  const left = Math.max(0, 30 - Math.floor((Date.now() - Date.parse(g.deletedAt)) / 86_400_000));
  return <span className="inline-block rounded-full px-2 py-0.5 text-xs border border-red-500/30 bg-red-500/10 text-red-300">בסל · נמחקת בעוד {left} ימים</span>;
}

/** How many days to add (instead of the browser's prompt). */
function ExtendDialog({ galleries, onClose, onExtend }) {
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const n = Math.floor(Number(days));
  const valid = Number.isFinite(n) && n >= 1 && n <= 3650;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-md" dir="rtl" data-testid="extend-dialog">
        <DialogHeader>
          <DialogTitle>{galleries.length === 1 ? `הארכת הגלריה של ${galleries[0].coupleName}` : `הארכת ${galleries.length} גלריות`}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-400">הימים נוספים מהיום, או מסוף התקופה אם הגלריה עוד פתוחה. גלריה שנסגרה נפתחת שוב.</p>
        <div className="flex flex-wrap gap-2">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(String(d))}
              className={`rounded-full border px-3 py-1 text-sm ${String(d) === days ? "border-brand-400 bg-brand-400/15 text-brand-300" : "border-gray-700 text-gray-300"}`}
            >
              {d} ימים
            </button>
          ))}
        </div>
        <Input type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} className="bg-gray-800 border-gray-700 text-white w-32" data-testid="extend-days" />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-gray-300">
            ביטול
          </Button>
          <Button
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              await onExtend(n);
              setBusy(false);
            }}
            className="bg-brand-400 hover:bg-brand-500 text-brand-fg font-semibold"
            data-testid="extend-go"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `הארכה ב-${valid ? n : "…"} ימים`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IconButton({ onClick, title, icon: Icon, danger }) {
  return (
    <Button type="button" size="icon" variant="ghost" onClick={onClick} title={title} className={danger ? "text-red-400 hover:text-red-300" : "text-gray-400 hover:text-white"}>
      <Icon className="w-4 h-4" />
    </Button>
  );
}

function IconLink({ href, to, title, icon: Icon }) {
  return (
    <Button asChild size="icon" variant="ghost" title={title} className="text-gray-400 hover:text-white">
      {to ? (
        <Link to={to}>
          <Icon className="w-4 h-4" />
        </Link>
      ) : (
        <a href={href} target="_blank" rel="noopener noreferrer">
          <Icon className="w-4 h-4" />
        </a>
      )}
    </Button>
  );
}

const EXAMPLE = `הדר ואלירז 6/8/26 הופה
מאיה וקובי 30/6/26 חוות אלבני
נועה ואיתי 28/6/26 גן הפקאן`;

/** Paste a list of events, one per line, and get a gallery for each. */
function BulkImport({ kind, onClose, onDone }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // "X וY" → "X & Y" is a suggestion (P72, D15): shown in the table, and the studio may keep the names as typed.
  const [amp, setAmp] = useState(true);
  const parsed = useMemo(() => parseEventList(text), [text]);
  const suggests = parsed.some((r) => withAmpersand(r.coupleName) !== r.coupleName);
  const rows = useMemo(() => (amp ? parsed.map((r) => ({ ...r, coupleName: withAmpersand(r.coupleName) })) : parsed), [parsed, amp]);
  const bad = rows.filter((r) => !r.coupleName).length;

  const create = async () => {
    setError("");
    setBusy(true);
    try {
      const created = await filmsApi("POST", "/api/admin/galleries/bulk", { items: rows, kind });
      toast.success(`נוצרו ${created.length} גלריות`);
      onDone(created);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>{kind === "photos" ? "ייבוא רשימת אירועים (גלריות תמונות)" : "ייבוא רשימת אירועים (גלריות סרטים)"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-400">
          שורה לכל אירוע: <b>שמות הזוג, תאריך, אולם</b>. התאריך יכול להיות עם / או עם נקודות. האולם לא חובה. לכל שורה תיווצר
          גלריה, ואחר כך מוסיפים לכל אחת את {kind === "photos" ? "התמונות" : "הסרטים"}.
        </p>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={EXAMPLE} autoFocus className="bg-gray-800 border-gray-700 text-white min-h-[140px]" />
        {rows.length > 0 && (
          <div className="rounded-lg border border-gray-800 overflow-x-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="text-gray-400">
                <tr>
                  <th className="p-2 text-right font-medium">זוג</th>
                  <th className="p-2 text-right font-medium">תאריך</th>
                  <th className="p-2 text-right font-medium">אולם</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className={`p-2 ${r.coupleName ? "" : "text-red-400"}`}>{r.coupleName || "חסרים שמות"}</td>
                    <td className={`p-2 ${r.date ? "" : "text-gray-500"}`}>{r.date ? formatDate(r.date) : "בלי תאריך"}</td>
                    <td className={`p-2 ${r.venue ? "" : "text-gray-500"}`}>{r.venue || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {suggests && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" className="w-4 h-4" checked={amp} onChange={(e) => setAmp(e.target.checked)} data-testid="bulk-amp" />
            להציג את שמות הזוג עם & (למשל "נועה & איתי" במקום "נועה ואיתי")
          </label>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        {bad > 0 && <p className="text-amber-400 text-sm">יש {bad} שורות בלי שמות זוג. תקנו או מחקו אותן כדי להמשיך.</p>}
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} className="text-gray-300">
            ביטול
          </Button>
          <Button disabled={busy || rows.length === 0 || bad > 0} onClick={create} className="bg-brand-400 hover:bg-brand-500 text-brand-fg font-semibold">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : `יצירת ${rows.length} גלריות`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
