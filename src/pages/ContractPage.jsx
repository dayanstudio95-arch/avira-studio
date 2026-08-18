import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { format } from "date-fns";
import { Heart, Camera, CheckCircle, Printer, FileDown, Eraser } from "lucide-react";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import SignatureCanvas from "react-signature-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { applyContractTermsPrice } from "@/lib/defaultContractTerms";
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
  const [signedFileName, setSignedFileName] = useState(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
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

  // FIXED (2026-08-13): the previous implementation built the PDF entirely with
  // jsPDF's doc.text() calls using the built-in 'helvetica' font. jsPDF's standard
  // fonts only support WinAnsi/Latin-1 glyphs -- they have NO Hebrew glyphs at all --
  // so every Hebrew string (couple names, venue, package, client-entered details) came
  // out as mojibake garbage in the downloaded PDF (confirmed by the user's screenshot:
  // "ÙÜØÕ ÙàÓ" instead of the couple's actual name). It also never included the actual
  // contract terms text, and the "Studio Signature" line was always blank.
  //
  // Rebuilt to render an actual styled, RTL, Hebrew DOM node (same content model as
  // the live contract page above) off-screen, rasterize it with html2canvas (already
  // an installed dependency, just unused until now), and place that image into the
  // PDF page-by-page with jsPDF. This guarantees the PDF looks exactly like real
  // Hebrew text because it *is* real browser-rendered Hebrew text, just captured as an
  // image -- sidesteps jsPDF's font limitation entirely instead of fighting it with
  // custom font embedding.
  const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const generateSignedPdf = async (leadData, formData, signedAt, signatureDataUrl, studioSignatureDataUrl) => {
    const eventDateFormatted = leadData.eventDate ? format(new Date(leadData.eventDate), 'd/M/yyyy') : 'טרם נקבע';
    const packageDetailsHtml = leadData.packageDetails
      ? `<div style="white-space:pre-wrap;">${leadData.packageDetails}</div>`
      : '';
    // applyContractTermsPrice resolves the {{FINAL_PRICE}} merge-field (or self-heals a
    // legacy hardcoded number) in the "total consideration" sentence to this lead's real,
    // current finalPrice -- see src/lib/defaultContractTerms.js for why this is needed.
    const contractTermsHtml = applyContractTermsPrice(leadData.contractTerms, leadData.finalPrice);

    // Build the printable document off-screen (not display:none -- html2canvas needs
    // real layout -- just shifted far outside the viewport) so it never flashes on
    // screen or affects the visible page's scroll/layout.
    const container = document.createElement('div');
    container.setAttribute('dir', 'rtl');
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '-99999px';
    container.style.width = '780px';
    container.style.background = '#ffffff';
    container.style.fontFamily = "Arial, 'Noto Sans Hebrew', sans-serif";
    container.style.color = '#1f2937';

    container.innerHTML = `
      <div style="background:#1e1e1e; padding:24px; text-align:center;">
        <div style="color:#ffd700; font-size:26px; font-weight:bold; letter-spacing:2px;">AVIRA STUDIO</div>
        <div style="color:#c8c8c8; font-size:12px; margin-top:4px;">Wedding Photography &amp; Videography Studio</div>
      </div>
      <div style="padding:28px;">
        <div style="text-align:center; border-bottom:1px solid #e5e7eb; padding-bottom:14px; margin-bottom:18px;">
          <div style="font-size:20px; font-weight:bold;">הסכם שירותי צילום חתונה</div>
          <div style="font-size:12px; color:#6b7280; margin-top:4px;">נחתם: ${escapeHtml(signedAt)}</div>
        </div>

        <div style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; margin-bottom:16px;">
          <div style="background:#111827; color:#fff; padding:8px 14px; font-weight:600; font-size:13px;">פרטי האירוע</div>
          <div style="padding:14px; display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; font-size:13px;">
            <div><span style="color:#6b7280;">שמות הזוג: </span><strong>${escapeHtml(leadData.coupleNames)}</strong></div>
            <div><span style="color:#6b7280;">תאריך האירוע: </span><strong>${escapeHtml(eventDateFormatted)}</strong></div>
            <div><span style="color:#6b7280;">שם האולם: </span>${escapeHtml(leadData.venueName || '-')}</div>
            <div><span style="color:#6b7280;">חבילה: </span>${escapeHtml(leadData.packageChoice || '-')}</div>
            <div style="grid-column:1 / -1;"><span style="color:#6b7280;">סכום סופי לתשלום: </span><strong style="color:#15803d;">₪${(leadData.finalPrice || 0).toLocaleString()}</strong></div>
          </div>
        </div>

        ${packageDetailsHtml ? `
        <div style="border:1px solid #fde68a; border-radius:10px; overflow:hidden; margin-bottom:16px;">
          <div style="background:#fbbf24; color:#111827; padding:8px 14px; font-weight:600; font-size:13px;">פרטי החבילה — ${escapeHtml(leadData.packageChoice || '')}</div>
          <div style="padding:14px; font-size:12px; line-height:1.6;">${packageDetailsHtml}</div>
        </div>` : ''}

        <div style="border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; margin-bottom:16px;">
          <div style="background:#111827; color:#fff; padding:8px 14px; font-weight:600; font-size:13px;">תנאי ההתקשרות</div>
          <div style="padding:14px; font-size:12px; line-height:1.7;">${contractTermsHtml}</div>
        </div>

        <div style="background:#fff9dc; border:1px solid #fde68a; border-radius:10px; padding:14px; margin-bottom:22px; font-size:13px;">
          <div style="font-weight:600; margin-bottom:8px;">פרטי אישור לקוח</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px;">
            <div><span style="color:#6b7280;">שמות הזוג (לאימות): </span>${escapeHtml(formData.coupleNamesVerify)}</div>
            <div><span style="color:#6b7280;">תעודת זהות: </span>${escapeHtml(formData.idNumber)}</div>
            <div><span style="color:#6b7280;">טלפון: </span>${escapeHtml(formData.phone || '-')}</div>
            <div><span style="color:#6b7280;">אימייל: </span>${escapeHtml(formData.email || '-')}</div>
            ${formData.coupleNotes ? `<div style="grid-column:1 / -1;"><span style="color:#6b7280;">הערות: </span>${escapeHtml(formData.coupleNotes)}</div>` : ''}
          </div>
        </div>

        <div style="text-align:center; font-size:11px; color:#4b5563; margin-bottom:10px;">
          בחתימתם, הלקוח/ה מאשר/ת שקרא/ה והסכים/ה לכל תנאי ההסכם.
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:24px; text-align:center;">
          <div>
            <div style="height:70px; display:flex; align-items:flex-end; justify-content:center;">
              ${signatureDataUrl ? `<img src="${signatureDataUrl}" style="max-height:65px; max-width:220px;" />` : ''}
            </div>
            <div style="border-top:2px solid #9ca3af; margin-top:4px; padding-top:6px; font-size:11px;">
              <div>${escapeHtml(leadData.coupleNames || 'לקוח/ה')}</div>
              <div style="color:#6b7280;">חתימת הלקוח/ה</div>
            </div>
          </div>
          <div>
            <div style="height:70px; display:flex; align-items:flex-end; justify-content:center;">
              ${studioSignatureDataUrl ? `<img src="${studioSignatureDataUrl}" style="max-height:65px; max-width:220px;" />` : ''}
            </div>
            <div style="border-top:2px solid #9ca3af; margin-top:4px; padding-top:6px; font-size:11px;">
              <div>Avira Studio</div>
              <div style="color:#6b7280;">חתימת הסטודיו</div>
            </div>
          </div>
        </div>
      </div>
      <div style="background:#1e1e1e; color:#b4b4b4; text-align:center; font-size:10px; padding:10px;">
        Avira Studio | www.avira-studio.com
      </div>
    `;

    document.body.appendChild(container);

    let pdfBase64;
    try {
      // html2canvas has no built-in timeout and can hang indefinitely on some mobile
      // browsers (observed stuck signing flow on mobile Safari) rendering an
      // off-screen container. Race it against a hard timeout so this step always
      // either resolves or throws into the outer try/catch in handleSign, instead of
      // leaving the "שומר ומאמת..." button spinning forever with no error surfaced.
      const canvas = await Promise.race([
        html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true }),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error('יצירת מסמך ה-PDF נתקעה (חריגת זמן) — נסה שוב, ואם הבעיה נמשכת נסה מדפדפן או רשת אחרת')),
          15000
        )),
      ]);

      const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
      const pageWidth = 210;
      const pageHeight = 297;
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL('image/png');

      let heightLeft = imgHeight;
      let position = 0;
      doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        doc.addPage();
        doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const dataUri = doc.output('datauristring');
      pdfBase64 = dataUri.split('base64,').pop();
    } finally {
      document.body.removeChild(container);
    }

    const safeName = (leadData.coupleNames || 'client').replace(/\s+/g, '_').replace(/[^\w_\u0590-\u05ff]/gi, '');
    const fileName = `חוזה_חתום_${safeName}.pdf`;
    // fileName is only ever used client-side now (as the `download` attribute on the
    // PDF link) -- the actual Supabase Storage object key is a fixed ASCII path built
    // server-side in save-signed-contract, so this Hebrew name is safe to keep as-is.

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
    // Tracks which of the 3 sequential steps below is in flight, so the catch block
    // can report exactly what failed instead of a single generic message that made
    // this bug impossible to diagnose from a user's screenshot alone.
    //
    // FIXED (2026-08-13): order used to be sign -> pdf -> upload, so signLeadPublic
    // (which sets leads.signed_at + status) ran BEFORE the PDF was generated/uploaded.
    // When the upload step failed (e.g. the Hebrew-filename storage-key bug), the lead
    // was already committed as "signed" with no PDF attached -- the couple saw an error
    // toast, but the studio's dashboard showed the contract as signed with nothing to
    // show for it. Now the PDF is generated and uploaded FIRST; signLeadPublic (the
    // actual "mark as signed" step) only runs once the signed PDF is safely stored, so
    // a failure anywhere above it leaves the lead correctly unsigned.
    let step = 'pdf';
    try {
      const signedAt = format(new Date(), "d/M/yyyy HH:mm");
      // getTrimmedCanvas() is a known crash source in react-signature-canvas
      // (IndexSizeError/DOMException) on certain devicePixelRatio + percentage-width
      // canvas combinations -- common on phones, which is how most couples actually
      // sign. It was called unguarded here, so any such crash aborted the whole flow
      // before signLeadPublic was even called, surfacing as an immediate generic error.
      // Fall back to the untrimmed canvas (always safe) rather than failing the signing.
      let signatureDataUrl;
      try {
        signatureDataUrl = signatureRef.current.getTrimmedCanvas().toDataURL('image/png');
      } catch (trimErr) {
        console.error('getTrimmedCanvas() failed, falling back to full canvas:', trimErr);
        signatureDataUrl = signatureRef.current.getCanvas().toDataURL('image/png');
      }

      const { pdfBase64, fileName } = await generateSignedPdf(lead, clientForm, signedAt, signatureDataUrl, lead.studioSignature);

      step = 'upload';
      const saveRes = await base44.functions.invoke('saveSignedContract', {
        leadId: lead.id,
        pdfBase64,
        fileName,
      });
      const fileUrl = saveRes?.data?.fileUrl || null;

      step = 'sign';
      await base44.functions.invoke('signLeadPublic', {
        leadId: lead.id,
        idNumber: clientForm.idNumber,
        email: clientForm.email || undefined,
        phoneNumber: clientForm.phone || undefined,
        coupleNames: clientForm.coupleNamesVerify || undefined,
        coupleNotesSigned: clientForm.coupleNotes || undefined,
      });

      setSignedPdfUrl(fileUrl);
      setSignedFileName(fileName);
      setSigned(true);
      setShowSuccessDialog(true);
      toast.success("החוזה נחתם בהצלחה!", { duration: 4000 });
    } catch (e) {
      // Previously swallowed silently (no console.error, no real message shown), which
      // made this exact class of bug undiagnosable from a user's report. Now logs the
      // real error and surfaces its message in the toast description.
      console.error(`Contract signing failed at step "${step}":`, e);
      const stepLabel = step === 'sign'
        ? 'שמירת פרטי החתימה'
        : step === 'pdf'
          ? 'יצירת מסמך ה-PDF'
          : 'שמירת הקובץ החתום';
      toast.error(`שגיאה ב${stepLabel}, נא לנסות שוב`, {
        description: e?.message || undefined,
        duration: 8000,
      });
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
  const contractTerms = applyContractTermsPrice(lead.contractTerms, lead.finalPrice);
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
                  download={signedFileName || 'contract-signed.pdf'}
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

      {/* Popup shown right after a successful signature, so the couple gets an
          unmissable confirmation (not just the toast, which can be missed on mobile)
          with an immediate way to download their signed PDF. */}
      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent dir="rtl" className="text-center">
          <div className="flex flex-col items-center gap-2 py-2">
            <CheckCircle className="w-14 h-14 text-green-600" />
            <p className="text-xl font-bold text-gray-900">ההסכם נחתם בהצלחה! ✅</p>
            <p className="text-gray-500 text-sm">הפרטים והחוזה החתום נשמרו במערכת.</p>
            {signedPdfUrl && (
              <a
                href={signedPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                download={signedFileName || 'contract-signed.pdf'}
                className="inline-flex items-center gap-2 mt-3 bg-green-700 hover:bg-green-600 text-white font-semibold px-5 py-2.5 rounded-lg text-sm"
              >
                <FileDown className="w-4 h-4" />
                הורדת החוזה החתום (PDF)
              </a>
            )}
            <Button
              variant="ghost"
              onClick={() => setShowSuccessDialog(false)}
              className="mt-1 text-gray-500 hover:text-gray-800"
            >
              סגירה
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}