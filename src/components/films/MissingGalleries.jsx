import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ImageOff, Plus } from "lucide-react";
import { supabase } from "@/api/supabaseClient";
import { israelToday } from "@/lib/dates";
import { galleryHome } from "@/lib/galleryRoutes";
import { agoText, MISSING_EVENT_FIELDS, MISSING_FROM, missingGalleries } from "@/lib/galleryMissing";
import ShooterDots from "@/components/films/ShooterDots";

// The weddings with no gallery yet (Avira, 2026-11-07; 2026-11-09, the owner's request: "אני רוצה לראות במסך הזה את
// הגלריות שעוד לא יצרתי") — red rows inside the photo galleries list, in their month, up to and including today;
// "יצירת גלריה" opens a new gallery with the event picked (/photos/new?event=<id>). galleryMissing.js decides which.

const shortDate = (key) => {
  const [y, m, d] = key.split("-");
  return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
};

const createLink = (r) => `${galleryHome("photos")}/new?event=${r.id}`;

/** The rows ({ id, date, names, venue, daysAgo, uploads }) once the galleries and the events are read; [] before. */
export function useMissingGalleries(galleries, enabled) {
  const today = israelToday();
  const [events, setEvents] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    supabase
      .from("events")
      .select(MISSING_EVENT_FIELDS)
      .gte("date", MISSING_FROM)
      .lte("date", today)
      .order("date")
      .limit(500)
      .then(({ data, error }) => {
        if (live && !error) setEvents(data || []);
      });
    return () => {
      live = false;
    };
  }, [enabled, today]);
  if (!enabled || !galleries || !events) return [];
  return missingGalleries(events, galleries, today);
}

function NoGalleryThumb({ r }) {
  return (
    <Link to={createLink(r)} tabIndex={-1} aria-hidden="true" className="shrink-0 w-24 h-[68px] rounded-md border border-dashed border-rose-500/60 bg-rose-500/5 flex items-center justify-center">
      <ImageOff className="w-5 h-5 text-rose-400" />
    </Link>
  );
}

function CreateButton({ r }) {
  return (
    <Link
      to={createLink(r)}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-brand-400 px-3 py-1.5 text-sm font-semibold text-brand-fg hover:bg-brand-500"
      data-testid="missing-gallery-create"
    >
      <Plus className="h-4 w-4" />
      יצירת גלריה
    </Link>
  );
}

/** A table row in the galleries list (photos, with the events module: 11 columns). */
export function MissingRow({ r }) {
  return (
    <tr className="border-t border-gray-800 bg-rose-500/[0.07] hover:bg-rose-500/10" data-testid="missing-gallery-row">
      <td className="p-3 border-r-2 border-rose-500" />
      <td className="p-1" />
      <td className="p-3 whitespace-nowrap">
        <div>{shortDate(r.date)}</div>
        <div className="text-xs text-rose-400">{agoText(r.daysAgo)}</div>
      </td>
      <td className="p-2 font-medium">
        <div className="flex items-center gap-3 min-w-[200px]">
          <NoGalleryThumb r={r} />
          <div className="min-w-0">
            <div>{r.names}</div>
            <div className="text-xs text-rose-400" data-testid="row-alert">עוד לא נוצרה גלריה</div>
          </div>
        </div>
      </td>
      <td className="p-3 text-gray-400">{r.venue}</td>
      <td className="p-3 text-gray-300" data-testid="photographer">
        <ShooterDots up={r.uploads} />
      </td>
      <td className="p-3 text-gray-500">—</td>
      <td className="p-3" />
      <td className="p-3" />
      <td className="p-3" />
      <td className="p-3">
        <div className="flex justify-end">
          <CreateButton r={r} />
        </div>
      </td>
    </tr>
  );
}

/** The same wedding in the cards view. */
export function MissingCard({ r }) {
  return (
    <div className="relative rounded-xl border border-rose-500/60 bg-gray-900 overflow-hidden" data-testid="missing-gallery-card">
      <Link to={createLink(r)} className="flex aspect-[3/2] items-center justify-center gap-2 border-b border-dashed border-rose-500/40 bg-rose-500/5 text-sm text-rose-300">
        <ImageOff className="w-5 h-5" />
        עוד לא נוצרה גלריה
      </Link>
      <div className="p-3 space-y-2">
        <div className="font-semibold text-white truncate">{r.names}</div>
        <div className="text-xs text-gray-400 truncate">
          {shortDate(r.date)} · <span className="text-rose-400">{agoText(r.daysAgo)}</span>
          {r.venue && <> · {r.venue}</>}
        </div>
        <div className="text-gray-300">
          <ShooterDots up={r.uploads} inline />
        </div>
        <div className="flex justify-end">
          <CreateButton r={r} />
        </div>
      </div>
    </div>
  );
}
