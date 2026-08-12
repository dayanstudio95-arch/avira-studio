import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Banknote } from "lucide-react";

const PAYMENT_TYPES = [
  { value: "deposit", label: "מקדמה" },
  { value: "balance", label: "תשלום יתרה" },
  { value: "service", label: "תוספת שירות" },
  { value: "other", label: "אחר" },
];

export default function ManualPaymentModal({ isOpen, onClose, lead, onSaved }) {
  const [paymentType, setPaymentType] = useState("deposit");
  const [amount, setAmount] = useState("500");
  const [note, setNote] = useState("מקדמה");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPaymentType("deposit");
      setAmount("500");
      setNote("מקדמה");
    }
  }, [isOpen]);

  const handlePaymentTypeChange = (newType) => {
    setPaymentType(newType);
    const selectedType = PAYMENT_TYPES.find(t => t.value === newType);
    setNote(selectedType?.label || "");
  };

  const handleSubmit = async () => {
    const num = parseFloat(amount);
    if (!num || num <= 0) {
      toast.error("יש להזין סכום תקין");
      return;
    }

    setIsLoading(true);
    const prevManual = lead.manualPayment || 0;
    const newManual = prevManual + num;
    const newTotalPaid = (lead.totalPaid || 0) + num;
    const newBalance = (lead.finalPrice || 0) - newTotalPaid;

    const updateData = {
      manualPayment: newManual,
      manualPaymentNote: note || undefined,
      totalPaid: newTotalPaid,
      remainingBalance: newBalance,
    };

    // סנכרון עבור מקדמה
    if (paymentType === "deposit") {
      updateData.depositAmount = (lead.depositAmount || 0) + num;
    }

    await base44.entities.Lead.update(lead.id, updateData);

    toast.success(`תשלום ידני של ₪${num.toLocaleString()} נשמר`);
    setIsLoading(false);
    onClose();
    if (onSaved) onSaved();
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-sm" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Banknote className="w-5 h-5 text-blue-400" />
            עדכון תשלום ידני
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 text-sm text-gray-300">
            לקוח: <span className="text-white font-semibold">{lead?.coupleNames}</span>
            {lead?.manualPayment > 0 && (
              <div className="text-blue-400 text-xs mt-1">תשלום ידני קיים: ₪{lead.manualPayment.toLocaleString()}</div>
            )}
          </div>

          <div>
            <Label className="text-gray-300 mb-1 block">סוג תשלום *</Label>
            <Select value={paymentType} onValueChange={handlePaymentTypeChange}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700">
                {PAYMENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value} className="text-white hover:bg-gray-700">
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-gray-300 mb-1 block">סכום לתוספת (₪) *</Label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="bg-gray-800 border-gray-700 text-white"
              dir="ltr"
            />
          </div>

          <div>
            <Label className="text-gray-300 mb-1 block">הערה (אופציונלי)</Label>
            <Input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="תשם תיעוד - יתמלא אוטומטית"
              className="bg-gray-800 border-gray-700 text-white"
            />
            <p className="text-xs text-gray-500 mt-1">שדה זה יתמלא אוטומטית בהערה בהתאם לסוג התשלום הנבחר</p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              onClick={handleSubmit}
              disabled={isLoading}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isLoading ? "שומר..." : "אישור ועדכון"}
            </Button>
            <Button variant="outline" onClick={handleClose} className="border-gray-600 text-gray-300">
              ביטול
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}