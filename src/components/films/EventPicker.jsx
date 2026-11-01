import { useEffect, useState } from "react";
import { coupleMatches } from "@films-shared/names";
import { supabase } from "@/api/supabaseClient";
import { Input } from "@/components/ui/input";
import { formatDateShort, israelToday } from "@/lib/dates";

const inputCls = "bg-gray-800 border-gray-700 text-white";

// The event search (an ilike pattern): % * and \ become "_" (one character), so typing them never matches everything.
const cleanEventSearch = (text) => String(text || "").replace(/[%*\\]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);

// "דן ודניאלה" → "דניאלה": the database is asked for the longest name typed, and the answers are kept by coupleMatches,
// so the names find the couple in any order and spelling (Avira, 2026-11-02).
const longestName = (text) =>
  cleanEventSearch(text)
    .split(/\s*(?:&|,|\s)\s*/)
    .map((w) => w.replace(/^ו(?=.{2,})/, ""))
    .sort((a, b) => b.length - a.length)[0] || "";

export const EVENT_FIELDS = "id, couple_names, date, venue, team";

/**
 * The studio's event a gallery belongs to (crm studios; fix plan P57): the couple's album order then joins the
 * order the studio opened for that wedding instead of making a second one. The films Worker checks the event is
 * this studio's. Avira (2026-10-31, the owner's request): before anything is typed it lists the weddings that
 * already happened and didn't get their final link yet (work status: "לינק סופי" empty, "→ זוג" not sent);
 * picking one fills the names, date, venue and photographer, and "שלח לזוג" sends through it.
 * `onPick(id, label, event)`; `onPick("", "")` unlinks.
 */
export default function EventPicker({ eventId, label, onPick }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState([]);
  const [waiting, setWaiting] = useState([]);
  useEffect(() => {
    if (eventId) return;
    let live = true;
    supabase
      .from("events")
      .select(`${EVENT_FIELDS}, final_link, final_done_manual`)
      .lte("date", israelToday())
      .order("date", { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (live && !error) setWaiting((data || []).filter((ev) => !String(ev.final_link || "").trim() && ev.final_done_manual !== true).slice(0, 40));
      });
    return () => {
      live = false;
    };
  }, [eventId]);
  useEffect(() => {
    const t = setTimeout(() => setQuery(cleanEventSearch(search)), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const word = longestName(query);
    if (!word) {
      setFound([]);
      return;
    }
    let live = true;
    supabase
      .from("events")
      .select(EVENT_FIELDS)
      .ilike("couple_names", `%${word}%`)
      .order("date", { ascending: false })
      .limit(40)
      .then(({ data, error }) => {
        if (live && !error) setFound((data || []).filter((ev) => coupleMatches(ev.couple_names || "", query)).slice(0, 10));
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
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש לפי שם הזוג (בכל האירועים)" className={inputCls} data-testid="gallery-event-search" />
          {!query && waiting.length > 0 && <p className="text-xs text-gray-400">אירועים שעוד לא קיבלו את הלינק הסופי:</p>}
          {(query ? found : waiting).length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-gray-800 p-1">
              {(query ? found : waiting).map((ev) => (
                <button
                  key={ev.id}
                  type="button"
                  className="block w-full rounded p-1.5 text-right text-sm text-gray-300 hover:bg-gray-800"
                  onClick={() => {
                    onPick(ev.id, `${ev.couple_names || ""}${ev.date ? ` · ${formatDateShort(ev.date)}` : ""}`, ev);
                    setSearch("");
                  }}
                  data-testid="gallery-event-option"
                >
                  {ev.couple_names} {ev.date ? `· ${formatDateShort(ev.date)}` : ""}
                  {ev.venue ? <span className="text-gray-500"> · {ev.venue}</span> : null}
                </button>
              ))}
            </div>
          )}
          {query && found.length === 0 && <p className="text-xs text-gray-500">לא נמצא אירוע בשם הזה.</p>}
        </>
      )}
    </div>
  );
}
