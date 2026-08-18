import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, ExternalLink, Loader2, AlertTriangle, XCircle, Wifi, CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { VAT_RATE } from "@/lib/financialCalculations";

const INVOICE_ITEMS = ["מקדמה", "תשלום יתרה", "תוספת צילום", "אלבומים"];

// Morning API payment type codes: 1=מזומן, 2=צ'ק, 4=העברה בנקאית, 10=ביט
const PAYMENT_METHODS = [
  { value: "4", label: "העברה בנקאית" },
  { value: "1", label: "מזומן" },
  { value: "2", label: "צ'ק" },
  { value: "10", label: "ביט" },
];

export default function InvoiceDialog({
  isOpen,
  onClose,
  coupleNames,
  eventDate,
  venueName,
  clientEmail,
  clientPhone,
  leadId,
  remainingBalance,
  onInvoiceCreated,
  // Which Morning account issues the document — 'sole_prop' (עוסק מורשה, ירוק) or
  // 'company' (חברה בע״מ, סגול). Defaults to 'sole_prop' to preserve old behavior for
  // any caller that doesn't pass it. See generate-morning-invoice/index.ts.
  businessType = "sole_prop",
}) {
  const todayStr = new Date().toISOString().split("T")[0];
  const DEPOSIT_AMOUNT = 500;
  const isCompany = businessType === "company";
  const businessLabel = isCompany ? "חברה בע״מ" : "עוסק מורשה";
  // Full literal Tailwind class strings (not template-interpolated) so the JIT scanner
  // picks them up regardless of which branch renders first.
  const theme = isCompany
    ? { icon: "text-purple-400", btn: "bg-purple-600 hover:bg-purple-700" }
    : { icon: "text-emerald-400", btn: "bg-emerald-600 hover:bg-emerald-700" };

  const getAutoAmount = (selectedItem) => {
    if (selectedItem === "מקדמה") return DEPOSIT_AMOUNT;
    if (selectedItem === "תשלום יתרה" && remainingBalance != null) return remainingBalance;
    return "";
  };

  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("4");
  const [documentDate, setDocumentDate] = useState(todayStr);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingConnection, setIsCheckingConnection] = useState(false);
  const [invoiceUrl, setInvoiceUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [apiStatus, setApiStatus] = useState(null); // { ok: bool, msg: string }
  const [latestMorningDate, setLatestMorningDate] = useState(null); // latest issued doc date globally
  const [isFetchingLatestDate, setIsFetchingLatestDate] = useState(false);

  // Display-only VAT breakdown preview (the actual charged amount, amountNum, is
  // unaffected) — centralized on the shared VAT_RATE constant instead of a locally
  // duplicated magic number, so a future statutory rate change is a one-place fix.
  const vatRate = VAT_RATE - 1;
  const amountNum = parseFloat(amount) || 0;
  const vatAmount = +(amountNum - amountNum / (1 + vatRate)).toFixed(2);
  const priceBeforeVat = +(amountNum / (1 + vatRate)).toFixed(2);

  // Fetch latest Morning doc date when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    setIsFetchingLatestDate(true);
    base44.functions.invoke("getLatestMorningDocumentDate", { businessType })
      .then((res) => {
        if (res.data?.found && res.data?.latestDocumentDate) {
          setLatestMorningDate(res.data.latestDocumentDate);
        }
      })
      .catch(() => {}) // silent fail — don't block the dialog
      .finally(() => setIsFetchingLatestDate(false));
  }, [isOpen, businessType]);

  const isDateBeforeLatest = latestMorningDate && documentDate < latestMorningDate;

  const handleSubmit = async () => {
    // שלב א׳ - בדיקת תקינות מקומית
    if (!item || !amountNum || !paymentMethod) {
      setErrorMsg("חסרים שדות: יש למלא פריט, סכום ואמצעי תשלום");
      return;
    }
    if (!coupleNames) {
      setErrorMsg("חסרים נתוני הגדרה: שם לקוח חסר");
      return;
    }
    if (isDateBeforeLatest) {
      setErrorMsg(`תאריך המסמך (${documentDate}) קודם לתאריך המסמך האחרון שהונפק במורנינג (${latestMorningDate}). לא ניתן להנפיק מסמך בתאריך מוקדם יותר.`);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    try {
      // שלב ב׳ + ג׳ - שליחה לשרת (שם מתבצע אימות הטוקן והפקת המסמך)
      const res = await base44.functions.invoke("generateMorningInvoice", {
        clientName: coupleNames,
        clientEmail: clientEmail || "avira.media1@gmail.com",
        clientPhone: clientPhone || "",
        itemDescription: item,
        itemNotes: description,
        amount: amountNum,
        paymentMethodType: parseInt(paymentMethod),
        documentDate,
        eventDate: eventDate || "",
        leadId: leadId || "",
        businessType,
      });

      const data = res.data;

      if (data?.success || data?.warning) {
        // החשבונית הופקה בהצלחה ב-Morning וכבר נשמרה ב-CRM
        const url = data.invoiceUrl;
        setInvoiceUrl(url);
        
        if (data.warning) {
          toast.error(data.warning);
        } else {
          toast.success(`החשבונית הופקה בהצלחה על סך ₪${amountNum.toLocaleString()}`);
        }
        
        // קרא ל-callback כדי לתרגל את ה-Drawer
        if (onInvoiceCreated) onInvoiceCreated(url, amountNum);
      } else if (data?.invoiceUrl) {
        // Fallback: אם יש URL זה כנראה הצליח
        const url = data.invoiceUrl;
        setInvoiceUrl(url);
        toast.success(`החשבונית הופקה בהצלחה על סך ₪${amountNum.toLocaleString()}`);
        if (onInvoiceCreated) onInvoiceCreated(url, amountNum);
      } else {
        // טיפול בשגיאה - Drawer נשאר פתוח
        const errMsg = data?.error || "שגיאה לא ידועה";
        const rawBody = data?.rawBody || "";
        setErrorMsg(errMsg);
        console.error("Morning invoice error:", data);
        const debugInfo = data?.debugPayload ? `\n\n--- DEBUG PAYLOAD ---\n${JSON.stringify(data.debugPayload, null, 2)}` : "";
        alert(`Detailed Server Error: ${rawBody || errMsg}${debugInfo}`);
      }
    } catch (e) {
      // שגיאת רשת / שרת - Drawer נשאר פתוח
      setErrorMsg(`Detailed Server Error: ${e.message}`);
      console.error("Invoice network error:", e);
      alert(`Detailed Server Error: ${e.message}`);
    }

    setIsLoading(false);
  };

  const handleCheckConnection = async () => {
    setIsCheckingConnection(true);
    setApiStatus(null);
    try {
      const res = await base44.functions.invoke("checkMorningConnection", { businessType });
      const data = res.data;
      setApiStatus({ ok: data?.success, msg: data?.message || "תשובה לא ידועה" });
    } catch (e) {
      setApiStatus({ ok: false, msg: `שגיאת רשת: ${e.message}` });
    }
    setIsCheckingConnection(false);
  };

  const handleClose = () => {
    setItem("");
    setDescription("");
    setAmount("");
    setPaymentMethod("4");
    setDocumentDate(todayStr);
    setInvoiceUrl(null);
    setErrorMsg(null);
    setApiStatus(null);
    setLatestMorningDate(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <FileText className={`w-5 h-5 ${theme.icon}`} />
            הפקת חשבונית — {businessLabel}
          </DialogTitle>
        </DialogHeader>

        {invoiceUrl ? (
          <div className="text-center py-6 space-y-4">
            <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto">
              <FileText className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-green-400 font-semibold text-lg">החשבונית הופקה בהצלחה על סך ₪{amountNum.toLocaleString()}</p>
            <a href={invoiceUrl} target="_blank" rel="noopener noreferrer">
              <Button className={`${theme.btn} text-white gap-2 w-full`}>
                <ExternalLink className="w-4 h-4" />
                פתח חשבונית
              </Button>
            </a>
            <p className="text-gray-400 text-xs break-all">{invoiceUrl}</p>
            <Button variant="outline" onClick={handleClose} className="w-full border-gray-600 text-gray-300">
              סגור
            </Button>
          </div>
        ) : (
           <div className="space-y-4">
             {/* שם הלקוח */}
             <div>
               <Label className="text-gray-300 mb-1 block">שם הלקוח *</Label>
               <div className="bg-gray-800 border border-gray-700 rounded-md p-2 text-white">
                 {coupleNames || "לא צוין"}
               </div>
             </div>

             {/* התראת מייל חסר */}
             {!clientEmail && (
               <div className="flex items-center gap-2 bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 text-yellow-400 text-xs">
                 <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                 <span>לא קיים מייל ללקוח — ישלח לכתובת הדיפולטיבית (avira.media1@gmail.com)</span>
               </div>
             )}

             {/* שגיאה ממורנינג */}
             {errorMsg && (
               <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/40 rounded-lg p-3 text-red-400 text-xs">
                 <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                 <div>
                   <p className="font-semibold mb-1">שגיאה מ-Morning:</p>
                   <p className="break-all">{errorMsg}</p>
                 </div>
               </div>
             )}

             {/* תאריך המסמך */}
            <div>
              <Label className="text-gray-300 mb-1 block">תאריך המסמך / התשלום *</Label>
              <Input
                type="date"
                value={documentDate}
                onChange={(e) => { setDocumentDate(e.target.value); setErrorMsg(null); }}
                className={`bg-gray-800 text-white ${isDateBeforeLatest ? "border-red-500" : "border-gray-700"}`}
                dir="ltr"
              />
              {isFetchingLatestDate && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> טוען תאריך מסמך אחרון ממורנינג...
                </p>
              )}
              {latestMorningDate && !isFetchingLatestDate && (
                <div className={`flex items-center gap-1.5 mt-1.5 text-xs ${isDateBeforeLatest ? "text-red-400" : "text-emerald-400"}`}>
                  <CalendarCheck className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>
                    מסמך אחרון במורנינג: <span className="font-mono font-semibold">{latestMorningDate}</span>
                    {isDateBeforeLatest
                      ? " — התאריך שנבחר קודם לכן, שינוי נדרש"
                      : " — התאריך שנבחר תקין ✓"}
                  </span>
                </div>
              )}
            </div>

            {/* פריט */}
            <div>
              <Label className="text-gray-300 mb-1 block">פריט לחיוב *</Label>
              <Select value={item} onValueChange={(val) => { setItem(val); setAmount(getAutoAmount(val)); }}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue placeholder="בחר פריט..." />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {INVOICE_ITEMS.map((i) => (
                    <SelectItem key={i} value={i}>{i}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* תיאור נוסף */}
            <div>
              <Label className="text-gray-300 mb-1 block">תיאור (יופיע במסמך)</Label>
              <Input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="לדוגמה: מקדמה לצילום חתונה - יוסי ומיכל"
                className="bg-gray-800 border-gray-700 text-white"
              />
            </div>

            {/* סכום */}
            <div>
              <Label className="text-gray-300 mb-1 block">סכום לתשלום (כולל מע"מ) *</Label>
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="bg-gray-800 border-gray-700 text-white"
                dir="ltr"
              />
              {amountNum > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  לפני מע"מ: ₪{priceBeforeVat.toLocaleString()} | מע"מ {Math.round(vatRate * 100)}%: ₪{vatAmount.toLocaleString()}
                </p>
              )}
            </div>

            {/* אמצעי תשלום */}
            <div>
              <Label className="text-gray-300 mb-1 block">אמצעי תשלום *</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700 text-white">
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* סטטוס API */}
            {apiStatus && (
              <div className={`flex items-start gap-2 rounded-lg p-3 text-xs ${apiStatus.ok ? "bg-green-900/20 border border-green-700/40 text-green-400" : "bg-red-900/20 border border-red-700/40 text-red-400"}`}>
                <span className="font-semibold">סטטוס API:</span>
                <span className="break-all">{apiStatus.msg}</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSubmit}
                disabled={isLoading || isDateBeforeLatest}
                className={`flex-1 ${theme.btn} text-white disabled:opacity-50`}
              >
                {isLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin ml-2" /> מפיק חשבונית...</>
                ) : (
                  <><FileText className="w-4 h-4 ml-2" /> אשר והפק חשבונית</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={handleCheckConnection}
                disabled={isCheckingConnection}
                className="border-gray-600 text-gray-300 text-xs px-3"
                title="בדוק חיבור למורנינג"
              >
                {isCheckingConnection ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
              </Button>
              <Button variant="outline" onClick={handleClose} className="border-gray-600 text-gray-300">
                ביטול
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}