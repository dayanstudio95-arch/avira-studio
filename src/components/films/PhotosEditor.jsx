import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PRESET_SETS, isTopFolder } from "@films-shared/photosets";
import { readPhotoDates } from "@/lib/photoDates";
import { copyText, filmsApi, photoUrl } from "@/lib/filmsApi";
import { formatDateShort } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBottomBar } from "@/lib/bottomBar";
import { confirmDialog, isConfirmOpen } from "@/lib/confirmDialog";

// The studio organizes a photo gallery: read the folder, sets, cover, hidden photos, and sees the
// couple's hearts and Instagram marks. Ported from the Avira films app's admin (PhotosEditor.tsx,
// 2026-09-26). Not here yet (later phases): face search, the album card.

// Lightroom's order (keys 6–9, then purple). "none" = a photo read with no colour at all (Avira, 2026-10-31: the
// owner's hall has no colour left, so an unmarked photo is the hall).
const LABELS = ["red", "yellow", "green", "blue", "purple", "none"];
const LABEL_NAMES = { yellow: "צהוב", red: "אדום", blue: "כחול", purple: "סגול", green: "ירוק", none: "בלי צבע" };
const LABEL_DOT = { yellow: "bg-yellow-400", red: "bg-red-500", blue: "bg-blue-500", purple: "bg-purple-500", green: "bg-green-500", none: "border border-gray-400" };
/** A photo read with no colour, outside the teaser ("top") folders — those go to the teaser instead. */
const isUnmarked = (it) => it.label === "" && !(it.folder && isTopFolder(it.folder));

const card = "rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-3";
const chip = (on) => `rounded-full border px-3 py-1 text-sm transition-colors ${on ? "border-brand-400 bg-brand-400/15 text-brand-300" : "border-gray-700 text-gray-300 hover:text-white"}`;
// A cloud folder's chip says how far its sorting got (Avira, 2026-10-31, the owner's request): green — every photo is
// in a set (or hidden from the couple), yellow — some, red — none yet. The open folder gets a white ring.
const FOLDER_TONE = {
  done: "border-green-500 bg-green-500/15 text-green-300",
  some: "border-amber-400 bg-amber-400/15 text-amber-300",
  none: "border-red-500 bg-red-500/15 text-red-300",
};
const folderChip = (on, tone) => `rounded-full border px-3 py-1 text-sm transition-colors ${FOLDER_TONE[tone]} ${on ? "ring-2 ring-white/80 ring-offset-1 ring-offset-gray-900" : "hover:brightness-125"}`;
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";

function Progress({ done, total, children, testId }) {
  const pct = Math.round((done / Math.max(1, total)) * 100);
  return (
    <div className="relative h-8 rounded-full bg-gray-800 overflow-hidden text-sm text-gray-200 grid place-items-center" data-testid={testId}>
      <div className="absolute inset-y-0 right-0 bg-brand-400/30 transition-all" style={{ width: `${pct}%` }} />
      <span className="relative">
        {children} {done.toLocaleString("he-IL")}/{total.toLocaleString("he-IL")}
      </span>
    </div>
  );
}

