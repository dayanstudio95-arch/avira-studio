// Global cross-entity search (2026-08-21) — searches leads + events + staff at once
// from anywhere in the app, reachable via the header search button or Ctrl/Cmd+K.
// Rendered only for non-scoped (admin-equivalent) roles — see Layout.jsx's
// `{!scopedRole && <GlobalSearch />}` guard, same pattern already used for the
// menu-edit button/secondary nav/quick-stats/AIAssistant: scoped roles (lead_coordinator,
// photographer, editor, album_manager) each already have a single-purpose narrow app and
// a cross-entity search bar doesn't fit that scoped experience.
//
// Deliberately does its own direct Supabase queries (via the exported `supabase` client
// from src/api/supabaseClient.js — same precedent as StudioDetailsCard.jsx's Storage
// calls) rather than a new Edge Function: RLS already scopes every one of these 3 tables
// to the caller's own tenant, so there is nothing a server-side function would add here
// except latency. Results are best-effort/independent per table — one table's query
// failing never blocks the other two.
//
// "Jump to" a result navigates to the page that already owns that record's real detail
// UI (UnifiedSidePanel for leads/events, the events dialog on TeamMembers) via a
// `?open<Entity>Id=` query param, which each target page reads once on load — mirrors
// the existing `?filter=` param pattern already used by src/pages/Events.jsx. No new
// detail UI is built here; this component only finds records and hands off to the page
// that already knows how to display them.
import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon, Heart, CalendarDays, Users, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { supabase } from "@/api/supabaseClient";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 5;
const EMPTY_RESULTS = { leads: [], events: [], staff: [] };

function safeFormatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString("he-IL");
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState(EMPTY_RESULTS);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  // Ctrl/Cmd+K opens the palette from anywhere in the app.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      setResults(EMPTY_RESULTS);
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const term = `%${q}%`;
      try {
        const [leadsRes, eventsRes, staffRes] = await Promise.all([
          supabase
            .from("leads")
            .select("id, couple_names, phone_number")
            .or(`couple_names.ilike.${term},phone_number.ilike.${term}`)
            .order("created_at", { ascending: false })
            .limit(RESULT_LIMIT),
          supabase
            .from("events")
            .select("id, couple_names, venue, date")
            .or(`couple_names.ilike.${term},venue.ilike.${term}`)
            .order("date", { ascending: false })
            .limit(RESULT_LIMIT),
          supabase
            .from("staff_members")
            .select("id, name, phone_number")
            .ilike("name", term)
            .limit(RESULT_LIMIT),
        ]);
        setResults({
          leads: leadsRes.data || [],
          events: eventsRes.data || [],
          staff: staffRes.data || [],
        });
      } catch (err) {
        console.error("Global search failed:", err);
        setResults(EMPTY_RESULTS);
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  const closeAndReset = () => {
    setOpen(false);
    setQuery("");
    setResults(EMPTY_RESULTS);
  };

  const goToLead = (id) => { navigate(`/Leads?openLeadId=${id}`); closeAndReset(); };
  const goToEvent = (id) => { navigate(`/Events?openEventId=${id}`); closeAndReset(); };
  const goToStaff = (id) => { navigate(`/TeamMembers?openStaffId=${id}`); closeAndReset(); };

  const trimmedQuery = query.trim();
  const hasResults = results.leads.length > 0 || results.events.length > 0 || results.staff.length > 0;

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        className="text-gray-400 hover:text-white hover:bg-gray-800"
        title="חיפוש (Ctrl+K)"
      >
        <SearchIcon className="w-5 h-5" />
      </Button>

      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeAndReset())}>
        <DialogContent className="overflow-hidden p-0 bg-gray-900 border-gray-800 max-w-xl">
          <Command shouldFilter={false} className="bg-gray-900 text-white">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="חיפוש לידים, אירועים וצוות..."
              className="text-white placeholder:text-gray-500"
            />
            <CommandList>
              {isLoading && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> מחפש...
                </div>
              )}

              {!isLoading && trimmedQuery.length < MIN_QUERY_LENGTH && (
                <div className="py-6 text-center text-sm text-gray-500">
                  הקלד/י לפחות 2 תווים לחיפוש
                </div>
              )}

              {!isLoading && trimmedQuery.length >= MIN_QUERY_LENGTH && !hasResults && (
                <CommandEmpty className="py-6 text-center text-sm text-gray-400">
                  לא נמצאו תוצאות עבור "{trimmedQuery}"
                </CommandEmpty>
              )}

              {results.leads.length > 0 && (
                <CommandGroup heading="לידים">
                  {results.leads.map((lead) => (
                    <CommandItem
                      key={`lead-${lead.id}`}
                      value={`lead-${lead.id}`}
                      onSelect={() => goToLead(lead.id)}
                      className="text-gray-200 cursor-pointer"
                    >
                      <Heart className="text-pink-400 shrink-0" />
                      <span className="flex-1">{lead.couple_names}</span>
                      {lead.phone_number && (
                        <span className="text-xs text-gray-500">{lead.phone_number}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.events.length > 0 && (
                <CommandGroup heading="אירועים">
                  {results.events.map((event) => (
                    <CommandItem
                      key={`event-${event.id}`}
                      value={`event-${event.id}`}
                      onSelect={() => goToEvent(event.id)}
                      className="text-gray-200 cursor-pointer"
                    >
                      <CalendarDays className="text-yellow-400 shrink-0" />
                      <span className="flex-1">{event.couple_names}</span>
                      <span className="text-xs text-gray-500">
                        {[safeFormatDate(event.date), event.venue].filter(Boolean).join(" · ")}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {results.staff.length > 0 && (
                <CommandGroup heading="צוות">
                  {results.staff.map((staff) => (
                    <CommandItem
                      key={`staff-${staff.id}`}
                      value={`staff-${staff.id}`}
                      onSelect={() => goToStaff(staff.id)}
                      className="text-gray-200 cursor-pointer"
                    >
                      <Users className="text-blue-400 shrink-0" />
                      <span className="flex-1">{staff.name}</span>
                      {staff.phone_number && (
                        <span className="text-xs text-gray-500">{staff.phone_number}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
