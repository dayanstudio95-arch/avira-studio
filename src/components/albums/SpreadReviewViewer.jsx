import React, { useEffect } from "react";
import { X, ChevronLeft, ChevronRight, ExternalLink, MapPin, ImageIcon } from "lucide-react";

// Studio-side full-screen viewer for one album spread, showing the couple's
// correction pin exactly where they placed it plus the note text beside it.
// Read-only: every spread/decision is passed in from AlbumOrderDetail, nothing
// is fetched or written here.

// Also used by the grid cards in AlbumOrderDetail, so both places always read
// the couple's verdict the same way. "pending" covers both "the couple hasn't
// reviewed this version yet" and "no review round exists at all".
export const SPREAD_STATUS_STYLES = {
  approved: { label: "אושר", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  needs_revision: { label: "תיקון", className: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30" },
  pending: { label: "ממתין", className: "bg-gray-700/60 text-gray-300 border-gray-600" },
};

export default function SpreadReviewViewer({
  spreads,
  index,
  decisionBySpreadId,
  authorName,
  onNavigate,
  onClose,
  onOpenFullRes,
}) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      // The page is RTL, but ArrowRight/ArrowLeft are physical keys -- keep them
      // mapped to physical direction so they match the on-screen arrows.
      else if (e.key === "ArrowLeft") onNavigate(1);
      else if (e.key === "ArrowRight") onNavigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNavigate]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  const spread = spreads[index];
  if (!spread) return null;

  const decision = decisionBySpreadId[spread.id];
  const status = SPREAD_STATUS_STYLES[decision?.decision] || SPREAD_STATUS_STYLES.pending;
  const hasNote = decision?.decision === "needs_revision";
  const hasPin = hasNote && decision.pointX != null && decision.pointY != null;

  return (
    <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col" dir="rtl">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-white font-medium">עמוד {spread.sequenceNumber}</span>
          <span className="text-gray-500 text-sm">{index + 1} / {spreads.length}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${status.className}`}>{status.label}</span>
          {hasNote && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-yellow-400 text-gray-900 font-medium">
              <MapPin className="w-3 h-3" />
              סימון 1
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenFullRes(spread.fileKey)}
            className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white border border-gray-700 hover:bg-gray-800 rounded-lg px-3 py-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            פתח באיכות מקורית
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="סגירה"
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row-reverse">
        <div className="flex-1 min-h-0 relative flex items-center justify-center p-4">
          {spread.thumbUrl ? (
            // The wrapper must shrink-wrap the image: point_x/point_y were captured
            // as percentages of the <img> box itself in the couple's portal
            // (AlbumPortal.jsx handleImageClick), so anchoring the pin to the
            // centering container instead would place it off-target.
            <div className="relative inline-block max-w-full max-h-full">
              <img
                src={spread.thumbUrl}
                alt={`עמוד ${spread.sequenceNumber}`}
                className="block max-w-full max-h-full w-auto h-auto object-contain"
              />
              {hasPin && (
                <span
                  className="absolute w-7 h-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 text-gray-900 text-xs font-bold border-2 border-white shadow-lg flex items-center justify-center"
                  style={{ left: `${decision.pointX}%`, top: `${decision.pointY}%` }}
                >
                  1
                </span>
              )}
            </div>
          ) : (
            <div className="text-gray-600 flex flex-col items-center gap-2">
              <ImageIcon className="w-8 h-8" />
              <span className="text-sm">אין תצוגה מקדימה לעמוד זה</span>
            </div>
          )}

          {/* RTL: "previous" sits on the right, "next" on the left. */}
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            disabled={index <= 0}
            aria-label="העמוד הקודם"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 text-white flex items-center justify-center"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={index >= spreads.length - 1}
            aria-label="העמוד הבא"
            className="absolute left-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-20 text-white flex items-center justify-center"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        </div>

        <div className="w-full md:w-72 shrink-0 border-t md:border-t-0 md:border-l border-gray-800 overflow-y-auto p-4 space-y-3">
          <p className="text-gray-400 text-sm">הערות לעמוד זה ({hasNote ? 1 : 0})</p>
          {hasNote ? (
            <div className="border border-gray-800 bg-gray-900/60 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-gray-400 text-xs">{authorName || "הזוג"}</span>
                <span className="w-5 h-5 rounded-full bg-yellow-400 text-gray-900 text-[11px] font-bold flex items-center justify-center shrink-0">
                  1
                </span>
              </div>
              <p className="text-white text-sm whitespace-pre-wrap break-words">
                {decision.comment || "סומן לתיקון ללא הערה"}
              </p>
            </div>
          ) : (
            <p className="text-gray-600 text-sm">אין הערות לעמוד זה</p>
          )}
        </div>
      </div>
    </div>
  );
}
