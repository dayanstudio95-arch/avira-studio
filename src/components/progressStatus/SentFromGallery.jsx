import React from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Images } from "lucide-react";

// "נשלח מהגלריות" under the final-link buttons (Avira, 2026-11-03, 0109): the couple got their gallery from the
// galleries page ("שלח לזוג" there), when, and a way back to that gallery. A send from work status itself says nothing.
export default function SentFromGallery({ event, className = "" }) {
  if (!event?.finalDoneManual || event?.finalSentVia !== "gallery") return null;
  const at = event.finalSentAt ? new Date(event.finalSentAt) : null;
  const when = at && !Number.isNaN(at.getTime()) ? format(at, "d/M HH:mm") : "";
  const path = /^(photos|films)\/[A-Za-z0-9_-]+$/.test(event.finalSentGallery || "") ? `/${event.finalSentGallery}` : null;
  return (
    <div className={`flex items-center gap-1 text-[11px] text-green-300 ${className}`} style={{ direction: "rtl" }} data-testid="sent-from-gallery">
      <Images className="h-3 w-3 shrink-0" />
      <span>נשלח מהגלריות{when ? ` · ${when}` : ""}</span>
      {path && (
        <Link to={path} className="text-green-200 underline hover:text-white">
          פתיחת הגלריה
        </Link>
      )}
    </div>
  );
}
