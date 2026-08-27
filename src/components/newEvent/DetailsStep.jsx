import React, { useState } from 'react';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Heart, Banknote, Percent, CreditCard, Package, MapPin, Phone } from "lucide-react";
import { useAuth } from "@/lib/SupabaseAuthContext";

// Discounts are deliberately NOT offered on this screen.
//
// There were two independent discount mechanisms in the system. The one in daily use
// lives on the lead (LeadFormDialog.jsx: basePrice / discount / finalPrice), always
// computes `finalPrice = basePrice - discount` from a stored base price, and is correct
// on all 298 leads including the 89 that carry a real discount. sync-lead-to-event
// (:94, :120) copies `lead.final_price` into `events.total_amount_gross`, so an event
// created from a discounted lead already arrives with the discounted price.
//
// The second mechanism lived here -- `events.selected_discount_id` + `manual_discount`
// fed by the `discount_presets` catalog. It was never usable: this component is rendered
// only by EditEvent.jsx, which could not save at all between 2026-08-12 and 2026-08-27
// (see EditEvent.jsx's calculateFinancials comment), so it never persisted a single
// value -- 0 of 271 events. Its arithmetic was also wrong: both handlers took their base
// price from `originalPrice || eventData.totalAmountGross`, and `originalPrice` stays 0
// unless the package is re-picked, so each keystroke subtracted again from the already
// discounted total (typing 1000 on a 12,000 event produced 10,889, not 11,000).
//
// Removed rather than repaired (owner's decision, 2026-08-28): it removed no working
// capability, it was actively misleading -- an event created from a discounted lead
// showed an EMPTY discount field -- and repairing it would have kept a second, parallel
// discount concept alive next to the one that works. For an event with no lead behind it
// the final price is typed directly into "סכום ברוטו כולל" below. The DB columns and the
// `discount_presets` table are untouched.

