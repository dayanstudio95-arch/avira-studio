import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X, CalendarDays, Upload, RefreshCw, Loader2, MoreHorizontal } from "lucide-react";
import { format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import EventsTableWithBulkDelete from "../components/events/EventsTableWithBulkDelete";
import CSVImportDialog from "../components/CSVImportDialog";
import EventsMobileMenu from "../components/events/EventsMobileMenu";

export default function Events() {
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('events_sort') || 'asc');
  const [duplicates, setDuplicates] = useState([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showQuestionnaireModal, setShowQuestionnaireModal] = useState(false);
  const [questionnaireLoading, setQuestionnaireLoading] = useState(false);
  const [questionnaireSent, setQuestionnaireSent] = useState(0);
  const [questionnaireTemplate, setQuestionnaireTemplate] = useState('');
  const [checkedEvents, setCheckedEvents] = useState(new Set());
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [selectedQuestionnaireMonth, setSelectedQuestionnaireMonth] = useState(0);

  // Check for filter parameter
  const urlParams = new URLSearchParams(window.location.search);
  const filterParam = urlParams.get('filter');

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const data = await base44.entities.Event.list("-date");
      setEvents(data);
    } catch (error) {
      console.error("Error loading events:", error);
    }
    setIsLoading(false);
  };

  const handleDetectAndDeleteDuplicates = async () => {
    try {
      setIsSyncing(true);
      
      // טען נתונים טריים לפני הבדיקה
      const freshEvents = await base44.entities.Event.list();
      
      // פונקציה לחלץ את כל הkeys האפשריים לאירוע
      const getEventKeys = (event) => {
        const keys = [];
        if (event.sourceLeadId) keys.push(`source:${event.sourceLeadId}`);
        if (event.leadId) keys.push(`leadId:${event.leadId}`);
        if (event.studioId && event.studioId > 0) keys.push(`studio:${event.studioId}`);
        if (event.coupleNames && event.date) keys.push(`couple:${event.coupleNames}|${event.date}`);
        return keys;
      };
      
      // זיהוי כפילויות - בדיקה על כל הקריטריונים בו זמנית
      const duplicationMap = new Map();
      const processedEvents = new Set();
      const foundDuplicates = [];
      
      freshEvents.forEach(event => {
        const keys = getEventKeys(event);
        keys.forEach(key => {
          if (!duplicationMap.has(key)) {
            duplicationMap.set(key, new Set());
          }
          duplicationMap.get(key).add(event.id);
        });
      });
      
      // בדוק כל key - אם יש מ-1 אירוע, הם כפולים
      duplicationMap.forEach((eventIds, key) => {
        if (eventIds.size > 1) {
          const events = freshEvents.filter(e => eventIds.has(e.id));
          if (events.length > 1) {
            // עדיין לא עבדנו קבוצה זו
            const groupKey = Array.from(eventIds).sort().join('|');
            if (!processedEvents.has(groupKey)) {
              processedEvents.add(groupKey);
              const [type, value] = key.split(':');
              foundDuplicates.push({
                key: value,
                type,
                events: events.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
              });
            }
          }
        }
      });
      
      if (foundDuplicates.length > 0) {
        setDuplicates(foundDuplicates);
        setShowDuplicateDialog(true);
      } else {
        // No duplicates found
        alert('✅ לא נמצאו כפילויות באירועים');
      }
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      alert('שגיאה בזיהוי כפילויות');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteDuplicates = async () => {
    try {
      setIsSyncing(true);
      const res = await base44.functions.invoke('cleanupDuplicateEvents', {});
      const { message, deletedFromDatabase, deletedFromGoogle, googleFailed } = res.data || {};
      let fullMessage = message;
      if (googleFailed > 0) {
        fullMessage += `\n⚠️ ${googleFailed} אירועים לא נמחקו מיומן הגוגל - אנא בדוק את החיבור`;
      }
      alert(`✅ ${fullMessage}`);
      setShowDuplicateDialog(false);
      setDuplicates([]);
      loadEvents();
    } catch (error) {
      console.error('Error deleting duplicates:', error);
      alert('שגיאה במחיקת כפילויות: ' + error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  const getNextMonthEvents = (monthOffset = 1) => {
    const now = new Date();
    const targetDate = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const targetYYYYMM = `${targetDate.getFullYear()}-${String(targetDate.getMonth() + 1).padStart(2, '0')}`;
    return events.filter(e => e.date && e.date.startsWith(targetYYYYMM)).sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  const handleSendQuestionnaire = async () => {
    try {
      setQuestionnaireLoading(true);
      const DEFAULT_TEMPLATE = 'היי {coupleNames}, ההתרגשות בשיאה! 🥂\nלקראת האירוע שלכם, אנחנו רוצים לוודא שכל הפרטים מסונכרנים אצלנו במערכת. 📋\nנשמח אם תוכלו למלא את השאלון הקצר בקישור הבא כדי שנוכל לתת לכם את השירות הטוב ביותר ❤️\n{questionnaireUrl}\nתודה! אווירה צלמים 📸';
      
      const nextMonthEvents = getNextMonthEvents(1 + selectedQuestionnaireMonth);
      const targetDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1 + selectedQuestionnaireMonth, 1);
      const targetMonth = targetDate.getMonth() + 1;
      const targetYear = targetDate.getFullYear();
      const toSend = nextMonthEvents.filter(e => checkedEvents.has(e.id) && e.phoneNumber);
      
      if (toSend.length === 0) {
        alert('אין אירועים לשליחה');
        setQuestionnaireLoading(false);
        return;
      }

      const res = await base44.functions.invoke('sendQuestionnaireToEvents', {
        eventIds: toSend.map(e => e.id),
        month: targetMonth,
        year: targetYear,
        messageTemplate: questionnaireTemplate || DEFAULT_TEMPLATE,
        progressCallback: (progress) => setSendProgress(progress)
      });
      
      const sent = res.data?.sent || 0;
      alert(`✅ נשלחו ${sent} שאלונים בהצלחה!`);
      setShowQuestionnaireModal(false);
      setCheckedEvents(new Set());
      setSendProgress({ sent: 0, total: 0 });
      loadEvents();
    } catch (error) {
      console.error('Error sending questionnaire:', error);
      alert('שגיאה בשליחה: ' + error.message);
    } finally {
      setQuestionnaireLoading(false);
    }
  };

  const scrollToClosestEvent = () => {
    if (filteredEvents.length === 0) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let closest = null;
    let closestDiff = Infinity;
    filteredEvents.forEach(event => {
      const d = new Date(event?.date || 0);
      d.setHours(0, 0, 0, 0);
      const diff = d.getTime() - today.getTime();
      const absDiff = Math.abs(diff);
      if (closest === null) { closest = event; closestDiff = diff; return; }
      const prevIsFuture = closestDiff >= 0;
      const currIsFuture = diff >= 0;
      if (currIsFuture && !prevIsFuture) { closest = event; closestDiff = diff; return; }
      if (!currIsFuture && prevIsFuture) return;
      if (absDiff < Math.abs(closestDiff)) { closest = event; closestDiff = diff; }
    });
    if (!closest) return;
    // Both the mobile card list and the desktop table are always mounted at
    // once (visibility toggled with CSS classes like `md:hidden`/`hidden
    // md:block`, not conditional rendering) and both use the same
    // `event-row-{id}` id for their row/card. document.getElementById always
    // returns the FIRST matching element in DOM order regardless of which
    // one is actually visible — on desktop that's the hidden mobile card, so
    // scrollIntoView() was silently a no-op there. Query every element
    // sharing that id and scroll to whichever one actually has layout
    // (offsetParent is null for display:none elements), so this works
    // correctly on both mobile and desktop without touching the row markup.
    const candidates = document.querySelectorAll(`[id="event-row-${closest.id}"]`);
    const el = Array.from(candidates).find((node) => node.offsetParent !== null) || candidates[0];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Filter events based on search term, year, and filter parameter
  const filteredEvents = useMemo(() => {
    let filtered = events.filter(event => {
      const eventDate = new Date(event.date);
      return eventDate.getFullYear() === selectedYear;
    });
    
    if (filterParam === 'urgentStaffing') {
      const today = new Date();
      const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
      filtered = filtered.filter(event => {
        const eventDate = new Date(event.date);
        if (eventDate < today || eventDate > thirtyDaysFromNow) return false;
        const requiredCrew = event.requiredCrew || 3;
        const assignedTeam = (event.team || []).filter(m => m.staffMemberName);
        return assignedTeam.length < requiredCrew;
      });
    }
    
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(event => {
        const coupleMatch = event.coupleNames?.toLowerCase().includes(searchLower);
        const venueMatch = event.venue?.toLowerCase().includes(searchLower);
        const staffMatch = (event.team || []).some(m =>
          m.staffMemberName?.toLowerCase().includes(searchLower)
        );
        const eventDate = new Date(event.date);
        const formattedDate = format(eventDate, "d/M/yyyy");
        const dateMatch = formattedDate.includes(searchTerm) || 
                         format(eventDate, "dd/MM/yyyy").includes(searchTerm) ||
                         format(eventDate, "yyyy").includes(searchTerm) ||
                         format(eventDate, "M/yyyy").includes(searchTerm);
        return coupleMatch || venueMatch || staffMatch || dateMatch;
      });
    }

    filtered.sort((a, b) => {
      if (sortOrder === 'asc') return new Date(a.date) - new Date(b.date);
      if (sortOrder === 'desc') return new Date(b.date) - new Date(a.date);
      if (sortOrder === 'created_desc') return new Date(b.created_date) - new Date(a.created_date);
      if (sortOrder === 'created_asc') return new Date(a.created_date) - new Date(b.created_date);
      if (sortOrder === 'amount_desc') return (b.totalAmountGross || 0) - (a.totalAmountGross || 0);
      if (sortOrder === 'amount_asc') return (a.totalAmountGross || 0) - (b.totalAmountGross || 0);
      if (sortOrder === 'venue_asc') return (a.venue || '').localeCompare(b.venue || '', 'he');
      if (sortOrder === 'payment_status') {
        const order = { 'Unpaid': 0, 'Partially Paid': 1, 'Paid': 2 };
        return (order[a.clientPaymentStatus] ?? 0) - (order[b.clientPaymentStatus] ?? 0);
      }
      return 0;
    });

    return filtered;
  }, [events, searchTerm, selectedYear, filterParam, sortOrder]);

  return (
    <div className="min-h-screen bg-gray-950 p-3 md:p-5">
      <div className="w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
              {filterParam === 'urgentStaffing' ? 'אירועים עם חוסר צוות' : 'כל האירועים'}
            </h1>
            <p className="text-gray-400">
              {filterParam === 'urgentStaffing' 
                ? 'אירועים ב-30 הימים הקרובים שחסר להם צוות' 
                : 'ניהול ומעקב אחר כל האירועים שלך'}
            </p>
          </div>
          {/* Desktop buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Button
              onClick={() => {
                setSelectedQuestionnaireMonth(0);
                const nextMonth = getNextMonthEvents(1);
                setCheckedEvents(new Set(nextMonth.filter(e => e.phoneNumber).map(e => e.id)));
                setShowQuestionnaireModal(true);
              }}
              disabled={questionnaireLoading}
              variant="outline"
              className="border-purple-500 text-purple-300 bg-transparent hover:bg-purple-600/10 px-4 py-2 rounded-lg font-medium"
            >
              {questionnaireLoading ? <Loader2 className="w-4 h-4 ml-2 animate-spin" /> : <span>📋</span>}
              {questionnaireLoading ? 'שולח...' : 'שאלון הכנה'}
            </Button>
            <Button
              onClick={handleDetectAndDeleteDuplicates}
              disabled={isSyncing}
              variant="outline"
              className="border-red-500 text-red-300 bg-transparent hover:bg-red-600/10 px-4 py-2 rounded-lg font-medium"
            >
              <RefreshCw className={`w-4 h-4 ml-2 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'בודק...' : 'בדוק כפילויות'}
            </Button>
            <Button 
              onClick={() => setIsImportDialogOpen(true)}
              variant="outline"
              className="border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-yellow-400 hover:border-yellow-400"
            >
              <Upload className="w-5 h-5 mr-2" />
              ייבוא CSV
            </Button>
          </div>

          {/* Mobile buttons — "more" dropdown */}
          <div className="md:hidden flex items-center gap-2 w-full">
            <EventsMobileMenu
              questionnaireLoading={questionnaireLoading}
              isSyncing={isSyncing}
              onQuestionnaire={() => {
                setSelectedQuestionnaireMonth(0);
                const nextMonth = getNextMonthEvents(1);
                setCheckedEvents(new Set(nextMonth.filter(e => e.phoneNumber).map(e => e.id)));
                setShowQuestionnaireModal(true);
              }}
              onDuplicates={handleDetectAndDeleteDuplicates}
              onCSVImport={() => setIsImportDialogOpen(true)}
            />
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex flex-col md:flex-row gap-3 md:gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="חפש לפי שם הזוג, אולם, איש צוות או תאריך..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10 bg-gray-900/50 border-gray-700 text-white placeholder-gray-400 focus:border-yellow-400 focus:ring-yellow-400/20 w-full"
            />
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchTerm("")}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white p-1"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>

          {/* Year + Sort + Today — side by side on mobile, inline on desktop */}
          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="flex items-center gap-2 flex-shrink-0">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              <Select value={selectedYear.toString()} onValueChange={(val) => setSelectedYear(parseInt(val))}>
                <SelectTrigger className="w-24 md:w-32 bg-gray-900/50 border-gray-700 text-white text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  <SelectItem value="2025">2025</SelectItem>
                  <SelectItem value="2026">2026</SelectItem>
                  <SelectItem value="2027">2027</SelectItem>
                  <SelectItem value="2028">2028</SelectItem>
                  <SelectItem value="2029">2029</SelectItem>
                  <SelectItem value="2030">2030</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={sortOrder} onValueChange={v => { setSortOrder(v); localStorage.setItem('events_sort', v); }}>
              <SelectTrigger className="flex-1 md:w-56 bg-gray-900/50 border-gray-700 text-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                <SelectItem value="asc">תאריך – מהקרוב לרחוק</SelectItem>
                <SelectItem value="desc">תאריך – מהרחוק לקרוב</SelectItem>
                <SelectItem value="created_desc">יצירה – חדש לישן</SelectItem>
                <SelectItem value="created_asc">יצירה – ישן לחדש</SelectItem>
                <SelectItem value="amount_desc">סכום – גבוה לנמוך</SelectItem>
                <SelectItem value="amount_asc">סכום – נמוך לגבוה</SelectItem>
                <SelectItem value="venue_asc">אולם – א׳ עד ת׳</SelectItem>
                <SelectItem value="payment_status">סטטוס תשלום</SelectItem>
              </SelectContent>
            </Select>
            <button
              onClick={scrollToClosestEvent}
              className="flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg border border-yellow-500/60 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20 text-xs font-semibold transition-colors whitespace-nowrap"
              title="גלול לאירוע הקרוב ביותר להיום"
            >
              📍 היום
            </button>
          </div>
        </div>

        {searchTerm && (
          <p className="text-sm text-gray-400 mb-4">
            נמצאו {filteredEvents.length} תוצאות עבור "{searchTerm}"
          </p>
        )}

        {/* Events Table */}
        <EventsTableWithBulkDelete events={filteredEvents} isLoading={isLoading} onRefresh={loadEvents} />

        {/* CSV Import Dialog */}
        <CSVImportDialog 
          isOpen={isImportDialogOpen} 
          onClose={() => setIsImportDialogOpen(false)}
          onSuccess={loadEvents}
        />

        {/* Questionnaire Modal */}
        {showQuestionnaireModal && (() => {
          const nextMonthEvents = getNextMonthEvents(1 + selectedQuestionnaireMonth);
          const selectedCount = nextMonthEvents.filter(e => checkedEvents.has(e.id)).length;
          const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1 + selectedQuestionnaireMonth, 1);
          const monthName = monthDate.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
          
          return (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
              <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
                <div className="bg-gray-900/95 border-b border-gray-700 px-6 py-4 flex items-center justify-between rounded-t-xl">
                  <h2 className="text-xl font-bold text-purple-400">📋 שליחת שאלון הכנה</h2>
                  <button onClick={() => { setShowQuestionnaireModal(false); setSendProgress({ sent: 0, total: 0 }); }} disabled={questionnaireLoading} className="text-gray-400 hover:text-white p-2">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex items-center justify-between px-6 py-3 border-b border-gray-700 bg-gray-800/30">
                  <button
                    onClick={() => { const nm = selectedQuestionnaireMonth + 1; setSelectedQuestionnaireMonth(nm); setCheckedEvents(new Set(getNextMonthEvents(1 + nm).filter(e => e.phoneNumber).map(e => e.id))); }}
                    disabled={questionnaireLoading}
                    className="text-gray-300 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-40"
                  >◀</button>
                  <span className="text-white font-semibold">{monthName} — {nextMonthEvents.length} אירועים</span>
                  <button
                    onClick={() => { const nm = selectedQuestionnaireMonth - 1; setSelectedQuestionnaireMonth(nm); setCheckedEvents(new Set(getNextMonthEvents(1 + nm).filter(e => e.phoneNumber).map(e => e.id))); }}
                    disabled={questionnaireLoading}
                    className="text-gray-300 hover:text-white text-lg px-2 py-1 rounded hover:bg-gray-700 disabled:opacity-40"
                  >▶</button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                  {nextMonthEvents.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">אין אירועים בחודש הבא</p>
                  ) : (
                    nextMonthEvents.map(event => {
                      const hasPhone = !!event.phoneNumber?.trim();
                      const hasSent = !!event.questionnaireSentAt;
                      const isChecked = checkedEvents.has(event.id);
                      const isDisabled = !hasPhone || questionnaireLoading;
                      
                      return (
                        <div key={event.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isChecked && !isDisabled}
                            onChange={(e) => {
                              if (e.target.checked && !isDisabled) {
                                setCheckedEvents(prev => new Set([...prev, event.id]));
                              } else {
                                setCheckedEvents(prev => { const s = new Set(prev); s.delete(event.id); return s; });
                              }
                            }}
                            disabled={isDisabled}
                            className="w-4 h-4 accent-purple-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-white text-sm">{event.coupleNames}</span>
                              {hasSent && (
                                <span className="text-xs bg-orange-900/60 text-orange-300 border border-orange-700/40 px-2 py-0.5 rounded whitespace-nowrap">
                                  נשלח ב-{new Date(event.questionnaireSentAt).toLocaleDateString('he-IL')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 mt-1">
                              <span className="text-xs text-gray-400 font-mono">{hasPhone ? event.phoneNumber : 'אין טלפון'}</span>
                              {event.date && <span className="text-xs text-gray-500">{new Date(event.date).toLocaleDateString('he-IL')}</span>}
                            </div>
                          </div>
                          {!hasPhone && <span className="text-xs text-red-400 bg-red-900/20 px-2 py-1 rounded whitespace-nowrap">אין טלפון</span>}
                        </div>
                      );
                    })
                  )}
                </div>

                {questionnaireLoading && sendProgress.total > 0 && (
                  <div className="border-t border-gray-700 px-6 py-4 bg-gray-800/50 space-y-2">
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>שליחה בביצוע...</span>
                      <span>{sendProgress.sent} מתוך {sendProgress.total}</span>
                    </div>
                    <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                      <div className="bg-purple-600 h-full transition-all duration-300" style={{ width: `${(sendProgress.sent / sendProgress.total) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="border-t border-gray-700 px-6 py-4 flex gap-2 bg-gray-900/95 rounded-b-xl">
                  <button 
                    onClick={() => { setShowQuestionnaireModal(false); setSendProgress({ sent: 0, total: 0 }); }} 
                    disabled={questionnaireLoading} 
                    className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium disabled:opacity-50"
                  >
                    ביטול
                  </button>
                  <button 
                    onClick={handleSendQuestionnaire} 
                    disabled={questionnaireLoading || selectedCount === 0} 
                    className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {questionnaireLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {questionnaireLoading ? 'שולח...' : `שלח ל-${selectedCount} אירועים`}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Duplicate Dialog */}
        {showDuplicateDialog && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" dir="rtl">
            <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl max-h-[80vh] overflow-auto p-6 space-y-4">
              <div>
                <h2 className="text-xl font-bold text-yellow-400">⚠️ נמצאו {duplicates.length} קבוצות כפילויות</h2>
                <p className="text-sm text-gray-400 mt-1">הפונקציה cleanupDuplicateEvents תמחוק את כל הכפילויות בו-זמנית</p>
              </div>
              <div className="space-y-3 max-h-[50vh] overflow-y-auto">
                {duplicates.map((dup, idx) => (
                  <div key={idx} className="bg-gray-800/50 border border-yellow-700/30 rounded-lg p-3 space-y-2">
                    <div className="text-sm font-semibold text-gray-300">
                      {dup.type === 'source' ? '🔗 ליד (source):' : dup.type === 'leadId' ? '🔗 ליד (old):' : dup.type === 'studio' ? '🔢 Studio ID:' : '👰 זוג:'} {dup.key}
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
                <button onClick={() => { setShowDuplicateDialog(false); setDuplicates([]); }} disabled={isSyncing} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed">ביטול</button>
                <button onClick={handleDeleteDuplicates} disabled={isSyncing} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium font-bold disabled:opacity-50 disabled:cursor-not-allowed">{isSyncing ? 'מוחק...' : 'מחק כפילויות ✓'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}