import React from "react";
import { Link } from "react-router-dom";
import { dayMonth, filmStateOf, lastFix, pendingFix } from "@/lib/videoEditing";

// Under the editor's square on work status (2026-11-06, the owner's choice): the film went to the couple from
// "עריכת וידאו" — when, and whether it was backed up; or the editor pasted it and it waits to be sent. A correction
// the editor finished waits the same way, and once sent shows beside the film's day.
// "סופי" / "→ זוג" stay the photo gallery's.
export default function FilmLine({ event }) {
  const fix = pendingFix(event);
  if (fix) {
    return (
      <Link to="/VideoEditing" className="whitespace-nowrap text-[10px] text-amber-300 underline hover:text-amber-200" data-testid="film-line">
        🛠️ תיקון {fix.n} מוכן לשליחה
      </Link>
    );
  }
  if (event?.filmSentAt) {
    const last = lastFix(event);
    return (
      <span className="whitespace-nowrap text-[10px] text-green-300" data-testid="film-line">
        🎬 נשלח {dayMonth(event.filmSentAt)}{last?.sentAt ? ` · תיקון ${last.n} ${dayMonth(last.sentAt)}` : ""}{event.filmBackedUpAt ? " · גובה" : ""}
      </span>
    );
  }
  if (filmStateOf(event) === "ready") {
    return (
      <Link to="/VideoEditing" className="whitespace-nowrap text-[10px] text-amber-300 underline hover:text-amber-200" data-testid="film-line">
        🎬 מוכן לשליחה
      </Link>
    );
  }
  return null;
}
