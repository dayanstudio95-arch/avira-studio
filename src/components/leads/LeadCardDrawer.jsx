import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ExternalLink, FileText, Loader2, Receipt, FileDown, Copy, Send, ClipboardCheck, CheckCircle, Settings, MessageCircle, Trash2, Calendar } from "lucide-react";
import { toast } from "sonner";
import InvoiceDialog from "@/components/invoice/InvoiceDialog";

// This component is deprecated - use UnifiedSidePanel instead
export default function LeadCardDrawer({ isOpen, onClose, lead, onLeadUpdated }) {
  // Render nothing - redirect to new unified component
  return null;
  const [invoices, setInvoices] = useState([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [copiedQLink, setCopiedQLink] = useState(false);
  const [contractTemplate, setContractTemplate] = useState("");
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [isSendingContract, setIsSendingContract] = useState(false);
  const [lastContractSentAt, setLastContractSentAt] = useState(null);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState("");
  const [showQuestionnaireTemplateEditor, setShowQuestionnaireTemplateEditor] = useState(false);
  const [isSendingQuestionnaire, setIsSendingQuestionnaire] = useState(false);
  const [lastQuestionnaireSentAt, setLastQuestionnaireSentAt] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCreatingCalendarEvent, setIsCreatingCalendarEvent] = useState(false);

  const getQuestionnaireLink = () => `${window.location.origin}/questionnaire/${lead?.id}`;

  const handleCopyQuestionnaireLink = () => {
    navigator.clipboard.writeText(getQuestionnaireLink());
    setCopiedQLink(true);
    toast.success("הלינק לשאלון הועתק!");
    setTimeout(() => setCopiedQLink(false), 2500);
  };

  const handleSendToTeamWhatsApp = () => {
    if (!lead) return;
    const p = lead;
    const eventDateStr = p.eventDate ? new Date(p.eventDate).toLocaleDateString("he-IL") : "—";
    const lines = [
      `*פרטי אירוע לצוות - Avira Media*`,
      ``,
      `🎥 זוג: ${p.coupleNames}`,
      `📅 תאריך: ${eventDateStr}`,
      `🏛️ אולם: ${p.venueName || "—"}`,
      ``,
      `*התארגנות כלה:*`,
      `📍 ${p.productionBridePrepLocation || "—"}`,
      ``,
      `*פרטי קשר ביום האירוע:*`,
      `👰 נייד כלה: ${p.productionBridePhone || p.phoneNumber || "—"}`,
      `🤵 נייד חתן: ${p.productionGroomPhone || "—"}`,
      p.productionInstagram ? `📸 אינסטגרם: ${p.productionInstagram}` : null,
      ``,
      p.productionSpecialRequests ? `💬 בקשות מיוחדות:\n${p.productionSpecialRequests}` : null,
    ].filter(l => l !== null).join("\n");

    const encoded = encodeURIComponent(lines);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  useEffect(() => {
    if (isOpen && lead) {
      loadLeadData();
      loadContractTemplate();
      loadQuestionnaireTemplate();
    }
  }, [isOpen, lead?.id]);

  const loadContractTemplate = async () => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "contractWhatsappTemplate" });
      if (settings.length > 0) {
        setContractTemplate(settings[0].value || getDefaultContractTemplate());
      } else {
        setContractTemplate(getDefaultContractTemplate());
      }
    } catch (e) {
      setContractTemplate(getDefaultContractTemplate());
    }
  };

  const loadQuestionnaireTemplate = async () => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "questionnaireWhatsappTemplate" });
      if (settings.length > 0) {
        setQuestionnaireTemplate(settings[0].value || getDefaultQuestionnaireTemplate());
      } else {
        setQuestionnaireTemplate(getDefaultQuestionnaireTemplate());
      }
    } catch (e) {
      setQuestionnaireTemplate(getDefaultQuestionnaireTemplate());
    }
  };

  const getDefaultContractTemplate = () => {
    return "היי [שם הלקוח], איזה כיף! הנה החוזה לחתימה עבור האירוע שלכם: [לינק לחוזה]";
  };

  const getDefaultQuestionnaireTemplate = () => {
    return "היי [שם הלקוח], כדי שנוכל להתכונן בצורה הכי טובה לצילומים שלכם, נשמח אם תמלאו את הפרטים הקטנים כאן: [לינק לשאלון]";
  };

  const getContractLink = () => `${window.location.origin}/contract/${lead?.id}`;

  const replaceTemplateVars = (template) => {
    return template
      .replace("[שם הלקוח]", lead?.coupleNames || "")
      .replace("[לינק לחוזה]", getContractLink());
  };

  const replaceQuestionnaireTemplateVars = (template) => {
    return template
      .replace("[שם הלקוח]", lead?.coupleNames || "")
      .replace("[לינק לשאלון]", getQuestionnaireLink());
  };

  const handleSaveTemplate = async (newTemplate) => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "contractWhatsappTemplate" });
      if (settings.length > 0) {
        await base44.entities.AppSetting.update(settings[0].id, { value: newTemplate });
      } else {
        await base44.entities.AppSetting.create({ key: "contractWhatsappTemplate", value: newTemplate });
      }
      setContractTemplate(newTemplate);
      setShowTemplateEditor(false);
      toast.success("התבנית נשמרה בהצלחה");
    } catch (e) {
      toast.error("שגיאה בשמירת התבנית");
    }
  };

  const handleSaveQuestionnaireTemplate = async (newTemplate) => {
    try {
      const settings = await base44.entities.AppSetting.filter({ key: "questionnaireWhatsappTemplate" });
      if (settings.length > 0) {
        await base44.entities.AppSetting.update(settings[0].id, { value: newTemplate });
      } else {
        await base44.entities.AppSetting.create({ key: "questionnaireWhatsappTemplate", value: newTemplate });
      }
      setQuestionnaireTemplate(newTemplate);
      setShowQuestionnaireTemplateEditor(false);
      toast.success("התבנית נשמרה בהצלחה");
    } catch (e) {
      toast.error("שגיאה בשמירת התבנית");
    }
  };



  const handleSendContractWhatsApp = () => {
    if (!lead?.phoneNumber) {
      toast.error("אין מספר טלפון לליד");
      return;
    }

    setIsSendingContract(true);
    const message = replaceTemplateVars(contractTemplate);
    const encoded = encodeURIComponent(message);
    
    // Format phone: remove non-digits, add country code
    const cleanedPhone = lead.phoneNumber.replace(/[-\s()]/g, "");
    const phoneWithCountry = cleanedPhone.startsWith("0") 
      ? "972" + cleanedPhone.substring(1) 
      : cleanedPhone;

    window.open(`https://wa.me/${phoneWithCountry}?text=${encoded}`, "_blank");
    
    setLastContractSentAt(new Date());
    setIsSendingContract(false);
    toast.success("הודעה נשלחה לוואטסאפ");
  };

  const handleSendQuestionnaireWhatsApp = () => {
    if (!lead?.phoneNumber) {
      toast.error("אין מספר טלפון לליד");
      return;
    }

    setIsSendingQuestionnaire(true);
    const message = replaceQuestionnaireTemplateVars(questionnaireTemplate);
    const encoded = encodeURIComponent(message);
    
    // Format phone: remove non-digits, add country code
    const cleanedPhone = lead.phoneNumber.replace(/[-\s()]/g, "");
    const phoneWithCountry = cleanedPhone.startsWith("0") 
      ? "972" + cleanedPhone.substring(1) 
      : cleanedPhone;

    window.open(`https://wa.me/${phoneWithCountry}?text=${encoded}`, "_blank");
    
    setLastQuestionnaireSentAt(new Date());
    setIsSendingQuestionnaire(false);
    toast.success("הודעה נשלחה לוואטסאפ");
  };

  const loadLeadData = async () => {
    setIsLoadingInvoices(true);
    try {
      const freshLeads = await base44.entities.Lead.filter({ id: lead.id });
      const freshLead = freshLeads?.[0];
      setInvoices(freshLead?.invoicesList || lead?.invoicesList || []);
    } catch {
      setInvoices(lead?.invoicesList || []);
    }
    setIsLoadingInvoices(false);
  };

  const handleCreateCalendarEvent = async () => {
    if (!lead?.phoneNumber) {
      toast.error('אין מספר טלפון לליד');
      return;
    }

    setIsCreatingCalendarEvent(true);
    try {
      await base44.functions.invoke('createLeadCalendarEvent', {
        leadId: lead.id,
      });
      toast.success('אירוע נוצר ביומן גוגל בהצלחה');
      if (onLeadUpdated) onLeadUpdated();
    } catch (error) {
      console.error('Error creating calendar event:', error);
      toast.error('שגיאה בYou created calendar event');
    } finally {
      setIsCreatingCalendarEvent(false);
    }
  };

  const handleDeleteLead = async () => {
    setIsDeleting(true);
    try {
      // Delete from Google Calendar if calendar event exists
      const googleEventId = lead?.googleCalendarEventId;
      if (googleEventId) {
        try {
          await base44.functions.invoke('deleteFromGoogleCalendar', {
            calendarEventId: googleEventId,
          });
          console.log('Event deleted from Google Calendar');
        } catch (calendarErr) {
          console.error('Failed to delete from Google Calendar:', calendarErr);
          // Continue with CRM deletion even if calendar deletion fails
        }
      }

      // Delete from CRM
      await base44.entities.Lead.delete(lead.id);
      
      toast.success('הליד נמחק בהצלחה מהמערכת ומהיומן');
      setShowDeleteConfirm(false);
      onClose();
      if (onLeadUpdated) onLeadUpdated();
    } catch (error) {
      console.error('Error deleting lead:', error);
      toast.error('שגיאה במחיקת הליד');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!lead) return null;

  // Calculate totalPaid from invoices array to ensure it's always up-to-date
  const totalPaidFromInvoices = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const displayTotalPaid = totalPaidFromInvoices > 0 ? totalPaidFromInvoices : (lead.totalPaid || 0);
  const balance = (lead.finalPrice || 0) - displayTotalPaid;
  const contractStatus = lead.signedAt ? "נחתם" : lead.contractSent ? "נשלח" : "טרם נשלח";

  return (
    <>
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto max-w-lg" dir="rtl">
        <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle className="text-white text-2xl">{lead.coupleNames}</SheetTitle>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 p-2"
                  title="מחק ליד"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
                <SheetClose />
              </div>
            </div>
          </SheetHeader>

        {/* כפתורים בולטים */}
        <div className="mt-4 mb-2 space-y-2">
          <Button
            onClick={handleCreateCalendarEvent}
            disabled={isCreatingCalendarEvent || lead?.googleCalendarEventId}
            className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-xl gap-2 text-base disabled:opacity-50 disabled:cursor-not-allowed"
            title={lead?.googleCalendarEventId ? "אירוע כבר נוצר ביומן" : "צור אירוע חדש ביומן גוגל"}
          >
            <Calendar className="w-5 h-5" />
            {isCreatingCalendarEvent ? 'יוצר אירוע...' : lead?.googleCalendarEventId ? '✅ אירוע בקלנדר' : 'צור אירוע ביומן גוגל'}
          </Button>
          <Button
            onClick={() => setInvoiceDialogOpen(true)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl gap-2 text-base"
          >
            <Receipt className="w-5 h-5" />
            הפקת חשבונית מס קבלה
          </Button>
        </div>

        <div className="space-y-6 mt-2">
          {/* פרטים בסיסיים */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">פרטים בסיסיים</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">טלפון:</span>
                <span className="text-white font-medium">{lead.phoneNumber || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">אימייל:</span>
                <span className="text-white font-medium break-all">{lead.email || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">תאריך אירוע:</span>
                <span className="text-white font-medium">
                  {lead.eventDate ? format(new Date(lead.eventDate), "d/M/yyyy") : "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">אולם:</span>
                <span className="text-white font-medium">{lead.venueName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">חבילה:</span>
                <span className="text-white font-medium">{lead.packageChoice || "—"}</span>
              </div>
            </div>
          </div>

          {/* סטטוס חוזה */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">סטטוס חוזה</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 text-sm">סטטוס:</span>
                <Badge
                  className={`${
                    contractStatus === "נחתם"
                      ? "bg-green-500/20 text-green-400"
                      : contractStatus === "נשלח"
                      ? "bg-blue-500/20 text-blue-400"
                      : "bg-gray-500/20 text-gray-400"
                  } border text-xs`}
                >
                  {contractStatus}
                </Badge>
              </div>
              {lead.signedAt && (
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">חתום בתאריך:</span>
                  <span className="text-white">{format(new Date(lead.signedAt), "d/M/yyyy")}</span>
                </div>
              )}
              {lead.signedAt && (
                <a
                  href={`${window.location.origin}/contract/${lead.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs mt-2"
                >
                  <FileText className="w-3 h-3" />
                  צפה בחוזה החתום
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}

              {/* כפתור שליחת חוזה בוואטסאפ */}
              <div className="flex gap-2 mt-3">
                <Button
                  onClick={handleSendContractWhatsApp}
                  disabled={isSendingContract || !lead.phoneNumber}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg gap-2 text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  שלח חוזה בוואטסאפ
                </Button>
                <button
                  onClick={() => setShowTemplateEditor(!showTemplateEditor)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 transition-colors"
                  title="ערוך תבנית הודעה"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {/* הודעה על שליחה אחרונה */}
              {lastContractSentAt && (
                <div className="bg-green-900/30 border border-green-700/40 rounded-lg p-2 text-xs text-green-400">
                  ✓ הודעה נשלחה ב-{format(lastContractSentAt, "HH:mm")}
                </div>
              )}

              {/* עורך התבנית */}
              {showTemplateEditor && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-gray-400 mb-2">ערוך את תבנית ההודעה:</p>
                  <textarea
                    value={contractTemplate}
                    onChange={(e) => setContractTemplate(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500">משתנים: [שם הלקוח] [לינק לחוזה]</p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSaveTemplate(contractTemplate)}
                      size="sm"
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1"
                    >
                      שמור
                    </Button>
                    <Button
                      onClick={() => setShowTemplateEditor(false)}
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs py-1"
                    >
                      ביטול
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* מעקב פיננסי */}
          <div>
            <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">מעקב פיננסי</h3>
            <div className="space-y-3">
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">סכום סופי:</span>
                  <span className="text-white font-semibold">₪{(lead.finalPrice || 0).toLocaleString()}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">סה"כ שולם:</span>
                  <span className="text-green-400 font-semibold">₪{displayTotalPaid.toLocaleString()}</span>
                </div>
                <div className="border-t border-gray-700 pt-2 flex justify-between text-sm">
                  <span className="text-gray-400">יתרה לתשלום:</span>
                  <span className={`font-semibold ${balance === 0 ? "text-green-400" : "text-red-400"}`}>
                    {balance === 0 ? "שולם במלואו ✅" : `₪${balance.toLocaleString()}`}
                  </span>
                </div>
              </div>

              {/* חשבוניות שהופקו */}
              <div>
                <h4 className="text-gray-400 text-xs font-semibold mb-2">חשבוניות שהופקו</h4>
                {isLoadingInvoices ? (
                  <div className="flex items-center gap-2 text-gray-500 text-xs py-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> טוען...
                  </div>
                ) : invoices.length === 0 ? (
                  <p className="text-gray-500 text-xs py-2">טרם הופקו חשבוניות</p>
                ) : (
                  <div className="border border-gray-700 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-800/80 text-gray-400 border-b border-gray-700">
                          <th className="text-right px-3 py-2 font-semibold">מס' מסמך</th>
                          <th className="text-right px-3 py-2 font-semibold">תאריך</th>
                          <th className="text-right px-3 py-2 font-semibold">פירוט</th>
                          <th className="text-right px-3 py-2 font-semibold">סכום</th>
                          <th className="text-center px-3 py-2 font-semibold">קישור</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoices.map((inv, idx) => (
                          <tr key={inv.id || idx} className="border-t border-gray-700/40 hover:bg-gray-800/40 transition-colors">
                            <td className="px-3 py-2 text-gray-300 whitespace-nowrap text-left">{inv.number || "—"}</td>
                            <td className="px-3 py-2 text-gray-300 whitespace-nowrap">{inv.date || "—"}</td>
                            <td className="px-3 py-2 text-gray-200 max-w-[110px] truncate" title={inv.description}>{inv.description || "—"}</td>
                            <td className="px-3 py-2 text-green-400 font-semibold whitespace-nowrap">₪{(inv.amount || 0).toLocaleString()}</td>
                            <td className="px-3 py-2 text-center">
                              {inv.url ? (
                                <a href={inv.url} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center w-6 h-6 rounded bg-red-900/40 hover:bg-red-800/60 text-red-400 hover:text-red-300 transition-colors" title="פתח חשבונית PDF">
                                  <FileDown className="w-3.5 h-3.5" />
                                </a>
                              ) : <span className="text-gray-600">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-gray-600 bg-gray-800/60">
                          <td colSpan={3} className="px-3 py-2 text-gray-400 font-semibold text-xs">סה"כ שולם</td>
                          <td className="px-3 py-2 text-green-400 font-bold text-xs whitespace-nowrap">
                            ₪{invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0).toLocaleString()}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* פרטי הפקה */}
          <div>
            {/* כותרת + סטטוס */}
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-gray-400 text-xs font-semibold uppercase">פרטי הפקה</h3>
              {lead.productionFormFilledAt && (
                <span className="flex items-center gap-1 text-xs text-green-400 bg-green-900/30 border border-green-700/40 px-2 py-0.5 rounded-full">
                  <CheckCircle className="w-3 h-3" /> מולא ✓
                </span>
              )}
            </div>

            {/* כפתורי פעולה */}
            <div className="flex flex-col gap-2 mb-3">
              <div className="flex gap-2">
                <Button
                  onClick={handleSendQuestionnaireWhatsApp}
                  disabled={isSendingQuestionnaire || !lead.phoneNumber}
                  className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg gap-2 text-sm"
                >
                  <MessageCircle className="w-4 h-4" />
                  שלח שאלון בוואטסאפ
                </Button>
                <button
                  onClick={() => setShowQuestionnaireTemplateEditor(!showQuestionnaireTemplateEditor)}
                  className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-300 transition-colors"
                  title="ערוך תבנית הודעה"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>

              {/* עורך התבנית לשאלון */}
              {showQuestionnaireTemplateEditor && (
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-gray-400 mb-2">ערוך את תבנית ההודעה:</p>
                  <textarea
                    value={questionnaireTemplate}
                    onChange={(e) => setQuestionnaireTemplate(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                    rows={3}
                  />
                  <p className="text-xs text-gray-500">משתנים: [שם הלקוח] [לינק לשאלון]</p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleSaveQuestionnaireTemplate(questionnaireTemplate)}
                      size="sm"
                      className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1"
                    >
                      שמור
                    </Button>
                    <Button
                      onClick={() => setShowQuestionnaireTemplateEditor(false)}
                      size="sm"
                      variant="outline"
                      className="flex-1 text-xs py-1"
                    >
                      ביטול
                    </Button>
                  </div>
                </div>
              )}

              {/* הודעה על שליחה אחרונה */}
              {lastQuestionnaireSentAt && (
                <div className="bg-green-900/30 border border-green-700/40 rounded-lg p-2 text-xs text-green-400">
                  ✓ הודעה נשלחה ב-{format(lastQuestionnaireSentAt, "HH:mm")}
                </div>
              )}

              <button
                onClick={handleCopyQuestionnaireLink}
                className="flex items-center justify-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 hover:text-white px-2 py-1.5 rounded-lg transition-colors"
              >
                {copiedQLink ? <ClipboardCheck className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                {copiedQLink ? "הועתק!" : "העתק לינק לשאלון"}
              </button>
              <a
                href={getQuestionnaireLink()}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-center gap-1 text-xs border px-2 py-1.5 rounded-lg transition-colors font-medium ${
                  lead.productionFormFilledAt
                    ? "bg-green-900/40 border-green-700/40 text-green-400 hover:bg-green-800/60"
                    : "bg-blue-900/40 border-blue-700/40 text-blue-400 hover:bg-blue-800/60"
                }`}
              >
                <ExternalLink className="w-3 h-3" />
                {lead.productionFormFilledAt ? "עדכון השאלון" : "הצגת השאלון"}
              </a>
            </div>

            {/* תוכן השאלון */}
            {lead.productionFormFilledAt ? (
              <>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-2 text-sm mb-3">
                  {[
                    { label: "📱 נייד כלה", val: lead.productionBridePhone },
                    { label: "📱 נייד חתן", val: lead.productionGroomPhone },
                    { label: "📍 התארגנות כלה", val: lead.productionBridePrepLocation },
                    { label: "📸 אינסטגרם", val: lead.productionInstagram },
                  ].map(({ label, val }) => val ? (
                    <div key={label} className="flex justify-between gap-2">
                      <span className="text-gray-400 flex-shrink-0">{label}:</span>
                      <span className="text-white font-medium text-right break-all">{val}</span>
                    </div>
                  ) : null)}
                  {lead.productionSpecialRequests && (
                    <div className="pt-2 border-t border-gray-700">
                      <p className="text-gray-400 text-xs mb-1">💬 בקשות מיוחדות:</p>
                      <p className="text-gray-200 text-xs whitespace-pre-wrap">{lead.productionSpecialRequests}</p>
                    </div>
                  )}
                </div>
                {/* כפתור שליחה לצוות בולט */}
                <button
                  onClick={handleSendToTeamWhatsApp}
                  className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold text-sm px-3 py-2.5 rounded-xl transition-colors"
                >
                  <Send className="w-4 h-4" />
                  שלח פרטי הפקה לצוות הצילום (WhatsApp)
                </button>
              </>
            ) : (
              <div className="bg-gray-800/30 border border-gray-700/50 rounded-lg p-3">
                <p className="text-gray-500 text-xs">הזוג טרם מילא את שאלון ההפקה.</p>
                <p className="text-gray-600 text-xs mt-1">לחץ "העתק לינק לשאלון" לשלוח להם את הטופס.</p>
              </div>
            )}
          </div>

          {/* הערות */}
          {lead.notes && (
            <div>
              <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">הערות</h3>
              <p className="text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded p-3">
                {lead.notes}
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>

    <InvoiceDialog
      isOpen={invoiceDialogOpen}
      onClose={() => setInvoiceDialogOpen(false)}
      coupleNames={lead?.coupleNames}
      eventDate={lead?.eventDate}
      venueName={lead?.venueName}
      clientEmail={lead?.email}
      clientPhone={lead?.phoneNumber}
      leadId={lead?.id}
      onInvoiceCreated={(url, amount) => {
        // Refresh lead data immediately and trigger parent refresh
        loadLeadData();
        if (onLeadUpdated) onLeadUpdated();
      }}
    />

    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent className="bg-gray-900 border-gray-800 text-white">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-white">מחק ליד?</AlertDialogTitle>
          <AlertDialogDescription className="text-gray-400">
            פעולה זו תמחק את הליד "{lead?.coupleNames}" מהמערכת.
            {lead?.googleCalendarEventId && (
              <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
                ⚠️ האירוע יימחק גם מיומן Google Calendar.
              </div>
            )}
            <div className="mt-2 text-gray-300">
              לא ניתן לבטל פעולה זו.
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex gap-3 justify-end">
          <AlertDialogCancel className="border-gray-700 text-gray-300 hover:bg-gray-800">
            בטל
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteLead}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isDeleting ? "מוחק..." : "מחק ליד"}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}