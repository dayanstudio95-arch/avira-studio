import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save, CheckCircle, MessageCircle, Calendar, FileText, Eye, EyeOff, ArrowLeft } from "lucide-react";
import WhatsAppPanel from "./WhatsAppPanel";
import { toast } from "sonner";

// CHANGED: Make.com was fully retired (site-wide decision — every WhatsApp send now
// goes through the Green API helper server-side, see supabase/functions/_shared/whatsapp.ts).
// This tab used to expose a `make_webhook_url` field that nothing reads anymore, and had
// NO fields at all for the keys that actually matter now (whatsapp_gateway_url /
// whatsapp_api_key) — meaning there was never any way to configure WhatsApp sending from
// the UI. Replaced with real Green API fields, wired to the same keys _shared/whatsapp.ts
// and the whatsapp-manager Edge Function already read/test against. WhatsAppPanel.jsx
// (QR connect + status + test-send, backed by whatsapp-manager) already existed fully
// built but was never imported anywhere — wired in here.
// CHANGED: split the single Morning/Green Invoice key pair into two — the studio runs
// both an עוסק מורשה (sole proprietor) and a חברה בע״מ (Ltd company), each billed through
// its own separate Morning account. morning_api_key/morning_api_secret (the old single
// pair) were renamed to the _sole_prop variants by migration 0011_morning_dual_business.sql;
// morning_api_key_company/morning_api_secret_company are new and start empty until filled in.
const INTEGRATION_KEYS = [
  "whatsapp_gateway_url",
  "whatsapp_instance_id",
  "whatsapp_api_key",
  "morning_api_key_sole_prop",
  "morning_api_secret_sole_prop",
  "morning_api_key_company",
  "morning_api_secret_company",
];

