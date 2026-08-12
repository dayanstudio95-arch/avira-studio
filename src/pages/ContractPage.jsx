import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { Heart, Camera, CheckCircle, Printer, FileDown, Eraser } from "lucide-react";
import { jsPDF } from "jspdf";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_CONTRACT_TERMS } from "@/lib/defaultContractTerms";
import { toast } from "sonner";

function PackageDetailsRenderer({ html }) {
  if (!html) return null;
  if (/<[a-z][\s\S]*>/i.test(html)) {
    return (
      <div
        className="package-details text-gray-700 text-sm mb-4"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
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

export default function ContractPage() {
  const { leadId: paramsLeadId } = useParams();
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [leadId, setLeadId] = useState(paramsLeadId || null);
  const [signed, setSigned] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [signedPdfUrl, setSignedPdfUrl] = useState(null);
  const [signatureEmpty, setSignatureEmpty] = useState(true);
  const [clientForm, setClientForm] = useState({
    coupleNamesVerify: "",
    idNumber: "",
    phone: "",
    email: "",
    coupleNotes: "",
  });
  const signatureRef = useRef(null);

  useEffect(() => {
    if (paramsLeadId) {
      setLeadId(paramsLeadId);
    }
  }, [paramsLeadId]);

  useEffect(() => {
    if (!leadId) { setNotFound(true); setLoading(false); return; }

    base44.functions.invoke('getLeadPublic', { leadId })
      .then((res) => {
        const data = res.data;
        if (data && data.id) {
          setLead(data);
          // Bug fix: signLeadPublic sets status to 'חוזה' (intentionally, the studio
          // moves it to 'נסגר/חתימה' later) — gating on that specific status here meant
          // reloading the page right after signing would show the signing form again.
          // signedAt is the actual "already signed" signal.
          if (data.signedAt) {
            setSigned(true);
            if (data.signedContractPdfUrl) setSignedPdfUrl(data.signedContractPdfUrl);
          }
        } else {
          setNotFound(true);
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [leadId]);

  const generateSignedPdf = async (leadData, formData, signedAt, signatureDataUrl) => {
    const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
    doc.setFont('helvetica');

    // Header
    doc.setFillColor(30, 30, 30);
    doc.rect(0, 0, 210, 30, 'F');
    doc.setTextColor(255, 215, 0);
    doc.setFontSize(20);
    doc.text('AVIRA STUDIO', 105, 18, { align: 'center' });
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text('Wedding Photography & Videography Studio', 105, 25, { align: 'center' });

    doc.setTextColor(30, 30, 30);
    let y = 42;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Contract - ' + (leadData.coupleNames || ''), 105, y, { align: 'center' });
    y += 8;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text('Signed: ' + signedAt, 105, y, { align: 'center' });
    y += 10;

    // Event details
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(245, 245, 245);
    doc.rect(15, y, 180, 32, 'FD');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Event Details', 20, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const eventDateFormatted = leadData.eventDate ? format(new Date(leadData.eventDate), 'd/M/yyyy') : 'TBD';
    doc.text(`Couple: ${leadData.coupleNames || ''}`, 20, y + 14);
    doc.text(`Date: ${eventDateFormatted}`, 20, y + 20);
    doc.text(`Venue: ${leadData.venueName || '-'}`, 20, y + 26);
    doc.text(`Package: ${leadData.packageChoice || '-'}`, 110, y + 14);
    doc.text(`Final Price: ${(leadData.finalPrice || 0).toLocaleString()} ILS`, 110, y + 20);
    y += 40;

    // Client details
    const clientNotesText = formData.coupleNotes ? formData.coupleNotes.substring(0, 90) : '';
    const clientBoxH = clientNotesText ? 50 : 40;
    doc.setFillColor(255, 249, 220);
    doc.rect(15, y, 180, clientBoxH, 'FD');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Client Confirmation Details', 20, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    if (formData.coupleNamesVerify) doc.text('Couple Names: ' + formData.coupleNamesVerify, 20, y + 15);
    doc.text('ID Number: ' + (formData.idNumber || '-'), 20, y + 22);
    doc.text('Phone: ' + (formData.phone || '-'), 20, y + 29);
    doc.text('Email: ' + (formData.email || '-'), 110, y + 22);
    if (clientNotesText) doc.text('Notes: ' + clientNotesText, 20, y + 37);
    y += clientBoxH + 8;

    // Signature line
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text('By signing, the client confirms they have read and agreed to all contract terms.', 105, y, { align: 'center' });
    y += 10;
    doc.setDrawColor(80, 80, 80);
    doc.line(30, y + 10, 90, y + 10);
    doc.line(120, y + 10, 180, y + 10);
    // Embed the couple's actual drawn signature above the client signature line
    // (was previously always blank -- just a typed name below an empty line).
    if (signatureDataUrl) {
      try {
        doc.addImage(signatureDataUrl, 'PNG', 35, y - 3, 50, 12);
      } catch (imgErr) {
        console.error('Could not embed signature image in PDF:', imgErr);
      }
    }
    doc.setFontSize(8);
    doc.text(leadData.coupleNames || 'Client', 60, y + 16, { align: 'center' });
    doc.text('Avira Studio', 150, y + 16, { align: 'center' });
    doc.text('Client Signature', 60, y + 21, { align: 'center' });
    doc.text('Studio Signature', 150, y + 21, { align: 'center' });

    // Footer
    doc.setFillColor(30, 30, 30);
    doc.rect(0, 285, 210, 12, 'F');
    doc.setTextColor(180, 180, 180);
    doc.setFontSize(7);
    doc.text('Avira Studio | www.avira-studio.com', 105, 292, { align: 'center' });

    const safeName = (leadData.coupleNames || 'client').replace(/\s+/g, '_').replace(/[^\w_\u0590-\u05ff]/gi, '');
    const fileName = `חוזה_חתום_${safeName}.pdf`;
    // Base64-encode client-side and hand the bytes to save-signed-contract, which
    // uploads them server-side (service-role) to the signed-contracts Storage bucket --
    // see migration 0006 for why this replaced the old base44.integrations.Core.UploadFile
    // call, which was never implemented against Supabase and silently failed.
    const dataUri = doc.output('datauristring');
    const pdfBase64 = dataUri.split('base64,').pop();

    return { pdfBase64, fileName };
  };


  const handleSign = async () => {
    if (!clientForm.coupleNamesVerify.trim()) { toast.error("נא לאמת את שמות הזוג"); return; }
    if (!clientForm.idNumber.trim()) { toast.error("נא להזין מספר תעודת זהות"); return; }
    if (!signatureRef.current || signatureRef.current.isEmpty()) {
      toast.error("נא לחתום באמצעות העכבר/האצבע במקום המיועד לחתימה");
      return;
    }
    setIsSigning(true);
    try {
      const signedAt = format(new Date(), "d/M/yyyy HH:mm");
      const signatureDataUrl = signatureRef.current
        .getTrimmedCanvas()
        .toDataURL('image/png');

      await base44.functions.invoke('signLeadPublic', {
        leadId: lead.id,
        idNumber: clientForm.idNumber,
        email: clientForm.email || undefined,
        phoneNumber: clientForm.phone || undefined,
        coupleNames: clientForm.coupleNamesVerify || undefined,
        coupleNotesSigned: clientForm.coupleNotes || undefined,
      });

      // PDF generation + upload is now awaited (was previously fire-and-forget with a
      // .catch(console.error), meaning the couple saw "signed successfully" even when
      // the PDF silently failed to save). If this step fails, the couple's signature is
      // already recorded on the lead (signLeadPublic succeeded above) but we tell them
      // the document itself needs a retry, rather than falsely claiming full success.
      const { pdfBase64, fileName } = await generateSignedPdf(lead, clientForm, signedAt, signatureDataUrl);
      const saveRes = await base44.functions.invoke('saveSignedContract', {
        leadId: lead.id,
        pdfBase64,
        fileName,
      });
      setSignedPdfUrl(saveRes?.data?.fileUrl || null);

      setSigned(true);
      toast.success("החוזה נחתם בהצלחה!", { duration: 4000 });
    } catch (e) {
      toast.error("שגיאה בשמירת החוזה החתום, נא לנסות שוב");
    }
    setIsSigning(false);
  };

  const handleClearSignature = () => {
    signatureRef.current?.clear();
    setSignatureEmpty(true);
  };


  if (loading) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center text-center p-8" dir="rtl">
      <div>
        <Heart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-700 mb-2">החוזה לא נמצא</h2>
        <p className="text-gray-500">הלינק שגוי או שהחוזה הוסר.</p>
      </div>
    </div>
  );

  const today = format(new Date(), "d/M/yyyy");
  const eventDate = lead.eventDate ? format(new Date(lead.eventDate), "d/M/yyyy") : "טרם נקבע";
  const contractTerms = lead.contractTerms || DEFAULT_CONTRACT_TERMS;
  const packageDetails = lead.packageDetails || "";

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl overflow-hidden">
        {/* Banner */}
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
            variant="ghost" size="sm"
            onClick={() => window.print()}
            className="absolute top-3 left-3 text-gray-300 hover:text-white border border-gray-600 hover:border-white"
          >
            <Printer className="w-4 h-4 ml-1" />
            הדפסה
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Title */}
          <div className="text-center border-b pb-4">
            <h2 className="text-2xl font-bold text-gray-900">הסכם שירותי צילום חתונה</h2>
            <p className="text-gray-500 text-sm mt-1">תאריך הפקה: <strong>{today}</strong></p>
          </div>

          {/* Event Details */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">📋 פרטי האירוע</div>
            <div className="p-4 grid grid-cols-2 gap-y-2 gap-x-6 text-sm">
              <span className="text-gray-500">שמות הזוג:</span>
              <span className="font-semibold text-gray-900">{lead.coupleNames}</span>
              <span className="text-gray-500">תאריך האירוע:</span>
              <span className="font-semibold text-gray-900">{eventDate}</span>
              {lead.venueName && (<>
                <span className="text-gray-500">שם האולם:</span>
                <span className="font-semibold text-gray-900">{lead.venueName}</span>
              </>)}
              <span className="text-gray-500">טלפון:</span>
              <span className="text-gray-700">{lead.phoneNumber || "—"}</span>
            </div>
          </div>

          {/* Package */}
          <div className="border border-yellow-300 rounded-xl overflow-hidden">
            <div className="bg-yellow-400 text-gray-900 px-4 py-2 font-semibold text-sm">📦 החבילה שלכם — {lead.packageChoice || "—"}</div>
            <div className="p-4 pt-5">
              <style>{`
                .package-details { direction: rtl; text-align: right; }
                .package-details p { margin-bottom: 6px; white-space: pre-wrap; }
                .package-details ul, .package-details ol { padding-right: 18px; margin-bottom: 8px; }
                .package-details li { margin-bottom: 10px; line-height: 1.6; }
                .package-details strong { font-weight: 700; }
              `}</style>
              {packageDetails ? <PackageDetailsRenderer html={packageDetails} /> : (
                <p className="text-gray-400 text-sm italic mb-4">לא הוגדר פירוט חבילה</p>
              )}
              <div className="border-t pt-3 mt-2 grid grid-cols-2 gap-y-1 text-sm">
                <span className="text-gray-500">מחיר בסיס:</span>
                <span>₪{(lead.basePrice || 0).toLocaleString()}</span>
                {lead.discount > 0 && (<>
                  <span className="text-gray-500">הנחה:</span>
                  <span className="text-red-500">- ₪{lead.discount.toLocaleString()}</span>
                </>)}
                <span className="text-gray-700 font-bold">סכום סופי לתשלום:</span>
                <span className="font-bold text-green-700 text-base">₪{(lead.finalPrice || 0).toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Contract Terms */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">📄 תנאי ההתקשרות</div>
            <div className="p-4">
              <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed" dir="rtl"
                dangerouslySetInnerHTML={{ __html: contractTerms }} />
            </div>
          </div>

          {/* Signing / Signed */}
          {!signed ? (
            <div className="border-2 border-gray-800 rounded-xl overflow-hidden">
              <div className="bg-gray-900 text-white px-4 py-2 font-semibold text-sm">✍️ אישור פרטי לקוח וחתימה</div>
              <div className="p-5 space-y-4 bg-gray-50">
                <p className="text-sm text-gray-600">נא למלא את הפרטים הבאים לפני החתימה על ההסכם:</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-gray-700 font-medium">שמות הזוג (לאימות) *</Label>
                    <Input value={clientForm.coupleNamesVerify} onChange={(e) => setClientForm(f => ({ ...f, coupleNamesVerify: e.target.value }))} placeholder={`הקלד: ${lead.coupleNames}`} className="mt-1 bg-white border-gray-300" />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">תעודת זהות *</Label>
                    <Input value={clientForm.idNumber} onChange={(e) => setClientForm(f => ({ ...f, idNumber: e.target.value }))} placeholder="000000000" className="mt-1 bg-white border-gray-300" />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">טלפון</Label>
                    <Input value={clientForm.phone} onChange={(e) => setClientForm(f => ({ ...f, phone: e.target.value }))} placeholder={lead.phoneNumber || "050-0000000"} className="mt-1 bg-white border-gray-300" />
                  </div>
                  <div>
                    <Label className="text-gray-700 font-medium">אימייל</Label>
                    <Input value={clientForm.email} onChange={(e) => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" className="mt-1 bg-white border-gray-300" />
                  </div>
                </div>
                <div>
                  <Label className="text-gray-700 font-medium">הערות מיוחדות מהזוג</Label>
                  <Textarea value={clientForm.coupleNotes} onChange={(e) => setClientForm(f => ({ ...f, coupleNotes: e.target.value }))} placeholder="בקשות מיוחדות, הנחיות לצוות..." className="mt-1 bg-white border-gray-300 min-h-[80px]" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-gray-700 font-medium">חתימה דיגיטלית *</Label>
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
                    >
                      <Eraser className="w-3.5 h-3.5" />
                      נקה חתימה
                    </button>
                  </div>
                  <div className="bg-white border border-gray-300 rounded-lg overflow-hidden touch-none">
                    <SignatureCanvas
                      ref={signatureRef}
                      penColor="black"
                      onEnd={() => setSignatureEmpty(signatureRef.current?.isEmpty() ?? true)}
                      canvasProps={{
                        className: "w-full",
                        style: { width: "100%", height: "160px", touchAction: "none" },
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">חתמו כאן באצבע (בנייד) או בעכבר (במחשב)</p>
                </div>
                <div className="bg-yellow-50 border border-yellow-300 rounded-lg p-3 text-sm text-yellow-800">
                  <strong>בלחיצה על "חתום על ההסכם"</strong> אתה מאשר שקראת את כל תנאי ההסכם ומסכים לכולם.
                </div>
                <Button onClick={handleSign} disabled={isSigning} className="w-full bg-gray-900 hover:bg-gray-800 text-white font-bold py-3 text-base">
                  {isSigning ? "שומר ומאמת..." : "✅ חתום על ההסכם"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-2 border-green-400 rounded-xl p-5 bg-green-50 text-center">
              <CheckCircle className="w-10 h-10 text-green-600 mx-auto mb-2" />
              <p className="text-green-800 font-bold text-lg">ההסכם נחתם בהצלחה!</p>
              <p className="text-green-700 text-sm mt-1">הפרטים נשמרו.</p>
              {signedPdfUrl && (
                <a
                  href={signedPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-3 bg-green-700 hover:bg-green-600 text-white font-semibold px-4 py-2 rounded-lg text-sm"
                >
                  <FileDown className="w-4 h-4" />
                  הורדת החוזה החתום (PDF)
                </a>
              )}
            </div>
          )}

          {signed && (
            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 text-sm mt-2" dir="rtl">
              <p className="font-semibold text-gray-800 mb-3 pb-1 border-b">פרטי אישור לקוח</p>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-gray-600">
                <div><span className="font-medium">שמות הזוג: </span>{clientForm.coupleNamesVerify || lead?.coupleNames || '-'}</div>
                <div><span className="font-medium">תעודת זהות: </span>{clientForm.idNumber || lead?.idNumber || '-'}</div>
                <div><span className="font-medium">טלפון: </span>{clientForm.phone || lead?.phoneNumber || '-'}</div>
                <div><span className="font-medium">אימייל: </span>{clientForm.email || lead?.email || '-'}</div>
                {(clientForm.coupleNotes || lead?.coupleNotesSigned) && (
                  <div className="col-span-2"><span className="font-medium">הערות: </span>{clientForm.coupleNotes || lead?.coupleNotesSigned}</div>
                )}
              </div>
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
      </div>
    </div>
  );
}