import React, { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Trash2 } from "lucide-react";

export default function MobileMoreMenu({
  selectedIds,
  convertingId,
  onBulkStatus,
  onBulkSync,
  onBulkDeposit,
  onBulkDelete,
  onAssignIds,
  onFixMissing,
  onCSVImport,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const item = (label, onClick, extra = "") => (
    <button
      onClick={() => { onClick(); setOpen(false); }}
      className={`w-full text-right px-4 py-3 text-sm font-medium border-b border-gray-700 last:border-0 hover:bg-gray-700 transition-colors ${extra}`}
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
        <div className="absolute left-0 top-full mt-1 w-52 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden" dir="rtl">
          {selectedIds.size > 0 && (
            <>
              {item(`🔄 שנה סטטוס (${selectedIds.size})`, onBulkStatus, "text-blue-300")}
              {item("🔗 סנכרן לאירועים", onBulkSync, "text-purple-300")}
              {item("💰 מקדמה ₪500", onBulkDeposit, "text-emerald-300")}
              {item(`🗑️ מחק ${selectedIds.size} מסומנים`, onBulkDelete, "text-red-300")}
            </>
          )}
          {item("🔢 שייך IDs", onAssignIds, "text-purple-300")}
          {item("🔧 תיקון חסרים", onFixMissing, "text-red-300")}
          {item("📂 ייבוא CSV", onCSVImport, "text-gray-300")}
        </div>
      )}
    </div>
  );
}