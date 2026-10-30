import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BookOpen, Copy, ExternalLink, Printer, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { coupleLink, copyText, filmsApi, filmsConfigured } from "@/lib/filmsApi";
import { confirmDialog } from "@/lib/confirmDialog";

// From Studio Plan's hub (2026-10-30); Avira: its buttons get Avira's dark outline style.
// An album order the couple designed themselves in their photo gallery (album_orders.source =
// 'couple_designer', migration 0080). It has no uploaded sketch: the pages are the couple's design
// on the films site, so this card opens it there and gives the print files (both as the studio,
// with the gallery's short-lived preview token), and copies the couple's link to this order.
// `onCoupleLink(url)` hands that link to the order page, which sends it in its WhatsApp messages
// (fix plan P56: the studio's own portal link is not in this browser for such an order).
// Fix plan P55: when the couple sent the album again after paying, with another page count, the print shop's link
// waits; 'אישור N דפים' accepts the count of the album as SENT (the films Worker sets it on the order).
//
// Only a 404 means the gallery is gone (fix plan P56). Any failure used to show "נמחקה", so a
// network blip or a Worker error told the studio the couple's gallery had been deleted.
function failureOf(results) {
  const statuses = results.filter((r) => r.status === "rejected").map((r) => r.reason?.status);
  if (!statuses.length) return null;
  if (statuses.includes(404)) return "missing";
  if (statuses.some((st) => st === 401 || st === 403)) return "forbidden";
  return "error";
}

export default function DesignedAlbumCard({ order, onCoupleLink, onChanged }) {
  const { tenant, hasModule, user } = useAuth();
  // /films is not routed for an album manager (App.jsx): "לגלריה" is for the studio's managers only (U1).
  const canOpenGallery = isAdmin(user);
  const galleryId = order.filmsGalleryId;
  // { previewToken, summary, coupleLink } | { failed: 'missing' | 'forbidden' | 'error' }
  const [info, setInfo] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const photosOn = hasModule("photos");

  useEffect(() => {
    if (!galleryId || !filmsConfigured() || !photosOn) return;
    let cancelled = false;
    setInfo(null);
    Promise.allSettled([filmsApi("GET", `/api/admin/galleries/${galleryId}`), filmsApi("GET", `/api/admin/galleries/${galleryId}/album`)])
      .then((results) => {
        if (cancelled) return;
        const failed = failureOf(results);
        if (failed) return setInfo({ failed });
        const [g, a] = results.map((r) => r.value);
        setInfo({ previewToken: g?.previewToken || "", summary: a?.summary, coupleLink: a?.order?.coupleLink || "", print: a?.print || null, orderSpreads: a?.order?.spreads ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [galleryId, photosOn, attempt]);

  const coupleOrderLink = info?.coupleLink || "";
  useEffect(() => {
    onCoupleLink?.(coupleOrderLink);
  }, [coupleOrderLink, onCoupleLink]);

  const [confirming, setConfirming] = useState(false);
  const sentSpreads = info?.print?.sentSpreads;
  const confirmPages = async () => {
    if (!(await confirmDialog(`לאשר ${sentSpreads} דפים להזמנה ששולמה? המחיר בהזמנה לא משתנה — הפרש, אם יש, מסדירים עם הזוג. קישור בית הדפוס יחזור לעבוד.`))) return;
    setConfirming(true);
    try {
      await filmsApi("POST", `/api/admin/galleries/${galleryId}/album/confirm-pages`);
      toast.success(`מספר הדפים אושר: ${sentSpreads}`);
      setAttempt((n) => n + 1);
      onChanged?.();
    } catch (e) {
      toast.error(e.message);
    }
    setConfirming(false);
  };

  const base = galleryId ? coupleLink(tenant?.slug, galleryId) : "";
  const withToken = (path) => `${base}${path}${info?.previewToken ? `?pt=${encodeURIComponent(info.previewToken)}` : ""}`;
  const pages = order.designedSpreadCount ?? info?.summary?.spreads;

  return (
    <Card className="bg-gray-900/50 border-gray-800" data-testid="designed-album-card">
      <CardHeader>
        <CardTitle className="text-white text-lg flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-brand-400" />
          עוצב על ידי הזוג
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-gray-300">
          הזוג עיצב את האלבום בגלריית התמונות שלו{pages != null ? ` (${pages} דפים)` : ""}. אין כאן סקיצה להעלות: העמודים הם העיצוב שלהם, ומהם יוצאים קבצי הדפוס.
        </p>
        {!galleryId || info?.failed === "missing" ? (
          <p className="text-gray-500" data-testid="designed-missing">הגלריה של האלבום נמחקה, ולכן אין גישה לעיצוב ולקבצים.</p>
        ) : !filmsConfigured() || !photosOn ? (
          <p className="text-gray-500">הפתיחה והקבצים לדפוס זמינים עם מודול גלריות התמונות.</p>
        ) : !info ? (
          <p className="text-gray-500">טוען…</p>
        ) : info.failed === "forbidden" ? (
          <p className="text-gray-500" data-testid="designed-forbidden">אין הרשאה לפתוח את הגלריה של האלבום (רק מנהלי הסטודיו).</p>
        ) : info.failed ? (
          <div className="flex items-center gap-3 flex-wrap" data-testid="designed-error">
            <p className="text-amber-400">לא הצלחנו לטעון את פרטי הגלריה. נסו שוב.</p>
            <Button variant="outline" size="sm" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700" onClick={() => setAttempt((n) => n + 1)}>
              <RefreshCw className="w-4 h-4 ml-2" />
              נסו שוב
            </Button>
          </div>
        ) : (
          <>
          {info.print?.paused === "pages_changed" && (
            <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 space-y-2" data-testid="designed-pages-changed">
              <p className="text-amber-300">
                הזוג שלח את האלבום שוב אחרי התשלום עם {sentSpreads} דפים (בהזמנה ששולמה: {info.orderSpreads ?? "?"}). קישור בית הדפוס מושהה עד שתאשרו את מספר הדפים החדש.
              </p>
              <Button size="sm" variant="outline" className="border-amber-700 text-amber-200" disabled={confirming} onClick={confirmPages} data-testid="designed-confirm-pages">
                אישור {sentSpreads} דפים
              </Button>
            </div>
          )}
          {info.print?.paused === "album_open" && (
            <p className="text-amber-300" data-testid="designed-album-open">האלבום פתוח לעריכה אצל הזוג: קישור בית הדפוס מושהה עד שישלחו אותו שוב.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
              <a href={withToken("/album")} target="_blank" rel="noreferrer" data-testid="designed-open">
                <ExternalLink className="w-4 h-4 ml-2" />
                פתיחת האלבום
              </a>
            </Button>
            <Button asChild variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
              <a href={withToken("/print")} target="_blank" rel="noreferrer" data-testid="designed-print">
                <Printer className="w-4 h-4 ml-2" />
                קבצים לדפוס
              </a>
            </Button>
            {canOpenGallery && (
              <Button asChild variant="outline" className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700">
                <Link to={`/photos/${galleryId}`}>לגלריה</Link>
              </Button>
            )}
            {info?.coupleLink && (
              <Button
                variant="outline"
                className="border-gray-700 bg-gray-800 text-gray-200 hover:bg-gray-700"
                onClick={async () => {
                  if (await copyText(info.coupleLink)) toast.success("הקישור של הזוג להזמנה הועתק");
                }}
                data-testid="designed-copy-link"
              >
                <Copy className="w-4 h-4 ml-2" />
                הקישור של הזוג להזמנה
              </Button>
            )}
          </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
