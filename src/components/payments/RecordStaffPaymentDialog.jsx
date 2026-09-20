import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/api/supabaseClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { allocatePayment } from "@/lib/staffPaymentAllocation";

// "רשום תשלום" — a real payment in a round sum (2026-09-20). The owner pays some staff
// in cash and "זה לא תמיד יוצא בול לפי אירוע": 6,000 against events of 1,800.
//
// The preview below is computed with the same rule the database applies
// (record_staff_payment, migration 0065): oldest first, stop at the first event that
// doesn't fit, the rest stays as credit. He sees exactly what will be closed BEFORE
// confirming — this is money, and "trust me" is not an interface.
//
// `rows` are ALL of this person's unpaid past events, not only the month the page is
// filtered to; an older unpaid event from a previous month is closed first, and the
// preview says so.

const METHODS = [
  { value: "cash", label: "מזומן" },
  { value: "transfer", label: "העברה בנקאית" },
  { value: "bit", label: "ביט / פייבוקס" },
  { value: "check", label: "צ׳ק" },
  { value: "other", label: "אחר" },
];

const money = (n) => `₪${(Math.round((n || 0) * 100) / 100).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

export default function RecordStaffPaymentDialog({ open, onOpenChange, staffName, rows, credit, onRecorded }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount("");
      setMethod("cash");
      setPaidOn(new Date().toISOString().slice(0, 10));
      setNote("");
    }
  }, [open]);

  const numericAmount = parseFloat(amount) || 0;
  const totalOwed = useMemo(() => (rows || []).reduce((s, r) => s + r.cost, 0), [rows]);
  const preview = useMemo(
    () => allocatePayment({ amount: numericAmount, creditBefore: credit || 0, rows: rows || [] }),
    [numericAmount, credit, rows]
  );

  const handleSave = async () => {
    if (numericAmount <= 0) {
      toast.error("יש להזין סכום");
      return;
    }
    setIsSaving(true);
    try {
      const { data, error } = await supabase.rpc("record_staff_payment", {
        p_staff_name: staffName,
        p_amount: numericAmount,
        p_method: method,
        p_paid_on: paidOn,
        p_note: note.trim() || null,
      });
      if (error) throw error;
      const closed = data?.covered?.length || 0;
      toast.success(
        `נרשם תשלום ${money(numericAmount)} ל${staffName} — נסגרו ${closed} אירועים` +
          (data?.creditAfter > 0 ? `, יתרת זכות ${money(data.creditAfter)}` : "")
      );
      onRecorded?.();
      onOpenChange(false);
    } catch (e) {
      console.error("record_staff_payment failed:", e);
      toast.error(`רישום התשלום נכשל: ${e?.message || "שגיאה לא ידועה"}`);
    }
    setIsSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="bg-gray-900 border-gray-700 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-right flex items-center gap-2">
            <Banknote className="w-5 h-5 text-emerald-400" />
            רישום תשלום — {staffName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
              <p className="text-gray-400 text-xs">פתוח לתשלום (אירועים שעברו)</p>
              <p className="text-red-400 font-bold text-lg">{money(totalOwed)}</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/50 p-3">
              <p className="text-gray-400 text-xs">יתרת זכות קיימת</p>
              <p className="text-emerald-400 font-bold text-lg">{money(credit || 0)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-300">סכום ששילמת (בלי מע״מ)</Label>
              <Input
                type="number"
                min={0}
                step="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="6000"
                className="bg-gray-800 border-gray-700 text-white mt-1"
                dir="ltr"
                autoFocus
              />
            </div>
            <div>
              <Label className="text-gray-300">תאריך</Label>
              <Input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white mt-1"
                dir="ltr"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-gray-300">אמצעי תשלום</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-gray-300">הערה (לא חובה)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={1}
                className="bg-gray-800 border-gray-700 text-white mt-1 min-h-[40px]"
              />
            </div>
          </div>

          {numericAmount > 0 && (
            <div className="rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-3 space-y-2 text-sm">
              <p className="text-emerald-300 font-medium">מה יקרה כשתאשר:</p>
              {preview.covered.length > 0 ? (
                <ul className="space-y-1">
                  {preview.covered.map((r) => (
                    <li key={`${r.eventId}-${r.index}`} className="flex justify-between text-gray-200">
                      <span>✅ {r.coupleNames} · {format(new Date(r.date), "d/M/yy")}</span>
                      <span className="text-gray-400">{money(r.cost)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-400">
                  הסכום (יחד עם היתרה) לא מכסה אף אירוע במלואו — הכל יישמר כיתרת זכות.
                </p>
              )}
              <div className="flex justify-between border-t border-emerald-800/40 pt-2">
                <span className="text-gray-300">יתרת זכות אחרי התשלום</span>
                <span className="text-emerald-300 font-semibold">{money(preview.creditAfter)}</span>
              </div>
              {preview.firstUncovered && (
                <p className="text-xs text-gray-400">
                  הבא בתור: {preview.firstUncovered.coupleNames} ({money(preview.firstUncovered.cost)}) — חסרים{" "}
                  {money(preview.firstUncovered.cost - preview.creditAfter)} כדי לסגור אותו.
                </p>
              )}
              <p className="text-xs text-gray-500">
                נסגרים מהישן לחדש, רק אירועים שכבר התקיימו. אפשר לבטל את התשלום האחרון מלשונית ההיסטוריה.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-row-reverse">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="border-gray-700 bg-gray-800 text-gray-300">
            ביטול
          </Button>
          <Button onClick={handleSave} disabled={isSaving || numericAmount <= 0} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {isSaving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Banknote className="w-4 h-4 ml-2" />}
            {isSaving ? "רושם..." : `רשום תשלום ${numericAmount > 0 ? money(numericAmount) : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
