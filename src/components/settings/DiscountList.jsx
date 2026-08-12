import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import DiscountForm from "./DiscountForm";
import { toast } from "sonner";

export default function DiscountList() {
  const [discounts, setDiscounts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingDiscount, setEditingDiscount] = useState(null);

  useEffect(() => {
    loadDiscounts();
  }, []);

  const loadDiscounts = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.DiscountPreset.list();
      setDiscounts(data);
    } catch (error) {
      console.error("Error loading discounts:", error);
    }
    setIsLoading(false);
  };

  const handleDelete = async (id) => {
    if (!confirm("האם אתה בטוח שברצונך למחוק את ההנחה?")) return;
    try {
      await base44.entities.DiscountPreset.delete(id);
      toast.success("ההנחה נמחקה בהצלחה");
      loadDiscounts();
    } catch (error) {
      console.error("Error deleting discount:", error);
      toast.error("שגיאה במחיקת ההנחה");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array(3).fill(0).map((_, i) => (
          <div key={i} className="h-16 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (discounts.length === 0) {
    return <p className="text-gray-400 text-center py-8">אין הנחות במערכת</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {discounts.map((discount) => (
          <div key={discount.id} className="flex items-center justify-between p-4 bg-gray-800/50 rounded-lg">
            <div>
              <p className="text-white font-medium">{discount.name}</p>
              <p className="text-sm text-gray-400">₪{discount.amount.toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditingDiscount(discount)}
                className="text-gray-400 hover:text-yellow-400"
              >
                <Edit className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDelete(discount.id)}
                className="text-gray-400 hover:text-red-400"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!editingDiscount} onOpenChange={() => setEditingDiscount(null)}>
        <DialogContent className="bg-gray-900 border-gray-800 text-white">
          <DialogHeader>
            <DialogTitle>ערוך הנחה</DialogTitle>
          </DialogHeader>
          <DiscountForm 
            discount={editingDiscount} 
            onSuccess={() => {
              setEditingDiscount(null);
              loadDiscounts();
            }} 
          />
        </DialogContent>
      </Dialog>
    </>
  );
}