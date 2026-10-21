import React, { useEffect, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { base64PdfUrl } from "@/lib/pdfPreview";

// A Morning preview (Base64 PDF) inside a window, with "open in a tab" (phones often show a
// PDF only there).
export default function PdfPreview({ base64, title = "תצוגה מקדימה" }) {
  const url = useMemo(() => (base64 ? base64PdfUrl(base64) : null), [base64]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (!url) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{title} — עוד לא הופק, שום מסמך לא נוצר</span>
        <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sky-300 underline">
          <ExternalLink className="h-3.5 w-3.5" /> פתח בלשונית
        </a>
      </div>
      <iframe title={title} src={url} className="h-[55vh] w-full rounded-lg border border-gray-700 bg-white" />
    </div>
  );
}
