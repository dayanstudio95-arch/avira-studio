import React from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { printDetailsText } from "@/lib/albumPrintDetails";

// Clipboard API first; where it is refused, a hidden textarea and the old copy command.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const copy = async (text, what) => {
  if (await copyText(text)) toast.success(`${what} הועתק`);
  else toast.error("לא הצלחתי להעתיק — סמן את הטקסט והעתק ידנית");
};

function Row({ row }) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.06] py-2 last:border-b-0">
      <span className="w-24 shrink-0 text-sm text-gray-400">{row.label}</span>
      <span className={`flex min-w-0 flex-1 items-center gap-2 text-sm text-white ${row.ltr ? "justify-end" : ""}`} dir={row.ltr ? "ltr" : undefined}>
        {row.image && <img src={row.image} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" />}
        <span className="break-all">{row.value}</span>
      </span>
      <button type="button" onClick={() => copy(row.value, row.label)} className="shrink-0 rounded-md border border-gray-700 px-2 py-0.5 text-xs text-gray-300 hover:bg-gray-800">
        העתק
      </button>
    </div>
  );
}

// "פרטים להזמנה בבית הדפוס" (2026-10-29, the owner's order of fields): what he types into the
// print shop's own order form — product, couple, files link, pages, cover (with its picture),
// engraving, parents' album, mini album; then shipping: name, city, street, phone. Rows
// without a value are not shown (albumPrintDetails.printDetailRows / shippingRows).
export default function PrintOrderDetailsCard({ rows, ship, hasLink }) {
  return (
    <div className="space-y-2 rounded-lg border border-yellow-500/25 bg-yellow-500/[0.04] p-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-white">פרטים להזמנה בבית הדפוס</span>
        <button type="button" onClick={() => copy(printDetailsText(rows, ship), "הכל")} className="flex items-center gap-1 rounded-md bg-yellow-400 px-2.5 py-1 text-xs font-semibold text-gray-900 hover:bg-yellow-500">
          <Copy className="h-3.5 w-3.5" /> העתק הכל
        </button>
      </div>
      <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3">
        {rows.map((r) => <Row key={r.key} row={r} />)}
      </div>
      {!hasLink && <p className="text-xs text-gray-500">הקישור לקבצים ייכנס כאן אחרי "צור קישור חדש".</p>}
      {ship.length > 0 && (
        <>
          <div className="pt-1 text-xs text-gray-400">משלוח</div>
          <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-3">
            {ship.map((r) => <Row key={r.key} row={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
