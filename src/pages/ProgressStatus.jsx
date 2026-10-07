import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { uploadFile } from "@/api/uploadFile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Camera, Video, Scissors, Filter, CalendarDays, CheckSquare } from "lucide-react";
import ProgressEventMobileCard from "../components/progressStatus/ProgressEventMobileCard";
import { format } from "date-fns";
import { EVENT_TEAM_ROLES } from "@/lib/staffRoles";

const HEBREW_MONTHS = [
  'ינואר','פברואר','מרץ','אפריל','מאי','יוני',
  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'
];
const formatMonthYear = (date) => `${HEBREW_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
import { toast } from "sonner";

// Was previously missing "videographer2" entirely (same real bug as
// ProgressEventMobileCard.jsx — a videographer2 team member got no status button and
// was silently excluded from the progress % below) — now built from the shared role
// list so it can't drift out of sync again.
const ROLE_ICONS = { photographer1: Camera, photographer2: Camera, videographer: Video, videographer2: Video, editor: Scissors };
const ROLE_CONFIG = Object.fromEntries(
  EVENT_TEAM_ROLES.map(({ value, label, doneField }) => [value, { label, icon: ROLE_ICONS[value], doneField }])
);

const isRawCompleted   = (e) => !!(e?.rawLink  || e?.rawDoneManual);
const isFinalCompleted = (e) => !!(e?.finalLink || e?.finalDoneManual);

const getProgress = (event, teamMembers) => {
  const items = [];
  (teamMembers || []).forEach(m => {
    const cfg = ROLE_CONFIG[m?.role];
    if (cfg) items.push(!!event?.[cfg.doneField]);
  });
  items.push(isRawCompleted(event));
  items.push(isFinalCompleted(event));
  const total = items.length;
  const completed = items.filter(Boolean).length;
  return { completed, total, percentage: total > 0 ? Math.round((completed / total) * 100) : 0 };
};

export default function ProgressStatus() {
  const [events, setEvents] = useState([]);
  // Per month (label): "closed" | "open" (unfinished only) | "all" — set by a click.
  const [monthMode, setMonthMode] = useState({});
  const [staffMembers, setStaffMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [pendingLinks, setPendingLinks] = useState({});
  const [sendingEditor, setSendingEditor] = useState({});
  const [sendingCouple, setSendingCouple] = useState({});
  const [sendingGraphic, setSendingGraphic] = useState({});
  const [sendingAlbumCouple, setSendingAlbumCouple] = useState({});
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('progress_sort') || 'asc');
  const [showAlbumSettings, setShowAlbumSettings] = useState(false);
  const [showAlbumSend, setShowAlbumSend] = useState(false);
  const [albumMsg, setAlbumMsg] = useState('');
  const [albumImg, setAlbumImg] = useState('');
  const [albumSaving, setAlbumSaving] = useState(false);
  const [albumImgUploading, setAlbumImgUploading] = useState(false);
  const [albumSendMonth, setAlbumSendMonth] = useState(new Date().getMonth() + 1);
  const [albumSendYear, setAlbumSendYear] = useState(new Date().getFullYear());
  const [albumEvents, setAlbumEvents] = useState([]);
  const [albumSendLoading, setAlbumSendLoading] = useState(false);
  const [albumSendResult, setAlbumSendResult] = useState(null);
  const [albumSending, setAlbumSending] = useState(false);
  const [selectedAlbumEventIds, setSelectedAlbumEventIds] = useState(new Set());

  useEffect(() => { loadEvents(); }, []);

  const loadEvents = async () => {
    setIsLoading(true);
    try {
      const [data, staff] = await Promise.all([
        base44.entities.Event.list("-date"),
        base44.entities.StaffMember.list(),
      ]);
      setEvents(data || []);
      setStaffMembers(staff || []);
    } catch {
      toast.error("שגיאה בטעינת האירועים");
    }
    setIsLoading(false);
  };

  const updateField = async (eventId, field, value) => {
    try {
      await base44.entities.Event.update(eventId, { [field]: value });
      setEvents(prev => prev.map(e => e?.id === eventId ? { ...e, [field]: value } : e));
    } catch {
      toast.error("שגיאה בשמירה");
    }
  };

  const saveLinkOnBlur = async (eventId, field) => {
    const key = `${eventId}-${field}`;
    const value = pendingLinks[key];
    if (value === undefined) return;
    await updateField(eventId, field, value);
    setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleSendToEditor = async (event) => {
    if (event?.rawSentToEditor) {
      toast.warning('גלם כבר נשלח לעורך עבור אירוע זה');
      return;
    }
    const rawLink = event?.rawLink || pendingLinks[`${event?.id}-rawLink`];
    if (!rawLink) { toast.error('נא להזין לינק גלם לפני השליחה'); return; }

    const editorMember = (event?.team || []).find(m => m?.role === 'editor');
    if (!editorMember?.staffMemberName) { toast.error('לא הוגדר עורך לאירוע זה'); return; }

    const staffRecord = staffMembers.find(s => s?.name === editorMember.staffMemberName);
    if (!staffRecord?.phoneNumber) { toast.error('חסר טלפון לעורך ' + editorMember.staffMemberName); return; }

    setSendingEditor(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendToEditor', {
        eventId: event.id,
        coupleNames: event?.coupleNames,
        eventDate: event?.date,
        venue: event?.venue,
        phoneNumber: event?.phoneNumber,
        editorName: editorMember.staffMemberName,
        editorPhone: staffRecord.phoneNumber,
        rawLink,
      });
      setEvents(prev => prev.map(e => e?.id === event.id
        ? { ...e, rawSentToEditor: true, rawSentAt: new Date().toISOString() }
        : e
      ));
      toast.success('נשלח לעורך בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingEditor(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendToCouple = async (event) => {
    const finalLink = event?.finalLink || pendingLinks[`${event?.id}-finalLink`];
    if (!finalLink) { toast.error('נא להזין לינק סופי לפני השליחה'); return; }
    if (!event?.phoneNumber) { toast.error('חסר טלפון זוג לאירוע'); return; }
    // Daniel's decision R4 (2026-10-06): a second send to the couple only after asking.
    if (event?.finalDoneManual && !window.confirm(`הגלריה כבר סומנה כנשלחה ל${event?.coupleNames || 'זוג'}. לשלוח שוב?`)) return;

    setSendingCouple(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendToCouple', {
        eventId: event.id,
        coupleNames: event?.coupleNames,
        eventDate: event?.date,
        venue: event?.venue,
        phoneNumber: event?.phoneNumber,
        finalLink,
      });
      setEvents(prev => prev.map(e => e?.id === event.id
        ? { ...e, finalDoneManual: true }
        : e
      ));
      toast.success('נשלח לזוג בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingCouple(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendAlbumToGraphic = async (event) => {
    if (!event?.albumSketchLink && !pendingLinks[`${event?.id}-albumSketchLink`]) {
      toast.error('נא להזין לינק סקיצת אלבום לפני השליחה');
      return;
    }
    // save link first if pending
    const key = `${event?.id}-albumSketchLink`;
    if (pendingLinks[key] !== undefined) {
      await updateField(event.id, 'albumSketchLink', pendingLinks[key]);
      setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
    setSendingGraphic(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendAlbumSketch', { eventId: event.id, target: 'graphic' });
      setEvents(prev => prev.map(e => e?.id === event.id ? { ...e, albumSketchGraphicNotified: true } : e));
      toast.success('נשלח לגרפיקאית בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingGraphic(prev => ({ ...prev, [event.id]: false }));
    }
  };

  const handleSendAlbumToCouple = async (event) => {
    if (!event?.albumSketchLink && !pendingLinks[`${event?.id}-albumSketchLink`]) {
      toast.error('נא להזין לינק סקיצת אלבום לפני השליחה');
      return;
    }
    const key = `${event?.id}-albumSketchLink`;
    if (pendingLinks[key] !== undefined) {
      await updateField(event.id, 'albumSketchLink', pendingLinks[key]);
      setPendingLinks(prev => { const next = { ...prev }; delete next[key]; return next; });
    }
    // Daniel's decision R4: a second send of the album sketch to the couple only after asking.
    if (event?.albumSketchCoupleNotified && !window.confirm(`סקיצת האלבום כבר נשלחה ל${event?.coupleNames || 'זוג'}. לשלוח שוב?`)) return;
    setSendingAlbumCouple(prev => ({ ...prev, [event.id]: true }));
    try {
      await base44.functions.invoke('sendAlbumSketch', { eventId: event.id, target: 'couple' });
      setEvents(prev => prev.map(e => e?.id === event.id ? { ...e, albumSketchCoupleNotified: true } : e));
      toast.success('סקיצת האלבום נשלחה לזוג בהצלחה ✅');
    } catch (err) {
      toast.error('שגיאה בשליחה: ' + (err?.message || ''));
    } finally {
      setSendingAlbumCouple(prev => ({ ...prev, [event.id]: false }));
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
      // prefer today or future; fall back to past
      const absDiff = Math.abs(diff);
      if (closest === null) { closest = event; closestDiff = diff; return; }
      // prefer upcoming (diff >= 0) over past
      const prevIsFuture = closestDiff >= 0;
      const currIsFuture = diff >= 0;
      if (currIsFuture && !prevIsFuture) { closest = event; closestDiff = diff; return; }
      if (!currIsFuture && prevIsFuture) return;
      if (absDiff < Math.abs(closestDiff)) { closest = event; closestDiff = diff; }
    });
    if (!closest) return;
    // Same fix as Events.jsx's scrollToClosestEvent: the mobile card list and
    // the desktop list are both always mounted (visibility toggled via CSS
    // `md:hidden`/`hidden md:block`, not conditional rendering), and both use
    // the same `event-row-{id}` id — document.getElementById always returns
    // the first (mobile) match regardless of which is actually visible, so
    // scrollIntoView() was a silent no-op on desktop. Query every element
    // sharing the id and scroll to whichever one actually has layout.
    const candidates = document.querySelectorAll(`[id="event-row-${closest.id}"]`);
    const el = Array.from(candidates).find((node) => node.offsetParent !== null) || candidates[0];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const getLinkValue = (event, field) => {
    const key = `${event?.id}-${field}`;
    return pendingLinks[key] !== undefined ? pendingLinks[key] : (event?.[field] || "");
  };

  const openAlbumSettings = async () => {
    try {
      const allS = await base44.entities.AppSetting.list() /* BUG-01: list({}) threw */;
      const msgRec = allS.find(s => s.key === 'album_reminder_message');
      const imgRec = allS.find(s => s.key === 'album_reminder_image_url');
      setAlbumMsg(msgRec?.value || '');
      setAlbumImg(imgRec?.value || '');
    } catch(e) { setAlbumMsg(''); setAlbumImg(''); }
    setShowAlbumSettings(true);
  };

  const saveAlbumSettings = async () => {
    setAlbumSaving(true);
    try {
      const allS = await base44.entities.AppSetting.list() /* BUG-01: list({}) threw */;
      const exMsg = allS.find(s => s.key === 'album_reminder_message');
      const exImg = allS.find(s => s.key === 'album_reminder_image_url');
      if (exMsg?.id) await base44.entities.AppSetting.update(exMsg.id, { value: albumMsg });
      else await base44.entities.AppSetting.create({ key: 'album_reminder_message', value: albumMsg });
      if (exImg?.id) await base44.entities.AppSetting.update(exImg.id, { value: albumImg });
      else await base44.entities.AppSetting.create({ key: 'album_reminder_image_url', value: albumImg });
      toast.success('Ғההגדרות נשמרו');
      setShowAlbumSettings(false);
    } catch(e) { toast.error('שגיאה'); }
    setAlbumSaving(false);
  };

  const loadAlbumEvents = async (month, year) => {
    setAlbumSendLoading(true);
    setAlbumEvents([]);
    setAlbumSendResult(null);
    try {
          const _fetchR = await fetch("/api/apps/69bee10fa6d31a0348c609dd/functions/sendAlbumReminder", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ month, year, debugMode: true }) });
          const result = await _fetchR.json();
      const loaded = result?.events || [];
      setAlbumEvents(loaded);
      // Default: select only events that never received a reminder
      setSelectedAlbumEventIds(new Set(loaded.filter(e => !e.album_reminder_sent_at).map(e => e.id)));
    } catch(e) { setAlbumEvents([]); }
    setAlbumSendLoading(false);
  };

  const openAlbumSend = () => {
    setAlbumSendResult(null);
    setAlbumEvents([]);
    setSelectedAlbumEventIds(new Set());
    setShowAlbumSend(true);
  };

  const sendAlbumReminders = async () => {
    setAlbumSending(true);
    try {
          const _fetchS = await fetch("/api/apps/69bee10fa6d31a0348c609dd/functions/sendAlbumReminder", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ month: albumSendMonth, year: albumSendYear, debugMode: false, eventIds: Array.from(selectedAlbumEventIds) }) });
          const result = await _fetchS.json();
      setAlbumSendResult(result);
      toast.success('נשלח בהצלחה!');
    } catch(e) { toast.error('שגיאה'); }
    setAlbumSending(false);
  };

  const filteredEvents = events.filter(event => {
    const year = new Date(event?.date || "").getFullYear();
    if (year !== selectedYear) return false;
    if (filter === "all") return true;
    const progress = getProgress(event, event?.team || []);
    if (filter === "completed")  return progress.percentage === 100;
    if (filter === "in-progress") return progress.percentage > 0 && progress.percentage < 100;
    if (filter === "pending")    return progress.percentage === 0;
    return true;
  }).sort((a, b) => {
    const da = new Date(a?.date || 0).getTime();
    const db = new Date(b?.date || 0).getTime();
    return sortOrder === 'asc' ? da - db : db - da;
  });

  // Months as folders (2026-10-07, the owner's request): a month whose events are all at
  // 100% starts closed; a month with unfinished events shows only those, with "הצג גם N
  // שהושלמו". A click on the month header opens/closes it. With a status filter on, every
  // matching event is shown (the filter already decided).
  const buildMonthItems = () => {
    const items = [];
    const groups = [];
    for (const event of filteredEvents) {
      const label = formatMonthYear(new Date(event?.date));
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, events: [] });
      groups[groups.length - 1].events.push(event);
    }
    for (const g of groups) {
      const pct = (e) => getProgress(e, e?.team || []).percentage;
      const done = g.events.filter((e) => pct(e) === 100).length;
      const complete = done === g.events.length;
      const mode = monthMode[g.label] || (filter !== "all" ? "all" : complete ? "closed" : "open");
      const visible = mode === "closed" ? [] : mode === "all" ? g.events : g.events.filter((e) => pct(e) < 100);
      items.push({ type: "monthHeader", id: `header-${g.label}`, label: g.label, done, total: g.events.length, complete, mode });
      for (const e of visible) items.push({ type: "event", id: e?.id, data: e });
      const hidden = g.events.length - visible.length;
      if (mode === "open" && hidden > 0) items.push({ type: "monthMore", id: `more-${g.label}`, label: g.label, hidden });
    }
    return items;
  };
  const toggleMonth = (item) =>
    setMonthMode((m) => ({ ...m, [item.label]: item.mode === "closed" ? (item.complete ? "all" : "open") : "closed" }));
  const renderMonthHeader = (item, mobile) => (
    <button
      key={item.id}
      type="button"
      onClick={() => toggleMonth(item)}
      aria-expanded={item.mode !== "closed"}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-start transition-colors hover:border-[#4F7BFF]/40 ${item.complete ? "border-[#22C987]/25 bg-[#22C987]/[0.05]" : "border-white/[0.08] bg-white/[0.03]"} ${mobile ? "mt-3" : "mt-5 mb-2"}`}
    >
      <span className={`font-semibold text-white ${mobile ? "text-base" : "text-lg"}`}>{item.label}</span>
      <span className="flex items-center gap-3 text-xs">
        {/* Design E: the same done/total as a bar (display only). */}
        <span className="hidden sm:block h-1.5 w-28 overflow-hidden rounded-full bg-white/[0.07]">
          <span className={`block h-full rounded-full ${item.complete ? "bg-[#22C987]" : "bg-gradient-to-l from-[#FACC15] to-[#F59E0B]"}`} style={{ width: `${item.total ? Math.round((item.done / item.total) * 100) : 0}%` }} />
        </span>
        <span className={`font-semibold ${item.complete ? "text-emerald-400" : "text-amber-300"}`}>
          {item.complete ? "✓ הושלם" : `${item.done}/${item.total} הושלמו`}
        </span>
        <span className="text-slate-500">{item.mode === "closed" ? "▸" : "▾"}</span>
      </span>
    </button>
  );
  const renderMonthMore = (item) => (
    <button
      key={item.id}
      type="button"
      onClick={() => setMonthMode((m) => ({ ...m, [item.label]: "all" }))}
      className="w-full rounded-xl border border-dashed border-[#2A3B57] py-2 text-xs text-slate-400 hover:text-white hover:border-[#4F7BFF]/50"
    >
      הצג גם {item.hidden} שהושלמו
    </button>
  );

  if (isLoading) {
    return (
      <div className="e-page min-h-screen p-4 md:p-8">
        <div className="max-w-7xl mx-auto space-y-4 animate-pulse">
          {Array(8).fill(0).map((_, i) => <div key={i} className="h-12 bg-gray-800 rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="e-page min-h-screen p-4 md:p-8" dir="rtl">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-4">
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#22C987]/45 bg-[#22C987]/10 text-emerald-300 shadow-[0_0_24px_-6px_rgba(34,201,135,0.7)]">
              <CheckSquare className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-bold text-white mb-1">סטטוס עבודה</h1>
              <p className="text-slate-400">מעקב בזמן אמת על התקדמות כל האירועים</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-gray-400" />
              <Select value={selectedYear.toString()} onValueChange={v => setSelectedYear(parseInt(v))}>
                <SelectTrigger className="w-28 rounded-xl bg-[#0B1529] border-[#2A3B57] text-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  {[2025, 2026, 2027, 2028, 2029, 2030].map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-36 rounded-xl bg-[#0B1529] border-[#2A3B57] text-white h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-900 border-gray-700 text-white">
                  <SelectItem value="all">כל האירועים</SelectItem>
                  <SelectItem value="pending">ממתין</SelectItem>
                  <SelectItem value="in-progress">בתהליך</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Select value={sortOrder} onValueChange={v => { setSortOrder(v); localStorage.setItem('progress_sort', v); }}>
              <SelectTrigger className="w-56 rounded-xl bg-[#0B1529] border-[#2A3B57] text-white h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-gray-900 border-gray-700 text-white">
                <SelectItem value="asc">תאריך – מהקרוב לרחוק</SelectItem>
                <SelectItem value="desc">תאריך – מהרחוק לקרוב</SelectItem>
              </SelectContent>
            </Select>
          <button
            onClick={scrollToClosestEvent}
            className="flex h-9 items-center gap-1.5 px-3 rounded-xl border border-[#FACC15]/70 bg-[#FACC15]/10 text-[#FDE047] hover:bg-[#FACC15]/20 text-xs font-semibold transition-colors whitespace-nowrap shadow-[0_0_18px_-6px_rgba(250,204,21,0.6)]"
            title="גלול לאירוע הקרוב ביותר להיום"
          >
            📍 היום
          </button>
          {/* B6 + B7 hidden by the owner's decision (2026-10-07): "תזכורת אלבומים" called a dead Base44
              address, and "הגדרות תזכורת אלבומים" saved a text nothing reads. The working album
              reminder is in the automations dashboard. */}
          </div>
        </div>

        {/* Design E: four counts for the selected year (the same rule as the status filter). */}
        {(() => {
          const ofYear = events.filter((e) => new Date(e?.date || "").getFullYear() === selectedYear);
          const pct = (e) => getProgress(e, e?.team || []).percentage;
          const tiles = [
            { label: `אירועי ${selectedYear}`, value: ofYear.length, tone: "border-[#3B82F6]/50 bg-[#3B82F6]/12 text-sky-300 shadow-[0_0_18px_-4px_rgba(59,130,246,0.6)]", icon: Calendar },
            { label: "ממתין", value: ofYear.filter((e) => pct(e) === 0).length, tone: "border-[#F05B70]/55 bg-[#F05B70]/12 text-rose-300 shadow-[0_0_18px_-4px_rgba(240,91,112,0.6)]", icon: Scissors },
            { label: "בתהליך", value: ofYear.filter((e) => pct(e) > 0 && pct(e) < 100).length, tone: "border-[#F59E0B]/55 bg-[#F59E0B]/12 text-amber-300 shadow-[0_0_18px_-4px_rgba(245,158,11,0.55)]", icon: Video },
            { label: "הושלם", value: ofYear.filter((e) => pct(e) === 100).length, tone: "border-[#22C987]/50 bg-[#22C987]/12 text-emerald-300 shadow-[0_0_18px_-4px_rgba(34,201,135,0.55)]", icon: CheckSquare },
          ];
          return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-4 mb-5">
              {tiles.map((t) => (
                <div key={t.label} className="dash-card flex items-center justify-end gap-3 px-3 py-3 md:gap-4 md:px-5 md:py-4">
                  <div>
                    <div className="text-xl md:text-2xl font-bold leading-tight text-white tabular-nums">{t.value}</div>
                    <div className="text-xs md:text-sm text-slate-400 whitespace-nowrap">{t.label}</div>
                  </div>
                  <div className={`flex h-10 w-10 md:h-12 md:w-12 shrink-0 items-center justify-center rounded-xl border ${t.tone}`}>
                    <t.icon className="h-5 w-5 md:h-6 md:w-6" strokeWidth={1.75} />
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Duplicates Viewer */}
        <div className="mb-4">
          <button
            onClick={() => setShowDuplicates(v => !v)}
            className="text-xs px-3.5 py-2 rounded-xl border border-[#F97316]/60 bg-[#F97316]/[0.06] text-orange-300 hover:bg-[#F97316]/15 transition-colors"
          >
            🔍 {showDuplicates ? "הסתר" : "הצג"} אירועים כפולים
          </button>
          {showDuplicates && (() => {
            const groups = {};
            events.forEach(e => {
              const key = (e?.coupleNames || "").trim().toLowerCase() + "|" + (e?.date || "");
              if (!groups[key]) groups[key] = [];
              groups[key].push(e);
            });
            const dupes = Object.values(groups).filter(g => g.length > 1);
            return (
              <div className="mt-3 space-y-3">
                {dupes.length === 0 ? (
                  <p className="text-green-400 text-sm">✅ לא נמצאו אירועים כפולים</p>
                ) : (
                  <>
                    <p className="text-orange-300 text-sm font-semibold">⚠️ נמצאו {dupes.length} קבוצות כפולות:</p>
                    {dupes.map((group, i) => (
                      <div key={i} className="bg-orange-950/40 border border-orange-700 rounded-lg p-3">
                        <p className="text-orange-200 font-semibold text-sm mb-2">{group[0]?.coupleNames} — {group[0]?.date}</p>
                        {group.map(ev => (
                          <div key={ev.id} className="flex items-center gap-3 text-xs text-gray-300">
                            <span className="font-mono text-gray-500">{ev.id}</span>
                            <span>source_lead_id: {ev.sourceLeadId || "—"}</span>
                            <span>יומן: {ev.googleCalendarEventId ? "✅" : "—"}</span>
                            <span className="text-gray-400">נוצר: {ev.created_date ? new Date(ev.created_date).toLocaleDateString("he-IL") : "—"}</span>
                          </div>
                        ))}
                        <p className="text-xs text-gray-500 mt-2">מחק ידנית את הרשומות המיותרות מדף האירועים.</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {/* Events List */}
        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {filteredEvents.length === 0 ? (
            <div className="text-center py-12">
              <CheckSquare className="w-12 h-12 mx-auto text-gray-600 mb-3" />
              <p className="text-gray-400">{filter === "all" ? "טרם נוצרו אירועים" : "אין אירועים עבור הסינון שנבחר"}</p>
            </div>
          ) : (() => {
            const items = buildMonthItems();
            return items.map(item => {
              if (item.type === 'monthHeader') return renderMonthHeader(item, true);
              if (item.type === 'monthMore') return renderMonthMore(item);
              return (
                <ProgressEventMobileCard
                  key={item.id}
                  event={item.data}
                  pendingLinks={pendingLinks}
                  setPendingLinks={setPendingLinks}
                  updateField={updateField}
                  saveLinkOnBlur={saveLinkOnBlur}
                  getLinkValue={getLinkValue}
                  handleSendToEditor={handleSendToEditor}
                  handleSendToCouple={handleSendToCouple}
                  handleSendAlbumToGraphic={handleSendAlbumToGraphic}
                  handleSendAlbumToCouple={handleSendAlbumToCouple}
                  sendingEditor={sendingEditor}
                  sendingCouple={sendingCouple}
                  sendingGraphic={sendingGraphic}
                  sendingAlbumCouple={sendingAlbumCouple}
                />
              );
            });
          })()}
        </div>

        {/* Desktop list — unchanged */}
        <div className="hidden md:block">
        {filteredEvents.length === 0 ? (
          <div className="text-center py-16">
            <CheckSquare className="w-16 h-16 mx-auto text-gray-600 mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">אין אירועים</h3>
            <p className="text-gray-400">{filter === "all" ? "טרם נוצרו אירועים במערכת" : "אין אירועים עבור הסינון שנבחר"}</p>
          </div>
        ) : (() => {
          // Month headers as folders — render-only, filteredEvents unchanged (buildMonthItems).
          const itemsToRender = buildMonthItems();

          return (
            <div className="space-y-2">
              {itemsToRender.map(item => {
                if (item.type === 'monthHeader') return renderMonthHeader(item, false);
                if (item.type === 'monthMore') return renderMonthMore(item);

                const event = item.data;
                const teamMembers = event?.team || [];
                const progress = getProgress(event, teamMembers);
                const rawDone = isRawCompleted(event);
                const finalDone = isFinalCompleted(event);

                return (
                  <div key={event?.id} id={`event-row-${event?.id}`} className="rounded-xl border border-white/[0.07] bg-gradient-to-b from-[#0F1C36] to-[#0B1529] p-4 transition-colors hover:border-[#4F7BFF]/40">
                    {/* Row: LTR so elements flow left→right */}
                    <div className="flex items-start gap-3 flex-wrap" style={{ direction: "ltr" }}>

                      {/* Event Info — forced RTL for Hebrew text */}
                      <div className="flex items-center gap-3 min-w-fit" style={{ direction: "rtl" }}>
                        <Calendar className="w-5 h-5 text-amber-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-semibold text-white">{event?.coupleNames || "—"}</p>
                          <p className="text-xs text-gray-400">
                            {event?.date ? format(new Date(event.date), "d/M/yyyy") : "—"}
                          </p>
                        </div>
                      </div>

                      {/* Crew Buttons with name below */}
                      <div className="flex items-start gap-2 flex-wrap">
                        {Object.entries(ROLE_CONFIG).map(([roleKey, config]) => {
                          const member = teamMembers.find(m => m?.role === roleKey);
                          if (!member) return null;
                          const isDone = !!event?.[config.doneField];
                          const Icon = config.icon;
                          return (
                            <div key={roleKey} className="flex flex-col items-center gap-0.5">
                              <button
                                onClick={() => updateField(event.id, config.doneField, !isDone)}
                                className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap border transition-colors ${
                                  isDone
                                    ? "bg-green-500/30 text-green-300 border-green-500/50 hover:bg-green-500/40"
                                    : "bg-red-500/20 text-red-300 border-red-500/30 hover:bg-red-500/30"
                                }`}
                              >
                                <Icon className="w-3 h-3" />
                                <span>{config.label}</span>
                              </button>
                              {member?.staffMemberName && (
                                <span className="text-xs text-gray-400 max-w-[56px] truncate text-center">
                                  {member.staffMemberName}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Raw Link + Status + Send to Editor */}
                      <div className="flex items-center gap-1">
                        <Input
                          type="url"
                          placeholder="לינק גלם"
                          value={getLinkValue(event, "rawLink")}
                          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-rawLink`]: e.target.value }))}
                          onBlur={() => saveLinkOnBlur(event.id, "rawLink")}
                          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                          dir="ltr"
                        />
                        <button
                          onClick={() => updateField(event.id, "rawDoneManual", !event?.rawDoneManual)}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors ${
                            rawDone
                              ? "bg-green-500/30 text-green-300 border-green-500/50"
                              : "bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-400"
                          }`}
                          title="גלם — לחץ לסימון ידני"
                        >
                          גלם
                        </button>
                        <button
                          onClick={() => {
                            if (event?.rawSentToEditor) {
                              updateField(event.id, 'rawSentToEditor', false);
                            } else {
                              handleSendToEditor(event);
                            }
                          }}
                          disabled={!!sendingEditor[event.id]}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                            event?.rawSentToEditor
                              ? 'bg-green-500/30 text-green-300 border-green-500/50 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40'
                              : 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                          }`}
                          title={event?.rawSentToEditor ? 'לחץ לאיפוס הסטטוס' : 'שלח לעורך'}
                        >
                          {sendingEditor[event.id] ? '...' : event?.rawSentToEditor ? '✓ נשלח' : '→ עורך'}
                        </button>
                      </div>

                      {/* Final Link + Status + Send to Couple */}
                      <div className="flex items-center gap-1">
                        <Input
                          type="url"
                          placeholder="לינק סופי"
                          value={getLinkValue(event, "finalLink")}
                          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-finalLink`]: e.target.value }))}
                          onBlur={() => saveLinkOnBlur(event.id, "finalLink")}
                          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                          dir="ltr"
                        />
                        <button
                          onClick={() => updateField(event.id, "finalDoneManual", !event?.finalDoneManual)}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors ${
                            finalDone
                              ? "bg-green-500/30 text-green-300 border-green-500/50"
                              : "bg-gray-800 text-gray-400 border-gray-600 hover:border-gray-400"
                          }`}
                          title="סופי — לחץ לסימון ידני"
                        >
                          סופי
                        </button>
                        <button
                          onClick={() => handleSendToCouple(event)}
                          disabled={!!sendingCouple[event.id]}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                            event?.finalDoneManual
                              ? "bg-green-500/30 text-green-300 border-green-500/50"
                              : "bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30"
                          }`}
                          title="שלח סופי לזוג"
                        >
                          {sendingCouple[event.id] ? '...' : event?.finalDoneManual ? '✓ נשלח' : '→ זוג'}
                        </button>
                      </div>

                      {/* Album Sketch — link + graphic + couple */}
                      <div className="flex items-center gap-1">
                        <Input
                          type="url"
                          placeholder="לינק אלבום"
                          value={getLinkValue(event, "albumSketchLink")}
                          onChange={e => setPendingLinks(prev => ({ ...prev, [`${event.id}-albumSketchLink`]: e.target.value }))}
                          onBlur={() => saveLinkOnBlur(event.id, "albumSketchLink")}
                          className="h-8 text-xs bg-gray-800 border-gray-700 text-white placeholder-gray-500 w-24"
                          dir="ltr"
                        />
                        <button
                          onClick={() => {
                            if (event?.albumSketchGraphicNotified) {
                              updateField(event.id, 'albumSketchGraphicNotified', false);
                            } else {
                              handleSendAlbumToGraphic(event);
                            }
                          }}
                          disabled={!!sendingGraphic[event.id]}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                            event?.albumSketchGraphicNotified
                              ? 'bg-green-500/30 text-green-300 border-green-500/50 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/40'
                              : 'bg-orange-600/20 text-orange-300 border-orange-500/40 hover:bg-orange-600/30'
                          }`}
                          title={event?.albumSketchGraphicNotified ? 'לחץ לאיפוס' : 'שלח לגרפיקאית'}
                        >
                          {sendingGraphic[event.id] ? '...' : event?.albumSketchGraphicNotified ? '✓ גרפיקה' : '→ גרפיקה'}
                        </button>
                        <button
                          onClick={() => handleSendAlbumToCouple(event)}
                          disabled={!!sendingAlbumCouple[event.id]}
                          className={`h-8 px-2 text-xs rounded border font-medium transition-colors whitespace-nowrap ${
                            event?.albumSketchCoupleNotified
                              ? 'bg-green-500/30 text-green-300 border-green-500/50'
                              : 'bg-teal-600/20 text-teal-300 border-teal-500/40 hover:bg-teal-600/30'
                          }`}
                          title="שלח סקיצה לזוג"
                        >
                          {sendingAlbumCouple[event.id] ? '...' : event?.albumSketchCoupleNotified ? '✓ זוג' : '→ זוג'}
                        </button>
                      </div>

                      {/* Album + Progress — pushed to end */}
                       <div className="flex items-center gap-2 ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateField(event.id, "albumStatus", event?.albumStatus === "sent" ? "pending" : "sent")}
                          className={`h-8 px-2 text-xs font-medium rounded-md whitespace-nowrap ${
                            event?.albumStatus === "sent"
                              ? "bg-green-500/30 text-green-300 border border-green-500/50"
                              : "bg-pink-500/20 text-pink-300 border border-pink-500/30"
                          }`}
                        >
                          📀 אלבום
                        </Button>
                        <div className="w-28 h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${progress.percentage === 100 ? "bg-[#22C987]" : progress.percentage >= 50 ? "bg-gradient-to-r from-[#06B6D4] to-[#3B82F6]" : "bg-gradient-to-r from-[#F59E0B] to-[#FACC15]"}`}
                            style={{ width: `${progress.percentage}%` }}
                          />
                        </div>
                        <span className={`text-xs font-semibold w-8 text-left ${progress.percentage === 100 ? "text-emerald-400" : progress.percentage >= 50 ? "text-sky-300" : "text-amber-300"}`}>
                          {progress.percentage}%
                        </span>
                      </div>

                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
        </div>
        {/* END desktop list */}

      {/* Album Settings Modal */}
      {showAlbumSettings && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold text-white mb-4">הגדרות תזכורת אלבומים</h2>
            <div className="mb-4">
              <label className="block text-gray-400 text-sm mb-1">הודעה</label>
              <textarea
                className="w-full bg-gray-800 border border-gray-600 text-white rounded-lg p-2 text-sm h-40"
                value={albumMsg}
                onChange={e => setAlbumMsg(e.target.value)}
              />
            </div>
            <div className="mb-6">
              <label className="block text-gray-400 text-sm mb-2">תמונה</label>
              {albumImg && (
                <img
                  src={albumImg}
                  alt="preview"
                  className="w-full max-h-40 object-contain rounded-lg mb-2 bg-gray-800 border border-gray-600"
                />
              )}
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer">
                  <div className="w-full bg-gray-800 border border-gray-600 text-gray-300 rounded-lg p-2 text-sm text-center hover:bg-gray-700 transition-colors">
                    {albumImgUploading ? 'מעלה תמונה...' : '📁 בחר תמונה להעלאה'}
                  </div>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    className="hidden"
                    disabled={albumImgUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setAlbumImgUploading(true);
                      try {
                        const res = await uploadFile({ file });
                        if (res?.file_url) {
                          setAlbumImg(res.file_url);
                          toast.success('התמונה הועלתה בהצלחה');
                        } else {
                          toast.error('שגיאה בהעלאת התמונה');
                        }
                      } catch {
                        toast.error('שגיאה בהעלאת התמונה');
                      }
                      setAlbumImgUploading(false);
                    }}
                  />
                </label>
                {albumImg && (
                  <button
                    onClick={() => setAlbumImg('')}
                    className="text-red-400 hover:text-red-300 text-sm px-2 py-1 border border-red-700 rounded-lg"
                  >
                    הסר
                  </button>
                )}
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" className="border-gray-600 bg-gray-800 text-gray-300" onClick={() => setShowAlbumSettings(false)}>ביטול</Button>
              <Button className="bg-yellow-500 text-black hover:bg-yellow-400" onClick={saveAlbumSettings} disabled={albumSaving}>{albumSaving ? '...' : 'שמור'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Album Send Modal */}
      {showAlbumSend && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" dir="rtl">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-white mb-4">שליחת תזכורת אלבומים</h2>
            <div className="flex gap-3 mb-4 items-end">
              <div>
                <label className="block text-gray-400 text-sm mb-1">חודש</label>
                <select className="bg-gray-800 border border-gray-600 text-white rounded-lg px-2 py-1" value={albumSendMonth} onChange={e => setAlbumSendMonth(Number(e.target.value))}>
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-1">שנה</label>
                <select className="bg-gray-800 border border-gray-600 text-white rounded-lg px-2 py-1" value={albumSendYear} onChange={e => setAlbumSendYear(Number(e.target.value))}>
                  {[2024,2025,2026,2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <Button size="sm" className="bg-gray-700 border-gray-600 text-gray-100 hover:bg-gray-600" style={{background:"#374151",color:"#d1d5db",border:"1px solid #4b5563"}} onClick={() => loadAlbumEvents(albumSendMonth, albumSendYear)} disabled={albumSendLoading}>
                {albumSendLoading ? 'טוען...' : 'טען אירועים'}
              </Button>
            </div>
            {albumEvents.length > 0 && (
              <div className="mb-4">
                <p className="text-gray-400 text-sm mb-2">{albumEvents.length} אירועים ישלחו</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {albumEvents.map((ev, i) => (
                    <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-sm text-white flex justify-between items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAlbumEventIds.has(ev.id)}
                        onChange={(e) => {
                          setSelectedAlbumEventIds(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(ev.id);
                            else next.delete(ev.id);
                            return next;
                          });
                        }}
                        className="w-4 h-4 accent-purple-500 cursor-pointer flex-shrink-0"
                      />
                      <span className="flex-1">{ev.coupleName || ev.coupleNames}</span>
                      {ev.album_reminder_sent_at ? (
                        <span className="text-xs text-green-400 whitespace-nowrap">
                          ✓ נשלח {new Date(ev.album_reminder_sent_at).toLocaleDateString('he-IL')}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">לא נשלח</span>
                      )}
                      <span className="text-gray-400">{ev.eventDate}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {albumSendResult && (
              <div className="mb-4 p-3 bg-green-900/30 border border-green-700 rounded-lg text-sm text-green-300">
                נשלח: {albumSendResult.sent} | נכשל: {albumSendResult.failed}
              </div>
            )}
            <div className="flex gap-3 justify-end mt-4">
              <Button variant="outline" className="border-gray-600 bg-gray-800 text-gray-300" onClick={() => setShowAlbumSend(false)}>ביטול</Button>
              <Button className="bg-purple-600 text-white hover:bg-purple-500" onClick={sendAlbumReminders} disabled={albumSending || selectedAlbumEventIds.size === 0}>
                {albumSending ? 'שולח...' : `שלח ${selectedAlbumEventIds.size}`}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}