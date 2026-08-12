import React, { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Printer, CheckCircle, Camera, Heart } from "lucide-react";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/defaultContractTerms";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

// Renders package details supporting HTML (from ReactQuill) and plain text with bullets/line breaks
function PackageDetailsRenderer({ html }) {
  // If it contains HTML tags, render as-is with enhanced styling
  if (html && /<[a-z][\s\S]*>/i.test(html)) {
    return (
      <div
        className="package-details text-gray-700 text-sm mb-4"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  // Plain text: parse line by line, detect bullet markers
  const lines = html.split(/\n/);
  return (
    <div className="text-gray-700 text-sm mb-4 space-y-[10px]" dir="rtl">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        const isBullet = trimmed.startsWith("*") || trimmed.startsWith("-") || trimmed.startsWith("•");
        const content = isBullet ? trimmed.slice(1).trim() : trimmed;
        return isBullet ? (
          <div key={i} className="flex items-start gap-2">
            <span className="mt-0.5 text-yellow-500 font-bold">•</span>
            <span className="leading-relaxed">{content}</span>
          </div>
        ) : (
          <p key={i} className="leading-relaxed">{content}</p>
        );
      })}
    </div>
  );
}

export default function LeadContractDialog({ isOpen, onClose, lead, onSigned }) {
  const [clientForm, setClientForm] = useState({
    coupleNamesVerify: "",
    idNumber: "",
    phone: "",
    email: "",
    coupleNotes: "",
  });
  const [isSigning, setIsSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  if (!lead) return null;

  const today = format(new Date(), "d/M/yyyy");
  const eventDate = lead.eventDate ? format(new Date(lead.eventDate), "d/M/yyyy") : "טרם נקבע";
  const contractTerms = lead.contractTerms || DEFAULT_CONTRACT_TERMS;
  const packageDetails = lead.packageDetails || "";

  const handleSign = async () => {
    if (!clientForm.coupleNamesVerify.trim()) {
      toast.error("נא לאמת את שמות הזוג");
      return;
    }
    if (!clientForm.idNumber.trim()) {
      toast.error("נא להזין מספר תעודת זהות");
      return;
    }
    setIsSigning(true);
    try {
      await base44.entities.Lead.update(lead.id, {
        idNumber: clientForm.idNumber,
        email: clientForm.email || undefined,
        phoneNumber: clientForm.phone || lead.phoneNumber,
        coupleNotesSigned: clientForm.coupleNotes || undefined,
        status: "נסגר/חתימה",
        signedAt: new Date().toISOString(),
      });
      setSigned(true);
      toast.success("החוזה נחתם בהצלחה! 🎉");
      if (onSigned) onSigned();
      setTimeout(() => window.print(), 500);
    } catch (e) {
      toast.error("שגיאה בשמירת הנתונים");
    }
    setIsSigning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="bg-white text-gray-900 max-w-3xl max-h-[95vh] overflow-y-auto p-0"
        dir="rtl"
      >
        {/* ===== BANNER ===== */}
        <div className="relative w-full h-36 bg-gradient-to-l from-gray-900 via-gray-800 to-black flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: "url('https://images.unsplash.com/photo-1519741497674-611481863552?w=900&q=80')", backgroundSize: "cover", backgroundPosition: "center" }}
          />
          <div className="relative z-10 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Heart className="w-5 h-5 text-yellow-400" />
              <span className="text-yellow-400 text-3xl font-bold tracking-widest">AVIRA</span>
              <Camera className="w-5 h-5 text-yellow-400" />
            </div>
            <p className="text-gray-300 text-sm tracking-wide">Wedding Photography &amp; Videography Studio</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.print()}
            className="absolute top-3 left-3 text-gray-300 hover:text-white border border-gray-600 hover:border-white"
          >
            <Printer className="w-4 h-4 ml-1" />
            הדפסה
          </Button>
        </div>

        <div className="p-6 space-y-6" id="contract-content">
          {/* Title */}
          <div className="text-center border-b pb-4">
            <h2 className="text-2xl font-bold text-gray-900">הסכם שירותי צילום חתונה</h2>
            <p className="text-gray-500 text-sm mt-1">תאריך הפקה: <strong>{today}</strong></p>
          </div>

          {/* Block 1: Event Details */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">📋 פרטי האירוע</div>
            <div className="p-4 grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <span className="text-gray-500">שמות הזוג:</span>
              <span className="font-semibold text-gray-900">{lead.coupleNames}</span>
              <span className="text-gray-500">תאריך האירוע:</span>
              <span className="font-semibold text-gray-900">{eventDate}</span>
              {lead.venueName && (
                <>
                  <span className="text-gray-500">שם האולם:</span>
                  <span className="font-semibold text-gray-900">{lead.venueName}</span>
                </>
              )}
              <span className="text-gray-500">טלפון:</span>
              <span className="text-gray-700">{lead.phoneNumber || "—"}</span>
            </div>
          </div>

          {/* Block 2: Package */}
          <div className="border border-yellow-300 rounded-xl overflow-hidden">
            <div className="bg-yellow-400 text-gray-900 px-4 py-2 font-semibold text-sm">📦 החבילה שלכם — {lead.packageChoice || "—"}</div>
            <div className="p-4 pt-5">
              {packageDetails ? (
                <>
                  <style>{`
                    .package-details { direction: rtl; text-align: right; }
                    .package-details p { margin-bottom: 6px; white-space: pre-wrap; }
                    .package-details ul, .package-details ol { padding-right: 18px; margin-bottom: 8px; }
                    .package-details li { margin-bottom: 10px; line-height: 1.6; }
                    .package-details strong { font-weight: 700; }
                  `}</style>
                  <PackageDetailsRenderer html={packageDetails} />
                </>
              ) : (
                <p className="text-gray-400 text-sm italic mb-4">לא הוגדר פירוט חבילה</p>
              )}
              <div className="border-t pt-3 mt-2 grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-gray-500">מחיר בסיס:</span>
                <span>₪{(lead.basePrice || 0).toLocaleString()}</span>
                {lead.discount > 0 && (
                  <>
                    <span className="text-gray-500">הנחה:</span>
                    <span className="text-red-500">- ₪{lead.discount.toLocaleString()}</span>
                  </>
                )}
                <span className="text-gray-700 font-bold">סכום סופי לתשלום:</span>
                <span className="font-bold text-green-700 text-base">₪{(lead.finalPrice || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Block 3: Contract Terms */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">📄 תנאי ההתקשרות</div>
            <div className="p-4">
              <div
                className="prose prose-sm max-w-none text-gray-700 leading-relaxed"
                dir="rtl"
                dangerouslySetInnerHTML={{ __html: contractTerms }}
              />
            </div>
          </div>

          {/* Block 4: Client Details Form */}
          {!signed ? (
            <div className="border-2 border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">✍️ אישור פרטי לקוח וחתימה</div>
              <div className="p-5 space-y-4 bg-gray-50">
                <p className="text-sm text-gray-600">נא למלא את הפרטים הבאים לפני החתימה על ההסכם:</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-700 font-medium">שמות הזוג (לאימות) *</Label>
                    <Input
                      value={clientForm.coupleNamesVerify}
                      onChange={(e) => setClientForm(f => ({ ...f, coupleNamesVerify: e.target.value }))}
                      placeholder={`הקלד: ${lead.coupleNames}`}
                      className="mt-1 bg-white border-gray-300"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">תעודת זהות *</Label>
                    <Input
                      value={clientForm.idNumber}
                      onChange={(e) => setClientForm(f => ({ ...f, idNumber: e.target.value }))}
                      placeholder="000000000"
                      className="mt-1 bg-white border-gray-300"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">טלפון</Label>
                    <Input
                      value={clientForm.phone}
                      onChange={(e) => setClientForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder={lead.phoneNumber || "050-0000000"}
                      className="mt-1 bg-white border-gray-300"
                    />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">אימייל</Label>
                    <Input
                      value={clientForm.email}
                      onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="email@example.com"
                      className="mt-1 bg-white border-gray-300"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-gray-700 font-medium">הערות מיוחדות מהזוג</Label>
                  <Textarea
                    value={clientForm.coupleNotes}
                    onChange={(e) => setClientForm(f => ({ ...f, coupleNotes: e.target.value }))}
                    placeholder="בקשות מיוחדות, הנחיות לצוות, הערות לחוזה..."
                    className="mt-1 bg-white border-gray-300 min-h-[80px]"
                  />
                </div>

                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 text-sm text-yellow-800">
                  <strong>בלחיצה על "חתום על ההסכם"</strong> אתה מאשר שקראת את כל תנאי ההסכם, ראית דוגמאות לעבודות הסטודיו ואתה מסכים לכל התנאים.
                </div>

                <Button
                  onClick={handleSign}
                  disabled={isSigning}
                  className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 text-base"
                >
                  {isSigning ? "שומר ומאמת..." : "✅ חתום על ההסכם"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-green-400 rounded-xl p-5 bg-green-50 text-center">
              <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-2" />
              <p className="text-green-800 font-bold text-lg">ההסכם נחתם בהצלחה!</p>
              <p className="text-green-700 text-sm mt-1">הפרטים נשמרו בכרטיס הליד. נפיק עבורך PDF בעוד שנייה...</p>
              <p className="text-gray-500 text-xs mt-2">
                {lead.coupleNames} | ת.ז: {clientForm.idNumber} | {format(new Date(), "d/M/yyyy HH:mm")}
              </p>
            </div>
          )}

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-8 pt-4 border-t">
            <div className="space-y-6 text-center">
              <p className="font-semibold text-gray-700 text-sm">חתימת הלקוח/ה</p>
              <div className="border-b-2 border-gray-400 h-10 mx-4"></div>
              <p className="text-xs text-gray-500">{lead.coupleNames}</p>
            </div>
            <div className="space-y-6 text-center">
              <p className="font-semibold text-gray-700 text-sm">חתימת הסטודיו</p>
              <div className="border-b-2 border-gray-400 h-10 mx-4"></div>
              <p className="text-xs text-gray-500">Avira Studio</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end px-6 pb-5">
          <Button variant="outline" onClick={onClose} className="border-gray-300 text-gray-700">סגור</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}