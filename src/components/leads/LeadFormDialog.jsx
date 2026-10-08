import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/defaultContractTerms";
import { parseWhatsAppLead } from "@/lib/whatsappLeadParser";
import { leadSyncOutcome } from "@/lib/actionOutcome";
import { applyLeadTemplateVariables } from "@/lib/leadMessages";
import { confirmDialog } from "@/components/ui/confirm-dialog";

// ששת הערכים שה-CHECK ב-0001_init.sql:106 מתיר. 'חוזה' נכתב ע"י sign-lead-public
// בכל חתימה ציבורית — בלעדיו ה-Select נשאר ריק בעריכת ליד חתום.
const STATUSES = ["חדש", "נשלחה הצעה", "פולו-אפ", "נסגר/חתימה", "חוזה", "לא רלוונטי"];

// After the contract of a couple who already received it is edited (2026-10-07: the owner
// saved a change and thought it had not saved). Editable before sending; nothing is sent
// without a click and a confirm.
const UPDATED_CONTRACT_MESSAGE = "שלום {{names}} 😊\nעדכנו את החוזה לפי מה שביקשתם. הנה הקישור לחוזה המעודכן:\n{{contract_link}}";

// `lead`          — an existing lead being EDITED; handleSave takes the update path.
// `initialValues` — pre-filled values for a NEW lead; handleSave still takes the create
//                   path. Added for the WhatsApp inbox's "צור ליד" button, which
//                   pre-fills this form from a conversation but must never create the
//                   lead by itself — nothing is written until the user presses שמור.
//                   Deliberately a separate prop from `lead`: passing a partial object
//                   as `lead` would send handleSave into `Lead.update(undefined, ...)`.
export default function LeadFormDialog({ isOpen, onClose, lead, initialValues, packagePrices, onSaved }) {
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState({
    coupleNames: "",
    eventDate: "",
    phoneNumber: "",
    // Until now these were writable ONLY by the couple, through the public
    // questionnaire (EventQuestionnaire.jsx) — the studio could see them but had no way
    // to enter or correct one. That left no place at all to record a couple's second
    // phone number, which matters twice: on the event day you want to be able to reach
    // either partner, and the WhatsApp inbox classifies an incoming number by matching
    // it against exactly these fields, so a partner who messages from the number we
    // never stored shows up as a total stranger.
    productionBridePhone: "",
    productionGroomPhone: "",
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
  // True only when the user typed in the contract editor (Quill normalises the HTML on
  // load, so comparing texts would flag edits that never happened).
  const [contractEdited, setContractEdited] = useState(false);
  // { phone, names, text } — the "contract updated" screen shown instead of closing.
  const [updatedNotice, setUpdatedNotice] = useState(null);
  const [isSendingUpdate, setIsSendingUpdate] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteWarnings, setPasteWarnings] = useState([]);

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
    // כל פתיחה מתחילה נקי — אחרת אזהרות מהדבקה קודמת נשארות על המסך.
    setPasteText("");
    setPasteWarnings([]);
    setContractEdited(false);
    setUpdatedNotice(null);
    if (lead) {
      setForm({
        coupleNames: lead.coupleNames || "",
        eventDate: lead.eventDate || "",
        phoneNumber: lead.phoneNumber || "",
        // Loaded so that saving an unrelated edit can never wipe an answer the couple
        // already gave in the questionnaire.
        productionBridePhone: lead.productionBridePhone || "",
        productionGroomPhone: lead.productionGroomPhone || "",
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
      // New lead: fetch master contract from DB.
      // initialValues (if any) is spread LAST but only over the empty defaults — it can
      // never overwrite the master contract terms, and callers deliberately don't pass
      // email/status/package fields (email is the invoice recipient — see the paste
      // handler's note below).
      loadMasterContract().then((terms) => {
        setForm({
          coupleNames: "", eventDate: "", phoneNumber: "",
          productionBridePhone: "", productionGroomPhone: "",
          email: "avira.media1@gmail.com", venueName: "",
          packageChoice: "", packageId: "", basePrice: "", discount: "", finalPrice: "",
          status: "חדש", notes: "", packageDetails: "",
          ...(initialValues || {}),
          contractTerms: terms,
        });
      });
    }
  }, [lead, isOpen]);

  // קליטת הודעת וואטסאפ שלמה. הזיהוי כולו מקומי בדפדפן — אין קריאת רשת, אין AI,
  // אין שליחה של שום דבר לאף אחד. ראה src/lib/whatsappLeadParser.js.
  const handleWhatsAppPaste = (text) => {
    setPasteText(text);
    if (!text || !text.trim()) {
      setPasteWarnings([]);
      return;
    }
    const result = parseWhatsAppLead(text);
    const warnings = [...result.warnings];

    setForm((f) => {
      // פורסים רק מפתחות שהפרסר באמת הפיק. email/status/packageChoice/contractTerms
      // לעולם לא נדרסים: form.email הוא נמען החשבונית (avira.media1@gmail.com),
      // ומילוי אוטומטי שלו היה שולח חשבוניות אמיתיות לזוגות.
      const next = { ...f, ...result.fields };
      if (result.leftovers.length > 0) {
        next.notes = [f.notes, ...result.leftovers].filter(Boolean).join(" | ");
      }
      return next;
    });

    for (const line of result.leftovers) {
      warnings.push(`לא זוהה — הועבר להערות: ${line}`);
    }
    setPasteWarnings(warnings);

    const filled = Object.keys(result.fields).length;
    if (filled === 0) toast.error("לא זוהו פרטים בהודעה");
    else toast.success(`זוהו ${filled} שדות`);
  };

  const handleClearPaste = () => {
    setPasteText("");
    setPasteWarnings([]);
  };

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
    // נשאר null במסלול העדכון — הקורא פותח את הפאנל רק עבור ליד שנוצר עכשיו.
    let createdLead = null;
    try {
      const data = {
        coupleNames: form.coupleNames,
        eventDate: form.eventDate || undefined,
        phoneNumber: form.phoneNumber || undefined,
        // `undefined` (not "") on purpose: JSON.stringify drops the key entirely, so an
        // empty box leaves the stored value untouched rather than erasing what the
        // couple filled in through the questionnaire. Same convention as the fields
        // above.
        productionBridePhone: form.productionBridePhone || undefined,
        productionGroomPhone: form.productionGroomPhone || undefined,
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
        await base44.entities.Lead.update(lead.id, data);

        if (data.status === "נסגר/חתימה") {
          // E2: the lead is saved either way — a failed event sync is a warning, not "save failed".
          const res = await base44.functions.invoke('syncLeadToEvent', { leadId: lead.id }).catch((e) => ({ data: { error: e.message } }));
          const out = leadSyncOutcome(res?.data);
          if (!out.ok) toast.warning(`הליד נשמר, אבל ${out.text}`);
        }
        // The couple already has this contract and has not signed it: say so plainly and
        // offer to send them the link again, instead of closing on a small toast.
        if (contractEdited && lead.contractSent && !lead.signedAt) {
          toast.success("החוזה עודכן ונשמר");
          setUpdatedNotice({
            phone: form.phoneNumber || lead.phoneNumber || "",
            names: form.coupleNames,
            text: applyLeadTemplateVariables(UPDATED_CONTRACT_MESSAGE, { ...lead, coupleNames: form.coupleNames }),
          });
          setIsSaving(false);
          return;
        }
        toast.success(contractEdited ? "הליד והחוזה עודכנו" : "הליד עודכן בהצלחה");
      } else {
        // Create NEW lead
        const newLead = await base44.entities.Lead.create(data);
        createdLead = newLead;
        console.log('[LeadFormDialog] 🆕 NEW LEAD CREATED:', { newLeadId: newLead.id, newLeadStudioId: newLead.studio_id });
        // Assign studio_id immediately
        try {
          await base44.functions.invoke('assignStudioIdToNewLead', { leadId: newLead.id });
        } catch (err) {
          console.error('Failed to assign studio_id:', err);
        }
        if (data.status === "נסגר/חתימה") {
          const res = await base44.functions.invoke('syncLeadToEvent', { leadId: newLead.id }).catch((e) => ({ data: { error: e.message } }));
          const out = leadSyncOutcome(res?.data);
          if (!out.ok) toast.warning(`הליד נשמר, אבל ${out.text}`);
        }
        toast.success("הליד נוסף בהצלחה עם מספר ID");
      }
      onSaved(createdLead);
    } catch (error) {
      console.error("[LeadFormDialog] save failed:", error);
      toast.error("שגיאה בשמירה", { description: error?.message });
    }
    setIsSaving(false);
  };

  const sendUpdatedContract = async () => {
    if (!updatedNotice?.phone) return;
    if (!await confirmDialog(`לשלוח ל-${updatedNotice.names} (${updatedNotice.phone}) את הקישור לחוזה המעודכן?`)) return;
    setIsSendingUpdate(true);
    try {
      const res = await base44.functions.invoke("sendWhatsAppMessage", { to: updatedNotice.phone, message: updatedNotice.text });
      if (res?.data?.error) throw new Error(res.data.error);
      toast.success("החוזה המעודכן נשלח לזוג");
      onSaved(null);
    } catch (e) {
      toast.error("השליחה נכשלה", { description: e?.message });
    }
    setIsSendingUpdate(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) { if (updatedNotice) onSaved(null); else onClose(); } }}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-3xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">{lead ? "עריכת ליד" : "ליד חדש"}</DialogTitle>
        </DialogHeader>

        {updatedNotice ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-emerald-500/50 bg-emerald-500/10 p-4">
              <div className="text-lg font-bold text-emerald-300">✅ החוזה עודכן ונשמר</div>
              <p className="mt-1 text-sm text-gray-300">
                {updatedNotice.names} כבר קיבלו את החוזה. הם יראו את הנוסח החדש כשיפתחו שוב את הקישור.
                אפשר לשלוח להם עכשיו הודעה עם הקישור לחוזה המעודכן:
              </p>
            </div>
            <div>
              <Label className="text-gray-300">ההודעה שתישלח בוואטסאפ</Label>
              <Textarea
                dir="rtl"
                rows={5}
                value={updatedNotice.text}
                onChange={(e) => setUpdatedNotice((n) => ({ ...n, text: e.target.value }))}
                className="mt-1 bg-gray-800 border-gray-700 text-white"
              />
              {!updatedNotice.phone && <p className="mt-1 text-xs text-amber-300">אין טלפון לליד — אי אפשר לשלוח.</p>}
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => onSaved(null)} disabled={isSendingUpdate} className="border-gray-700 bg-gray-800 text-gray-300">סגור בלי לשלוח</Button>
              <Button onClick={sendUpdatedContract} disabled={isSendingUpdate || !updatedNotice.phone || !updatedNotice.text.trim()} className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold">
                {isSendingUpdate ? "שולח..." : "📨 שלח לזוג את החוזה המעודכן"}
              </Button>
            </DialogFooter>
          </div>
        ) : (<>
        <div className="space-y-4 py-2">
          {/* רק בליד חדש: הדבקה על ליד קיים עלולה לדרוס פרטים שכבר אושרו. */}
          {!lead && (
            <div className="rounded-lg border border-dashed border-gray-600 bg-gray-800/40 p-3">
              <Label className="text-gray-300 text-xs">
                הדבקה מוואטסאפ{" "}
                <span className="text-gray-500">(שמות · תאריך · אולם · טלפון — כל שורה בנפרד)</span>
              </Label>
              <Textarea
                dir="rtl"
                rows={4}
                value={pasteText}
                onChange={(e) => handleWhatsAppPaste(e.target.value)}
                placeholder={"דניאל וסבינה\n16/9/27\nעדיה\n0547391810"}
                className="bg-gray-800 border-gray-700 text-white mt-1 text-sm"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-gray-500">הזיהוי מתבצע במכשיר שלך — לא נשלח לשום מקום</span>
                {pasteText && (
                  <Button type="button" variant="ghost" size="sm" onClick={handleClearPaste} className="text-gray-400 h-7 px-2 text-xs">
                    נקה
                  </Button>
                )}
              </div>
              {pasteWarnings.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {pasteWarnings.map((w, i) => (
                    <li key={i} className="text-[11px] text-amber-400 flex gap-1.5">
                      <span aria-hidden="true">⚠️</span>
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

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

          {/* The couple's own two numbers. Previously fillable only by the couple, in the
              questionnaire — so a partner who wasn't the original contact had no number
              stored anywhere, and the WhatsApp inbox tagged them "לא מוכר". */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-300">נייד כלה</Label>
              <Input value={form.productionBridePhone} onChange={(e) => setForm((f) => ({ ...f, productionBridePhone: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="050-0000000" />
            </div>
            <div>
              <Label className="text-gray-300">נייד חתן</Label>
              <Input value={form.productionGroomPhone} onChange={(e) => setForm((f) => ({ ...f, productionGroomPhone: e.target.value }))} className="bg-gray-800 border-gray-700 text-white mt-1" placeholder="050-0000000" />
            </div>
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
                onChange={(val, _delta, source) => {
                  setForm((f) => ({ ...f, contractTerms: val }));
                  if (source === "user") setContractEdited(true);
                }}
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

        {/* דביק: כפתור השמירה יושב אחרי שני עורכי ReactQuill בתוך דיאלוג גולל,
            ובלי זה צריך לגלול הרבה כדי להגיע אליו. */}
        <DialogFooter className="gap-2 sticky bottom-0 bg-gray-900 pt-3 -mx-6 px-6 border-t border-gray-800">
          <Button variant="outline" onClick={onClose} className="border-gray-700 bg-gray-800 text-gray-300">ביטול</Button>
          <Button onClick={handleSave} disabled={isSaving} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold">
            {isSaving ? "שומר..." : "שמור"}
          </Button>
        </DialogFooter>
        </>)}
      </DialogContent>
    </Dialog>
  );
}