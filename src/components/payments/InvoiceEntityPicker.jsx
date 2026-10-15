import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ENTITIES, ENTITY_KEYS, defaultEntity } from "@/lib/paymentEntity";

// "מאיזה עסק להוציא?" before an invoice (2026-10-15, the owner's request — the dashboard's
// "לא משולם" card). The couple's business is pre-marked; the caller asks before the other.
export default function InvoiceEntityPicker({ open, onOpenChange, coupleNames, lead, onPick }) {
  const expected = defaultEntity(lead);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white">חשבונית — {coupleNames}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-300">מאיזה עסק להוציא?</div>
        <div className="grid grid-cols-2 gap-2">
          {ENTITY_KEYS.map((k) => {
            const e = ENTITIES[k];
            const mark = expected === k;
            const tone = k === "company"
              ? mark ? "border-purple-400 bg-purple-600 text-white" : "border-purple-700/60 text-purple-300 hover:bg-purple-900/30"
              : mark ? "border-emerald-400 bg-emerald-600 text-white" : "border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/30";
            return (
              <button key={k} type="button" onClick={() => onPick(k)} className={`min-h-[48px] rounded-xl border px-3 text-sm font-semibold ${tone}`}>
                {e.label}{mark ? " ✓" : ""}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-gray-500">
          {expected ? `מסומן לפי העסק של הזוג (${ENTITIES[expected].label}).` : "לזוג הזה עוד לא נקבע עסק — החשבונית תקבע אותו."}
        </div>
      </DialogContent>
    </Dialog>
  );
}
