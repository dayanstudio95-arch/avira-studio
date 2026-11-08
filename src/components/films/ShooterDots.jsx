import { uploadsTitle } from "@/lib/galleryUploads";

/**
 * The photographers of a gallery's wedding, each with a dot (2026-11-09, the owner's request, as on work status): green =
 * uploaded the material ("צלם 1" / "צלם 2" marked there), red = not yet. `up` = uploadsOf(...); without a linked event
 * (no `up`) the gallery's own photographer, with no dot. `inline` for the cards' details line.
 */
export default function ShooterDots({ up, fallback = "", inline = false }) {
  if (!up) return fallback ? <span>{fallback}</span> : null;
  return (
    <span title={uploadsTitle(up)} className={inline ? "inline-flex flex-wrap gap-x-2" : "flex flex-col gap-0.5"} data-testid="shooters">
      {up.items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs" data-testid="shooter" data-done={i.done ? "1" : "0"}>
          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${i.done ? "bg-emerald-400" : "bg-rose-500"}`} aria-label={i.done ? "העלה חומרים" : "עוד לא העלה"} />
          {i.name || i.label}
        </span>
      ))}
    </span>
  );
}
