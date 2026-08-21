import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MoonStar, Save } from "lucide-react";
import { toast } from "sonner";

// "שעות שקטות" — tenant-level do-not-disturb window for all 7 automation types
// (the 5 direct-send handlers in automation-engine/index.ts, plus the 2
// queue-then-approve types whose actual send point is
// approve-pending-automation/index.ts). Both edge functions read these same 3
// columns live on every run/approval via _shared/automationGuards.ts's
// loadQuietHoursSettings() -- so changing the toggle/times here takes effect
// on the very next automation run or approval, no redeploy needed.
//
// base44.entities.Tenant.get() returns camelCase keys (rowToRecord/snakeToCamel
// conversion in src/api/entities.js) but .update() accepts snake_case keys
// unchanged -- same asymmetry documented in StudioDetailsCard.jsx.

export default function QuietHoursCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);

  const [enabled, setEnabled] = useState(false);
  const [startTime, setStartTime] = useState("22:00");
  const [endTime, setEndTime] = useState("08:00");
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
        setEnabled(!!data.quietHoursEnabled);
        setStartTime(data.quietHoursStart || "22:00");
        setEndTime(data.quietHoursEnd || "08:00");
      }
    } catch (error) {
      toast.error("שגיאה בטעינת שעות שקטות", { description: error.message });
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.entities.Tenant.update(user.tenant_id, {
        quiet_hours_enabled: enabled,
        quiet_hours_start: startTime,
        quiet_hours_end: endTime,
      });
      toast.success("שעות שקטות נשמרו בהצלחה");
    } catch (error) {
      toast.error("שמירה נכשלה", { description: error.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
        <CardContent className="p-6">
          <div className="h-24 bg-gray-800 rounded-lg animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <MoonStar className="w-5 h-5 text-yellow-400" />
          שעות שקטות
        </CardTitle>
        <p className="text-gray-400 text-sm mt-1">
          בטווח השעות שתגדירו כאן, המערכת לא תשלח הודעות אוטומטיות (כולל תזכורות שממתינות לאישור ידני) —
          ההודעות פשוט מדולגות עד הריצה הבאה, לא נשלחות מאוחר יותר באופן אוטומטי.
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-gray-300 font-medium">הפעל שעות שקטות</Label>
            <p className="text-xs text-gray-500 mt-1">כאשר כבוי, אוטומציות נשלחות בכל שעה כרגיל</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!canManage} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">משעה</Label>
            <Input
              type="time"
              value={startTime}
              disabled={!canManage}
              onChange={(e) => setStartTime(e.target.value)}
              className="bg-gray-800/50 border-gray-700 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-gray-300 font-medium">עד שעה</Label>
            <Input
              type="time"
              value={endTime}
              disabled={!canManage}
              onChange={(e) => setEndTime(e.target.value)}
              className="bg-gray-800/50 border-gray-700 text-white"
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          שעון ישראל. ניתן להגדיר טווח שחוצה חצות (למשל 22:00 עד 08:00).
        </p>

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
