import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function AddEventModal({ selectedDate, isOpen, onClose, onSuccess }) {
  const [formData, setFormData] = useState({
    date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '',
    coupleNames: '',
    phoneNumber: '',
    venue: '',
    packageId: '',
    requiredCrew: 3,
    totalAmountGross: 0,
    vatableAmount: 0,
    vatPercent: 18,
    team: [],
    clientPaymentStatus: 'Unpaid',
    notes: ''
  });
  const [packages, setPackages] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (selectedDate) {
      setFormData(prev => ({
        ...prev,
        date: format(selectedDate, 'yyyy-MM-dd')
      }));
    }
  }, [selectedDate]);

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

  const handleCreate = async () => {
    if (!formData.coupleNames || !formData.date || !formData.totalAmountGross) {
      toast.error('אנא מלא את השדות החובה: שמות הזוג, תאריך וסכום');
      return;
    }

    setIsCreating(true);
    try {
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

      const eventData = {
        ...formData,
        vatableAmount,
        vatAmount,
        profitNet
      };

      await base44.entities.Event.create(eventData);
      toast.success('האירוע נוצר בהצלחה');
      
      // Reset form
      setFormData({
        date: selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '',
        coupleNames: '',
        phoneNumber: '',
        venue: '',
        packageId: '',
        requiredCrew: 3,
        totalAmountGross: 0,
        vatableAmount: 0,
        vatPercent: 18,
        team: [],
        clientPaymentStatus: 'Unpaid',
        notes: ''
      });
      
      if (onSuccess) onSuccess();
      onClose();
    } catch (error) {
      console.error("Error creating event:", error);
      toast.error('שגיאה ביצירת האירוע');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-gray-800 text-white max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Plus className="w-6 h-6 text-yellow-400" />
            אירוע חדש - {selectedDate && format(selectedDate, 'd/M/yyyy')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-400">שמות הזוג *</Label>
              <Input
                value={formData.coupleNames}
                onChange={(e) => setFormData({...formData, coupleNames: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="הזן שמות הזוג"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">תאריך *</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({...formData, date: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">מספר טלפון</Label>
              <Input
                value={formData.phoneNumber}
                onChange={(e) => setFormData({...formData, phoneNumber: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="05X-XXXXXXX"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">אולם</Label>
              <Input
                value={formData.venue}
                onChange={(e) => setFormData({...formData, venue: e.target.value})}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="שם האולם"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-400">חבילה</Label>
            <Select
              value={formData.packageId}
              onValueChange={(value) => {
                const selectedPackage = packages.find(p => p.id === value);
                setFormData({
                  ...formData,
                  packageId: value,
                  requiredCrew: selectedPackage?.totalCrewCount || 3,
                  totalAmountGross: selectedPackage?.price || formData.totalAmountGross
                });
              }}
            >
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                <SelectValue placeholder="בחר חבילה (אופציונלי)" />
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-gray-400">סכום כולל (ברוטו) *</Label>
              <Input
                type="number"
                value={formData.totalAmountGross || ''}
                onChange={(e) => setFormData({...formData, totalAmountGross: parseFloat(e.target.value) || 0})}
                className="bg-gray-800 border-gray-700 text-white"
                placeholder="0"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-400">סטטוס תשלום</Label>
              <Select
                value={formData.clientPaymentStatus}
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
          </div>
        </div>

        <div className="flex gap-3 mt-6 pt-6 border-t border-gray-800">
          <Button
            onClick={onClose}
            variant="outline"
            className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
            disabled={isCreating}
          >
            <X className="w-4 h-4 mr-2" />
            ביטול
          </Button>
          <Button
            onClick={handleCreate}
            className="flex-1 bg-gradient-to-r from-yellow-400 to-yellow-500 hover:from-yellow-500 hover:to-yellow-600 text-gray-900 font-semibold"
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                יוצר...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4 mr-2" />
                צור אירוע
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}