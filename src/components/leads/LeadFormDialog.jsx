import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/defaultContractTerms";

const STATUSES = ["חדש", "נשלחה הצעה", "פולו-אפ", "נסגר/חתימה", "לא רלוונטי"];

export default function LeadFormDialog({ isOpen, onClose, lead, packagePrices, onSaved }) {
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState({
    coupleNames: "",
    eventDate: "",
    phoneNumber: "",
    email: "avira.media1@gmail.com",
    venueName: "",
    packageChoice: "",
    packageId: "",
    basePrice: "",
    discount: "",
    finalPrice: "",
    status: "חדש",
    notes: "",
    contractTerms: DEFAULT_CONTRACT_TERMS,
    packageDetails: "",
  });
  const [isSaving, setIsSaving] = useState(false);

  // Load packages from DB
  useEffect(() => {
    base44.entities.Package.list().then(setPackages).catch(() => {});
  }, []);

  // Load master contract terms from DB for new leads
  const loadMasterContract = async () => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "defaultContractTerms" });
      if (settings && settings.length > 0 && settings[0].value) {
        return settings[0].value;
      }
    } catch (e) {}
    return DEFAULT_CONTRACT_TERMS;
  };

  useEffect(() => {
    if (!isOpen) return;
    if (lead) {
      setForm({
        coupleNames: lead.coupleNames || "",
        eventDate: lead.eventDate || "",
        phoneNumber: lead.phoneNumber || "",
        email: lead.email || "avira.media1@gmail.com",
        venueName: lead.venueName || "",
        packageChoice: lead.packageChoice || "",
        packageId: lead.packageId || "",
        basePrice: lead.basePrice || "",
        discount: lead.discount || "",
        finalPrice: lead.finalPrice || "",
        status: lead.status || "חדש",
        notes: lead.notes || "",
        contractTerms: lead.contractTerms || DEFAULT_CONTRACT_TERMS,
        packageDetails: lead.packageDetails || "",
      });
    } else {
      // New lead: fetch master contract from DB
      loadMasterContract().then((terms) => {
        setForm({
          coupleNames: "", eventDate: "", phoneNumber: "", email: "avira.media1@gmail.com", venueName: "",
          packageChoice: "", packageId: "", basePrice: "", discount: "", finalPrice: "",
          status: "חדש", notes: "", contractTerms: terms, packageDetails: "",
        });
      });
    }
  }, [lead, isOpen]);

  const handlePackageChange = (pkgName) => {
    const matched = packages.find((p) => p.name === pkgName);
    const base = matched?.price || packagePrices[pkgName] || 0;
    const discount = Number(form.discount) || 0;
    // Build rich-text description from Package.description
    const autoDetails = matched?.description
      ? `<div dir="rtl"><p><strong>${matched.name}</strong></p><p>${matched.description}</p></div>`
      : "";
    setForm((f) => ({ ...f, packageChoice: pkgName, packageId: matched?.id || "", requiredCrew: matched?.totalCrewCount || undefined, basePrice: base, finalPrice: base - discount, packageDetails: autoDetails }));
  };

  const handleDiscountChange = (val) => {
    const discount = Number(val) || 0;
    const base = Number(form.basePrice) || 0;
    setForm((f) => ({ ...f, discount: val, finalPrice: base - discount }));
  };

  const handleBasePriceChange = (val) => {
    const base = Number(val) || 0;
    const discount = Number(form.discount) || 0;
    setForm((f) => ({ ...f, basePrice: val, finalPrice: base - discount }));
  };

  const handleSave = async () => {
    if (!form.coupleNames.trim()) {
      toast.error("נא להזין שמות הזוג");
      return;
    }
    setIsSaving(true);
    try {
      const data = {
        coupleNames: form.coupleNames,
        eventDate: form.eventDate || undefined,
        phoneNumber: form.phoneNumber || undefined,
        email: form.email || "avira.media1@gmail.com",
        venueName: form.venueName || undefined,
        packageChoice: form.packageChoice || undefined,
        packageId: form.packageId || undefined,
        basePrice: Number(form.basePrice) || 0,
        discount: Number(form.discount) || 0,
        finalPrice: Number(form.finalPrice) || 0,
        status: form.status,
        notes: form.notes || undefined,
        contractTerms: form.contractTerms || DEFAULT_CONTRACT_TERMS,
        packageDetails: form.packageDetails || undefined,
      };

      if (lead) {
        console.log('[LeadFormDialog] 🔵 BEFORE UPDATE: lead.id =', lead.id, '| lead.studio_id =', lead.studio_id);
        const updateResult = await base44.entities.Lead.update(lead.id, data);
        console.log('[LeadFormDialog] 🟢 AFTER UPDATE: result.id =', updateResult?.id, '| result.studio_id =', updateResult?.studio_id);
        
        // ✅ Verify UUID ID is the same (studio_id may change, that's different)
        if (updateResult?.id !== lead.id) {
          console.error('🔴 CRITICAL: Lead UUID ID changed! Original:', lead.id, 'Returned:', updateResult?.id);
        } else {
          console.log('✅ Lead UUID ID is identical. studio_id changed:', lead.studio_id, '→', updateResult?.studio_id);
        }
        
        if (data.status === "נסגר/חתימה") {
          await base44.functions.invoke('syncLeadToEvent', { leadId: lead.id });
        }
        toast.success("הליד עודכן בהצלחה");
      } else {
        // Create NEW lead
        const newLead = await base44.entities.Lead.create(data);
        console.log('[LeadFormDialog] 🆕 NEW LEAD CREATED:', { newLeadId: newLead.id, newLeadStudioId: newLead.studio_id });
        // Assign studio_id immediately
        try {
          await base44.functions.invoke('assignStudioIdToNewLead', { leadId: newLead.id });
        } catch (err) {
          console.error('Failed to assign studio_id:', err);
        }
        if (data.status === "נסגר/חתימה") {
          await base44.functions.invoke('syncLeadToEvent', { leadId: newLead.id });
        }
        toast.success("הליד נוסף בהצלחה עם מספר ID");
      }
      onSaved();
    } catch (error) {
      toast.error("שגיאה בשמירה");
    }
    setIsSaving(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{lead ? "עריכת ליד" : "ליד חדש"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-gray-300">שמות הזוג *</Label>
            <Input value={form.coupleNames} onChange={(e) => setForm((f) => ({ ...f, coupleNames: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="שם + שם" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-300">תאריך האירוע</Label>
              <Input type="date" value={form.eventDate} onChange={(e) => setForm((f) => ({ ...f, eventDate: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300">טלפון</Label>
              <Input value={form.phoneNumber} onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="050-0000000" />
            </div>
          </div>

          <div>
            <Label className="text-gray-300 text-xs">📋 הדבקה מוואטסאפ <span className="text-gray-500">(ממיר אוטומטית לפורמט ישראלי)</span></Label>
            <Input
              placeholder="+972 54-739-1810"
              className="bg-gray-800/60 border-gray-600 border-dashed text-gray-300 mt-1"
              value=""
              onChange={() => {}}
              onPaste={(e) => {
                e.preventDefault();
                const raw = e.clipboardData.getData('text');
                let cleaned = raw.replace(/\D/g, '');
                if (cleaned.startsWith('972')) cleaned = '0' + cleaned.slice(3);
                setForm((f) => ({ ...f, phoneNumber: cleaned }));
              }}
            />
          </div>

          <div>
            <Label className="text-gray-300">אימייל</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="avira.media1@gmail.com" />
          </div>

          <div>
            <Label className="text-gray-300">שם האולם</Label>
            <Input value={form.venueName} onChange={(e) => setForm((f) => ({ ...f, venueName: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="שם האולם / מקום האירוע" />
          </div>

          <div>
            <Label className="text-gray-300">בחירת חבילה</Label>
            <Select value={form.packageChoice} onValueChange={handlePackageChange}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                <SelectValue placeholder="בחר חבילה..." />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {packages.length > 0
                  ? packages.map((p) => (
                    <SelectItem key={p.id} value={p.name}>{p.name} — ₪{p.price?.toLocaleString()}</SelectItem>
                  ))
                  : Object.entries(packagePrices).map(([name, price]) => (
                    <SelectItem key={name} value={name}>{name} — ₪{price?.toLocaleString()}</SelectItem>
                  ))
                }
              </SelectContent>
            </Select>
          </div>

          {/* Package Details - editable per lead */}
          <div>
            <Label className="text-gray-300">
              פירוט החבילה{" "}
              <span className="text-gray-500 font-normal text-xs">(נמשך אוטומטית מהחבילה, ניתן לערוך לליד זה בלבד)</span>
            </Label>
            <div className="mt-1 rounded-md overflow-hidden" dir="rtl">
              <style>{`
                .pkg-quill .ql-toolbar { background: #374151; border-color: #4b5563; }
                .pkg-quill .ql-toolbar .ql-stroke { stroke: #d1d5db; }
                .pkg-quill .ql-toolbar .ql-fill { fill: #d1d5db; }
                .pkg-quill .ql-toolbar .ql-picker { color: #d1d5db; }
                .pkg-quill .ql-container { background: #1f2937; border-color: #4b5563; color: #f3f4f6; min-height: 120px; font-size: 13px; }
                .pkg-quill .ql-editor { direction: rtl; text-align: right; }
              `}</style>
              <ReactQuill
                className="pkg-quill"
                value={form.packageDetails}
                onChange={(val) => setForm((f) => ({ ...f, packageDetails: val }))}
                modules={{ toolbar: [["bold", "italic"], [{ list: "bullet" }], ["clean"]] }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <Label className="text-gray-300">מחיר בסיס (₪)</Label>
              <Input type="number" value={form.basePrice} onChange={(e) => handleBasePriceChange(e.target.value)} className="bg-gray-800 border-gray-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300">הנחה (₪)</Label>
              <Input type="number" value={form.discount} onChange={(e) => handleDiscountChange(e.target.value)} className="bg-gray-800 border-gray-700 text-white mt-1" />
            </div>
            <div>
              <Label className="text-gray-300">סכום סופי (₪)</Label>
              <Input type="number" value={form.finalPrice} readOnly className="bg-gray-700/50 border-gray-600 text-green-400 mt-1 font-semibold" />
            </div>
          </div>

          <div>
            <Label className="text-gray-300">סטטוס ליד</Label>
            <Select value={form.status} onValueChange={(val) => setForm((f) => ({ ...f, status: val }))}>
              <SelectTrigger className="bg-gray-800 border-gray-700 text-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-gray-300">הערות</Label>
            <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="הערות נוספות..." />
          </div>

          {/* Rich Text - Contract Terms */}
          <div>
            <Label className="text-gray-300">תנאי החוזה</Label>
            <div className="mt-1 rounded-md overflow-hidden" dir="rtl">
              <style>{`
                .contract-quill .ql-toolbar { background: #374151; border-color: #4b5563; }
                .contract-quill .ql-toolbar .ql-stroke { stroke: #d1d5db; }
                .contract-quill .ql-toolbar .ql-fill { fill: #d1d5db; }
                .contract-quill .ql-toolbar .ql-picker { color: #d1d5db; }
                .contract-quill .ql-container { background: #1f2937; border-color: #4b5563; color: #f3f4f6; min-height: 200px; font-size: 13px; }
                .contract-quill .ql-editor { direction: rtl; text-align: right; }
              `}</style>
              <ReactQuill
                className="contract-quill"
                value={form.contractTerms}
                onChange={(val) => setForm((f) => ({ ...f, contractTerms: val }))}
                modules={{
                  toolbar: [
                    [{ header: [2, 3, false] }],
                    ["bold", "italic", "underline"],
                    [{ list: "ordered" }, { list: "bullet" }],
                    ["clean"],
                  ],
                }}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} className="border-gray-700 bg-gray-800 text-gray-300">ביטול</Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
            {isSaving ? "שומר..." : "שמור"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}