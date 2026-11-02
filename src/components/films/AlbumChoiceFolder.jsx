import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { filmsApi, filmsFile } from "@/lib/filmsApi";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// "בחירת אלבום — תיקייה אחת לכל הגלריות" (Avira, 2026-11-02, the owner's request; 0104). The price list was copied
// into every wedding's cloud folder; now one folder link here, and the gallery Worker adds its photos to every photo
// gallery in the "בחירת אלבום" set (gallery-worker/worker/albumSet.ts). Saving reads the folder, shows its photos
// (measuring their shape, so the couple's grid lays them out right), and puts them into all the galleries there,
// APPLY_BATCH at a time. A gallery with its own price-list folder keeps its own; one gallery can switch it off.

const APPLY_BATCH = 8;
const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";

/** The photos' previews (the screen's session fetches them) and their shape. */
async function previews(items) {
  return Promise.all(
    items.map(async (it) => {
      try {
        const url = URL.createObjectURL(await filmsFile(`/api/admin/album-set/photo/${it.n}`));
        const img = new Image();
        img.src = url;
        await img.decode();
        return { ...it, url, ar: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : it.ar };
      } catch {
        return { ...it, url: "" };
      }
    })
  );
}

export default function AlbumChoiceFolder() {
  const [state, setState] = useState(null); // { albumSet, galleries }
  const [url, setUrl] = useState("");
  const [shown, setShown] = useState([]);
  const [busy, setBusy] = useState(""); // 'save' | 'remove' | progress text

  const show = async (albumSet) => {
    if (!albumSet) return setShown([]);
    const got = await previews(albumSet.items);
    setShown((old) => {
      old.forEach((p) => p.url && URL.revokeObjectURL(p.url));
      return got;
    });
    return got;
  };

  useEffect(() => {
    filmsApi("GET", "/api/admin/album-set")
      .then((d) => {
        setState(d);
        setUrl(d.albumSet?.url || "");
        show(d.albumSet);
      })
      .catch((e) => toast.error(e.message));
    return () => setShown((old) => (old.forEach((p) => p.url && URL.revokeObjectURL(p.url)), []));
  }, []);

  /** Into every photo gallery there, a few at a time. */
  const applyAll = async (galleries) => {
    let changed = 0;
    for (let i = 0; i < galleries.length; i += APPLY_BATCH) {
      setBusy(`מעדכן גלריות… ${Math.min(i + APPLY_BATCH, galleries.length)} מתוך ${galleries.length}`);
      const r = await filmsApi("POST", "/api/admin/album-set/apply", { ids: galleries.slice(i, i + APPLY_BATCH) });
      changed += r.changed.length;
    }
    return changed;
  };

  const save = async (link) => {
    setBusy("save");
    try {
      const d = await filmsApi("PUT", "/api/admin/album-set", { url: link });
      setState(d);
      setUrl(d.albumSet?.url || "");
      const got = (await show(d.albumSet)) || [];
      // The shapes first, so the galleries get them with the photos.
      const ars = Object.fromEntries(got.filter((p) => p.url && p.ar).map((p) => [p.ref, p.ar]));
      if (Object.keys(ars).length) await filmsApi("PUT", "/api/admin/album-set/sizes", { ars });
      const changed = await applyAll(d.galleries);
      toast.success(d.albumSet ? `התיקייה נשמרה (${d.albumSet.items.length} תמונות) ועודכנו ${changed} גלריות` : `התיקייה הוסרה מ-${changed} גלריות`);
    } catch (e) {
      toast.error(e.message);
    }
    setBusy("");
  };

  const remove = async () => {
    if (!(await confirmDialog({ title: "להסיר את תיקיית בחירת האלבום?", message: "התמונות שלה ייצאו מכל הגלריות. גלריות עם תיקיית מחירון משלהן לא משתנות.", confirmText: "הסרה", danger: true }))) return;
    save("");
  };

  const set = state?.albumSet;
  const working = Boolean(busy);
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4" data-testid="album-choice-folder">
      <h2 className="text-lg font-semibold text-white">בחירת אלבום — תיקייה אחת לכל הגלריות</h2>
      <p className="text-sm text-gray-400">
        במקום להעתיק את המחירון לתיקייה של כל אירוע: מדביקים כאן קישור לתיקייה אחת (גוגל דרייב או דרופבוקס, משותפת לכל מי שיש לו את הקישור), והתמונות שלה מופיעות בכל גלריות
        התמונות בסט "בחירת אלבום", בסוף הגלריה. גלריה שיש בה תיקיית מחירון משלה ממשיכה להציג את שלה. האורחים לא רואים את הסט (בכל גלריה אפשר לשנות ב"סטים שהאורחים לא רואים").
        החלפתם קבצים בתיקייה? לוחצים "רענון".
      </p>
      {state === null ? (
        <Loader2 className="w-5 h-5 animate-spin text-gray-500" />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), url.trim() && save(url.trim()))}
              placeholder="https://drive.google.com/drive/folders/…"
              dir="ltr"
              className="bg-gray-800 border-gray-700 text-white flex-1 min-w-[240px]"
              data-testid="album-folder-url"
            />
            <Button type="button" disabled={working || !url.trim()} onClick={() => save(url.trim())} className="bg-brand-400 hover:bg-brand-500 text-brand-fg" data-testid="album-folder-save">
              {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : set && url.trim() === set.url ? <><RefreshCw className="w-4 h-4 ml-1.5" /> רענון</> : "שמירה"}
            </Button>
            {set && (
              <Button type="button" variant="outline" disabled={working} onClick={remove} className={btn} data-testid="album-folder-remove">
                <Trash2 className="w-4 h-4 ml-1.5" /> הסרה
              </Button>
            )}
          </div>
          {busy && busy !== "save" && <p className="text-sm text-brand-300">{busy}</p>}
          {set && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                {set.items.length} תמונות · נקראה {new Date(set.at).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })} · ב-{state.galleries.length} גלריות תמונות
              </p>
              <div className="flex flex-wrap gap-2" data-testid="album-folder-photos">
                {(shown.length ? shown : set.items).map((p) => (
                  <div key={p.ref} className="h-24 rounded bg-gray-800 overflow-hidden" style={{ aspectRatio: p.ar || 0.75 }} title={p.name}>
                    {p.url && <img src={p.url} alt={p.name} className="h-full w-full object-cover" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