export default function DetailsStep({ eventData, updateEventData, packages = [] }) {
  const { tenantDefaults } = useAuth();
  const defaultVatPercent = tenantDefaults?.defaultVatPercent ?? 18;
  const [originalPrice, setOriginalPrice] = useState(0);

  const handlePackageChange = (packageId) => {
    const selectedPackage = packages.find(pkg => pkg.id === packageId);
    if (selectedPackage) {
      const defaultPrice = selectedPackage.defaultPrice || selectedPackage.price || 0;
      setOriginalPrice(defaultPrice);

      updateEventData({
        packageId,
        requiredCrew: selectedPackage.totalCrewCount || 3,
        totalAmountGross: defaultPrice
      });
    } else {
      updateEventData({ packageId: "", totalAmountGross: 0 });
      setOriginalPrice(0);
    }
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="coupleNames" className="text-gray-300 font-medium flex items-center gap-2">
            <Heart className="w-4 h-4 text-yellow-400" />
            שמות הזוג
          </Label>
          <Input
            id="coupleNames"
            placeholder="לדוגמה: שרה ודוד"
            value={eventData.coupleNames}
            onChange={(e) => updateEventData({ coupleNames: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="date" className="text-gray-300 font-medium flex items-center gap-2">
            <Calendar className="w-4 h-4 text-yellow-400" />
            תאריך האירוע
          </Label>
          <Input
            id="date"
            type="date"
            value={eventData.date}
            onChange={(e) => updateEventData({ date: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white focus:border-yellow-400 focus:ring-yellow-400/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="phoneNumber" className="text-gray-300 font-medium flex items-center gap-2">
            <Phone className="w-4 h-4 text-yellow-400" />
            מספר טלפון
          </Label>
          <Input
            id="phoneNumber"
            type="tel"
            placeholder="לדוגמה: 050-1234567"
            value={eventData.phoneNumber || ""}
            onChange={(e) => updateEventData({ phoneNumber: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="venue" className="text-gray-300 font-medium flex items-center gap-2">
            <MapPin className="w-4 h-4 text-yellow-400" />
            אולם
          </Label>
          <Input
            id="venue"
            placeholder="שם האולם"
            value={eventData.venue || ""}
            onChange={(e) => updateEventData({ venue: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="package" className="text-gray-300 font-medium flex items-center gap-2">
            <Package className="w-4 h-4 text-yellow-400" />
            חבילה
          </Label>
          <Select 
            value={eventData.packageId || ""} 
            onValueChange={handlePackageChange}
          >
            <SelectTrigger className="bg-gray-800/50 border-gray-700 text-white focus:border-yellow-400 focus:ring-yellow-400/20">
              <SelectValue placeholder="בחר חבילה (אופציונלי)" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700 text-white">
              <SelectItem value={null}>ללא חבילה</SelectItem>
              {packages.map((pkg) => (
                <SelectItem key={pkg.id} value={pkg.id}>
                  {pkg.name} ({pkg.totalCrewCount || 0} אנשי צוות)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="totalAmountGross" className="text-gray-300 font-medium flex items-center gap-2">
            <Banknote className="w-4 h-4 text-yellow-400" />
            סכום ברוטו כולל (₪)
          </Label>
          {originalPrice > 0 && originalPrice !== eventData.totalAmountGross && (
            <div className="text-sm text-gray-500">
              <span className="line-through">₪{originalPrice.toLocaleString()}</span>
              <span className="text-green-400 mr-2">
                → ₪{eventData.totalAmountGross?.toLocaleString() || 0}
              </span>
            </div>
          )}
          <Input
            id="totalAmountGross"
            type="number"
            min="0"
            step="100"
            placeholder="לדוגמה: 15000"
            value={eventData.totalAmountGross || ''}
            onChange={(e) => {
              const newPrice = parseFloat(e.target.value) || 0;
              updateEventData({ totalAmountGross: newPrice });
              if (!originalPrice) setOriginalPrice(newPrice);
            }}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="vatableAmount" className="text-gray-300 font-medium flex items-center gap-2">
            <Percent className="w-4 h-4 text-yellow-400" />
            סכום לחישוב מע״מ (₪)
          </Label>
          <Input
            id="vatableAmount"
            type="number"
            min="0"
            step="100"
            placeholder="ברירת מחדל: הסכום המלא"
            value={eventData.vatableAmount || ''}
            onChange={(e) => updateEventData({ vatableAmount: parseFloat(e.target.value) || 0 })}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
           <p className="text-xs text-gray-500">
            השאר ריק או 0 כדי לחשב על הסכום המלא.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="vatPercent" className="text-gray-300 font-medium flex items-center gap-2">
            <Percent className="w-4 h-4 text-yellow-400" />
            אחוז מע״מ (%)
          </Label>
          <Input
            id="vatPercent"
            type="number"
            min="0"
            max="100"
            step="0.1"
            placeholder={String(defaultVatPercent)}
            value={eventData.vatPercent || ''}
            onChange={(e) => updateEventData({ vatPercent: parseFloat(e.target.value) || defaultVatPercent })}
            className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20"
          />
          <p className="text-xs text-gray-500">
            ברירת מחדל: {defaultVatPercent}%.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="clientPaymentStatus" className="text-gray-300 font-medium flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-yellow-400" />
            סטטוס תשלום מהלקוח
          </Label>
          <Select 
            value={eventData.clientPaymentStatus || "Unpaid"} 
            onValueChange={(value) => updateEventData({ clientPaymentStatus: value })}
          >
            <SelectTrigger className="bg-gray-800/50 border-gray-700 text-white focus:border-yellow-400 focus:ring-yellow-400/20">
              <SelectValue placeholder="בחר סטטוס תשלום" />
            </SelectTrigger>
            <SelectContent className="bg-gray-900 border-gray-700 text-white">
              <SelectItem value="Paid">✅ שולם במלואו</SelectItem>
              <SelectItem value="Partially Paid">🟡 שולם חלקית</SelectItem>
              <SelectItem value="Unpaid">🔴 לא שולם</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes" className="text-gray-300 font-medium">
          הערות נוספות (אופציונלי)
        </Label>
        <Textarea
          id="notes"
          placeholder="דרישות מיוחדות, פרטי מיקום, או כל הערה אחרת..."
          value={eventData.notes}
          onChange={(e) => updateEventData({ notes: e.target.value })}
          className="bg-gray-800/50 border-gray-700 text-white placeholder-gray-500 focus:border-yellow-400 focus:ring-yellow-400/20 min-h-[100px]"
        />
      </div>
    </div>
  );
}