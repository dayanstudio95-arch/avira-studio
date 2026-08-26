import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Percent, Save } from "lucide-react";
import { toast } from "sonner";

// Tenant-level financial defaults: VAT % and deposit amount. Read at
// event-creation time only (sync-lead-to-event/index.ts sets events.vat_percent
// from this default when a lead closes) and used as the initial pre-fill value
// in a handful of frontend forms -- never joined back live, so changing the
// default here never retroactively changes an already-created event/payment
// (same snapshot discipline as the rest of this codebase's financial data).
//
// Defaults (18 / 500) match the existing hardcoded fallbacks already used
// throughout the app (events.vat_percent DEFAULT 18, ManualPaymentModal's
// useState("500")) -- so turning this feature on changes nothing until the
// studio deliberately edits it here.

export default function FinancialDefaultsCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);

  const [vatPercent, setVatPercent] = useState("18");
  const [depositAmount, setDepositAmount] = useState("500");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user?.tenant_id) loadTenant();
  }, [user?.tenant_id]);

  const loadTenant = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.Tenant.get(user.tenant_id);
      if (data) {
        setVatPercent(String(data.defaultVatPercent ?? 18));
        setDepositAmount(String(data.defaultDepositAmount ?? 500));
      }
    } catch (error) {
      toast.error("שגיאה בטעינת ברירות מחדל פיננסיות", { description: error.message });
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    // הקלטים אינם בתוך <form> ו-handleSave הוא onClick רגיל, ולכן min/max של
    // ה-<input> לעולם לא נאכפים ע"י הדפדפן. בלי הבדיקה כאן, שדה ריק היה נשמר
    // כ-0% מע״מ ומחתים כל אירוע חדש כפטור ממע״מ.
    const parsedVat = parseFloat(vatPercent);
    if (!Number.isFinite(parsedVat) || parsedVat < 0 || parsedVat > 100) {
      toast.error("אחוז מע״ם חייב להיות מספר בין 0 ל-100");
      return;
    }
    const parsedDeposit = parseFloat(depositAmount);
    if (!Number.isFinite(parsedDeposit) || parsedDeposit < 0) {
      toast.error("סכום מקדמה חייב להיות מספר שאינו שלילי");
      return;
    }

    setIsSaving(true);
    try {
      await base44.entities.Tenant.update(user.tenant_id, {
        default_vat_percent: parsedVat,
        default_deposit_amount: parsedDeposit,
      });
      toast.success("ברירות המחדל הפיננסיות נשמרו בהצלחה");
    } catch (error) {
      toast.error("שמירה נכשלה", { description: error.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="h-20 bg-gray-800 rounded-lg animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <Percent className="w-5 h-5 text-yellow-400" />
          ברירות מחדל פיננסיות
        </CardTitle>
        <p className="text-gray-400 text-sm mt-1">
          ערכי ברירת מחדל לאירועים ותשלומים חדשים. שינוי כאן לא משפיע רטרואקטיבית על אירועים/תשלומים שכבר נוצרו.
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">אחוז מע״ם ברירת מחדל</Label>
            <Input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={vatPercent}
              disabled={!canManage}
              onChange={(e) => setVatPercent(e.target.value)}
              className="bg-gray-800/50 border-gray-700 text-white"
            />
            <p className="text-xs text-gray-500">ישמש כברירת מחדל בעת יצירת אירוע חדש (מליד שנסגר)</p>
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">סכום מקדמה ברירת מחדל (₪)</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={depositAmount}
              disabled={!canManage}
              onChange={(e) => setDepositAmount(e.target.value)}
              className="bg-gray-800/50 border-gray-700 text-white"
            />
            <p className="text-xs text-gray-500">ישמש כמילוי מקדים בעת רישום תשלום מקדמה ידני</p>
          </div>
        </div>

        {canManage && (
          <Button onClick={handleSave} disabled={isSaving} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? "שומר..." : "שמירה"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
