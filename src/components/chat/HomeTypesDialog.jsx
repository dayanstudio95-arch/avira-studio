import React, { useState } from "react";
import { Loader2, X } from "lucide-react";
import { HOME_TYPE_OPTIONS, DEFAULT_HOME_TYPES } from "@/lib/chatModel";

// "מה מופיע בשיחות" (2026-10-12, the owner's request): which kinds of chats appear in the
// home list, like WhatsApp's main list. Groups are off by default. Saved per user
// (profiles.chat_prefs.homeTypes) — no code to change it. Hidden chats are still in their
// own boxes (לקוחות, קבוצות…) under "עוד".
export default function HomeTypesDialog({ value, onSave, onClose }) {
  const [picked, setPicked] = useState(() => new Set(value));
  const [saving, setSaving] = useState(false);
  const toggle = (k) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const save = async () => {
    setSaving(true);
    const ok = await onSave(HOME_TYPE_OPTIONS.map((o) => o.key).filter((k) => picked.has(k)));
    setSaving(false);
    if (ok) onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center" onClick={onClose}>
      <div role="dialog" aria-label="מה מופיע בשיחות" onClick={(e) => e.stopPropagation()} className="w-full rounded-t-3xl border-t border-gray-800 bg-gray-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:w-[380px] md:rounded-2xl md:border">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-bold text-white">מה מופיע ב"שיחות"</span>
          <button type="button" onClick={onClose} aria-label="סגור" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-800"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 text-xs text-gray-400">סמנו אילו שיחות יופיעו ברשימה הראשית. מה שלא מסומן עדיין נמצא בתיבה שלו תחת "עוד".</p>
        <div className="grid grid-cols-2 gap-1.5">
          {HOME_TYPE_OPTIONS.map((o) => (
            <label key={o.key} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${picked.has(o.key) ? "border-emerald-600/60 bg-emerald-500/10 text-white" : "border-gray-800 bg-gray-900 text-gray-400"}`}>
              <input type="checkbox" checked={picked.has(o.key)} onChange={() => toggle(o.key)} className="h-4 w-4 accent-emerald-500" />
              {o.label}
            </label>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={save} disabled={saving || picked.size === 0} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-gray-950 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} שמור
          </button>
          <button type="button" onClick={() => setPicked(new Set(DEFAULT_HOME_TYPES))} className="rounded-xl px-3 text-sm text-gray-400 hover:text-white">ברירת מחדל</button>
        </div>
      </div>
    </div>
  );
}
