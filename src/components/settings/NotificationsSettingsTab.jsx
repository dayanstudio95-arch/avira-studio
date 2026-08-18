import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, Bell, FileCheck } from "lucide-react";
import { toast } from "sonner";

// Settings > התראות — configures the single fixed WhatsApp number that receives
// automatic notifications (v1 scope: contract-signed only, migration
// 0026_notifications_trigger.sql). Per explicit user choice, this is one shared
// number configurable here, NOT each admin user's own profile phone.
//
// The number itself isn't a credential (same class as whatsapp_gateway_url /
// whatsapp_instance_id), so it lives in app_settings like those, not
// tenant_secrets. Read server-side by contract-signed-webhook/index.ts.
const SETTING_KEY = "notification_phone_number";

export default function NotificationsSettingsTab() {
  const [phone, setPhone] = useState("");
  const [settingId, setSettingId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const rows = await base44.entities.AppSetting.filter({ key: SETTING_KEY });
      if (rows?.[0]) {
        setPhone(rows[0].value || "");
        setSettingId(rows[0].id);
      }
    } catch (e) {
      console.error("Error loading notification settings:", e);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      if (settingId) {
        await base44.entities.AppSetting.update(settingId, { value: phone.trim() });
      } else {
        const created = await base44.entities.AppSetting.create({ key: SETTING_KEY, value: phone.trim() });
        setSettingId(created.id);
      }
      toast.success("הגדרות ההתראות נשמרו בהצלחה");
    } catch (e) {
      toast.error("שגיאה בשמירת הגדרות ההתראות");
    }
    setIsSaving(false);
  };

  return (
    <div className="space-y-6">
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800 pb-4">
          <CardTitle className="text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-yellow-500/20 rounded-lg flex items-center justify-center">
              <Bell className="w-4 h-4 text-yellow-400" />
            </div>
            התראות — WhatsApp
          </CardTitle>
          <p className="text-gray-400 text-sm">
            מספר וואטסאפ קבוע שיקבל התראה אוטומטית באירועים חשובים במערכת.
          </p>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 text-xs text-blue-300 flex items-start gap-2">
            <FileCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              כרגע פעילה התראה אחת: <strong>חתימת חוזה</strong> — ברגע שליד חותם על חוזה (בין אם דרך הקישור
              הציבורי ובין אם ידנית במערכת), תישלח הודעת וואטסאפ למספר שתגדירו כאן, וגם תופיע התראה בתוך
              המערכת (פעמון בראש התפריט) לכל בעל תפקיד ניהולי.
            </p>
          </div>
          <div>
            <Label className="text-gray-300">מספר טלפון לקבלת התראות</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050-1234567"
              className="bg-gray-800 border-gray-700 text-white mt-1"
              dir="ltr"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
          >
            <Save className="w-4 h-4 ml-2" />
            {isSaving ? "שומר..." : "שמור"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
