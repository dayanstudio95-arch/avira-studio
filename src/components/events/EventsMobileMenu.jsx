import React, { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Loader2 } from "lucide-react";

export default function EventsMobileMenu({
  questionnaireLoading,
  isSyncing,
  onQuestionnaire,
  onDuplicates,
  onCSVImport,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const item = (label, onClick, disabled = false, colorClass = "text-gray-300") => (
    <button
      onClick={() => { if (!disabled) { onClick(); setOpen(false); } }}
      disabled={disabled}
      className={`w-full text-right px-4 py-3 text-sm font-medium border-b border-gray-700 last:border-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-700 ${colorClass}`}
    >
      {label}
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-3 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
      >
        <MoreHorizontal className="w-5 h-5" />
        <span className="text-xs">עוד</span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden"
          dir="rtl"
        >
          {item(
            questionnaireLoading ? "שולח שאלון..." : "📋 שאלון הכנה",
            onQuestionnaire,
            questionnaireLoading,
            "text-purple-300"
          )}
          {item(
            isSyncing ? "בודק כפילויות..." : "🔄 בדוק כפילויות",
            onDuplicates,
            isSyncing,
            "text-red-300"
          )}
          {item("📂 ייבוא CSV", onCSVImport, false, "text-gray-300")}
        </div>
      )}
    </div>
  );
}