export default function IntegrationsTab() {
  const [values, setValues] = useState({
    whatsapp_gateway_url: "",
    whatsapp_instance_id: "",
    whatsapp_api_key: "",
    morning_api_key_sole_prop: "",
    morning_api_secret_sole_prop: "",
    morning_api_key_company: "",
    morning_api_secret_company: "",
  });
  const [settingIds, setSettingIds] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [showSecrets, setShowSecrets] = useState({});

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    try {
      const all = await base44.entities.AppSetting.list();
      const ids = {};
      const vals = { ...values };
      all.forEach((s) => {
        if (INTEGRATION_KEYS.includes(s.key)) {
          vals[s.key] = s.value || "";
          ids[s.key] = s.id;
        }
      });
      setValues(vals);
      setSettingIds(ids);
    } catch (e) {
      console.error("Error loading integrations:", e);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all(
        INTEGRATION_KEYS.map(async (key) => {
          const val = values[key] || "";
          if (settingIds[key]) {
            await base44.entities.AppSetting.update(settingIds[key], { value: val });
          } else {
            const created = await base44.entities.AppSetting.create({ key, value: val });
            setSettingIds((prev) => ({ ...prev, [key]: created.id }));
          }
        })
      );
      toast.success("הגדרות האינטגרציות נשמרו בהצלחה");
    } catch (e) {
      toast.error("שגיאה בשמירת ההגדרות");
    }
    setIsSaving(false);
  };

  const toggleShow = (key) =>
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));

  const SecretInput = ({ fieldKey, placeholder }) => (
    <div className="relative">
      <Input
        type={showSecrets[fieldKey] ? "text" : "password"}
        value={values[fieldKey]}
        onChange={(e) => setValues((v) => ({ ...v, [fieldKey]: e.target.value }))}
        placeholder={placeholder}
        className="bg-gray-800 border-gray-700 text-white pr-10"
        dir="ltr"
      />
      <button
        type="button"
        onClick={() => toggleShow(fieldKey)}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
      >
        {showSecrets[fieldKey] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Green API — WhatsApp */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800 pb-4">
          <CardTitle className="text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-green-500/20 rounded-lg flex items-center justify-center">
              <MessageCircle className="w-4 h-4 text-green-400" />
            </div>
            Green API — שליחת הודעות WhatsApp
          </CardTitle>
          <p className="text-gray-400 text-sm">שליחת חוזים, שאלונים ותזכורות בוואטסאפ דרך Green API</p>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-3 text-xs text-green-300 space-y-1">
            <p><strong>🔗 הוראות:</strong></p>
            <p>בדשבורד של Green API (console.green-api.com) יש שלושה שדות בעמוד האינסטנס שלך: apiUrl, idInstance ו-apiTokenInstance. העתק כל אחד מהם בדיוק לשדה המתאים למטה (בלי לשנות או לחבר ביניהם), שמור, ואז סרוק QR לחיבור המכשיר.</p>
          </div>
          <div>
            <Label className="text-gray-300">API URL (apiUrl)</Label>
            <Input
              value={values.whatsapp_gateway_url}
              onChange={(e) => setValues((v) => ({ ...v, whatsapp_gateway_url: e.target.value }))}
              placeholder="https://7107.api.green-api.com"
              className="bg-gray-800 border-gray-700 text-white mt-1"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-gray-300">Instance ID (idInstance)</Label>
            <Input
              value={values.whatsapp_instance_id}
              onChange={(e) => setValues((v) => ({ ...v, whatsapp_instance_id: e.target.value }))}
              placeholder="7107558672"
              className="bg-gray-800 border-gray-700 text-white mt-1"
              dir="ltr"
            />
          </div>
          <div>
            <Label className="text-gray-300">API Token (apiTokenInstance)</Label>
            <SecretInput fieldKey="whatsapp_api_key" placeholder="apiTokenInstance" />
          </div>
          <div className="pt-2 border-t border-gray-800">
            <WhatsAppPanel
              gatewayUrl={values.whatsapp_gateway_url}
              instanceId={values.whatsapp_instance_id}
              apiKey={values.whatsapp_api_key}
            />
          </div>
        </CardContent>
      </Card>

      {/* Google Calendar — connect/manage/sync-health now lives on its own dedicated page */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800 pb-4">
          <CardTitle className="text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <Calendar className="w-4 h-4 text-blue-400" />
            </div>
            Google Calendar
          </CardTitle>
          <p className="text-gray-400 text-sm">חיבור חשבונות, סנכרון דו-כיווני וגיבוי ליומן שני</p>
        </CardHeader>
        <CardContent className="p-6">
          <Link to="/GoogleCalendarSync">
            <Button variant="outline" className="border-gray-700 text-gray-200 hover:bg-gray-800 gap-2 w-full justify-between">
              <span>ניהול חיבור יומן Google ובריאות סנכרון</span>
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
        </CardContent>
      </Card>

      {/* Morning (חשבונית ירוקה) — שני עסקים נפרדים, כל אחד עם חשבון Morning משלו */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800 pb-4">
          <CardTitle className="text-white flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            Morning — הפקת חשבוניות
          </CardTitle>
          <p className="text-gray-400 text-sm">הפקת חשבוניות אוטומטית דרך מערכת Morning — לכל עסק חשבון Morning נפרד</p>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-4">
            <p className="text-emerald-300 text-sm font-semibold">עוסק מורשה (חשבונית ירוקה)</p>
            <div>
              <Label className="text-gray-300">API Key</Label>
              <SecretInput fieldKey="morning_api_key_sole_prop" placeholder="morning-api-key" />
            </div>
            <div>
              <Label className="text-gray-300">API Secret</Label>
              <SecretInput fieldKey="morning_api_secret_sole_prop" placeholder="morning-api-secret" />
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-gray-800">
            <p className="text-purple-300 text-sm font-semibold">חברה בע״מ (חשבונית מס קבלה)</p>
            <div>
              <Label className="text-gray-300">API Key</Label>
              <SecretInput fieldKey="morning_api_key_company" placeholder="morning-api-key" />
            </div>
            <div>
              <Label className="text-gray-300">API Secret</Label>
              <SecretInput fieldKey="morning_api_secret_company" placeholder="morning-api-secret" />
            </div>
          </div>

          <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-3 text-xs text-blue-300">
            ניתן למצוא את המפתחות ב: Morning → הגדרות → API &amp; Webhooks (בחשבון המתאים לכל עסק)
          </div>
        </CardContent>
      </Card>

      {/* Status Indicators */}
      <Card className="bg-gray-900/50 border-gray-800">
        <CardHeader className="border-b border-gray-800 pb-3">
          <CardTitle className="text-white text-sm">סטטוס חיבורים</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatusBadge
              label="Green API (WhatsApp)"
              active={!!(values.whatsapp_gateway_url && values.whatsapp_instance_id && values.whatsapp_api_key)}
              icon={<MessageCircle className="w-3.5 h-3.5" />}
            />
            <StatusBadge
              label="Morning — עוסק מורשה"
              active={!!(values.morning_api_key_sole_prop && values.morning_api_secret_sole_prop)}
              icon={<FileText className="w-3.5 h-3.5" />}
            />
            <StatusBadge
              label="Morning — חברה בע״מ"
              active={!!(values.morning_api_key_company && values.morning_api_secret_company)}
              icon={<FileText className="w-3.5 h-3.5" />}
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
         <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3 text-xs text-amber-300">
           ⚠️ <strong>חשוב:</strong> הגדרות צריכות להישמר בכפתור זה לפני שניתן להשתמש בהן. בדוק את הסטטוס בעל-פי תצוגת "בדיקת חיבור".
         </div>
         <div className="flex justify-end">
           <Button
             onClick={handleSave}
             disabled={isSaving}
             className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold px-6"
           >
             <Save className="w-4 h-4 mr-2" />
             {isSaving ? "שומר..." : "שמור הגדרות אינטגרציות"}
           </Button>
         </div>
       </div>
    </div>
  );
}

function StatusBadge({ label, active, icon }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${
      active
        ? "bg-green-900/20 border-green-700/40 text-green-400"
        : "bg-gray-800/50 border-gray-700 text-gray-500"
    }`}>
      {active ? <CheckCircle className="w-3.5 h-3.5" /> : icon}
      {label}
      <span className="mr-auto">{active ? "מחובר" : "לא מוגדר"}</span>
    </div>
  );
}