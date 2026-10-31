import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink, FileText, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { copyText, filmsApi, FILMS_BASE_URL, photoUrl } from "@/lib/filmsApi";
import { formatDateShort, formatDateTime } from "@/lib/dates";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const btn = "border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700";
const photosText = (n) => (n === 1 ? "תמונה אחת" : `${n.toLocaleString("he-IL")} תמונות`);
const SHOWN = 48;

/**
 * The couple's choice for their album (Avira, 2026-10-31, the owner's request; 0099): what they chose (and whether they
 * pressed "סיימנו לבחור"), the album designer's private page to see and download them, the file names for Lightroom,
 * the message to the album group (sent by itself when they press it; again from here), and reopening their hearts.
 * `onChanged(fields)`: the gallery's choice fields after a change, for the list.
 */
export default function ChoiceDialog({ galleryId, coupleName, onClose, onChanged }) {
  const [g, setG] = useState(null);
  const [photos, setPhotos] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([filmsApi("GET", `/api/admin/galleries/${galleryId}`), filmsApi("GET", `/api/admin/galleries/${galleryId}/photos`)])
      .then(([gallery, data]) => {
        setG(gallery);
        setPhotos(data);
      })
      .catch((e) => setError(e.message));
  }, [galleryId]);

  const update = (next) => {
    setG(next);
    onChanged?.({ choiceDoneAt: next.choiceDoneAt, choiceDoneCount: next.choiceDoneCount });
  };
  const run = async (name, fn) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy("");
    }
  };

  const favs = new Set(photos?.favorites || []);
  const chosen = (photos?.items || []).filter((i) => !i.hidden && favs.has(i.key));
  const link = g?.choiceToken ? `${FILMS_BASE_URL}/choice/${g.choiceToken}` : "";
  // The link exists from the couple's press; made here when the studio wants it before.
  const ensureLink = async () => {
    if (link) return link;
    const next = await filmsApi("POST", `/api/admin/galleries/${galleryId}/choice-link`, {});
    update(next);
    return `${FILMS_BASE_URL}/choice/${next.choiceToken}`;
  };
  const sendGroup = () =>
    run("group", async () => {
      if (g.choiceGroupSentAt && !(await confirmDialog(`הקישור כבר נשלח לקבוצת האלבומים ב-${formatDateTime(g.choiceGroupSentAt)}.\nלשלוח שוב?`))) return;
      await ensureLink();
      // A failed send throws (its words come back from gallery-choice-notify).
      await base44.functions.invoke("galleryChoiceNotify", { galleryId });
      update(await filmsApi("GET", `/api/admin/galleries/${galleryId}`));
      toast.success("נשלח לקבוצת האלבומים ✅");
    });
  const reopen = () =>
    run("reopen", async () => {
      if (!(await confirmDialog(`לפתוח ל${coupleName} את הבחירה מחדש?\nהם יוכלו לשנות לבבות וללחוץ שוב "סיימנו לבחור" — ואז תישלח הודעה חדשה לקבוצת האלבומים.`))) return;
      update(await filmsApi("POST", `/api/admin/galleries/${galleryId}/choice/reopen`));
      toast.success("הבחירה נפתחה לזוג");
    });
  const renew = () =>
    run("renew", async () => {
      if (!(await confirmDialog("ליצור קישור הורדה חדש?\nהקישור הנוכחי יפסיק לעבוד מיד, גם אצל מי שכבר קיבל אותו."))) return;
      update(await filmsApi("POST", `/api/admin/galleries/${galleryId}/choice-link`, { renew: true }));
      toast.success("נוצר קישור חדש");
    });
  const stop = () =>
    run("stop", async () => {
      if (!(await confirmDialog("לעצור את קישור ההורדה?\nמי שיש לו את הקישור לא יוכל לפתוח אותו יותר. אפשר ליצור קישור חדש אחר כך."))) return;
      update(await filmsApi("DELETE", `/api/admin/galleries/${galleryId}/choice-link`));
      toast.success("הקישור נעצר");
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl" data-testid="choice-dialog">
        <DialogHeader>
          <DialogTitle>הבחירה של {coupleName} לאלבום</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!g || !photos ? (
          !error && <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-gray-300 space-y-1" data-testid="choice-status">
              {g.choiceDoneAt ? (
                <p>
                  <span className="rounded-full border border-green-500/50 bg-green-500/20 px-2 py-0.5 text-green-300">✓ סיימו לבחור</span> ב-{formatDateShort(g.choiceDoneAt)} · {photosText(g.choiceDoneCount ?? chosen.length)}
                </p>
              ) : (
                <p>עוד לא לחצו "סיימנו לבחור". עד עכשיו סימנו {photosText(chosen.length)}.</p>
              )}
              {g.choiceGroupSentAt && <p className="text-xs text-gray-500">נשלח לקבוצת האלבומים ב-{formatDateTime(g.choiceGroupSentAt)}</p>}
            </div>

            {chosen.length > 0 && (
              <div className="grid grid-cols-6 sm:grid-cols-8 gap-1" data-testid="choice-thumbs">
                {chosen.slice(0, SHOWN).map((p) => (
                  <img key={p.key} src={photoUrl(galleryId, p.key, "m", photos.previewToken, photos.gen)} alt="" loading="lazy" title={p.name} className="aspect-square w-full rounded object-cover bg-black" />
                ))}
                {chosen.length > SHOWN && <div className="aspect-square rounded bg-gray-800 grid place-items-center text-xs text-gray-400">+{(chosen.length - SHOWN).toLocaleString("he-IL")}</div>}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" className="bg-brand-400 hover:bg-brand-500 text-brand-fg" disabled={!chosen.length || !!busy} onClick={() => run("open", async () => window.open(await ensureLink(), "_blank", "noopener"))} data-testid="choice-open">
                <Download className="w-4 h-4 ml-2" />
                הורדה (דף ההורדה)
              </Button>
              <Button type="button" variant="outline" className={btn} disabled={!chosen.length || !!busy} onClick={() => run("copy", async () => (await copyText(await ensureLink())) && toast.success("הקישור להורדה הועתק"))} data-testid="choice-copy">
                <Copy className="w-4 h-4 ml-2" />
                העתקת הקישור להורדה
              </Button>
              <Button
                type="button"
                variant="outline"
                className={btn}
                disabled={!chosen.length}
                onClick={() => copyText(chosen.map((i) => i.name.replace(/\.[^.]+$/, "")).join(", ")).then((ok) => ok && toast.success(`הועתקו ${chosen.length} שמות קבצים`))}
                data-testid="choice-names"
              >
                <FileText className="w-4 h-4 ml-2" />
                שמות הקבצים (לייטרום)
              </Button>
              <Button type="button" variant="outline" className="border-purple-500/40 bg-purple-600/20 text-purple-300 hover:bg-purple-600/30" disabled={!chosen.length || !!busy} onClick={sendGroup} data-testid="choice-group">
                {busy === "group" ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Send className="w-4 h-4 ml-2" />}
                שליחה לקבוצת אלבומים
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 pt-3 text-xs text-gray-400">
              {g.choiceDoneAt && (
                <button type="button" className="inline-flex items-center gap-1 hover:text-white" disabled={!!busy} onClick={reopen} data-testid="choice-reopen">
                  <RotateCcw className="w-3.5 h-3.5" />
                  פתיחת הבחירה מחדש לזוג
                </button>
              )}
              {link && (
                <>
                  <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-white" dir="ltr">
                    <ExternalLink className="w-3.5 h-3.5" />
                    {link.replace(/^https?:\/\//, "").slice(0, 46)}…
                  </a>
                  <button type="button" className="hover:text-white" disabled={!!busy} onClick={renew} data-testid="choice-renew">
                    קישור חדש
                  </button>
                  <button type="button" className="hover:text-red-300" disabled={!!busy} onClick={stop} data-testid="choice-stop">
                    עצירת הקישור
                  </button>
                </>
              )}
              <span>הקישור עובד עד שהגלריה נסגרת.</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
