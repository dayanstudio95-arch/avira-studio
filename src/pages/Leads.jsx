import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, X, Trash2, FileText, Receipt, Pencil, RefreshCw, Link, Banknote, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import LeadFormDialog from "../components/leads/LeadFormDialog";
import ManualPaymentModal from "../components/leads/ManualPaymentModal";
import LeadCSVImportDialog from "../components/leads/LeadCSVImportDialog";
import MobileMoreMenu from "../components/leads/MobileMoreMenu";
import LeadImageImportReviewDialog from "../components/leads/LeadImageImportReviewDialog";
import LeadContractDialog from "../components/leads/LeadContractDialog";
import FollowUpReminderDialog from "../components/leads/FollowUpReminderDialog";
import UnifiedSidePanel from "../components/unified/UnifiedSidePanel";
import InvoiceDialog from "../components/invoice/InvoiceDialog";
import { toast } from "sonner";

const packagePrices = {
  "חבילה 1": 9500,
  "חבילה 2": 13500,
  "חבילה 3": 15500,
  "חבילה 4": 11000,
};

const statusConfig = {
  "חדש":          { badge: "bg-blue-900/60 text-blue-300 border-blue-700",    card: "bg-blue-950/80 border-blue-800",   num: "text-blue-300" },
  "נשלחה הצעה":  { badge: "bg-yellow-900/60 text-yellow-300 border-yellow-700", card: "bg-yellow-950/80 border-yellow-800", num: "text-yellow-300" },
  "פולו-אפ":      { badge: "bg-orange-900/60 text-orange-300 border-orange-700", card: "bg-orange-950/80 border-orange-800",  num: "text-orange-300" },
  "נסגר/חתימה":  { badge: "bg-green-900/60 text-green-300 border-green-700",  card: "bg-green-950/80 border-green-800",   num: "text-green-300" },
  "חוזה":       { badge: "bg-yellow-900/60 text-yellow-300 border-yellow-700", card: "bg-yellow-950/80 border-yellow-800", num: "text-yellow-300" },
  "לא רלוונטי":  { badge: "bg-gray-800/60 text-gray-400 border-gray-600",     card: "bg-gray-900/80 border-gray-700",     num: "text-gray-400" },
};

