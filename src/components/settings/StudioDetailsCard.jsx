import React, { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { supabase } from "@/api/supabaseClient";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isAdmin } from "@/lib/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImageIcon, Save, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";

// New (2026-08-18): "פרטי הסטודיו" — tenant identity/contact fields, requested
// separately from the basic name/timezone/currency already in WorkspaceTab.jsx.
// v1/settings-only per explicit user decision: these fields are captured and
// saved here, but nothing else in the app (contract PDF, WhatsApp sends, invoice
// descriptions, the app header) reads them yet — that's a deliberate follow-up.
//
// Logo uploads go to the new `studio-logos` Supabase Storage bucket (migration
// 0021_studio_details.sql) — the first real Storage bucket in this project,
// rather than the base64-in-DB pattern StudioSignatureCard.jsx uses, since a
// logo is more likely to be reused/embedded elsewhere later where a plain
// public URL is preferable to inflating every `tenants` row with image bytes.
const FIELDS = [
  { key: "display_name_to_clients", label: "שם שיופיע ללקוחות" },
  { key: "phone", label: "טלפון" },
  { key: "whatsapp_number", label: "WhatsApp" },
  { key: "email", label: "אימייל" },
  { key: "address", label: "כתובת" },
  { key: "business_number_sole_prop", label: "מספר עוסק מורשה" },
  { key: "business_number_company", label: "ח.פ. חברה בע״מ" },
  { key: "website", label: "אתר" },
  { key: "instagram_url", label: "Instagram" },
  { key: "facebook_url", label: "Facebook" },
];

const EMPTY_FORM = FIELDS.reduce((acc, f) => ({ ...acc, [f.key]: "" }), { auto_signature_text: "" });

const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

// base44.entities.Tenant (src/api/entities.js) converts every column to camelCase
// on read (rowToRecord/snakeToCamel) but accepts snake_case keys on write unchanged
// (camelToSnake is a no-op on an already-snake string) — so `form`/FIELDS below stay
// snake_case (matches the DB columns, used directly in Tenant.update()), but reading
// a freshly-loaded row back must convert each key to camelCase first, or every field
// silently reads as undefined after a reload despite having saved correctly.
const toCamelKey = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

export default function StudioDetailsCard() {
  const { user } = useAuth();
  const canManage = isAdmin(user);

  const [form, setForm] = useState(EMPTY_FORM);
  const [logoUrl, setLogoUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (user?.tenant_id) loadTenant();
  }, [user?.tenant_id]);

  const loadTenant = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.Tenant.get(user.tenant_id);
      if (data) {
        const next = { ...EMPTY_FORM };
        FIELDS.forEach((f) => { next[f.key] = data[toCamelKey(f.key)] || ""; });
        next.auto_signature_text = data.autoSignatureText || "";
        setForm(next);
        setLogoUrl(data.logoUrl || null);
      }
    } catch (error) {
      toast.error("שגיאה בטעינת פרטי הסטודיו", { description: error.message });
    }
    setIsLoading(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await base44.entities.Tenant.update(user.tenant_id, { ...form });
      toast.success("פרטי הסטודיו נשמרו בהצלחה");
    } catch (error) {
      toast.error("שמירה נכשלה", { description: error.message });
    }
    setIsSaving(false);
  };

  const extractStoragePath = (publicUrl) => {
    // Public URLs look like ".../storage/v1/object/public/studio-logos/<path>".
    const marker = "/object/public/studio-logos/";
    const idx = publicUrl?.indexOf(marker);
    if (idx === -1 || idx === undefined) return null;
    return publicUrl.slice(idx + marker.length);
  };

  const handleLogoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("יש להעלות קובץ תמונה בלבד");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("גודל הקובץ חייב להיות עד 2MB");
      return;
    }

    setIsUploadingLogo(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.tenant_id}/logo-${Date.now()}-${sanitized || `logo.${ext}`}`;

      const { error: uploadError } = await supabase.storage
        .from("studio-logos")
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from("studio-logos").getPublicUrl(path);
      const newLogoUrl = publicUrlData?.publicUrl;
      if (!newLogoUrl) throw new Error("לא התקבל URL ציבורי עבור הלוגו");

      await base44.entities.Tenant.update(user.tenant_id, { logo_url: newLogoUrl });

      // Best-effort cleanup of the previous logo file — never blocks the save.
      const oldPath = extractStoragePath(logoUrl);
      if (oldPath) {
        supabase.storage.from("studio-logos").remove([oldPath]).catch(() => {});
      }

      setLogoUrl(newLogoUrl);
      toast.success("הלוגו הועלה בהצלחה");
    } catch (error) {
      toast.error("העלאת הלוגו נכשלה", { description: error.message });
    }
    setIsUploadingLogo(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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
          <ImageIcon className="w-5 h-5 text-yellow-400" />
          פרטי הסטודיו
        </CardTitle>
        <p className="text-gray-400 text-sm mt-1">
          פרטי זהות ויצירת קשר של הסטודיו (בשלב זה נשמר כאן בלבד — עדיין לא משולב אוטומטית בחוזה, בהודעות או בחשבוניות)
        </p>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="space-y-2">
          <Label className="text-gray-300 font-medium">לוגו</Label>
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-lg bg-gray-800/50 border border-gray-700 flex items-center justify-center overflow-hidden shrink-0">
              {logoUrl ? (
                <img src={logoUrl} alt="לוגו הסטודיו" className="w-full h-full object-contain" />
              ) : (
                <ImageIcon className="w-8 h-8 text-gray-600" />
              )}
            </div>
            {canManage && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleLogoChange}
                  disabled={isUploadingLogo}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isUploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-yellow-400"
                >
                  {isUploadingLogo ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <Upload className="w-4 h-4 ml-2" />}
                  {isUploadingLogo ? "מעלה..." : logoUrl ? "החלף לוגו" : "העלה לוגו"}
                </Button>
                <p className="text-xs text-gray-500 mt-1">PNG/JPG, עד 2MB</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-2">
              <Label className="text-gray-300 font-medium">{f.label}</Label>
              <Input
                value={form[f.key]}
                disabled={!canManage}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="bg-gray-800/50 border-gray-700 text-white"
              />
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label className="text-gray-300 font-medium">חתימה אוטומטית להודעות</Label>
          <Textarea
            value={form.auto_signature_text}
            disabled={!canManage}
            onChange={(e) => setForm({ ...form, auto_signature_text: e.target.value })}
            className="bg-gray-800/50 border-gray-700 text-white min-h-[80px]"
            placeholder="לדוגמה: בברכה, צוות הסטודיו"
          />
          <p className="text-xs text-gray-500">
            נשמר כרגע בלבד — עדיין לא מתווסף אוטומטית להודעות WhatsApp היוצאות.
          </p>
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
