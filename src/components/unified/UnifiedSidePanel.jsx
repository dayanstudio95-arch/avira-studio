import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { 
  Loader2, CheckCircle2, ExternalLink, FileDown, Copy, ClipboardCheck,
  Send, Calendar as CalendarIcon, MessageCircle, Settings, Receipt, TrendingUp, Share2, Eye, Edit2, Trash2
} from "lucide-react";
import { toast } from "sonner";
import InvoiceDialog from "@/components/invoice/InvoiceDialog";

export default function UnifiedSidePanel({ isOpen, onClose, lead, event, staffMembers, onLeadUpdated, onEventUpdated }) {
  // Hard stop: if event.sourceLeadId points to a different lead, discard the event entirely
  const hasLinkMismatch = !!(event && lead && event.sourceLeadId && event.sourceLeadId !== lead.id);
  const safeEvent = hasLinkMismatch ? null : event;

  const eventDate = safeEvent?.date || lead?.eventDate;

  // null = closed, 'sole_prop' | 'company' = which Morning account's invoice dialog is open
  // (green button below = sole_prop / עוסק מורשה, purple button = company / חברה בע״מ)
  const [invoiceDialogBusinessType, setInvoiceDialogBusinessType] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);

  const [isSyncingCalendar, setIsSyncingCalendar] = useState(false);
  const [isSharingTeam, setIsSharingTeam] = useState(false);
  const [isSendingContract, setIsSendingContract] = useState(false);
  const [lastContractSentAt, setLastContractSentAt] = useState(null);
  const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
  const [contractTemplate, setContractTemplate] = useState("");
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [isSendingQuestionnaire, setIsSendingQuestionnaire] = useState(false);
  const [lastQuestionnaireSentAt, setLastQuestionnaireSentAt] = useState(null);
  const [showQuestionnaireTemplateEditor, setShowQuestionnaireTemplateEditor] = useState(false);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState("");
  const [copiedQLink, setCopiedQLink] = useState(false);
  const [makeWebhookUrl, setMakeWebhookUrl] = useState("");
  const [paymentMessageText, setPaymentMessageText] = useState("");
  const [isSendingPayment, setIsSendingPayment] = useState(false);
  const [showPaymentSection, setShowPaymentSection] = useState(false);
  const [editingEventDate, setEditingEventDate] = useState(false);
  const [editingEventDateValue, setEditingEventDateValue] = useState(eventDate);
  const [isEditingContractTemplate, setIsEditingContractTemplate] = useState(false);
  const [contractTemplateEdit, setContractTemplateEdit] = useState('');
  const [isEditingQuestionnaireTemplate, setIsEditingQuestionnaireTemplate] = useState(false);
  const [questionnaireTemplateEdit, setQuestionnaireTemplateEdit] = useState('');
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(hasLinkMismatch ? (lead?.notes || '') : (event?.notes || lead?.notes || ''));
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [isCancelingEvent, setIsCancelingEvent] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const getQuestionnaireLink = () => {
    // CHANGED: was hardcoded to 'https://www.avira-studio.com', a domain nothing is
    // actually hosted on — every generated link 404'd. window.location.origin matches
    // LeadCardDrawer.jsx's already-correct pattern and always points at wherever the
    // app is actually running (localhost while testing, the real domain once deployed).
    const baseUrl = window.location.origin;
    return lead?.id
      ? `${baseUrl}/questionnaire/${lead.id}`
      : `${baseUrl}/questionnaire`;
  };

  const displayData = safeEvent || lead;
  const coupleNames = safeEvent?.coupleNames || lead?.coupleNames || '';
  const venue = safeEvent?.venue || lead?.venueName || '';

  // Auto-link: if event doesn't have sourceLeadId but we have a lead, save the canonical link
  useEffect(() => {
    if (event?.id && lead?.id && !event.sourceLeadId) {
      base44.entities.Event.update(event.id, { sourceLeadId: lead.id }).catch(() => {});
    }
  }, [event?.id, lead?.id]);

  useEffect(() => {
    if (lead?.id) {
      loadLeadInvoices();
    }
  }, [lead?.id]);

  useEffect(() => {
    base44.entities.AppSetting.list().then(all => {
      const webhookSetting = all.find(s => s.key === 'make_webhook_url');
      if (webhookSetting?.value) setMakeWebhookUrl(webhookSetting.value);
      const contractTpl = all.find(s => s.key === 'template_contract');
      if (contractTpl?.value) setContractTemplate(contractTpl.value);
      const questTpl = all.find(s => s.key === 'template_questionnaire');
      if (questTpl?.value) setQuestionnaireTemplate(questTpl.value);
    }).catch(() => {});
  }, []);

  const loadLeadInvoices = async () => {
    if (!lead?.id) return;
    setIsLoadingInvoices(true);
    try {
      const leads = await base44.entities.Lead.list();
      const leadData = leads.find(l => l.id === lead.id);
      setInvoices(leadData?.invoicesList || []);
    } catch (error) {
      console.error("Error loading invoices:", error);
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  const handleSyncToCalendar = async () => {
    setIsSyncingCalendar(true);
    try {
      await base44.functions.invoke('syncEventToCalendar', { eventId: safeEvent.id });
      toast.success('האירוע סונכרן ליומן בהצלחה');
      if (onEventUpdated) onEventUpdated();
    } catch (error) {
      console.error("Failed to sync to calendar:", error);
      toast.error('שגיאה בסנכרון ליומן');
    } finally {
      setIsSyncingCalendar(false);
    }
  };

  const handleShareWithTeam = async () => {
    if (!safeEvent?.team?.length) {
      toast.error('אין צוות משובץ לאירוע זה');
      return;
    }

    setIsSharingTeam(true);
    try {
      const result = await base44.functions.invoke('shareEventInfoWithTeam', { eventId: safeEvent.id });
      if (result.data.success) {
        toast.success(`הודעה נשלחה ל-${result.data.totalSent} אנשי צוות`);
      } else {
        toast.error(result.data.error || 'שגיאה בשליחת ההודעות');
      }
    } catch (error) {
      console.error("Failed to share team info:", error);
      toast.error('שגיאה בשליחת פרטים');
    } finally {
      setIsSharingTeam(false);
    }
  };

  const buildPaymentMessage = () => {
    const balance = (lead?.finalPrice || 0) - (lead?.totalPaid || 0);
    return `היי ${lead?.coupleNames || ''}, מזל טוב! 🎉\nנשארה יתרה לתשלום על סך ${balance.toLocaleString('he-IL')} ש"ח.\nניתן לשלם כאן: [לינק לתשלום]`;
  };

  const handleOpenPaymentSection = async () => {
    const balance = (lead?.finalPrice || 0) - (lead?.totalPaid || 0);
    try {
      const settings = await base44.entities.AppSetting.list();
      const tpl = settings.find(s => s.key === 'template_payment_request')?.value;
      if (tpl) {
        const msg = tpl
          .replace(/\{\{names\}\}/g, lead?.coupleNames || '')
          .replace(/\{\{balance\}\}/g, balance.toLocaleString('he-IL'))
          .replace(/\{\{payment_link\}\}/g, '[לינק לתשלום]');
        setPaymentMessageText(msg);
      } else {
        setPaymentMessageText(buildPaymentMessage());
      }
    } catch {
      setPaymentMessageText(buildPaymentMessage());
    }
    setShowPaymentSection(true);
  };

  const formatPhoneForWhatsApp = (phone) => {
    const cleaned = phone.replace(/[-\s()]/g, '');
    const intl = cleaned.startsWith('0') ? '972' + cleaned.substring(1) : cleaned;
    return `${intl}@c.us`;
  };

  // CHANGED: this used to call the retired Make.com webhook function ('sendMakeWebhook'),
  // which no longer exists now that every WhatsApp send goes through Green API (see
  // supabase/functions/_shared/whatsapp.ts) — every call from this panel (follow-up,
  // contract, payment request, questionnaire) was silently throwing "not implemented".
  // Fixed to call the real send-whatsapp-message Edge Function (mapped as
  // 'sendWhatsAppMessage' in src/api/functions.js), same helper the EventDetailModal
  // and WhatsAppPanel test-send already use. The `action_type` param is kept so call
  // sites don't need to change, but it's no longer sent — send-whatsapp-message only
  // needs { to, message }, and it strips/formats the phone number itself server-side.
  const sendViaWebhook = async (action_type, phone, message_text) => {
    const result = await base44.functions.invoke('sendWhatsAppMessage', { to: phone, message: message_text });
    if (result.data?.error) {
      throw new Error(result.data.error);
    }
    return true;
  };

  const applyVariables = (template, lead, extraVars = {}) => {
    const baseUrl = window.location.origin; // CHANGED: was hardcoded to a domain nothing is hosted on
    const contractLink = `${baseUrl}/contract/${lead?.id}`;
    const questionnaireLink = getQuestionnaireLink();
    const eventDateFormatted = eventDate ? format(new Date(eventDate), "d/M/yyyy") : "";
    return template
      .replace(/\{\{names\}\}/g, lead?.coupleNames || "")
      .replace(/\{\{event_date\}\}/g, eventDateFormatted)
      .replace(/\{\{contract_link\}\}/g, contractLink)
      .replace(/\{\{questionnaire_link\}\}/g, questionnaireLink)
      .replace(/\{\{[^}]+\}\}/g, m => extraVars[m] || m);
  };

  const handleSendFollowUp = async () => {
    if (!lead?.phoneNumber) { toast.error('אין מספר טלפון'); return; }
    setIsSendingFollowUp(true);
    try {
      const msg = `היי ${lead.coupleNames || ''} 😊\nרצינו לבדוק איך הכל, ואם יש לכם שאלות לגבי החבילה שלנו.\nנשמח לשמוע מכם! 📸`;
      const ok = await sendViaWebhook('followup', lead.phoneNumber, msg);
      if (ok) {
        const updatedData = {
          status: 'פולו-אפ',
          lastContactDate: new Date().toISOString()
        };
        await base44.entities.Lead.update(lead.id, updatedData);
        if (lead.status === 'נסגר/חתימה') {
          await base44.functions.invoke('syncLeadToEvent', { leadId: lead.id });
        }
      }
    } catch { toast.error('שגיאה בשליחה'); }
    finally { setIsSendingFollowUp(false); }
  };

  const handleSendContractWhatsApp = async () => {
    if (!lead?.phoneNumber) {
      toast.error('אין מספר טלפון');
      return;
    }
    setIsSendingContract(true);
    try {
      const rawTemplate = contractTemplate || `שלום {{names}},\n\nפה החוזה שלכם:\n{{contract_link}}`;
      const message_text = applyVariables(rawTemplate, lead);
      const ok = await sendViaWebhook('contract', lead.phoneNumber, message_text);
      if (ok) {
        setLastContractSentAt(new Date());
        // New (2026-08-13): sending the contract now persists status + a timestamp,
        // per explicit request that a lead should automatically move to "נשלחה הצעה"
        // once the contract is sent (previously this only updated local React state,
        // never the DB -- see contractSent's other write site, Leads.jsx handleCopyLink,
        // for the only place this used to happen before). Guarded so re-sending a
        // contract to an already-signed/closed lead never regresses its status.
        // contract_sent_at also feeds sync-lead-followups' 48h auto-follow-up flip.
        if (!['חוזה', 'נסגר/חתימה'].includes(lead.status)) {
          await base44.entities.Lead.update(lead.id, {
            status: 'נשלחה הצעה',
            contractSent: true,
            contractSentAt: new Date().toISOString(),
            lastContactDate: new Date().toISOString(),
          });
          if (onLeadUpdated) onLeadUpdated();
        }
        toast.success('הודעת חוזה נשלחה בהצלחה');
      }
    } catch (error) {
      toast.error('שגיאה בשליחה');
    } finally {
      setIsSendingContract(false);
    }
  };

  const handleSendPaymentRequest = async () => {
    if (!lead?.phoneNumber) {
      toast.error('אין מספר טלפון');
      return;
    }
    setIsSendingPayment(true);
    try {
      const ok = await sendViaWebhook('payment_request', lead.phoneNumber, paymentMessageText);
      if (ok) {
        setShowPaymentSection(false);
        setPaymentMessageText('');
        toast.success('דרישת התשלום נשלחה בהצלחה! ✓');
      }
    } catch (error) {
      toast.error('שגיאה בשליחה');
    } finally {
      setIsSendingPayment(false);
    }
  };

  const handleSendQuestionnaireWhatsApp = async () => {
    if (!lead?.phoneNumber) {
      toast.error('אין מספר טלפון');
      return;
    }
    setIsSendingQuestionnaire(true);
    try {
      const rawTemplate = questionnaireTemplate || `שלום {{names}},\n\nנשמח אם תמלאו את השאלון הקצר הזה:\n{{questionnaire_link}}`;
      const message_text = applyVariables(rawTemplate, lead);
      const ok = await sendViaWebhook('questionnaire', lead.phoneNumber, message_text);
      if (ok) {
        setLastQuestionnaireSentAt(new Date());
        toast.success('הודעת שאלון נשלחה בהצלחה');
      }
    } catch (error) {
      toast.error('שגיאה בשליחה');
    } finally {
      setIsSendingQuestionnaire(false);
    }
  };

  const handleCopyQuestionnaireLink = () => {
    navigator.clipboard.writeText(getQuestionnaireLink());
    setCopiedQLink(true);
    toast.success('הלינק הועתק!');
    setTimeout(() => setCopiedQLink(false), 2500);
  };

  const handleSaveContractTemplate = async () => {
    try {
      const existing = await base44.entities.AppSetting.list();
      const setting = existing.find(s => s.key === 'template_contract');
      if (setting) {
        await base44.entities.AppSetting.update(setting.id, { value: contractTemplateEdit });
      } else {
        await base44.entities.AppSetting.create({ key: 'template_contract', value: contractTemplateEdit });
      }
      setContractTemplate(contractTemplateEdit);
      setIsEditingContractTemplate(false);
      toast.success('תבנית החוזה נשמרה בהצלחה');
    } catch (error) {
      toast.error('שגיאה בשמירת התבנית');
    }
  };

  const handleSaveQuestionnaireTemplate = async () => {
    try {
      const existing = await base44.entities.AppSetting.list();
      const setting = existing.find(s => s.key === 'template_questionnaire');
      if (setting) {
        await base44.entities.AppSetting.update(setting.id, { value: questionnaireTemplateEdit });
      } else {
        await base44.entities.AppSetting.create({ key: 'template_questionnaire', value: questionnaireTemplateEdit });
      }
      setQuestionnaireTemplate(questionnaireTemplateEdit);
      setIsEditingQuestionnaireTemplate(false);
      toast.success('תבנית השאלון נשמרה בהצלחה');
    } catch (error) {
      toast.error('שגיאה בשמירת התבנית');
    }
  };

  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    try {
      if (safeEvent?.id) {
        await base44.entities.Event.update(safeEvent.id, { notes: notesValue });
      } else if (lead?.id) {
        await base44.entities.Lead.update(lead.id, { notes: notesValue });
      }
      setIsEditingNotes(false);
      toast.success('ההערות נשמרו');
      if (safeEvent?.id && onEventUpdated) onEventUpdated();
      if (!safeEvent?.id && lead?.id && onLeadUpdated) onLeadUpdated();
    } catch { toast.error('שגיאה בשמירה'); }
    finally { setIsSavingNotes(false); }
  };

  const handleCancelEvent = async () => {
    if (!safeEvent?.id) {
      toast.error('אין אירוע לביטול');
      return;
    }
    setIsCancelingEvent(true);
    try {
      await base44.functions.invoke('cancelEvent', { eventId: safeEvent.id });
      toast.success('האירוע בוטל בהצלחה');
      setShowCancelConfirm(false);
      onClose();
      if (onEventUpdated) onEventUpdated();
      if (onLeadUpdated) onLeadUpdated();
    } catch (error) {
      console.error('Error canceling event:', error);
      toast.error('שגיאה בביטול אירוע: ' + error.message);
    } finally {
      setIsCancelingEvent(false);
    }
  };

  const handleSaveEventDate = async () => {
    if (!editingEventDateValue) {
      toast.error('בחר תאריך');
      return;
    }
    try {
      if (safeEvent?.id) {
        await base44.entities.Event.update(safeEvent.id, { date: editingEventDateValue });
      }
      if (safeEvent?.sourceLeadId) {
        await base44.entities.Lead.update(safeEvent.sourceLeadId, { eventDate: editingEventDateValue });
      } else if (lead?.id) {
        await base44.entities.Lead.update(lead.id, { eventDate: editingEventDateValue });
      }
      toast.success('התאריך עודכן בהצלחה');
      setEditingEventDate(false);
      if (onEventUpdated) onEventUpdated();
      if (onLeadUpdated) onLeadUpdated();
    } catch (error) {
      console.error('Error updating date:', error);
      toast.error('שגיאה בעדכון התאריך');
    }
  };

  const contractStatus = lead?.signedAt ? "נחתם" : lead?.contractSent ? "נשלח" : "טרם נשלח";
  const team = safeEvent?.team || [];
  const totalPaidFromInvoices = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
  const displayTotalPaid = totalPaidFromInvoices > 0 ? totalPaidFromInvoices : (lead?.totalPaid || 0);
  const balance = (lead?.finalPrice || 0) - displayTotalPaid;

  if (!lead && !event) return null;

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent className="bg-gray-900 border-gray-800 text-white overflow-y-auto max-w-lg" dir="rtl">
          <SheetHeader>
            <div className="flex items-center justify-between">
              <SheetTitle className="text-white text-2xl">{coupleNames}</SheetTitle>
              <SheetClose />
            </div>
          </SheetHeader>

          <div className="space-y-6 mt-6">

            {/* ⚠️ Critical mismatch warning */}
            {hasLinkMismatch && (
              <div className="bg-red-900/40 border border-red-500 rounded-lg p-3 text-sm text-red-300 flex items-start gap-2">
                <span className="text-red-400 text-lg leading-none mt-0.5">⚠️</span>
                <div>
                  <p className="font-bold text-red-200">שגיאת קישור — מידע עלול להיות שגוי!</p>
                  <p className="text-xs mt-1 text-red-400">האירוע המוצג שייך לליד אחר. פנה לתמיכה לתיקון.</p>
                  <p className="text-xs text-red-500 font-mono mt-1">lead: {lead?.id?.slice(-6)} | event.source: {event?.sourceLeadId?.slice(-6)}</p>
                </div>
              </div>
            )}

            {/* כפתורים בולטים */}
            <div className="space-y-2">
              {/* כפתור ביטול אירוע (אם יש אירוע) */}
              {safeEvent && (
                <Button
                  onClick={() => setShowCancelConfirm(true)}
                  disabled={isCancelingEvent}
                  className="w-full bg-red-600/80 hover:bg-red-700 text-white font-semibold py-3 rounded-xl gap-2"
                  title="בטל את האירוע הנוכחי"
                >
                  <Trash2 className="w-5 h-5" />
                  {isCancelingEvent ? 'מבטל...' : 'בטל אירוע'}
                </Button>
              )}
              {/* 4 כפתורים בחלק העליון */}
              <Button
                onClick={() => setInvoiceDialogBusinessType('company')}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 rounded-xl gap-2"
              >
                <Receipt className="w-5 h-5" />
                הפקת חשבונית חברה בע״מ
              </Button>
              <Button
                onClick={() => setInvoiceDialogBusinessType('sole_prop')}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3 rounded-xl gap-2"
              >
                <Receipt className="w-5 h-5" />
                הפקת חשבונית מס קבלה
              </Button>
              {lead && !showPaymentSection && (
                <Button
                  onClick={handleOpenPaymentSection}
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-3 rounded-xl gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  שלח דרישת תשלום בוואטסאפ
                </Button>
              )}
              {lead?.signedContractPdfUrl && (
                <a
                  href={lead.signedContractPdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold py-3 rounded-xl text-sm"
                >
                  <FileDown className="w-5 h-5" />
                  צפה בחוזה החתום (PDF)
                </a>
              )}
            </div>

            {/* סעיף עריכת דרישת התשלום קבוע */}
            {lead && showPaymentSection && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-white font-semibold">דרישת תשלום</h3>
                  <button
                    onClick={() => setShowPaymentSection(false)}
                    className="text-gray-400 hover:text-gray-200 text-sm"
                  >
                    ✕ סגור
                  </button>
                </div>
                <textarea
                  className="w-full bg-gray-900 text-white text-sm border border-gray-700 rounded-lg p-3 resize-none focus:outline-none focus:border-orange-500"
                  rows={5}
                  value={paymentMessageText}
                  onChange={e => setPaymentMessageText(e.target.value)}
                />
                <Button
                  onClick={handleSendPaymentRequest}
                  disabled={isSendingPayment || !paymentMessageText.trim()}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-orange-800 text-white font-semibold py-2 rounded-lg gap-2"
                >
                  {isSendingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      שולח...
                    </>
                  ) : (
                    <>
                      <MessageCircle className="w-4 h-4 mr-2" />
                      אשר ושלח למייק
                    </>
                  )}
                </Button>
              </div>
            )}

            {/* כפתור צפייה בחוזה חתום */}
            {lead?.signedContractPdfUrl && (
              <a
                href={lead.signedContractPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white font-semibold py-3 rounded-xl text-sm"
              >
                <FileDown className="w-5 h-5" />
                צפה בחוזה החתום (PDF)
              </a>
            )}

            {/* שורת סטטוסים */}
            {lead && (
              <div className="flex gap-2 flex-wrap">
                <Badge className={`text-xs font-medium ${
                  lead.signedAt
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                } border`}>
                  {lead.signedAt ? "✅ חתום" : "⏳ חוזה"}
                </Badge>
                <Badge className={`text-xs font-medium ${
                  lead.productionFormFilledAt
                    ? "bg-green-500/20 text-green-400 border-green-500/30"
                    : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                } border`}>
                  {lead.productionFormFilledAt ? "✅ שאלון" : "📝 שאלון"}
                </Badge>
              </div>
            )}

            {/* ניהול חוזה */}
            {lead && (
              <div>
                <h3 className="text-gray-400 text-xs font-semibold uppercase mb-2">ניהול חוזה</h3>
                <div className="flex gap-2">
                  <Button
                   variant="ghost"
                   size="icon"
                   onClick={() => {
                     setContractTemplateEdit(contractTemplate || '');
                     setIsEditingContractTemplate(true);
                   }}
                   className="h-10 w-10 bg-gray-800 hover:bg-gray-700 text-gray-400 flex-shrink-0"
                   title="הגדרות חוזה"
                  >
                   <Settings className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={handleSendContractWhatsApp}
                    disabled={isSendingContract || !lead.phoneNumber}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg gap-2"
                  >
                    <MessageCircle className="w-4 h-4" />
                    {isSendingContract ? 'שולח...' : 'שלח חוזה בוואטסאפ'}
                  </Button>
                </div>
              </div>
            )}

            {/* פרטי הפקה */}
            {lead && (
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4">
                <div className="space-y-4 text-sm">
                  {/* פרטי האירוע */}
                  <div className="space-y-2">
                    <h4 className="text-gray-300 font-semibold text-xs uppercase">פרטי האירוע:</h4>
                    {coupleNames && (
                      <div className="flex justify-between text-gray-200">
                        <span className="text-gray-400">שמות הזוג:</span>
                        <span>{coupleNames}</span>
                      </div>
                    )}
                    {eventDate && (
                      <div className="flex justify-between text-gray-200">
                        <span className="text-gray-400">תאריך:</span>
                        <span>{format(new Date(eventDate), 'd.M.yyyy')}</span>
                      </div>
                    )}
                    {venue && (
                      <div className="flex justify-between text-gray-200">
                        <span className="text-gray-400">אולם:</span>
                        <span>{venue}</span>
                      </div>
                    )}
                    {lead?.phoneNumber && (
                      <div className="flex justify-between text-gray-200">
                        <span className="text-gray-400">טלפון:</span>
                        <span>{lead.phoneNumber}</span>
                      </div>
                    )}
                  </div>
                  
                  {/* צוות הצילום */}
                  {team && team.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-gray-300 font-semibold text-xs uppercase">צוות הצילום:</h4>
                      {team.map((member, idx) => (
                        <div key={idx} className="text-gray-200 text-xs">
                          • {member.staffMemberName} ({member.role})
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* פרטי הפקה מהשאלון */}
                  {lead && (
                    <div className="space-y-3">
                      <h4 className="text-gray-300 font-semibold text-xs uppercase">פרטי הפקה:</h4>
                      {lead?.productionBridePhone && (
                        <div className="flex justify-between text-gray-200 text-sm">
                          <span className="text-gray-400">נייד כלה:</span>
                          <span>{lead.productionBridePhone}</span>
                        </div>
                      )}
                      {lead?.productionGroomPhone && (
                        <div className="flex justify-between text-gray-200 text-sm">
                          <span className="text-gray-400">נייד חתן:</span>
                          <span>{lead.productionGroomPhone}</span>
                        </div>
                      )}
                      {lead?.productionBridePrepLocation && (
                        <div className="flex justify-between text-gray-200 text-sm">
                          <span className="text-gray-400">התארגנות כלה:</span>
                          <span>{lead.productionBridePrepLocation}</span>
                        </div>
                      )}
                      {lead?.productionInstagram && (
                        <div className="flex justify-between text-gray-200 text-sm">
                          <span className="text-gray-400">אינסטגרם:</span>
                          <span>{lead.productionInstagram}</span>
                        </div>
                      )}
                      {lead?.productionSpecialRequests && (
                        <div className="text-gray-200 text-sm">
                          <span className="text-gray-400">בקשות מיוחדות:</span>
                          <p className="mt-1 text-xs text-gray-300">{lead.productionSpecialRequests}</p>
                        </div>
                      )}
                      
                      {/* כפתורים לניהול השאלון */}
                      <div className="pt-3 space-y-2 border-t border-gray-700/50">
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setQuestionnaireTemplateEdit(questionnaireTemplate || '');
                              setIsEditingQuestionnaireTemplate(true);
                            }}
                            className="h-10 w-10 bg-gray-700 hover:bg-gray-600 text-gray-300 flex-shrink-0"
                            title="הגדרות שאלון"
                          >
                            <Settings className="w-4 h-4" />
                          </Button>
                          <Button
                            onClick={handleSendQuestionnaireWhatsApp}
                            disabled={isSendingQuestionnaire || !lead.phoneNumber}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-semibold py-2 rounded-lg gap-2 text-sm"
                          >
                            <MessageCircle className="w-4 h-4" />
                            {isSendingQuestionnaire ? 'שולח...' : 'שלח שאלון'}
                          </Button>
                        </div>
                        <Button
                          onClick={handleCopyQuestionnaireLink}
                          disabled={!lead.phoneNumber}
                          variant="outline"
                          className="w-full text-gray-300 border-gray-700 hover:bg-gray-700 py-2 rounded-lg gap-2 text-sm"
                        >
                          {copiedQLink ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          {copiedQLink ? 'הועתק!' : 'העתק לינק'}
                        </Button>
                        <a
                          href={getQuestionnaireLink()}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg text-sm"
                        >
                          <Eye className="w-4 h-4" />
                          הצגת השאלון
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* פרטים בסיסיים */}
            <div>
              <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">פרטים בסיסיים</h3>
              <div className="space-y-2 text-sm">
                {lead?.phoneNumber && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">טלפון:</span>
                    <a href={`tel:${lead.phoneNumber}`} className="text-blue-400 hover:underline">{lead.phoneNumber}</a>
                  </div>
                )}
                {lead?.email && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">אימייל:</span>
                    <span className="text-white font-medium break-all">{lead.email}</span>
                  </div>
                )}
                {eventDate && (
                   <div className="flex justify-between items-center gap-2">
                     <span className="text-gray-400">תאריך אירוע:</span>
                     {editingEventDate ? (
                       <div className="flex items-center gap-1">
                         <input
                           type="date"
                           value={editingEventDateValue}
                           onChange={(e) => setEditingEventDateValue(e.target.value)}
                           className="bg-gray-800 border border-gray-700 text-white text-sm rounded px-2 py-1 focus:outline-none focus:border-yellow-400"
                           dir="ltr"
                         />
                         <button
                           onClick={handleSaveEventDate}
                           className="text-green-400 hover:text-green-300 font-semibold text-xs px-2 py-1 bg-green-900/30 border border-green-700/40 rounded"
                         >
                           ✓
                         </button>
                         <button
                           onClick={() => {
                             setEditingEventDate(false);
                             setEditingEventDateValue(eventDate);
                           }}
                           className="text-red-400 hover:text-red-300 font-semibold text-xs px-2 py-1 bg-red-900/30 border border-red-700/40 rounded"
                         >
                           ✕
                         </button>
                       </div>
                     ) : (
                       <div className="flex items-center gap-2">
                         <span className="text-white font-medium">{format(new Date(eventDate), "d/M/yyyy")}</span>
                         <button
                           onClick={() => {
                             setEditingEventDate(true);
                             setEditingEventDateValue(eventDate);
                           }}
                           className="text-gray-400 hover:text-yellow-400 transition-colors p-1"
                           title="ערוך תאריך"
                         >
                           <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                           </svg>
                         </button>
                       </div>
                     )}
                     </div>
                     )}
                     {venue && (
                     <div className="flex justify-between">
                     <span className="text-gray-400">אולם:</span>
                     <span className="text-white font-medium">{venue}</span>
                     </div>
                     )}
                     {lead?.packageChoice && (
                       <div className="flex justify-between">
                         <span className="text-gray-400">חבילה:</span>
                         <span className="text-white font-medium">{lead.packageChoice}</span>
                       </div>
                     )}
                     </div>
                     </div>

            {/* סיכום כלכלי */}
            {(safeEvent || lead?.finalPrice) && (
              <div className="bg-gradient-to-r from-gray-800 to-gray-800/50 border border-gray-700 rounded-lg p-4">
                <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-400" />
                  סיכום כלכלי
                </h3>
                <div className="space-y-2 text-sm">
                  {safeEvent?.totalAmountGross && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-400">סכום ברוטו:</span>
                        <span className="text-white font-semibold">₪{(safeEvent.totalAmountGross || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">מע"מ ({safeEvent.vatPercent || 18}%):</span>
                        <span className="text-white font-semibold">₪{(safeEvent.vatAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </>
                  )}
                  {lead?.finalPrice && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-400">סכום סופי:</span>
                        <span className="text-white font-semibold">₪{(lead.finalPrice).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">סה"כ שולם:</span>
                        <span className="text-green-400 font-semibold">₪{displayTotalPaid.toLocaleString()}</span>
                      </div>
                      <div className="border-t border-gray-700 pt-2 flex justify-between">
                        <span className="text-gray-400">יתרה לתשלום:</span>
                        <span className={`font-semibold ${balance === 0 ? "text-green-400" : "text-red-400"}`}>
                          {balance === 0 ? "שולם במלואו ✅" : `₪${balance.toLocaleString()}`}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* היסטוריית חשבוניות */}
            {lead && invoices.length > 0 && (
              <div>
                <h3 className="text-gray-400 text-xs font-semibold uppercase mb-3">היסטוריית חשבוניות</h3>
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-800/80 border-b border-gray-700">
                        <th className="text-right px-2 py-2 font-semibold text-gray-400">מס' מסמך</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-400">תאריך</th>
                        <th className="text-right px-2 py-2 font-semibold text-gray-400">סכום</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoices.map((inv, idx) => (
                        <tr key={inv.id || idx} className="border-t border-gray-700/40 hover:bg-gray-800/40">
                          <td className="px-2 py-2 text-gray-300">{inv.number || "—"}</td>
                          <td className="px-2 py-2 text-gray-300">{inv.date || "—"}</td>
                          <td className="px-2 py-2 text-green-400 font-semibold">₪{(inv.amount || 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* הערות */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-gray-400 text-xs font-semibold uppercase">הערות</h3>
                {!isEditingNotes && (
                  <button onClick={() => { setNotesValue(safeEvent?.notes || lead?.notes || ''); setIsEditingNotes(true); }} className="text-xs text-yellow-400 hover:text-yellow-300">
                    ✏️ ערוך
                  </button>
                )}
              </div>
              {isEditingNotes ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg p-3 resize-none focus:outline-none focus:border-yellow-500 h-28"
                    value={notesValue}
                    onChange={e => setNotesValue(e.target.value)}
                    placeholder="הוסף הערות..."
                    dir="rtl"
                  />
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setIsEditingNotes(false)} className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1 border border-gray-700 rounded">ביטול</button>
                    <button onClick={handleSaveNotes} disabled={isSavingNotes} className="text-xs text-black bg-yellow-400 hover:bg-yellow-300 px-3 py-1 rounded font-semibold">{isSavingNotes ? '...' : 'שמור'}</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-300 bg-gray-800/50 border border-gray-700 rounded p-3 min-h-[40px]">
                  {notesValue || <span className="text-gray-500">אין הערות</span>}
                </p>
              )}
            </div>

          </div>
        </SheetContent>
      </Sheet>

      {/* Dialog עריכת תבנית חוזה */}
      <Dialog open={isEditingContractTemplate} onOpenChange={setIsEditingContractTemplate}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white">עריכת תבנית הודעת החוזה</DialogTitle>
          </DialogHeader>
          <textarea
            value={contractTemplateEdit}
            onChange={(e) => setContractTemplateEdit(e.target.value)}
            className="w-full bg-gray-800 text-white border border-gray-700 rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-green-500 h-40"
            placeholder="עריכת תבנית החוזה..."
          />
          <p className="text-xs text-gray-400 mt-2">{"משתנים זמינים: {names}, {event_date}, {contract_link}"}</p>
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button
              onClick={handleSaveContractTemplate}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              שמור
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsEditingContractTemplate(false)}
              className="border-gray-700 text-gray-300"
            >
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog פרטי ההפקה */}
      <Dialog open={isEditingQuestionnaireTemplate} onOpenChange={setIsEditingQuestionnaireTemplate}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md max-h-[80vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">פרטי האירוע</DialogTitle>
          </DialogHeader>

          <div className="space-y-6 text-sm">
            {/* פרטי האירוע */}
            <div className="space-y-2">
              <h4 className="text-gray-300 font-semibold text-xs uppercase">פרטי האירוע:</h4>
              {coupleNames && (
                <div className="flex justify-between text-gray-200">
                  <span className="text-gray-400">שמות הזוג:</span>
                  <span>{coupleNames}</span>
                </div>
              )}
              {eventDate && (
                <div className="flex justify-between text-gray-200">
                  <span className="text-gray-400">תאריך:</span>
                  <span>{format(new Date(eventDate), 'd.M.yyyy')}</span>
                </div>
              )}
              {venue && (
                <div className="flex justify-between text-gray-200">
                  <span className="text-gray-400">אולם:</span>
                  <span>{venue}</span>
                </div>
              )}
              {lead?.phoneNumber && (
                <div className="flex justify-between text-gray-200">
                  <span className="text-gray-400">טלפון:</span>
                  <span>{lead.phoneNumber}</span>
                </div>
              )}
            </div>

            {/* צוות הצילום */}
            {team && team.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-gray-300 font-semibold text-xs uppercase">צוות הצילום:</h4>
                {team.map((member, idx) => (
                  <div key={idx} className="text-gray-200 text-xs">
                    • {member.staffMemberName} ({member.role})
                  </div>
                ))}
              </div>
            )}

            {/* פרטי הפקה */}
            {(lead?.productionBridePhone || lead?.productionGroomPhone || lead?.productionBridePrepLocation || lead?.productionInstagram || lead?.productionSpecialRequests) && (
              <div className="space-y-2">
                <h4 className="text-gray-300 font-semibold text-xs uppercase">פרטי הפקה:</h4>
                {lead?.productionBridePhone && (
                  <div className="flex justify-between text-gray-200">
                    <span className="text-gray-400">נייד כלה:</span>
                    <span>{lead.productionBridePhone}</span>
                  </div>
                )}
                {lead?.productionGroomPhone && (
                  <div className="flex justify-between text-gray-200">
                    <span className="text-gray-400">נייד חתן:</span>
                    <span>{lead.productionGroomPhone}</span>
                  </div>
                )}
                {lead?.productionBridePrepLocation && (
                  <div className="flex justify-between text-gray-200">
                    <span className="text-gray-400">התארגנות כלה:</span>
                    <span>{lead.productionBridePrepLocation}</span>
                  </div>
                )}
                {lead?.productionInstagram && (
                  <div className="flex justify-between text-gray-200">
                    <span className="text-gray-400">אינסטגרם:</span>
                    <span>{lead.productionInstagram}</span>
                  </div>
                )}
                {lead?.productionSpecialRequests && (
                  <div className="text-gray-200">
                    <span className="text-gray-400">בקשות מיוחדות:</span>
                    <p className="mt-1 text-xs text-gray-300">{lead.productionSpecialRequests}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="mt-6">
            <Button
              variant="outline"
              onClick={() => setIsEditingQuestionnaireTemplate(false)}
              className="border-gray-700 text-gray-300 w-full"
            >
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <InvoiceDialog
        isOpen={invoiceDialogBusinessType !== null}
        onClose={() => setInvoiceDialogBusinessType(null)}
        businessType={invoiceDialogBusinessType || 'sole_prop'}
        coupleNames={coupleNames}
        eventDate={eventDate}
        venueName={venue}
        clientEmail={lead?.email}
        clientPhone={lead?.phoneNumber}
        leadId={lead?.id}
        remainingBalance={balance}
        onInvoiceCreated={() => {
          loadLeadInvoices();
          if (onLeadUpdated) onLeadUpdated();
        }}
      />

      {/* Dialog אישור ביטול אירוע */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-red-400">בטל את האירוע?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-gray-300">
              האם אתה בטוח שאתה רוצה לבטל את האירוע <span className="font-bold text-white">"{coupleNames}"</span>?
            </p>
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 text-sm text-red-200 space-y-1">
              <p className="font-semibold">הפעולה הבאה תבוצע:</p>
              <ul className="list-disc list-inside space-y-0.5 text-xs">
                <li>מחיקת האירוע</li>
                <li>עדכון הליד: status = "לא רלוונטי"</li>
                <li>ניקוי הקישור לאירוע</li>
                <li>הוספת הערה: "האירוע בוטל"</li>
              </ul>
            </div>
            <p className="text-xs text-gray-500">פעולה זו אטומית — הכל או כלום.</p>
          </div>
          <DialogFooter className="gap-2 flex-row-reverse">
            <Button
              variant="outline"
              onClick={() => setShowCancelConfirm(false)}
              disabled={isCancelingEvent}
              className="border-gray-700 text-gray-300"
            >
              ביטול
            </Button>
            <Button
              onClick={handleCancelEvent}
              disabled={isCancelingEvent}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isCancelingEvent ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  מבטל...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 ml-2" />
                  בטל אירוע
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}