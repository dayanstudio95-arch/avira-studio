import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { filmsApi, filmsConfigured } from "@/lib/filmsApi";
import { formatILS } from "@/lib/money";
import { formatDateShort } from "@/lib/dates";
import { galleryPath } from "@/lib/galleryRoutes";

// What needs attention today in the galleries (ported from the films app's dashboard): open
// galleries, those closing within a week (extend right here), albums the couples sent, the most
// viewed. With album orders (crm): orders waiting for payment and what came in this month.
// Used at the top of the galleries page and, compact, on the main dashboard.

/** "2026-09" in Israel's time (a payment at 01:00 on the 1st belongs to the new month). */
export function israelMonth(value) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(new Date(value)).slice(0, 7);
}

/** Album orders: waiting for payment (count, total) and paid this month (count, total). */
export function orderMoney(orders, now = Date.now()) {
  const month = israelMonth(now);
  const waiting = orders.filter((o) => o.payment_status !== "paid" && (o.workflow_status === "awaiting_payment" || o.payment_status === "transfer_pending_review"));
  const paid = orders.filter((o) => o.payment_status === "paid" && o.paid_at && israelMonth(o.paid_at) === month);
  const sum = (list) => list.reduce((n, o) => n + (Number(o.total_amount) || 0), 0);
  return { waiting: { count: waiting.length, total: sum(waiting) }, paid: { count: paid.length, total: sum(paid) } };
}

const money = (n) => formatILS(n); // whole shekels (fix plan P28, src/lib/money.js)
const tileBase = "dash-card p-4 space-y-2 min-w-0";

// `embed` (the dashboard's fourth row, work order 9.10 item 23): the tiles go straight into the caller's grid
// (a display: contents wrapper), each a glowing card of the row's height, scrolling inside.
// `kind` ("photos" / "films"): the summary of one menu's galleries; without it (the dashboard), both.
export default function GalleriesSummary({ refreshKey, onExtend, compact = false, embed = false, kind = null }) {
  const tile = embed ? `${tileBase} e-scroll overflow-y-auto sm:h-[245px]` : tileBase;
  const { hasModule } = useAuth();
  const crm = hasModule("crm");
  const [d, setD] = useState(null);
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    if (!filmsConfigured()) return;
    filmsApi("GET", `/api/admin/dashboard${kind ? `?kind=${kind}` : ""}`)
      .then(setD)
      .catch(() => setD(null));
  }, [refreshKey, kind]);

  useEffect(() => {
    if (!crm) return;
    supabase
      .from("album_orders")
      .select("total_amount, payment_status, workflow_status, paid_at")
      .then(({ data }) => setOrders(data || []));
  }, [crm, refreshKey]);

  if (!d) return null;
  const m = orders ? orderMoney(orders) : null;
  return (
    <div className={embed ? "contents" : `grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4"}`} data-testid="galleries-summary">
      <div className={tile}>
        <p className="text-sm text-gray-400">גלריות פתוחות</p>
        <p className="text-3xl font-bold text-white" data-testid="sum-open">
          {d.open}
        </p>
        <p className="text-xs text-gray-500">
          {d.closed} נסגרו{d.trash ? ` · ${d.trash} בסל המחזור` : ""}
        </p>
        {m && (
          <div className="border-t border-white/10 pt-2 text-sm space-y-1" data-testid="sum-orders">
            <Link to="/AlbumOrders" className="block text-gray-300 hover:text-white">
              ממתינות לתשלום: <b className="text-amber-300">{m.waiting.count}</b>
              {m.waiting.total > 0 && <span className="text-gray-500"> ({money(m.waiting.total)})</span>}
            </Link>
            <p className="text-gray-300">
              התקבל החודש מאלבומים: <b className="text-green-300">{money(m.paid.total)}</b>
            </p>
          </div>
        )}
      </div>

      <div className={tile} data-testid="sum-closing">
        <p className="text-sm text-gray-400">נסגרות השבוע</p>
        {d.closing.length === 0 ? (
          <p className="text-sm text-gray-500">אין גלריות שנסגרות בשבוע הקרוב.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {d.closing.slice(0, compact ? 4 : 6).map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2">
                <Link to={galleryPath(g)} className="truncate text-gray-200 hover:text-white">
                  {g.coupleName}
                </Link>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-amber-300">{g.daysLeft === 0 ? "היום" : g.daysLeft === 1 ? "מחר" : `עוד ${g.daysLeft} ימים`}</span>
                  {onExtend && (
                    <button type="button" className="text-xs text-sky-300 hover:underline" onClick={() => onExtend(g)} data-testid="sum-extend">
                      הארכה
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {kind !== "films" && (hasModule("photos") || d.albumsSent.length > 0) && (
        <div className={tile} data-testid="sum-albums">
          <p className="text-sm text-gray-400">אלבומים שהזוגות שלחו</p>
          {d.albumsSent.length === 0 ? (
            <p className="text-sm text-gray-500">עוד לא נשלחו אלבומים.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.albumsSent.slice(0, compact ? 4 : 6).map((a) => (
                <li key={a.galleryId} className="flex items-center justify-between gap-2">
                  <Link to={`/photos/${a.galleryId}`} className="truncate text-gray-200 hover:text-white">
                    {a.coupleName}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">{formatDateShort(a.submittedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && (
        <div className={tile} data-testid="sum-viewed">
          <p className="text-sm text-gray-400">הכי נצפות</p>
          {d.mostViewed.length === 0 ? (
            <p className="text-sm text-gray-500">עוד אין צפיות.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {d.mostViewed.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2">
                  <Link to={galleryPath(g)} className="truncate text-gray-200 hover:text-white">
                    {g.coupleName}
                  </Link>
                  <span className="text-xs text-gray-500 shrink-0">{g.views.toLocaleString("he-IL")} צפיות</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