export default function PhotosEditor({ galleryId, initialFolder = "", coupleName = "", coupleUrl = "", guestUrl = "" }) {
  const [data, setData] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [folder, setFolder] = useState(initialFolder);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  // An edit the Worker refused (a key two photos share, from before P64): loading the folder again fixes it.
  const [warning, setWarning] = useState("");
  const [view, setView] = useState("all");
  const [selected, setSelected] = useState(() => new Set());
  const [scan, setScan] = useState(null);
  const [dating, setDating] = useState(null);
  const [labelsOn, setLabelsOn] = useState(false);
  const [labelMap, setLabelMap] = useState({});
  const [showLabelMap, setShowLabelMap] = useState(false);
  const [newSet, setNewSet] = useState("");
  // A new set typed in the bottom bar: made and filled with the selected photos in one step.
  const [dockSet, setDockSet] = useState(null);
  // "Hide photos already in a set": what's left to sort stays in view (remembered on this computer). On unless
  // turned off (Avira, 2026-10-31, the owner's request: a photo put in a set leaves its folder); a new key, so an
  // old "off" doesn't carry over.
  const [hideSorted, setHideSorted] = useState(() => {
    try {
      return localStorage.getItem("photos:show-sorted") !== "1";
    } catch {
      return true;
    }
  });
  const toggleHideSorted = (on) => {
    setHideSorted(on);
    setSelected(new Set());
    try {
      localStorage.setItem("photos:show-sorted", on ? "0" : "1");
    } catch {
      /* private mode */
    }
  };
  const [hideTopCopies, setHideTopCopies] = useState(true);
  const [topDone, setTopDone] = useState(() => {
    try {
      return localStorage.getItem(`top-asked:${galleryId}`) === "1";
    } catch {
      return false;
    }
  });
  const lastClicked = useRef(null);
  const datesTried = useRef(false);
  const keyHandler = useRef(/** @type {(e: any) => void} */ (() => {}));
  // The selection dock is fixed at the bottom: the Layout floats its "המשך הקמה" pill above it.
  const selDockRef = useBottomBar();

  const thumb = (key, size = "m") => photoUrl(galleryId, key, size, data?.previewToken, data?.gen);

  useEffect(() => {
    const onKey = (e) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    filmsApi("GET", `/api/admin/galleries/${galleryId}/photos`)
      .then((d) => d && setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
    filmsApi("GET", "/api/admin/settings")
      .then((st) => {
        setLabelsOn(Boolean(st.labelSetsOn));
        setLabelMap(st.labelMap || {});
      })
      .catch(() => {});
  }, [galleryId]);

  // One save at a time, in the order they were made (the scan, the dates and the studio's clicks all
  // save): the answer of an older save can't replace a newer one on screen, and the server never has
  // two edits of this list racing each other (fix plan P60).
  const saveQueue = useRef(Promise.resolve());
  const save = (patch) => {
    const run = saveQueue.current.then(async () => {
      try {
        const next = await filmsApi("PUT", `/api/admin/galleries/${galleryId}/photos`, patch);
        setData(next);
        if (next?.warning) setWarning(next.warning);
        return next;
      } catch (e) {
        setError(e.message);
        return null;
      }
    });
    saveQueue.current = run;
    return run;
  };

  /** Puts photos that have no set yet into the set their Lightroom colour stands for (no colour: the "none" set). */
  const applyLabels = async (d, map = labelMap) => {
    const idByName = new Map(d.sets.map((x) => [x.name, x.id]));
    const items = {};
    for (const it of d.items) {
      if (it.set || !(it.label || isUnmarked(it))) continue;
      const id = idByName.get(map[it.label || "none"] || "");
      if (id) items[it.key] = { set: id };
    }
    const n = Object.keys(items).length;
    if (n) {
      await save({ items });
      toast.success(`${n.toLocaleString("he-IL")} תמונות שויכו לסטים לפי הצבע מלייטרום`);
    }
    return n;
  };

  /** Loads every small preview once to learn each photo's shape (and warm the cache for the couple). */
  const measure = async (d) => {
    const todo = d.items.filter((i) => !i.ar);
    if (todo.length === 0) return;
    setScan({ done: 0, total: todo.length });
    let done = 0;
    let pending = {};
    const flush = async () => {
      if (Object.keys(pending).length === 0) return;
      const batch = pending;
      pending = {};
      await save({ items: batch });
    };
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const it = queue.shift();
        await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            if (img.naturalWidth && img.naturalHeight) pending[it.key] = { ar: img.naturalWidth / img.naturalHeight };
            resolve();
          };
          img.onerror = () => resolve();
          img.src = photoUrl(galleryId, it.key, "m", d.previewToken, d.gen);
        });
        done++;
        setScan({ done, total: todo.length });
        if (Object.keys(pending).length >= 40) await flush();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await flush();
    setScan(null);
  };

  /**
   * Several photographers → one timeline, and Lightroom colours: read the start of each photo once. In
   * batches the Worker takes for this cloud; a photo it could not read is asked again (up to 3 times),
   * and one that still failed is not marked as read (no label), so the next opening tries it again
   * (fix plan P62). No made-up times (P64): a photo without one stays without, and the Worker puts it
   * next to the photo before it by name. `again` = the "read times again" button: every photo when the
   * list's times were read before P64 (they may be made up), else the photos without a time. When every
   * photo was read this way, the list is marked `timesV: 2` ("full quality" trusts its times).
   */
  const readTimes = async (d, { again = false } = {}) => {
    const old = d.timesV !== 2;
    const keys = d.items.filter((i) => (again ? old || typeof i.t !== "number" : i.label === undefined)).map((i) => i.key);
    datesTried.current = true;
    if (keys.length === 0) return;
    const whole = keys.length === d.items.length;
    setDating({ done: 0, total: keys.length });
    try {
      const { dates: found, labels, failed } = await readPhotoDates({
        keys,
        provider: d.provider,
        post: (batch) => filmsApi("POST", `/api/admin/galleries/${galleryId}/photos/dates`, { keys: batch }),
        onProgress: (done, total) => setDating({ done, total }),
      });
      const skip = new Set(failed);
      const patches = {};
      for (const k of keys) {
        // Not read: no label (tried again next time). Its old time goes only when every time is being
        // replaced by one from the files.
        if (skip.has(k)) {
          if (whole && old) patches[k] = { t: null };
          continue;
        }
        const t = found[k];
        patches[k] = { t: typeof t === "number" ? t : null, label: labels[k] || "" };
      }
      const entries = Object.entries(patches);
      let latest = null;
      let saved = true;
      for (let i = 0; i < entries.length; i += 1000) {
        const next = await save({ items: Object.fromEntries(entries.slice(i, i + 1000)) });
        saved = saved && Boolean(next);
        latest = next || latest;
      }
      if (saved && whole && old) latest = (await save({ timesV: 2 })) || latest;
      if (latest && labelsOn) await applyLabels(latest);
    } catch (e) {
      setError(e.message);
    } finally {
      setDating(null);
    }
  };

  /**
   * Reads the folder again. When more than 10% of the photos the couple chose (hearts, Instagram,
   * lists, the album) would lose their photo, the Worker saves nothing and asks (fix plan P64, D16).
   */
  const load = async (confirm = false) => {
    setError("");
    setWarning("");
    setBusy("load");
    try {
      const d = await filmsApi("POST", `/api/admin/galleries/${galleryId}/photos/load`, { url: folder, ...(confirm ? { confirm: true } : {}) });
      if (d?.needsConfirm) {
        const go = await confirmDialog(
          `${d.lost.toLocaleString("he-IL")} מתוך ${d.total.toLocaleString("he-IL")} התמונות שהזוג בחר (לבבות, אינסטגרם, רשימות או האלבום) לא נמצאות בתיקייה הזו. לטעון בכל זאת? הבחירות האלה יישארו בלי תמונה.`,
        );
        if (go) await load(true);
        return;
      }
      setData(d);
      toast.success(`נטענו ${d.items.length.toLocaleString("he-IL")} תמונות`);
      // Dropbox makes no preview of some files (HEIC, over 20MB): the Worker says which (fix plan P66).
      if (d.warnings?.length) setWarning(d.warnings.join(" "));
      datesTried.current = false;
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  // After loading: learn the shapes, then (once) capture times and colours, in the background.
  useEffect(() => {
    if (!data) return;
    (async () => {
      if (data.items.some((i) => !i.ar) && !scan) await measure(data);
      if (!datesTried.current && !dating && data.items.some((i) => i.label === undefined)) await readTimes(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items.length]);

  const favs = useMemo(() => new Set(data?.favorites || []), [data?.favorites]);
  const insta = useMemo(() => new Set(data?.insta || []), [data?.insta]);
  const byPerson = useMemo(() => {
    const n = new Map();
    for (const list of Object.values(data?.favBy || {})) for (const w of list) n.set(w, (n.get(w) || 0) + 1);
    return [...n].some(([w]) => w) ? [...n].sort((a, b) => b[1] - a[1]) : [];
  }, [data?.favBy]);
  // The switch applies where photos of every set are mixed: everything, and a cloud folder.
  const mixedView = view === "all" || view.startsWith("folder:");
  const shown = useMemo(() => {
    if (!data) return [];
    const hideSet = hideSorted && (view === "all" || view.startsWith("folder:"));
    return data.items.filter((i) => {
      // A photo hidden from the couple is dealt with too, as in the folder's colour.
      if (hideSet && (i.set || i.hidden)) return false;
      if (view === "all") return !i.hidden;
      if (view === "unsorted") return !i.hidden && !i.set;
      if (view === "fav") return favs.has(i.key);
      if (view === "insta") return insta.has(i.key);
      if (view === "hidden") return i.hidden;
      if (view.startsWith("folder:")) return i.folder === view.slice(7);
      return !i.hidden && i.set === view;
    });
  }, [data, view, favs, insta, hideSorted]);

  if (!loaded) {
    return (
      <div className="p-10 flex justify-center">
        <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
      </div>
    );
  }

  const folderRow = (label) => (
    <div className="flex flex-wrap gap-2">
      <Input className="bg-gray-800 border-gray-700 text-white flex-1 min-w-[240px]" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="https://www.dropbox.com/scl/fo/…" dir="ltr" data-testid="photo-folder" />
      <Button type="button" disabled={!folder || busy === "load"} onClick={() => load()} className="bg-brand-400 hover:bg-brand-500 text-brand-fg" data-testid="photos-load">
        {busy === "load" ? <Loader2 className="w-4 h-4 animate-spin" /> : label}
      </Button>
    </div>
  );

  if (!data) {
    return (
      <section className={card}>
        <h2 className="text-lg font-semibold text-white">התמונות</h2>
        <p className="text-sm text-gray-400">קישור לתיקייה עם התמונות: דרופבוקס, גוגל דרייב או pCloud. תיקיות בשם של סט ("02 התארגנות") ממלאות את הסט הזה.</p>
        {folderRow("טעינת תמונות")}
        {error && <p className="text-red-400 text-sm">{error}</p>}
      </section>
    );
  }

  const count = (v) =>
    v === "all"
      ? data.items.filter((i) => !i.hidden).length
      : v === "unsorted"
        ? data.items.filter((i) => !i.hidden && !i.set).length
        : v === "fav"
          ? favs.size
          : v === "insta"
            ? insta.size
          : v === "hidden"
            ? data.items.filter((i) => i.hidden).length
            : v.startsWith("folder:")
              ? data.items.filter((i) => i.folder === v.slice(7)).length
              : data.items.filter((i) => !i.hidden && i.set === v).length;
  const folders = [...new Set(data.items.map((i) => i.folder).filter(Boolean))];
  const folderState = (f) => {
    const inFolder = data.items.filter((i) => i.folder === f);
    const done = inFolder.filter((i) => i.set || i.hidden).length;
    const tone = done === 0 ? "none" : done === inFolder.length ? "done" : "some";
    const title = tone === "done" ? "כל התמונות שויכו לסטים" : tone === "none" ? "עוד לא שויכה אף תמונה" : `שויכו ${done.toLocaleString("he-IL")} מתוך ${inFolder.length.toLocaleString("he-IL")}`;
    return { tone, title, total: inFolder.length };
  };
  const setName = (id) => data.sets.find((s) => s.id === id)?.name || "";

  const click = (key, e) => {
    const next = new Set(selected);
    if (e.shiftKey && lastClicked.current) {
      const keys = shown.map((i) => i.key);
      const a = keys.indexOf(lastClicked.current);
      const b = keys.indexOf(key);
      if (a >= 0 && b >= 0) for (const k of keys.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(k);
    } else if (next.has(key)) next.delete(key);
    else next.add(key);
    lastClicked.current = key;
    setSelected(next);
  };
  const patchSelected = async (patch) => {
    const items = {};
    selected.forEach((k) => (items[k] = patch));
    await save({ items });
    setSelected(new Set());
  };

  const addSet = async (name) => {
    const n = name.trim();
    if (!n) return;
    if (data.sets.some((s) => s.name === n)) {
      toast.error(`כבר יש סט בשם "${n}"`);
      return;
    }
    await save({ sets: [...data.sets, { id: `s${Date.now()}`, name: n }] });
    setNewSet("");
    toast.success(`נוסף הסט "${n}"`);
  };
  /** New set from the selected photos (or, if the name exists, those photos join that set). */
  const setFromSelected = async (name) => {
    const n = name.trim().slice(0, 40);
    if (!n || selected.size === 0) return;
    const existing = data.sets.find((s) => s.name === n);
    const id = existing?.id ?? `s${Date.now()}`;
    const items = {};
    selected.forEach((k) => (items[k] = { set: id }));
    const count = selected.size;
    await save({ sets: existing ? data.sets : [...data.sets, { id, name: n }], items });
    setSelected(new Set());
    setDockSet(null);
    toast.success(existing ? `${count.toLocaleString("he-IL")} תמונות נוספו לסט "${n}"` : `נוצר הסט "${n}" עם ${count.toLocaleString("he-IL")} תמונות`);
  };
  const renameSet = async (s) => {
    const name = window.prompt("שם חדש לסט:", s.name);
    if (name && name.trim()) await save({ sets: data.sets.map((x) => (x.id === s.id ? { ...x, name: name.trim() } : x)) });
  };
  const moveSet = async (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= data.sets.length) return;
    const next = [...data.sets];
    [next[i], next[j]] = [next[j], next[i]];
    await save({ sets: next });
  };
  const deleteSet = async (s) => {
    if (!(await confirmDialog(`למחוק את הסט "${s.name}"? התמונות שלו לא נמחקות, הן רק יוצאות מהסט.`))) return;
    await save({ sets: data.sets.filter((x) => x.id !== s.id) });
    if (view === s.id) setView("all");
  };
  const copyNames = (keys) => {
    const names = data.items.filter((i) => keys.has(i.key)).map((i) => i.name.replace(/\.[^.]+$/, ""));
    copyText(names.join(", ")).then((ok) => ok && toast.success(`הועתקו ${names.length} שמות קבצים`));
  };

  keyHandler.current = (e) => {
    if (selected.size === 0 || e.metaKey || e.ctrlKey || e.altKey || isConfirmOpen(e)) return;
    const el = e.target;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
    if (e.key === "Escape") {
      setSelected(new Set());
      return;
    }
    if (/^[0-9]$/.test(e.key)) {
      const n = Number(e.key);
      // null, not undefined: JSON drops an undefined field, so the Worker never cleared the set (Studio Plan bug B1).
      if (n === 0) patchSelected({ set: null });
      else if (data.sets[n - 1]) patchSelected({ set: data.sets[n - 1].id });
      e.preventDefault();
    }
  };

  // "top" folders (טופ1, top2…) are the teaser.
  const topFolders = [...new Set(data.items.map((i) => i.folder).filter((f) => f && isTopFolder(f)))].sort();
  const topCopies = (() => {
    const seen = new Set();
    const copies = [];
    for (const f of topFolders)
      for (const it of data.items.filter((i) => i.folder === f)) {
        const n = it.name.toLowerCase();
        if (seen.has(n)) copies.push(it.key);
        else seen.add(n);
      }
    return copies;
  })();
  const markTopDone = () => {
    setTopDone(true);
    try {
      localStorage.setItem(`top-asked:${galleryId}`, "1");
    } catch {
      /* private mode */
    }
  };
  const assignTop = async () => {
    let sets = data.sets;
    let teaser = sets.find((x) => x.name === "טיזר");
    if (!teaser) {
      teaser = { id: `s${Date.now()}`, name: "טיזר" };
      sets = [teaser, ...sets];
      await save({ sets });
    }
    const items = {};
    const hide = new Set(hideTopCopies ? topCopies : []);
    for (const it of data.items) if (it.folder && topFolders.includes(it.folder)) items[it.key] = hide.has(it.key) ? { set: teaser.id, hidden: true } : { set: teaser.id };
    await save({ items });
    toast.success(`${Object.keys(items).length - hide.size} תמונות שויכו לטיזר${hide.size ? `, ${hide.size} עותקים הוסתרו` : ""}`);
    markTopDone();
  };

  // Lightroom colours.
  const labelCounts = {};
  for (const it of data.items) {
    const c = it.label || (isUnmarked(it) ? "none" : "");
    if (c) labelCounts[c] = (labelCounts[c] || 0) + 1;
  }
  const labeled = data.items.filter((it) => it.label).length;
  const saveLabelMap = async (map) => {
    setLabelMap(map);
    await filmsApi("PUT", "/api/admin/settings", { labelMap: map }).catch((e) => setError(e.message));
  };
  const toggleLabels = async (on) => {
    setLabelsOn(on);
    await filmsApi("PUT", "/api/admin/settings", { labelSetsOn: on }).catch((e) => setError(e.message));
    if (on) {
      if (data.items.some((i) => i.label === undefined)) await readTimes(data);
      else await applyLabels(data);
    }
  };

  // Photos whose capture time is unknown (none in the file, or not read yet).
  const noTime = data.items.filter((i) => typeof i.t !== "number").length;
  const coverItem = data.items.find((i) => i.key === data.cover) || data.items.find((i) => !i.hidden);
  const oneSelected = selected.size === 1 ? [...selected][0] : "";

  return (
    <div className="space-y-5">
      <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">התמונות ({count("all").toLocaleString("he-IL")})</h2>
          <span className={favs.size ? "text-green-300 text-sm" : "text-gray-400 text-sm"} data-testid="fav-summary">
            ♥ הזוג סימן {favs.size}
            {byPerson.length > 0 && <span className="text-gray-500"> ({byPerson.map(([w, n]) => `${w || "ללא שם"} ${n}`).join(" · ")})</span>}
          </span>
        </div>
        {folderRow("טעינה מחדש")}
        <p className="text-xs text-gray-500">טעינה מחדש מוסיפה תמונות חדשות ושומרת את הסטים, תמונת השער והתמונות המוסתרות.</p>
        {error && (
          <p className="text-red-400 text-sm" data-testid="photos-error">
            {error}
          </p>
        )}
        {warning && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-amber-300" data-testid="photos-warning">
            <span>{warning}</span>
            <Button type="button" size="sm" variant="outline" className={btn} disabled={!folder || busy === "load"} onClick={() => load()}>
              טען מחדש
            </Button>
          </div>
        )}
        {!dating && (noTime > 0 || (data.timesV !== 2 && data.items.every((i) => i.label !== undefined))) && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-400" data-testid="no-time">
            {noTime > 0 && <span>{noTime.toLocaleString("he-IL")} תמונות בלי שעת צילום (מוצגות אחרי התמונה שלפניהן לפי שם)</span>}
            <Button type="button" size="sm" variant="outline" className={btn} onClick={() => readTimes(data, { again: true })} data-testid="reread-times">
              קריאת זמנים מחדש
            </Button>
          </div>
        )}
        {dating && (
          <Progress done={dating.done} total={dating.total} testId="dating">
            מסדר את התמונות לפי שעת הצילום
          </Progress>
        )}
        {scan && (
          <Progress done={scan.done} total={scan.total} testId="scan">
            סורק תמונות
          </Progress>
        )}
      </section>

      {!topDone && topFolders.length > 0 && (
        <section className={`${card} border-brand-400/50`} data-testid="top-ask">
          <b className="text-white">
            מצאתי {topFolders.length === 1 ? "תיקיית טופ" : "תיקיות טופ"}: {topFolders.map((f) => `${f} (${data.items.filter((i) => i.folder === f).length})`).join(", ")}. לשייך אותן לסט "טיזר"?
          </b>
          {topCopies.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={hideTopCopies} onChange={(e) => setHideTopCopies(e.target.checked)} /> להסתיר מהזוג {topCopies.length} עותקים כפולים (אותה תמונה ביותר מתיקיית טופ אחת)
            </label>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={assignTop} className="bg-brand-400 hover:bg-brand-500 text-brand-fg" data-testid="top-yes">
              כן, לשייך לטיזר
            </Button>
            <Button type="button" variant="outline" onClick={markTopDone} className={btn} data-testid="top-no">
              לא
            </Button>
          </div>
        </section>
      )}

      <section className={card} data-testid="photo-options">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 w-4 h-4 accent-current"
            checked={data.timeOrder !== false}
            onChange={(e) => {
              const on = e.target.checked;
              setData({ ...data, timeOrder: on });
              save({ timeOrder: on });
            }}
            data-testid="time-order"
          />
          <span className="text-sm text-gray-300">
            <b className="text-white">סידור לפי שעת צילום</b> · התמונות של כל הצלמים על ציר זמן אחד. כבוי: לפי תיקייה ושם קובץ.
          </span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={labelsOn} onChange={(e) => toggleLabels(e.target.checked)} data-testid="labels-on" />
          <span className="text-sm text-gray-300">
            <b className="text-white">שיוך לסטים לפי צבע מלייטרום</b> · תמונה שסומנה בצבע בלייטרום נכנסת לסט של הצבע, ותמונה בלי צבע לסט של "בלי צבע" (רק תמונות שעוד אין להן סט, ולא תיקיות הטופ).
          </span>
        </label>
        {labelsOn && (
          <div className="space-y-2" data-testid="label-map">
            <div className="flex flex-wrap items-center gap-2">
              {LABELS.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300">
                  <span className={`w-2.5 h-2.5 rounded-full ${LABEL_DOT[c]}`} />
                  {LABEL_NAMES[c]}: {labelMap[c] || "בלי סט"} <span className="text-gray-500">{labelCounts[c] || 0}</span>
                </span>
              ))}
              <Button type="button" size="sm" variant="outline" className={btn} onClick={() => setShowLabelMap((v) => !v)}>
                {showLabelMap ? "סגירה" : "שינוי הצבעים"}
              </Button>
              <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => applyLabels(data)} data-testid="labels-apply">
                החלה עכשיו
              </Button>
            </div>
            {labeled === 0 && data.items.every((i) => i.label !== undefined) && (
              <p className="text-xs text-gray-500">לא נמצאו צבעים בקבצים. בייצוא מלייטרום, תחת Metadata, בחרו "All Metadata" (או "All Except Camera Raw Info") כדי שהצבע יישמר בקובץ.</p>
            )}
            {showLabelMap && (
              <div className="flex flex-wrap gap-3">
                {LABELS.map((c) => (
                  <label key={c} className="flex flex-col gap-1 text-xs text-gray-400 min-w-[140px]">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full ${LABEL_DOT[c]}`} />
                      {LABEL_NAMES[c]}
                    </span>
                    <select value={labelMap[c] || ""} onChange={(e) => saveLabelMap({ ...labelMap, [c]: e.target.value })} className="rounded-md bg-gray-800 border border-gray-700 text-white px-2 py-1.5" data-testid={`label-${c}`}>
                      <option value="">בלי סט</option>
                      {data.sets.map((x) => (
                        <option key={x.id} value={x.name}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {coverItem && <CoverPreview src={thumb(coverItem.key, "l")} pos={data.coverPos || { x: 50, y: 50 }} coupleName={coupleName} onChange={(p) => save({ coverPos: p })} />}

      <section className={card}>
        <h2 className="text-lg font-semibold text-white">סטים</h2>
        <div className="flex flex-wrap gap-2" data-testid="sets">
          {data.sets.map((s, i) => (
            <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-brand-400/40 bg-brand-400/5 py-1 pr-3 pl-1 text-sm text-white">
              <b className="font-medium">{s.name}</b>
              <span className="text-xs text-gray-500 font-mono">{count(s.id)}</span>
              <SetButton title="הזזה ימינה" onClick={() => moveSet(i, -1)}>›</SetButton>
              <SetButton title="הזזה שמאלה" onClick={() => moveSet(i, 1)}>‹</SetButton>
              <SetButton title="שינוי שם" onClick={() => renameSet(s)}>✎</SetButton>
              <SetButton title="מחיקה" onClick={() => deleteSet(s)}>×</SetButton>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_SETS.filter((p) => !data.sets.some((s) => s.name === p)).map((p) => (
            <button key={p} type="button" className={chip(false)} onClick={() => addSet(p)} data-testid={`preset-${p}`}>
              + {p}
            </button>
          ))}
          <Input value={newSet} onChange={(e) => setNewSet(e.target.value)} placeholder="שם לסט חדש" maxLength={40} className="bg-gray-800 border-gray-700 text-white w-44" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSet(newSet))} data-testid="new-set-name" />
          <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!newSet.trim()} onClick={() => addSet(newSet)} data-testid="new-set-add">
            + הוספת סט
          </Button>
        </div>
        <p className="text-xs text-gray-500">טיפ: אפשר גם לבחור תמונות וללחוץ "+ סט חדש" בפס שלמטה, והן ייכנסו לסט החדש מיד.</p>
      </section>

      <section className={card}>
        <div className="flex flex-wrap gap-1.5" data-testid="photo-views">
          {[["all", "הכל"], ["unsorted", "ללא סט"], ...data.sets.map((s) => [s.id, s.name]), ["fav", "♥ מועדפי הזוג"], ["insta", "📷 לאינסטגרם"], ["hidden", "מוסתרות"]].map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={chip(view === v)}
              onClick={() => {
                setView(v);
                setSelected(new Set());
              }}
              data-testid={`view-${v}`}
            >
              {label} <span className="opacity-70">{count(v)}</span>
            </button>
          ))}
        </div>
        {folders.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5" data-testid="folder-views">
            <span className="text-xs text-gray-500">תיקיות מהקישור:</span>
            {folders.map((f) => {
              const st = folderState(f);
              return (
                <button
                  key={f}
                  type="button"
                  className={folderChip(view === `folder:${f}`, st.tone)}
                  onClick={() => {
                    setView(`folder:${f}`);
                    setSelected(new Set());
                  }}
                  title={st.title}
                  data-testid="folder-view"
                  data-state={st.tone}
                >
                  📁 {f} <span className="opacity-70">{st.total}</span>
                </button>
              );
            })}
          </div>
        )}
        {view === "fav" && favs.size > 0 && (
          <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyNames(favs)} data-testid="copy-fav-names">
            העתקת שמות הקבצים (לסינון בלייטרום)
          </Button>
        )}
        {view === "insta" && insta.size > 0 && (
          <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyNames(insta)} data-testid="copy-insta-names">
            העתקת שמות הקבצים (לאינסטגרם)
          </Button>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-gray-800/40 px-3 py-2 text-sm" data-testid="select-bar">
          <label className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 whitespace-nowrap ${mixedView ? "border-brand-400 text-brand-300 cursor-pointer" : "border-gray-700 text-gray-500 opacity-60"}`} title={mixedView ? "" : 'עובד בתצוגת "הכל" ובתיקיות מהקישור'}>
            <input type="checkbox" checked={hideSorted} disabled={!mixedView} onChange={(e) => toggleHideSorted(e.target.checked)} data-testid="hide-sorted" />
            <span>
              הסתרת תמונות שכבר שויכו לסט
              {hideSorted && mixedView && <b data-testid="left-to-sort"> · נשארו {shown.length.toLocaleString("he-IL")}</b>}
            </span>
          </label>
          {selected.size === 0 ? (
            <>
              <span className="text-gray-400">לחיצה בוחרת תמונה. Shift+לחיצה בוחרת טווח, למשל כל ההתארגנות מהתמונה הראשונה עד האחרונה.</span>
              {shown.length > 0 && (
                <Button type="button" size="sm" variant="outline" className={btn} onClick={() => setSelected(new Set(shown.map((i) => i.key)))} data-testid="select-all">
                  בחירת כל {shown.length.toLocaleString("he-IL")}
                </Button>
              )}
            </>
          ) : (
            <>
              <b className="text-white">נבחרו {selected.size.toLocaleString("he-IL")}</b>
              <span className="text-gray-400">השיוך בפס שבתחתית המסך. אפשר להמשיך לגלול ולבחור.</span>
            </>
          )}
        </div>
        {hideSorted && mixedView && shown.length === 0 && count(view) > 0 && (
          <p className="py-6 text-center text-sm text-gray-400" data-testid="all-sorted">
            כל התמונות כאן כבר שויכו לסטים (או הוסתרו מהזוג). כדי לראות אותן: לחיצה על סט למעלה, או ביטול הסימון "הסתרת תמונות שכבר שויכו לסט".
          </p>
        )}
        <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(118px, 1fr))" }} data-testid="admin-photos">
          {shown.map((p) => (
            <button
              type="button"
              key={p.key}
              className={`relative aspect-square overflow-hidden rounded-md border-2 bg-black ${selected.has(p.key) ? "border-brand-400" : "border-transparent"}`}
              onClick={(e) => click(p.key, e)}
              title={p.name}
              data-testid="admin-photo"
              data-key={p.key}
            >
              {/* Shown although already in a set (the switch is off): grey, with the set's name. */}
              <img src={thumb(p.key)} alt="" loading="lazy" className={`w-full h-full object-cover ${p.hidden ? "opacity-30" : p.set && mixedView ? "opacity-50 grayscale" : ""}`} />
              {selected.has(p.key) && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-brand-400 text-brand-fg text-xs grid place-items-center font-bold">✓</span>}
              {data.cover === p.key && <span className="absolute top-1 left-1 text-brand-300 drop-shadow">★</span>}
              {favs.has(p.key) && <span className="absolute bottom-1 left-1.5 text-pink-400 drop-shadow">♥</span>}
              {insta.has(p.key) && (
                <span className="absolute top-1 left-6 text-sm drop-shadow" title="הזוג סימן לאינסטגרם">
                  📷
                </span>
              )}
              {p.set && mixedView && <span className="absolute bottom-1 right-1 max-w-[calc(100%-1.6rem)] truncate rounded-full bg-black/65 px-1.5 text-[10px] text-gray-100">{setName(p.set)}</span>}
            </button>
          ))}
        </div>
      </section>

      <AlbumCard
        galleryId={galleryId}
        albumUrl={coupleUrl && data.previewToken ? `${coupleUrl}/album?pt=${encodeURIComponent(data.previewToken)}` : ""}
        printUrl={coupleUrl && data.previewToken ? `${coupleUrl}/print?pt=${encodeURIComponent(data.previewToken)}` : ""}
      />

      <FaceCard
        galleryId={galleryId}
        on={data.faceSearch === true}
        total={data.items.filter((i) => !i.hidden).length}
        scanUrl={coupleUrl && data.previewToken ? `${coupleUrl}/faces?pt=${encodeURIComponent(data.previewToken)}` : ""}
        guestUrl={guestUrl}
        coupleName={coupleName}
        onToggle={async (on) => {
          setData({ ...data, faceSearch: on });
          return save({ faceSearch: on });
        }}
      />

      {selected.size > 0 && (
        <>
          <div style={{ height: 150 }} aria-hidden="true" />
          <div ref={selDockRef} className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-700 bg-gray-950/95 backdrop-blur p-3" data-testid="sel-dock">
            <div className="max-w-5xl mx-auto space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <b className="text-white">נבחרו {selected.size.toLocaleString("he-IL")} תמונות · שיוך לסט:</b>
                <div className="flex flex-wrap gap-1.5">
                  {view === "hidden" ? (
                    <Button type="button" size="sm" variant="outline" className={btn} onClick={() => patchSelected({ hidden: false })} data-testid="show-selected">
                      הצגה לזוג
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className={btn} onClick={() => patchSelected({ hidden: true })} data-testid="hide-selected">
                      הסתרה מהזוג
                    </Button>
                  )}
                  {oneSelected && (
                    <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => save({ cover: oneSelected }).then(() => setSelected(new Set()))} data-testid="set-cover">
                      ★ תמונת שער
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" className={btn} onClick={() => setSelected(new Set())} title="Esc">
                    ניקוי הבחירה
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {data.sets.map((st, i) => (
                  <button key={st.id} type="button" className={chip(false)} onClick={() => patchSelected({ set: st.id })} data-testid="assign-chip" data-set={st.id}>
                    {i < 9 && <kbd className="ml-1 rounded bg-gray-800 px-1 text-xs">{i + 1}</kbd>}
                    {st.name} <span className="opacity-60">{count(st.id)}</span>
                  </button>
                ))}
                <button type="button" className={chip(false)} onClick={() => patchSelected({ set: null })} data-testid="assign-none">
                  <kbd className="ml-1 rounded bg-gray-800 px-1 text-xs">0</kbd>בלי סט
                </button>
                {dockSet === null ? (
                  <button type="button" className={`${chip(false)} border-dashed`} onClick={() => setDockSet(view.startsWith("folder:") ? view.slice(7) : "")} data-testid="dock-new-set">
                    + סט חדש
                  </button>
                ) : (
                  // Not a <form>: the editor may sit inside the gallery's own form.
                  <span className="inline-flex items-center gap-2" role="group" aria-label="סט חדש">
                    <Input
                      autoFocus
                      value={dockSet}
                      onChange={(e) => setDockSet(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setFromSelected(dockSet);
                        }
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setDockSet(null);
                        }
                      }}
                      placeholder="שם הסט"
                      maxLength={40}
                      className="bg-gray-800 border-brand-400 text-white w-48 h-8"
                      data-testid="dock-new-set-name"
                    />
                    <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!dockSet.trim()} onClick={() => setFromSelected(dockSet)} data-testid="dock-new-set-save">
                      יצירה ושיוך
                    </Button>
                    <Button type="button" size="sm" variant="outline" className={btn} onClick={() => setDockSet(null)}>
                      ביטול
                    </Button>
                  </span>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Why the print shop's link gives no files now (the films Worker's `paused`, fix plan P55).
const PRINT_PAUSED = {
  album_open: "הקישור מושהה: האלבום פתוח לעריכה אצל הזוג. הוא יחזור לעבוד כשהזוג ישלח את האלבום שוב.",
  pages_changed: "הקישור מושהה: הזוג שלח מספר דפים שונה מההזמנה ששולמה. אשרו את מספר הדפים החדש בהזמנת האלבום.",
};

/** The couple's album: how far they got, and (once sent) reopening it for changes. */
function AlbumCard({ galleryId, albumUrl, printUrl }) {
  const [info, setInfo] = useState(undefined);
  const [order, setOrder] = useState(null);
  // A sent album whose order was not made (fix plan P57: the send failed half way; the couple's "להמשך ההזמנה" makes it).
  const [orderMissing, setOrderMissing] = useState(false);
  const [shopLink, setShopLink] = useState("");
  // The link's dates and state (fix plan P55): made, ends 30 days on (renewable), passed, paused.
  const [shop, setShop] = useState(null);
  // Album photos the studio hid since: the print shop still gets them (D15), so the studio is told.
  const [hiddenInAlbum, setHiddenInAlbum] = useState(0);
  const load = () => {
    filmsApi("GET", `/api/admin/galleries/${galleryId}/album`)
      .then((r) => {
        setInfo(r.summary);
        setOrder(r.order || null);
        setOrderMissing(Boolean(r.orderMissing));
      })
      .catch(() => setInfo(null));
    filmsApi("GET", `/api/admin/galleries/${galleryId}/print-link`)
      .then((r) => {
        setShopLink(r.url || "");
        setShop(r);
        setHiddenInAlbum(r.hiddenInAlbum || 0);
      })
      .catch(() => {});
  };
  const makeShopLink = async () => {
    try {
      const r = await filmsApi("POST", `/api/admin/galleries/${galleryId}/print-link`);
      setShopLink(r.url);
      setShop(r);
      setHiddenInAlbum(r.hiddenInAlbum || 0);
      copyText(r.url).then((ok) => ok && toast.success("הקישור הועתק. אפשר לשלוח אותו לבית הדפוס."));
    } catch (e) {
      toast.error(e.message);
    }
  };
  // The same link for 30 more days from today (D12(1)).
  const renewShopLink = async () => {
    try {
      const r = await filmsApi("POST", `/api/admin/galleries/${galleryId}/print-link`, { renew: true });
      setShopLink(r.url);
      setShop(r);
      toast.success(`הקישור חודש עד ${formatDateShort(r.expiresAt)}`);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const revokeShopLink = async () => {
    if (!(await confirmDialog("לבטל את הקישור? מי שקיבל אותו לא יוכל להוריד יותר."))) return;
    try {
      await filmsApi("DELETE", `/api/admin/galleries/${galleryId}/print-link`);
      setShopLink("");
      setShop(null);
      toast.success("הקישור בוטל");
    } catch (e) {
      toast.error(e.message);
    }
  };
  useEffect(() => {
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per key; the loader is a plain function recreated every render (listing it would refetch every render)
  }, [galleryId]);
  const unlock = async () => {
    if (!(await confirmDialog("לפתוח את האלבום לעריכה מחדש? הזוג יוכל לשנות אותו ולשלוח שוב. קישור בית הדפוס יושהה עד שישלחו שוב."))) return;
    try {
      const r = await filmsApi("POST", `/api/admin/galleries/${galleryId}/album/unlock`);
      setInfo(r.summary);
      if (r.printPaused) setShop((x) => (x ? { ...x, paused: "album_open" } : x));
      toast.success(r.warning ? `האלבום נפתח לעריכה. ${r.warning}` : "האלבום נפתח לעריכה");
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <section className={card} data-testid="album-card">
      <h2 className="text-lg font-semibold text-white">האלבום של הזוג</h2>
      {info === undefined ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : info === null ? (
        <p className="text-sm text-gray-400">הזוג עוד לא התחיל לעצב. הכפתור "עיצוב האלבום" מופיע להם בגלריה.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-300">
            {info.status === "submitted" ? (
              <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-green-300">נשלח ב-{new Date(info.submittedAt).toLocaleDateString("he-IL")}</span>
            ) : (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-300">בעבודה אצל הזוג</span>
            )}
            <span>{info.spreads} דפים</span>
            <span>{info.photos} תמונות</span>
            {info.extraSpreads > 0 && (
              <b className="text-amber-300">
                {info.extraSpreads} דפים נוספים
                {/* No price when the studio set none (fix plan P53: never a number from the code). */}
                {info.extraCost !== null && info.extraCost !== undefined ? ` · +${info.extraCost} ₪` : " · לא הוגדר מחיר לדף נוסף"}
              </b>
            )}
            {info.empty > 0 && <span className="text-gray-500">{info.empty} משבצות ריקות</span>}
          </div>
          {order && (
            <p className="text-sm text-gray-300" data-testid="album-order-line">
              כשהזוג שלח את האלבום נפתחה הזמנת אלבום, והם ממשיכים בה לבחירת מוצר, כריכה ותשלום.{" "}
              <Link to={`/AlbumOrders/${order.id}`} className="text-brand-400 hover:underline">
                להזמנה
              </Link>
            </p>
          )}
          {orderMissing && (
            <p className="text-sm text-amber-300" data-testid="album-order-missing">
              הזוג שלח את האלבום אבל הזמנת האלבום עוד לא נפתחה. היא תיפתח כשהזוג ילחץ "להמשך ההזמנה" בעמוד האלבום.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {albumUrl && (
              <Button asChild size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
                <a href={albumUrl} target="_blank" rel="noopener noreferrer" data-testid="open-album">
                  צפייה באלבום
                </a>
              </Button>
            )}
            {printUrl && (
              <Button asChild size="sm" variant="outline" className={btn}>
                <a href={printUrl} target="_blank" rel="noopener noreferrer" data-testid="open-print">
                  הורדה לדפוס (300DPI)
                </a>
              </Button>
            )}
            {info.status === "submitted" && (
              <Button type="button" size="sm" variant="outline" className={btn} onClick={unlock} data-testid="unlock-album">
                פתיחה לעריכה מחדש
              </Button>
            )}
          </div>
          <div className="space-y-2 border-t border-gray-800 pt-3" data-testid="print-link-card">
            <b className="text-sm text-white">קישור לבית הדפוס</b>
            <p className="text-xs text-gray-500">
              קישור פרטי לבית הדפוס: מוריד את דפי האלבום כפי שהזוג שלח אותו, באיכות מלאה, בלי סיסמה ובלי לראות שום דבר אחר מהגלריה. עובד 30 יום מיצירתו (אפשר לחדש), גם אחרי שהגלריה נסגרת לזוג.
            </p>
            {shopLink && shop?.expiresAt && (
              <p className={`text-xs ${shop.expired ? "text-red-300" : "text-gray-400"}`} data-testid="print-link-dates">
                {shop.createdAt ? `נוצר ${formatDateShort(shop.createdAt)} · ` : ""}
                {shop.expired ? `פג ב-${formatDateShort(shop.expiresAt)}` : `בתוקף עד ${formatDateShort(shop.expiresAt)}`}
              </p>
            )}
            {shopLink && PRINT_PAUSED[shop?.paused] && (
              <p className="text-xs text-amber-300" data-testid="print-link-paused">
                {PRINT_PAUSED[shop.paused]}
              </p>
            )}
            {hiddenInAlbum > 0 && (
              <p className="text-xs text-amber-300" data-testid="print-hidden-warning">
                {hiddenInAlbum === 1 ? "תמונה אחת באלבום מוסתרת" : `${hiddenInAlbum} תמונות באלבום מוסתרות`} בגלריה. בית הדפוס עדיין יקבל אותן כחלק מהאלבום. כדי להוציא אותן, פתחו את האלבום לעריכה והחליפו אותן.
              </p>
            )}
            {shopLink ? (
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex-1 min-w-[240px] truncate rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300" dir="ltr" data-testid="print-link">
                  {shopLink}
                </div>
                <Button type="button" size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" onClick={() => copyText(shopLink).then((ok) => ok && toast.success("הקישור הועתק"))}>
                  העתקה
                </Button>
                <Button type="button" size="sm" variant="outline" className={btn} onClick={renewShopLink} data-testid="print-link-renew">
                  חידוש ל-30 יום
                </Button>
                <Button type="button" size="sm" variant="outline" className="border-red-500/40 bg-gray-800 text-red-300 hover:bg-gray-700" onClick={revokeShopLink} data-testid="print-link-revoke">
                  ביטול הקישור
                </Button>
              </div>
            ) : info.status === "submitted" ? (
              <Button type="button" size="sm" variant="outline" className={btn} onClick={makeShopLink} data-testid="print-link-create">
                יצירת קישור לבית הדפוס
              </Button>
            ) : (
              <p className="text-xs text-gray-500" data-testid="print-link-not-sent">
                אפשר ליצור קישור לבית הדפוס אחרי שהזוג שולח את האלבום.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Guest face search: guests take a selfie and get only the photos they are in. The scan runs in the
 * studio's browser on the films site (a new tab, as the studio); only numbers are stored, and the
 * server deletes them when this is switched off, when the gallery is deleted, and nightly once the
 * gallery closes.
 */
function FaceCard({ galleryId, on, total, scanUrl, guestUrl, coupleName, onToggle }) {
  const [meta, setMeta] = useState(null);
  const load = () =>
    filmsApi("GET", `/api/admin/galleries/${galleryId}/faces`)
      .then(setMeta)
      .catch(() => setMeta(null));
  useEffect(() => {
    load();
    // Coming back from the scanning tab shows the new count.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- loads once per key; the loader is a plain function recreated every render (listing it would refetch every render)
  }, [galleryId]);
  const toggle = async (next) => {
    if (!next && !(await confirmDialog("לכבות את החיפוש לפי פנים? נתוני הפנים של הגלריה יימחקו, והדף לאורחים יפסיק לעבוד."))) return;
    await onToggle(next);
    load();
  };
  // The server counts by photo keys (fix plan P68): photos shown and scanned, and what is left. A server without
  // those numbers: the old estimate from the totals.
  const keyed = typeof meta?.left === "number";
  const scanned = keyed ? meta.scanned : (meta?.photos ?? 0);
  const shown = keyed ? meta.visible : total;
  const left = keyed ? meta.left : Math.max(0, total - scanned);
  const link = guestUrl ? `${guestUrl}/me` : "";
  return (
    <section className={card} data-testid="face-card">
      <label className="flex items-start gap-3 cursor-pointer">
        <input type="checkbox" className="mt-1 w-4 h-4" checked={on} onChange={(e) => toggle(e.target.checked)} data-testid="face-on" />
        <span className="text-sm text-gray-300">
          <b className="text-white">זיהוי פנים לאורחים</b> · כל אורח מצלם סלפי ומקבל רק את התמונות שבהן הוא מופיע. הסריקה רצה במחשב שלכם והסלפי נבדק בטלפון של האורח: התמונות והסלפי לא נשלחים לשום חברה חיצונית, ונשמרים רק מספרים (לא תמונות של פנים).
        </span>
      </label>
      {!on && meta?.offBecauseDeleted && (
        <p className="text-sm text-amber-300" data-testid="face-off-deleted">
          זיהוי הפנים כובה כי הנתונים נמחקו — הדליקו וסרקו מחדש.
        </p>
      )}
      {on && (
        <>
          {meta === null ? (
            <p className="text-sm text-gray-400">טוען…</p>
          ) : left > 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-amber-300" data-testid="face-status">
                נסרקו {scanned.toLocaleString("he-IL")} מתוך {shown.toLocaleString("he-IL")} תמונות.
                {scanned === 0 && " עד הסריקה, אורחים יראו שהחיפוש עוד לא מוכן."}
              </span>
              {scanUrl && (
                <Button asChild size="sm" className="bg-brand-400 hover:bg-brand-500 text-brand-fg">
                  <a href={scanUrl} target="_blank" rel="noopener noreferrer" data-testid="face-scan">
                    {scanned ? "המשך סריקה" : "סריקת פנים"}
                  </a>
                </Button>
              )}
              <span className="text-xs text-gray-500">נפתחת לשונית חדשה; השאירו אותה פתוחה עד הסוף. אם נעצר, זה ממשיך מאותו מקום.</span>
            </div>
          ) : (
            <p className="text-sm text-green-300" data-testid="face-ready">
              ✓ כל התמונות נסרקו · נמצאו {(meta.faces ?? 0).toLocaleString("he-IL")} פנים
            </p>
          )}
          {link && (
            <div className="space-y-2 border-t border-gray-800 pt-3">
              <b className="text-sm text-white">הקישור לאורחים</b>
              <div className="flex flex-wrap gap-2 items-center">
                <div className="flex-1 min-w-[240px] truncate rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300" dir="ltr" data-testid="face-guest-link">
                  {link}
                </div>
                <Button type="button" size="sm" variant="outline" className={btn} onClick={() => copyText(link).then((ok) => ok && toast.success("הקישור לאורחים הועתק"))}>
                  העתקה
                </Button>
                <Button asChild size="sm" variant="outline" className={btn}>
                  <a href={`https://wa.me/?text=${encodeURIComponent(`מצאו את התמונות שלכם מהחתונה של ${coupleName}: ${link}`)}`} target="_blank" rel="noopener noreferrer">
                    שליחה בוואטסאפ
                  </a>
                </Button>
              </div>
              <p className="text-xs text-gray-500">שלחו לזוג כדי שיעבירו לאורחים, או הדפיסו כ-QR לשולחנות. כל אורח מאשר לפני הסלפי, ונתוני הפנים נמחקים כשהגלריה נסגרת.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SetButton({ title, onClick, children }) {
  return (
    <button type="button" title={title} onClick={onClick} className="px-1 text-gray-400 hover:text-white">
      {children}
    </button>
  );
}

/**
 * How the cover sits on a computer screen and on a phone. Click or drag on the photo to choose
 * the point that stays in view (the couple's names sit over it).
 */
function CoverPreview({ src, pos, coupleName, onChange }) {
  const [p, setP] = useState(pos);
  const dragging = useRef(false);
  useEffect(() => setP(pos), [pos.x, pos.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setP({ x: Math.round(Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))), y: Math.round(Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))) });
  };
  const frame = (cls, label) => (
    <div className="flex flex-col items-center gap-1 text-xs text-gray-500">
      <div className={`relative overflow-hidden bg-cover bg-no-repeat grid place-items-center border border-gray-700 ${cls}`} style={{ backgroundImage: `url(${src})`, backgroundPosition: `${p.x}% ${p.y}%` }}>
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/45" />
        <b className="relative text-white font-light drop-shadow">{coupleName}</b>
      </div>
      {label}
    </div>
  );
  return (
    <section className={card} data-testid="cover-preview">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">תמונת השער</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={btn}
          onClick={() => {
            setP({ x: 50, y: 50 });
            onChange({ x: 50, y: 50 });
          }}
        >
          איפוס למרכז
        </Button>
      </div>
      <p className="text-xs text-gray-500">לחצו או גררו על התמונה כדי לבחור איזה חלק שלה יישאר במרכז. בצד: איך זה ייראה במחשב ובטלפון. את התמונה עצמה בוחרים עם ★ בתמונות למטה.</p>
      <div className="grid gap-4 md:grid-cols-[1fr_1.4fr] items-start">
        <div
          className="relative cursor-crosshair touch-none rounded-lg overflow-hidden bg-black"
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => dragging.current && pick(e)}
          onPointerUp={() => {
            dragging.current = false;
            onChange(p);
          }}
          data-testid="cover-pick"
        >
          <img src={src} alt="" draggable={false} className="block w-full max-h-[360px] object-contain select-none" />
          <span className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-[3px] border-white shadow" style={{ left: `${p.x}%`, top: `${p.y}%` }} />
        </div>
        <div className="flex items-end gap-4">
          {frame("w-[300px] max-w-full aspect-[16/10] rounded-lg text-xl", "מחשב")}
          {frame("w-[110px] aspect-[9/19.5] rounded-2xl text-sm", "טלפון")}
        </div>
      </div>
    </section>
  );
}
