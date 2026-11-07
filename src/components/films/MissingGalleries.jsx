import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Plus } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { israelToday } from "@/lib/dates";
import { galleryHome } from "@/lib/galleryRoutes";
import { agoText, MISSING_EVENT_FIELDS, MISSING_FROM, missingGalleries } from "@/lib/galleryMissing";

const shortDate = (key) => {
  const [y, m, d] = key.split("-");
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
};

/**
 * "אירועים שעברו ועדיין אין להם גלריה" (Avira, 2026-11-07, the owner's request): under Google Drive on the photo
 * galleries page; "יצירת גלריה" opens a new gallery with the event picked (/photos/new?event=<id>). Nothing when every
 * past wedding has its gallery, or before the list and the events are read (galleryMissing.js).
 */
export default function MissingGalleries({ galleries }) {
  const today = israelToday();
  const [events, setEvents] = useState(null);
  useEffect(() => {
    let live = true;
    supabase
      .from("events")
      .select(MISSING_EVENT_FIELDS)
      .gte("date", MISSING_FROM)
      .lt("date", today)
      .order("date")
      .limit(500)
      .then(({ data, error }) => {
        if (live && !error) setEvents(data || []);
      });
    return () => {
      live = false;
    };
  }, [today]);
  if (!galleries || !events) return null;
  const rows = missingGalleries(events, galleries, today);
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 px-4 py-3" data-testid="missing-galleries">
      <div className="mb-1 flex items-center gap-2">
        <CalendarClock className="h-5 w-5 shrink-0 text-amber-400" />
        <span className="text-sm font-semibold text-amber-200">אירועים שעברו ועדיין אין להם גלריה</span>
        <span className="rounded-full bg-amber-400 px-2 text-xs font-semibold text-amber-950" data-testid="missing-galleries-count">
          {rows.length}
        </span>
        <span className="ms-auto text-xs text-gray-400">מ-{shortDate(MISSING_FROM)}</span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 py-2" data-testid="missing-gallery-row">
          <div className="w-20 shrink-0">
            <div className="text-sm text-gray-100">{shortDate(r.date)}</div>
            <div className="text-xs text-rose-400">{agoText(r.daysAgo)}</div>
          </div>
          <div className="min-w-[8rem] flex-1 text-sm font-semibold text-white">{r.names}</div>
          {r.venue && <div className="hidden w-40 truncate text-sm text-gray-400 sm:block">{r.venue}</div>}
          <div className="flex flex-wrap gap-x-3 text-xs text-gray-300">
            {r.uploads.items.map((i) => (
              <span key={i.label} title={`${i.label}: ${i.done ? "העלה חומרים" : "עוד לא סומן שהעלה"}`} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-full ${i.done ? "bg-emerald-400" : "bg-rose-500"}`} />
                {i.name || i.label}
              </span>
            ))}
          </div>
          <Link
            to={`${galleryHome("photos")}/new?event=${r.id}`}
            className="ms-auto inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500"
            data-testid="missing-gallery-create"
          >
            <Plus className="h-4 w-4" />
            יצירת גלריה
          </Link>
        </div>
      ))}
    </div>
  );
}
