import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart, Banknote, X, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function EventQuickEditModal({ event, isOpen, onClose, onUpdate }) {
  const [formData, setFormData] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [packages, setPackages] = useState([]);

  useEffect(() => {
    if (event) {
      setFormData(event);
    }
  }, [event]);

  useEffect(() => {
    const fetchPackages = async () => {
      try {
        const pkgs = await base44.entities.Package.list();
        setPackages(pkgs);
      } catch (error) {
        console.error("Error fetching packages:", error);
      }
    };
    fetchPackages();
  }, []);

  const handleSave = async () => {
    if (!formData) return;
    
    setIsSaving(true);
    try {
      // Recalculate financials
      const totalAmountGross = formData.totalAmountGross || 0;
      const vatableAmount = (formData.vatableAmount > 0 && formData.vatableAmount <= totalAmountGross)
        ? formData.vatableAmount
        : totalAmountGross;
      const vatRate = (formData.vatPercent || 18) / 100;
      const vatOnVatablePart = vatableAmount - (vatableAmount / (1 + vatRate));
      const vatAmount = vatOnVatablePart;
      const amountBeforeVat = totalAmountGross - vatAmount;
      const totalExpenses = (formData.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
      const profitNet = amountBeforeVat - totalExpenses;

      const updatedData = {
        ...formData,
        vatableAmount,
        vatAmount,
        profitNet
      };

      await base44.entities.Event.update(event.id, updatedData);
      toast.success("האירוע עודכן בהצלחה");
      if (onUpdate) onUpdate();
      onClose();
    } catch (error) {
      console.error("Error updating event:", error);
      toast.error("שגיאה בעדכון האירוע");
    } finally {
      setIsSaving(false);
    }
  };

  if (!formData) return null;

  const totalExpenses = (formData.team || []).reduce((sum, member) => sum + (member.cost || 0), 0);
  const statusConfig = {
    "Paid": { color: "bg-green-500/20 text-green-400 border-green-500/30", label: "שולם" },
    "Partially Paid": { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "שולם חלקית" },
    "Unpaid": { color: "bg-red-500/20 text-red-400 border-red-500/30", label: "לא שולם" }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Heart className="w-6 h-6 text-yellow-400" />
            עריכת אירוע
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-400">שמות הזוג</Label>
              <Input
                value={formData.coupleNames || ""}
                onChange={(e) => setFormData({...formData, coupleNames: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">תאריך</Label>
              <Input
                type="date"
                value={formData.date || ""}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">מספר טלפון</Label>
              <Input
                value={formData.phoneNumber || ""}
                onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">אולם</Label>
              <Input
                value={formData.venue || ""}
                onChange={(e) => setFormData({...formData, venue: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="שם האולם"
              />
            </div>
          </div>

          {/* Package Selection */}
          <div className="space-y-2">
            <Label className="text-gray-400">חבילה</Label>
            <Select
              value={formData.packageId || ""}
              onValueChange={(value) => {
                const selectedPackage = packages.find(p => p.id === value);
                setFormData({
                  ...formData, 
                  packageId: value,
                  requiredCrew: selectedPackage?.totalCrewCount || 3
                });
              }}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                <SelectValue placeholder="בחר חבילה" />
              </SelectTrigger>
              <SelectContent className="bg-gray-800 border-gray-700 text-white">
                {packages.map(pkg => (
                  <SelectItem key={pkg.id} value={pkg.id}>
                    {pkg.name} - ₪{pkg.price?.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Financial Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-400 flex items-center gap-2">
                <Banknote className="w-4 h-4" />
                סכום כולל (ברוטו)
              </Label>
              <Input
                type="number"
                value={formData.totalAmountGross || ""}
                onChange={(e) => setFormData({...formData, totalAmountGross: parseFloat(e.target.value) || 0})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">אחוז מע״מ</Label>
              <Input
                type="number"
                value={formData.vatPercent || 18}
                onChange={(e) => setFormData({...formData, vatPercent: parseFloat(e.target.value) || 18})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">סטטוס תשלום</Label>
              <Select
                value={formData.clientPaymentStatus || "Unpaid"}
                onValueChange={(value) => setFormData({...formData, clientPaymentStatus: value})}
              >
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  <SelectItem value="Paid">✅ שולם</SelectItem>
                  <SelectItem value="Partially Paid">🟡 שולם חלקית</SelectItem>
                  <SelectItem value="Unpaid">🔴 לא שולם</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">סטטוס אלבום</Label>
              <Select
                value={formData.albumStatus || "pending"}
                onValueChange={(value) => setFormData({...formData, albumStatus: value})}
              >
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  <SelectItem value="pending">לא נשלח</SelectItem>
                  <SelectItem value="sent">נשלח</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="bg-gray-800/50 rounded-lg p-4 space-y-2 border border-gray-700">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">סך הוצאות:</span>
              <span className="text-red-400 font-semibold">₪{totalExpenses.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">רווח נקי משוער:</span>
              <span className="text-green-400 font-semibold">
                ₪{((formData.totalAmountGross || 0) - (formData.totalAmountGross || 0) * 0.18 / 1.18 - totalExpenses).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label className="text-gray-400">הערות</Label>
            <Textarea
              value={formData.notes || ""}
              onChange={(e) => setFormData({...formData, notes: e.target.value})}
              className="bg-gray-800 border-gray-700 text-white min-h-[80px]"
              placeholder="הוסף הערות..."
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mt-6 pt-6 border-t border-gray-800">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
            disabled={isSaving}
          >
            <X className="w-4 h-4 mr-2" />
            ביטול
          </Button>
          <Button
            onClick={handleSave}
            className="flex-1 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-gray-900 font-semibold"
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                שומר...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                שמור
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}