export default function Leads() {
  const [leads, setLeads] = useState([]);
  const [events, setEvents] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState(null);
  const [convertingId, setConvertingId] = useState(null);
  const [contractLead, setContractLead] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [invoiceLead, setInvoiceLead] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [statusFilter, setStatusFilter] = useState(null);
  const [showDormant, setShowDormant] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [manualPaymentLead, setManualPaymentLead] = useState(null);
  const [isCSVImportOpen, setIsCSVImportOpen] = useState(false);
  const [isImageImportOpen, setIsImageImportOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('leads_sort') || 'event_asc');
  const [quickFilter, setQuickFilter] = useState('all');
  const [duplicates, setDuplicates] = useState([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [bulkStatusDialogOpen, setBulkStatusDialogOpen] = useState(false);
  const [followUpDialogOpen, setFollowUpDialogOpen] = useState(false);

  const [selectedBulkStatus, setSelectedBulkStatus] = useState(null);

  // CHANGED: was hardcoded to a domain nothing is actually hosted on, so every copied
  // link 404'd. window.location.origin always points at wherever the app is running.
  const getContractLink = (leadId) => `${window.location.origin}/contract/${leadId}`;

  const safeFormat = (dateStr, fmt) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? '—' : format(d, fmt);
  };

  const handleCopyLink = async (lead) => {
    navigator.clipboard.writeText(getContractLink(lead.id));
    setCopiedId(lead.id);
    setTimeout(() => setCopiedId(null), 2000);
    if (!lead.contractSent) {
      await base44.entities.Lead.update(lead.id, { contractSent: true });
      loadLeads();
    }
  };

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // New (2026-08-13): opportunistically auto-flip any lead stuck in "נשלחה הצעה"
      // (contract sent, unsigned) for 48h+ to "פולו-אפ" before loading the list, so the
      // status shown always reflects the 48h rule without needing cron infrastructure
      // (see sync-lead-followups edge function for why this runs here instead of on a
      // schedule). Best-effort — a failure here must never block the page from loading.
      try { await base44.functions.invoke('syncLeadFollowups', {}); } catch (syncErr) { console.error('syncLeadFollowups failed:', syncErr); }

      const [leadsData, eventsData, staffData] = await Promise.all([
        base44.entities.Lead.list("-created_date"),
        base44.entities.Event.list(),
        base44.entities.StaffMember.list()
      ]);
      setLeads(leadsData);
      setEvents(eventsData);
      setStaffMembers(staffData);
    } catch (error) {
      console.error("Error loading data:", error);
    }
    setIsLoading(false);
  };

  const loadLeads = () => loadData();

  const handleAssignStudioIds = async () => {
    try {
      toast.info('מבצע שיוך מספרי ID...');
      const res = await base44.functions.invoke('assignStudioIds', {});
      toast.success(`שויכו ${res.data?.assigned || 0} רשומות`);
      loadData();
    } catch (e) {
      toast.error('שגיאה בשיוך IDs');
    }
  };

  const handleSyncAllSigned = async () => {
    try {
      setConvertingId('sync');
      const response = await base44.functions.invoke('syncAllSignedLeads', {});
      const { created = 0, linked = 0, alreadyLinked = 0 } = response.data || {};
      toast.success(`סונכרנו בהצלחה: ${created} חדשים, ${linked} קושרו, ${alreadyLinked} כבר מקושרים`);
      loadLeads();
    } catch (error) {
      toast.error('שגיאה בסנכרון: ' + error.message);
    } finally {
      setConvertingId(null);
    }
  };


  const handleDeleteDuplicates = async () => {
    try {
      let deletedCount = 0;
      for (const dup of duplicates) {
        // שמור את האחרון (החדש ביותר), מחק את השאר
        for (let i = 1; i < dup.events.length; i++) {
          // Clean up Google Calendar BEFORE deleting the row — best-effort,
          // never blocks the actual deletion.
          try {
            await base44.functions.invoke('deleteEventFromCalendar', { eventId: dup.events[i].id });
          } catch (calendarErr) {
            console.error('Failed to clean up Google Calendar for event', dup.events[i].id, calendarErr);
          }
          await base44.entities.Event.delete(dup.events[i].id);
          deletedCount++;
        }
      }
      toast.success(`נמחקו ${deletedCount} אירועים כפולים`);
      setShowDuplicateDialog(false);
      setDuplicates([]);
      loadLeads();
    } catch (error) {
      toast.error('שגיאה במחיקת כפילויות: ' + error.message);
    }
  };

  const handleFixMissingEvents = async () => {
    try {
      setConvertingId('fix');
      const response = await base44.functions.invoke('fixMissingEventForLead', {});
      toast.success(response.message);
      loadLeads();
    } catch (error) {
      toast.error('שגיאה בתיקון: ' + error.message);
    } finally {
      setConvertingId(null);
    }
  };

  const handleStatusChange = async (lead, newStatus) => {
    try {
      setConvertingId(lead.id);
      await base44.entities.Lead.update(lead.id, { status: newStatus, lastContactDate: new Date().toISOString() });
      if (newStatus === "נסגר/חתימה") {
        await base44.functions.invoke('syncLeadToEvent', { leadId: lead.id });
        toast.success("הסטטוס עודכן — סינכרון לאירוע בוצע בהצלחה 🎉");
      } else {
        toast.success("הסטטוס עודכן בהצלחה");
      }
      loadLeads();
    } catch (error) {
      console.error('Error in handleStatusChange:', error);
      toast.error("שגיאה בעדכון");
    } finally {
      setConvertingId(null);
    }
  };

  const handleDelete = async (leadId) => {
    if (!confirm('האם למחוק ליד זה?')) return;
    try {
      await base44.entities.Lead.delete(leadId);
      loadLeads();
    } catch (error) {
      toast.error('שגיאה במחיקה');
    }
  };

  // Deprecated - kept for backwards compat
  // const handleDelete_old = async (leadId) => {

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`האם למחוק ${selectedIds.size} לידים מסומנים?`)) return;
    try {
      await Promise.all([...selectedIds].map(id => base44.entities.Lead.delete(id)));
      setSelectedIds(new Set());
      toast.success(`נמחקו ${selectedIds.size} לידים`);
      loadLeads();
    } catch (error) {
      toast.error('שגיאה במחיקה');
    }
  };

  const handleBulkDeposit = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`עדכן מקדמה ₪500 עבור ${selectedIds.size} לידים?`)) return;
    try {
      setConvertingId('deposit');
      const selectedLeads = leads.filter(l => selectedIds.has(l.id));
      await Promise.all(selectedLeads.map(lead =>
        base44.entities.Lead.update(lead.id, {
          manualPayment: 500,
          totalPaid: 500,
          remainingBalance: (lead.finalPrice || 0) - 500,
          depositInvoiceIssued: true,
        })
      ));
      toast.success(`עודכנה מקדמה ₪500 ל-${selectedIds.size} לידים`);
      setSelectedIds(new Set());
      await loadData();
    } catch (error) {
      toast.error('שגיאה בעדכון מקדמה');
    } finally {
      setConvertingId(null);
    }
  };

  const handleBulkStatusChange = async (newStatus) => {
    if (selectedIds.size === 0) return;
    if (!selectedBulkStatus) return;
    try {
      setConvertingId('bulk');
      const leadIds = [...selectedIds];
      await Promise.all(
        leadIds.map(id => 
          base44.entities.Lead.update(id, { status: newStatus, lastContactDate: new Date().toISOString() })
        )
      );
      if (newStatus === "נסגר/חתימה") {
        await Promise.all(
          leadIds.map(id => base44.functions.invoke('syncLeadToEvent', { leadId: id }))
        );
      }
      toast.success(`שונו ${selectedIds.size} לידים לסטטוס "${newStatus}"`);
      setSelectedIds(new Set());
      setBulkStatusDialogOpen(false);
      setSelectedBulkStatus(null);
      loadLeads();
    } catch (error) {
      console.error('Error in handleBulkStatusChange:', error);
      toast.error('שגיאה בשינוי סטטוס');
    } finally {
      setConvertingId(null);
    }
  };

  const handleBulkSync = async () => {
    const signedLeads = leads.filter(l => selectedIds.has(l.id) && l.status === 'נסגר/חתימה');
    if (signedLeads.length === 0) {
      toast.error('אין לידים מסומנים בסטטוס נסגר/חתימה לסנכרון');
      return;
    }
    try {
      setConvertingId('sync');
      await Promise.all(signedLeads.map(l => base44.functions.invoke('syncLeadToEvent', { leadId: l.id })));
      toast.success(`סונכרנו ${signedLeads.length} לידים לאירועים בהצלחה`);
      setSelectedIds(new Set());
      loadLeads();
    } catch (error) {
      toast.error('שגיאה בסנכרון: ' + error.message);
    } finally {
      setConvertingId(null);
    }
  };

  // Deprecated - kept for backwards compat
  // const handleBulkDelete_old = async () => {

  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map(l => l.id)));
    }
  };

  const STATUS_ORDER = ['נסגר/חתימה', 'פולו-אפ', 'נשלחה הצעה', 'חדש', 'לא רלוונטי'];
  const DORMANT_HOURS = 48;
  const filteredLeads = leads.filter((lead) => {
    if (searchTerm.trim()) {
      const match = lead.coupleNames?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        lead.phoneNumber?.includes(searchTerm);
      if (!match) return false;
    }
    if (statusFilter && lead.status !== statusFilter) return false;
    if (showDormant) {
      if (lead.status === 'נסגר/חתימה' || lead.status === 'לא רלוונטי') return false;
      const lastContact = lead.lastContactDate || lead.updated_date || lead.created_date;
      if (!lastContact) return true;
      const hours = (Date.now() - new Date(lastContact).getTime()) / 36e5;
      if (hours < DORMANT_HOURS) return false;
    }
    if (quickFilter === 'no_event') {
      const hasEvent = events.some(e => e.sourceLeadId === lead.id || e.leadId === lead.id);
      if (hasEvent) return false;
    }
    if (quickFilter === 'no_contact_48h') {
      if (lead.status === 'נסגר/חתימה' || lead.status === 'לא רלוונטי') return false;
      const lastContact = lead.lastContactDate || lead.updated_date || lead.created_date;
      if (!lastContact) return true;
      const hours = (Date.now() - new Date(lastContact).getTime()) / 36e5;
      if (hours < 48) return false;
    }
    return true;
  }).sort((a, b) => {
    if (sortOrder === 'event_asc') {
      const da = a.eventDate ? new Date(a.eventDate).getTime() : Infinity;
      const db = b.eventDate ? new Date(b.eventDate).getTime() : Infinity;
      return da - db;
    }
    if (sortOrder === 'event_desc') {
      const da = a.eventDate ? new Date(a.eventDate).getTime() : -Infinity;
      const db = b.eventDate ? new Date(b.eventDate).getTime() : -Infinity;
      return db - da;
    }
    if (sortOrder === 'created_new') {
      return new Date(b.created_date).getTime() - new Date(a.created_date).getTime();
    }
    if (sortOrder === 'created_old') {
      return new Date(a.created_date).getTime() - new Date(b.created_date).getTime();
    }
    if (sortOrder === 'amount_high') {
      return (b.finalPrice || 0) - (a.finalPrice || 0);
    }
    if (sortOrder === 'amount_low') {
      return (a.finalPrice || 0) - (b.finalPrice || 0);
    }
    if (sortOrder === 'venue_az') {
      return (a.venueName || '').localeCompare(b.venueName || '', 'he');
    }
    if (sortOrder === 'status_order') {
      return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    }
    return 0;
  });

  const statOrder = ["חדש", "נשלחה הצעה", "פולו-אפ", "נסגר/חתימה", "חוזה", "לא רלוונטי"];

  return (
    <div className="min-h-screen bg-gray-950 p-4 md:p-6" dir="rtl">
      <div className="max-w-[1600px] mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white">לידים - CRM</h1>
            <p className="text-gray-400 text-sm mt-1">ניהול לידים ולקוחות פוטנציאליים</p>
          </div>

          {/* Desktop buttons — unchanged */}
          <div className="hidden md:flex gap-3 items-center">
           {selectedIds.size > 0 && (
           <>
             <Button onClick={() => setBulkStatusDialogOpen(true)} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-lg">
               🔄 שנה סטטוס {selectedIds.size}
             </Button>
             <Button onClick={handleBulkSync} disabled={convertingId === 'sync'} className="bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg">
               🔗 סנכרן לאירועים
             </Button>
             <Button onClick={handleBulkDeposit} disabled={convertingId === 'bulk'} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-lg">
               💰 מקדמה ₪500
             </Button>
             <Button onClick={handleBulkDelete} className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg">
               <Trash2 className="w-4 h-4 ml-1" />מחק {selectedIds.size} מסומנים
             </Button>
           </>
           )}
            <Button onClick={() => setFollowUpDialogOpen(true)} variant="outline" className="border-orange-500 text-orange-300 bg-transparent hover:bg-orange-600/10 px-4 py-2 rounded-lg font-medium">📨 תזכורת פולו-אפ</Button>
            <Button onClick={handleAssignStudioIds} variant="outline" className="border-purple-500 text-purple-300 bg-transparent hover:bg-purple-600/10 px-4 py-2 rounded-lg font-medium">🔢 שייך IDs</Button>
            <Button onClick={handleFixMissingEvents} disabled={convertingId === 'fix'} variant="outline" className="border-red-500 text-red-300 bg-transparent hover:bg-red-600/10 px-4 py-2 rounded-lg font-medium">🔧 תיקון חסרים</Button>
            <Button onClick={() => setIsCSVImportOpen(true)} variant="outline" className="border-gray-600 text-gray-300 bg-transparent hover:bg-gray-700 px-4 py-2 rounded-lg font-medium">📂 ייבוא CSV</Button>
            <Button onClick={() => { setEditingLead(null); setIsFormOpen(true); }} className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold px-5 py-2 rounded-lg shadow-lg">
              <Plus className="w-5 h-5 ml-1" />ליד חדש +
            </Button>
          </div>

          {/* Mobile buttons — "ליד חדש" + collapsible "more" menu */}
          <div className="md:hidden flex items-center gap-2 w-full">
            <Button
              onClick={() => { setEditingLead(null); setIsFormOpen(true); }}
              className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold px-4 py-2 rounded-lg shadow-lg flex-1"
            >
              <Plus className="w-4 h-4 ml-1" />ליד חדש +
            </Button>
            <MobileMoreMenu
              selectedIds={selectedIds}
              convertingId={convertingId}
              onBulkStatus={() => setBulkStatusDialogOpen(true)}
              onBulkSync={handleBulkSync}
              onBulkDeposit={handleBulkDeposit}
              onBulkDelete={handleBulkDelete}
              onAssignIds={handleAssignStudioIds}
              onFixMissing={handleFixMissingEvents}
              onCSVImport={() => setIsCSVImportOpen(true)}
              onFollowUpReminder={() => setFollowUpDialogOpen(true)}
            />
          </div>
        </div>

        {/* Stat Cards */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 mb-6">
          {statOrder.map((status) => {
            const count = leads.filter((l) => l.status === status).length;
            const cfg = statusConfig[status];
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                onClick={() => setStatusFilter(isActive ? null : status)}
                className={`rounded-xl border p-2 md:p-4 text-center transition-all cursor-pointer ${cfg.card} ${isActive ? "ring-2 ring-white/30 scale-105" : "opacity-90 hover:opacity-100"}`}
              >
                <div className={`text-xl md:text-3xl font-bold ${cfg.num}`}>{count}</div>
                <div className="text-[10px] md:text-xs text-gray-300 mt-0.5 md:mt-1 font-medium leading-tight">{status}</div>
              </button>
            );
          })}
        </div>

        {/* Dormant filter bar */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => setShowDormant(!showDormant)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
              showDormant
                ? 'bg-red-500/20 border-red-500 text-red-300'
                : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200'
            }`}
          >
            🔴 {showDormant ? `רדומים (${filteredLeads.length})` : 'הצג רדומים (+48 שעות)'}
          </button>
          {showDormant && (
            <span className="text-xs text-gray-500">לידים שלא עודכנו ביותר מ-48 שעות (ללא סגורים)</span>
          )}
        </div>

        {/* Quick Filters */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {[
            { key: 'all', label: 'הכל' },
            { key: 'no_event', label: 'ללא Event מקושר' },
            { key: 'no_contact_48h', label: 'ללא קשר 48 שעות' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setQuickFilter(f.key)}
              className={`px-3 py-1 rounded-lg border text-xs font-medium transition-all ${
                quickFilter === f.key
                  ? 'bg-yellow-400/20 border-yellow-400 text-yellow-300'
                  : 'bg-gray-800 border-gray-600 text-gray-400 hover:text-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Sort + Search — stacked on mobile, inline on desktop */}
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 whitespace-nowrap">מיון:</span>
            <select
              value={sortOrder}
              onChange={e => { setSortOrder(e.target.value); localStorage.setItem('leads_sort', e.target.value); }}
              className="text-xs bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 cursor-pointer w-full md:w-auto"
            >
              <option value="event_asc">תאריך אירוע – מהקרוב לרחוק</option>
              <option value="event_desc">תאריך אירוע – מהרחוק לקרוב</option>
              <option value="created_new">תאריך יצירת ליד – חדש לישן</option>
              <option value="created_old">תאריך יצירת ליד – ישן לחדש</option>
              <option value="amount_high">סכום – גבוה לנמוך</option>
              <option value="amount_low">סכום – נמוך לגבוה</option>
              <option value="venue_az">אולם – א׳ עד ת׳</option>
              <option value="status_order">סטטוס – לפי סדר עדיפות</option>
            </select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="חיפוש לפי שם או טלפון..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10 bg-gray-900 border-gray-700 text-white placeholder-gray-500 rounded-lg w-full md:w-1/2"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800/80 text-gray-400 text-xs border-b border-gray-700">
                  <th className="text-center px-2 py-3 w-8">
                   <input type="checkbox" checked={filteredLeads.length > 0 && selectedIds.size === filteredLeads.length} onChange={toggleSelectAll} className="cursor-pointer" />
                 </th>
                  <th className="text-center px-2 py-3 font-semibold w-10">#</th>
                  <th className="text-center px-2 py-3 font-semibold">תאריך אירוע</th>
                  <th className="text-right px-3 py-3 font-semibold">שמות הזוג</th>
                  <th className="text-center px-2 py-3 font-semibold">טלפון</th>
                  <th className="text-center px-2 py-3 font-semibold">אולם</th>
                  <th className="text-center px-2 py-3 font-semibold">חבילה</th>
                  <th className="text-center px-2 py-3 font-semibold">סכום סופי</th>
                  <th className="text-center px-2 py-3 font-semibold">סטטוס</th>
                  <th className="text-center px-2 py-3 font-semibold">חוזה</th>
                  <th className="text-center px-2 py-3 font-semibold">שולם</th>
                  <th className="text-center px-2 py-3 font-semibold">יתרה</th>
                  <th className="text-center px-2 py-3 font-semibold">מקדמה</th>
                  <th className="text-center px-2 py-3 font-semibold">יומן</th>
                  <th className="text-center px-2 py-3 font-semibold">פנייה</th>
                  <th className="text-center px-2 py-3 font-semibold">לינק</th>
                  <th className="text-center px-2 py-3 font-semibold">פעולות</th>
                  <th className="text-center px-2 py-3 font-semibold">תאריך יצירה</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={18} className="text-center py-12 text-gray-500">טוען...</td></tr>
                ) : filteredLeads.length === 0 ? (
                  <tr><td colSpan={18} className="text-center py-12 text-gray-500">אין לידים</td></tr>
                ) : (
                  filteredLeads.map((lead) => {
                    const balance = (lead.finalPrice || 0) - (lead.totalPaid || 0);
                    const waLink = lead.phoneNumber ? `https://wa.me/972${lead.phoneNumber.replace(/^0/, "").replace(/\D/g, "")}` : null;
                    const cfg = statusConfig[lead.status || "חדש"];
                    return (
                     <tr key={lead.id} className={`border-b border-gray-800 hover:bg-gray-800/40 transition-colors ${selectedIds.has(lead.id) ? 'bg-red-900/10' : ''}`}>
                       <td className="px-2 py-2 text-center">
                         <input type="checkbox" checked={selectedIds.has(lead.id)} onChange={() => toggleSelect(lead.id)} className="cursor-pointer" />
                       </td>
                        <td className="px-2 py-2 text-center text-gray-500 font-mono text-xs font-semibold">
                          {lead.studio_id || '—'}
                        </td>
                        <td className="px-2 py-2 text-gray-300 text-center whitespace-nowrap">
                          {safeFormat(lead.eventDate, "d/M/yy")}
                        </td>
                        <td className="px-3 py-2">
                          <button onClick={() => setSelectedLead(lead)} className="text-blue-400 hover:text-blue-300 font-semibold underline text-right block">
                            {lead.coupleNames}
                          </button>
                        </td>
                        <td className="px-2 py-2 text-gray-300 text-center whitespace-nowrap">{lead.phoneNumber || "—"}</td>
                        <td className="px-2 py-2 text-gray-300 text-center max-w-[90px] truncate">{lead.venueName || "—"}</td>
                        <td className="px-2 py-2 text-gray-300 text-center whitespace-nowrap">{lead.packageChoice || "—"}</td>
                        <td className="px-2 py-2 text-center text-white font-semibold whitespace-nowrap">
                          {lead.finalPrice ? `₪${lead.finalPrice.toLocaleString()}` : "—"}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <select
                            value={lead.status || "חדש"}
                            onChange={(e) => handleStatusChange(lead, e.target.value)}
                            disabled={convertingId !== null}
                            className={`text-xs border rounded-full px-2 py-0.5 bg-transparent cursor-pointer ${cfg.badge} ${convertingId ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            {Object.keys(statusConfig).map((s) => (
                              <option key={s} value={s} className="bg-gray-900 text-white">{s}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-center">
                          {lead.signedAt ? <span title="נחתם" className="text-green-400">✅</span>
                            : lead.contractSent ? <span title="נשלח" className="text-blue-400">📨</span>
                            : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center font-semibold whitespace-nowrap">
                          {lead.totalPaid ? (
                            <span>
                              <span className="text-green-400">₪{lead.totalPaid.toLocaleString()}</span>
                              {lead.manualPayment > 0 && (
                                <span className="text-blue-400 text-xs block">(+₪{lead.manualPayment.toLocaleString()} ידני)</span>
                              )}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-2 py-2 text-center font-semibold whitespace-nowrap">
                          {balance === 0 ? <span className="text-green-400">✅</span> : <span className="text-red-400">₪{balance.toLocaleString()}</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {lead.depositInvoiceIssued ? <span className="text-green-400">✅</span> : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {lead.googleCalendarStatus?.includes("הצליח") ? <span title={lead.googleCalendarStatus} className="text-green-400">📅</span> : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          {waLink ? <a href={waLink} target="_blank" rel="noopener noreferrer" title="שלח וואטסאפ" className="text-green-400 hover:text-green-300">💬</a> : <span className="text-gray-600">—</span>}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <button onClick={() => handleCopyLink(lead)} title={copiedId === lead.id ? "הועתק!" : "העתק לינק חוזה"} className={`transition-colors ${copiedId === lead.id ? "text-green-400" : "text-gray-400 hover:text-blue-400"}`}>
                            <Link className="w-3.5 h-3.5" />
                          </button>
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => { setEditingLead(lead); setIsFormOpen(true); }} title="עריכה" className="p-1 rounded text-gray-400 hover:bg-gray-700 hover:text-white transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setContractLead(lead)} title="חוזה" className="p-1 rounded text-blue-400 hover:bg-blue-500/10 transition-colors">
                              <FileText className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setInvoiceLead(lead)} title="הפק חשבונית" className="p-1 rounded text-emerald-400 hover:bg-emerald-500/10 transition-colors">
                              <Receipt className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setManualPaymentLead(lead)} title="עדכון תשלום ידני" className="p-1 rounded text-blue-400 hover:bg-blue-500/10 transition-colors">
                              <Banknote className="w-3.5 h-3.5" />
                            </button>

                            <button onClick={() => handleDelete(lead.id)} title="מחיקה" className="p-1 rounded text-red-400 hover:bg-red-500/10 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          </td>
                          <td className="px-2 py-2 text-gray-300 text-center whitespace-nowrap">
                          {safeFormat(lead.created_date, "d/M/yy")}
                          </td>
                          </tr>
                          );
                          })
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden p-4 space-y-4">
            {isLoading ? (
              <p className="text-center text-gray-500">טוען...</p>
            ) : filteredLeads.length === 0 ? (
              <p className="text-center text-gray-500 py-8">אין לידים עדיין</p>
            ) : (
              filteredLeads.map((lead) => {
                const balance = (lead.finalPrice || 0) - (lead.totalPaid || 0);
                const cfg = statusConfig[lead.status || "חדש"];
                return (
                  <div key={lead.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <button onClick={() => setSelectedLead(lead)} className="font-bold text-blue-400 text-lg hover:text-blue-300 underline">
                          {lead.studio_id ? <span className="text-gray-500 font-normal ml-1">[{lead.studio_id}]</span> : ''}{lead.coupleNames}
                         </button>
                        <div className="text-gray-400 text-sm">{lead.phoneNumber}</div>
                      </div>
                      <select
                        value={lead.status || "חדש"}
                        onChange={(e) => handleStatusChange(lead, e.target.value)}
                        disabled={convertingId !== null}
                        className={`text-xs border rounded-full px-2 py-0.5 bg-transparent cursor-pointer ${cfg.badge} ${convertingId ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {Object.keys(statusConfig).map((s) => (
                          <option key={s} value={s} className="bg-gray-900 text-white">{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div><span className="text-gray-400">תאריך: </span><span className="text-white">{safeFormat(lead.eventDate, "d/M/yyyy")}</span></div>
                      <div><span className="text-gray-400">חבילה: </span><span className="text-white">{lead.packageChoice || "—"}</span></div>
                      <div><span className="text-gray-400">סכום: </span><span className="text-white">₪{(lead.finalPrice || 0).toLocaleString()}</span></div>
                      <div><span className="text-gray-400">יתרה: </span><span className={balance === 0 ? "text-green-400" : "text-red-400"}>₪{balance.toLocaleString()}</span></div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" onClick={() => { setEditingLead(lead); setIsFormOpen(true); }} className="border-gray-700 text-gray-300 bg-transparent border text-xs">עריכה</Button>
                      <Button size="sm" onClick={() => setContractLead(lead)} className="text-blue-400 bg-transparent border border-blue-700 text-xs">חוזה</Button>
                      <Button size="sm" onClick={() => setInvoiceLead(lead)} className="text-emerald-400 bg-transparent border border-emerald-700 text-xs">חשבונית</Button>
                      <Button size="sm" onClick={() => handleDelete(lead.id)} className="text-red-400 bg-transparent border border-red-800 text-xs"><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <LeadFormDialog
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        lead={editingLead}
        packagePrices={packagePrices}
        onSaved={() => { setIsFormOpen(false); loadLeads(); }}
      />
      <LeadContractDialog
        isOpen={!!contractLead}
        onClose={() => setContractLead(null)}
        lead={contractLead}
        onSigned={() => { setContractLead(null); loadLeads(); }}
      />
      <InvoiceDialog
        isOpen={!!invoiceLead}
        onClose={() => setInvoiceLead(null)}
        coupleNames={invoiceLead?.coupleNames}
        eventDate={invoiceLead?.eventDate}
        venueName={invoiceLead?.venueName}
        clientEmail={invoiceLead?.email}
        clientPhone={invoiceLead?.phoneNumber}
        leadId={invoiceLead?.id}
        onInvoiceCreated={() => { setInvoiceLead(null); loadLeads(); }}
      />
      <ManualPaymentModal
        isOpen={!!manualPaymentLead}
        onClose={() => setManualPaymentLead(null)}
        lead={manualPaymentLead}
        onSaved={() => { setManualPaymentLead(null); loadLeads(); }}
      />
      <LeadImageImportReviewDialog
        isOpen={isImageImportOpen}
        onClose={() => setIsImageImportOpen(false)}
        onSuccess={loadLeads}
      />
      <LeadCSVImportDialog
        isOpen={isCSVImportOpen}
        onClose={() => setIsCSVImportOpen(false)}
        onSuccess={loadLeads}
      />

      {/* Duplicate Dialog */}
      {showDuplicateDialog && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl max-h-[80vh] overflow-auto p-6 space-y-4">
            <h2 className="text-xl font-bold text-yellow-400">⚠️ נמצאו {duplicates.length} קבוצות כפילויות</h2>
            <div className="space-y-3 max-h-[50vh] overflow-y-auto">
              {duplicates.map((dup, idx) => (
                <div key={idx} className="bg-gray-800/50 border border-yellow-700/30 rounded-lg p-3 space-y-2">
                  <div className="text-sm font-semibold text-gray-300">
                    {dup.type === 'source_lead_id' ? '🔗 ליד:' : '🔢 Studio ID:'} {dup.key}
                  </div>
                  <div className="space-y-1">
                    {dup.events.map((evt, i) => (
                      <div key={evt.id} className="text-xs text-gray-400 flex items-center gap-2">
                        {i === 0 && <span className="bg-green-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">שמור</span>}
                        {i > 0 && <span className="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">מחק</span>}
                        <span>{evt.coupleNames || '—'} | {evt.date || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-4 border-t border-gray-700">
              <button onClick={() => { setShowDuplicateDialog(false); setDuplicates([]); }} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium">ביטול</button>
              <button onClick={handleDeleteDuplicates} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium font-bold">מחק כפילויות ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Status Change Dialog */}
      {bulkStatusDialogOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
          <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-md p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">שינוי סטטוס לכל המסומנים</h2>
            <p className="text-sm text-gray-400">בחר סטטוס חדש עבור {selectedIds.size} לידים</p>
            <div className="space-y-2">
              {Object.keys(statusConfig).map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setSelectedBulkStatus(status);
                  }}
                  className={`w-full px-4 py-3 rounded-lg border text-left font-medium transition-all ${
                    selectedBulkStatus === status
                      ? 'bg-yellow-500/20 border-yellow-500 text-yellow-400'
                      : `${statusConfig[status].badge} border hover:opacity-80`
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
            <div className="flex gap-2 pt-4 border-t border-gray-700">
              <button
                onClick={() => {
                  setBulkStatusDialogOpen(false);
                  setSelectedBulkStatus(null);
                }}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium"
              >
                ביטול
              </button>
              <button
                onClick={() => handleBulkStatusChange(selectedBulkStatus)}
                disabled={!selectedBulkStatus || convertingId === 'bulk'}
                className="flex-1 px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-gray-900 rounded-lg font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {convertingId === 'bulk' ? 'שומר...' : 'עדכן'}
              </button>
            </div>
          </div>
        </div>
      )}

      <UnifiedSidePanel
        isOpen={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        lead={selectedLead}
        event={selectedLead?.id ? events.find(e => e.sourceLeadId === selectedLead.id || e.leadId === selectedLead.id) : null}
        staffMembers={staffMembers}
        onLeadUpdated={loadLeads}
        onEventUpdated={loadLeads}
      />

      <FollowUpReminderDialog
        isOpen={followUpDialogOpen}
        onClose={() => setFollowUpDialogOpen(false)}
        leads={leads}
        onSent={loadLeads}
      />
    </div>
  );
}