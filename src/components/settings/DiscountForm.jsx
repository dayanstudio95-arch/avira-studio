import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export default function DiscountForm({ discount = null, onSuccess }) {
  const [formData, setFormData] = useState({
    name: discount?.name || "",
    amount: discount?.amount || 0
  });

  const handleSubmit = async () => {
    if (!formData.name || formData.amount <= 0) {
      toast.error("יש למלא את כל השדות");
      return;
    }

    try {
      if (discount) {
        await base44.entities.DiscountPreset.update(discount.id, formData);
        toast.success("ההנחה עודכנה בהצלחה");
      } else {
        await base44.entities.DiscountPreset.create(formData);
        toast.success("ההנחה נוצרה בהצלחה");
      }
      onSuccess();
    } catch (error) {
      console.error("Error saving discount:", error);
      toast.error("שגיאה בשמירת ההנחה");
    }
  };

  return (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label>שם ההנחה</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({...formData, name: e.target.value})}
          className="bg-gray-800 border-gray-700 text-white"
          placeholder="לדוגמה: חורף 2026"
        />
      </div>
      <div className="space-y-2">
        <Label>סכום הנחה (₪)</Label>
        <Input
          type="number"
          min="0"
          step="100"
          value={formData.amount}
          onChange={(e) => setFormData({...formData, amount: parseFloat(e.target.value) || 0})}
          className="bg-gray-800 border-gray-700 text-white"
          placeholder="0"
        />
      </div>
      <DialogFooter>
        <Button onClick={handleSubmit} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900">
          {discount ? 'עדכן' : 'הוסף'}
        </Button>
      </DialogFooter>
    </div>
  );
}