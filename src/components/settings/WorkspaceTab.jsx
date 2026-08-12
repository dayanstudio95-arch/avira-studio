import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, Save } from "lucide-react";
import { toast } from "sonner";

const CURRENCIES = [
  { value: "ILS", label: "₪ שקל חדש (ILS)" },
  { value: "USD", label: "$ דולר אמריקאי (USD)" },
  { value: "EUR", label: "€ יורו (EUR)" },
];

const TIMEZONES = ["Asia/Jerusalem", "Europe/London", "America/New_York", "UTC"];

export default function WorkspaceTab() {
  const { user } = useAuth();
  const canManage = ["owner", "admin"].includes(user?.role);

  const [tenant, setTenant] = useState({ name: "", timezone: "Asia/Jerusalem", currency: "ILS" });
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
        setTenant({
          name: data.name || "",
          timezone: data.timezone || "Asia/Jerusalem",
          currency: data.currency || "ILS",
        });
      }
    } catch (error) {
      toast.error("שגיאה בטעינת פרטי הסטודיו", { description: error.message });
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.entities.Tenant.update(user.tenant_id, {
        name: tenant.name,
        timezone: tenant.timezone,
        currency: tenant.currency,
      });
      toast.success("פרטי הסטודיו נשמרו בהצלחה");
    } catch (error) {
      toast.error("שמירה נכשלה", { description: error.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="h-32 bg-gray-800 rounded-lg animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <Building2 className="w-5 h-5 text-yellow-400" />
          סביבת עבודה
        </CardTitle>
        <p className="text-gray-400 text-sm mt-1">פרטי הסטודיו הבסיסיים</p>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="space-y-2">
          <Label className="text-gray-300 font-medium">שם הסטודיו</Label>
          <Input
            value={tenant.name}
            disabled={!canManage}
            onChange={(e) => setTenant({ ...tenant, name: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">אזור זמן</Label>
            <Select
              value={tenant.timezone}
              disabled={!canManage}
              onValueChange={(val) => setTenant({ ...tenant, timezone: val })}
            >
              <SelectTrigger className="bg-gray-800/50 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">מטבע</Label>
            <Select
              value={tenant.currency}
              disabled={!canManage}
              onValueChange={(val) => setTenant({ ...tenant, currency: val })}
            >
              <SelectTrigger className="bg-gray-800/50 border-gray-700 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
