import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PenTool, Save, Eraser, Loader2 } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { toast } from "sonner";

// New (2026-08-13): lets the studio draw+save its own signature once, stored as a
// tenant-scoped app_setting (key: "studio_signature", value: a base64 PNG data URL --
// same plain key/value app_settings table used everywhere else in Settings, see
// IntegrationsTab.jsx/handleSaveContractTerms above for the identical load/save
// pattern). ContractPage.jsx's generateSignedPdf() reads this (via getLeadPublic,
// which now returns it) and stamps it into every signed contract next to the client's
// own signature, so a signed contract PDF shows both signatures like a real paper
// contract -- previously the "Studio Signature" line in the PDF was always blank.
export default function StudioSignatureCard() {
  const [savedSignature, setSavedSignature] = useState(null); // data URL string or null
  const [settingId, setSettingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEmpty, setIsEmpty] = useState(true);
  const sigRef = useRef(null);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await base44.entities.AppSetting.filter({ key: "studio_signature" });
      if (rows && rows.length > 0 && rows[0].value) {
        setSavedSignature(rows[0].value);
        setSettingId(rows[0].id);
      }
    } catch (error) {
      console.error("Error loading studio signature:", error);
    }
    setLoading(false);
  };

  const handleClear = () => {
    sigRef.current?.clear();
    setIsEmpty(true);
  };

  const handleSave = async () => {
    if (!sigRef.current || sigRef.current.isEmpty()) {
      toast.error("נא לצייר חתימה לפני השמירה");
      return;
    }
    setIsSaving(true);
    try {
      // Same getTrimmedCanvas()-can-crash-on-mobile fallback used in ContractPage.jsx.
      let dataUrl;
      try {
        dataUrl = sigRef.current.getTrimmedCanvas().toDataURL("image/png");
      } catch (trimErr) {
        console.error("getTrimmedCanvas() failed, falling back to full canvas:", trimErr);
        dataUrl = sigRef.current.getCanvas().toDataURL("image/png");
      }

      if (settingId) {
        await base44.entities.AppSetting.update(settingId, { value: dataUrl });
      } else {
        const created = await base44.entities.AppSetting.create({ key: "studio_signature", value: dataUrl });
        setSettingId(created.id);
      }
      setSavedSignature(dataUrl);
      setIsEditing(false);
      toast.success("החתימה נשמרה בהצלחה! מעכשיו היא תופיע אוטומטית על כל חוזה חתום.");
    } catch (error) {
      console.error("Error saving studio signature:", error);
      toast.error("שגיאה בשמירת החתימה");
    }
    setIsSaving(false);
  };

  return (
    <Card className="bg-gray-900/50 border-gray-800 backdrop-blur-sm">
      <CardHeader className="border-b border-gray-800">
        <CardTitle className="text-white flex items-center gap-2">
          <PenTool className="w-5 h-5 text-yellow-400" />
          חתימת הסטודיו
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <p className="text-gray-400 text-sm">
          החתימה שתשמור כאן תוטבע אוטומטית בצד "חתימת הסטודיו" בכל חוזה שנחתם על ידי לקוח.
        </p>

        {loading ? (
          <div className="h-40 bg-gray-800 rounded-lg animate-pulse" />
        ) : savedSignature && !isEditing ? (
          <div className="space-y-3">
            <div className="bg-white border border-gray-300 rounded-lg p-3 flex items-center justify-center">
              <img src={savedSignature} alt="חתימת הסטודיו" className="max-h-32" />
            </div>
            <Button
              variant="outline"
              onClick={() => setIsEditing(true)}
              className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
            >
              <PenTool className="w-4 h-4 ml-2" />
              עדכן חתימה
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-400">חתמו כאן באצבע (בנייד) או בעכבר (במחשב)</span>
              <button
                type="button"
                onClick={handleClear}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-200 rounded px-2 py-1"
              >
                <Eraser className="w-3.5 h-3.5" />
                נקה
              </button>
            </div>
            <div className="bg-white border border-gray-300 rounded-lg overflow-hidden touch-none">
              <SignatureCanvas
                ref={sigRef}
                penColor="black"
                onEnd={() => setIsEmpty(sigRef.current?.isEmpty() ?? true)}
                canvasProps={{
                  className: "w-full",
                  style: { width: "100%", height: "160px", touchAction: "none" },
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={isSaving || isEmpty}
                className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold"
              >
                {isSaving ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Save className="w-4 h-4 ml-2" />}
                {isSaving ? "שומר..." : "שמור חתימה"}
              </Button>
              {savedSignature && (
                <Button
                  variant="ghost"
                  onClick={() => setIsEditing(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ביטול
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
