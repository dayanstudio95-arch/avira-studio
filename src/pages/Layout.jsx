import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { 
  LayoutDashboard, 
  Calendar, 
  PieChart, 
  Settings, 
  Heart,
  Camera,
  WalletCards,
  CheckSquare,
  Users,
  Zap,
  FileText,
  Edit2,
  X,
  LogOut,
  BookImage,
  BookOpen,
  MessageSquare,
  Bot,
  Eye,
  EyeOff,
  GripVertical,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AIAssistant from "@/components/AIAssistant";
import PostSignWizardHost from "@/components/postSign/PostSignWizardHost";
import { isMissingTeam, israelToday, eventDay, yearProgress } from "@/lib/missingTeam";
import { progressPct } from "@/lib/eventProgress";
import { needsReply } from "@/lib/chatModel";
import { utcToIsraelParts } from "@/lib/meetings";
import NotificationBell from "@/components/notifications/NotificationBell";
import { NotificationsProvider, useNotifications } from "@/components/notifications/NotificationsContext";
import GlobalSearch from "@/components/layout/GlobalSearch";
import { toast } from "sonner";
import { useAuth } from "@/lib/SupabaseAuthContext";
import { isLeadCoordinator, isPhotographerRole, isAlbumManagerRole, isEditorRole } from "@/lib/permissions";

const ROLE_LABELS = {
  owner: "בעלים",
  admin: "מנהל",
  studio_manager: "מנהל סטודיו",
  photographer: "צלם",
  editor: "עורך",
  album_manager: "מנהל אלבומים",
  lead_coordinator: "רכז לידים",
};

// Scoped roles (lead_coordinator, photographer, album_manager) get exactly one small
// nav destination set and none of the admin-panel chrome (menu editing, quick-stats --
// which would otherwise call base44.entities.Event.list() and pull tenant-wide
// event/financial data down to these roles well beyond what they're scoped to see) or
// the floating AI assistant (its tools query the same tenant-wide tables).
// lead_coordinator's one destination is now the full Leads.jsx page (2026-08-20:
// expanded to full financial-data/all-leads access per product decision, see
// 0030_lead_coordinator_full_leads_access.sql -- only delete is blocked, enforced via
// RLS) -- photographer stays read-only/own-events-only. album_manager (Wedding Albums
// module, see CLAUDE.md) gets the order list + catalog settings; order detail is
// reached by clicking into a row on the order list, not a separate nav entry.
// editor (2026-08-21) shares photographer's exact "האירועים שלי" destination -- same
// crew-scoped read-only schedule view, see src/App.jsx / photographer-events edge fn.
const scopedNavItemsByRole = {
  lead_coordinator: [
    { title: "לידים", url: "/Leads", icon: Heart },
    // First-contact WhatsApp inquiries are lead intake. Same four roles as the RLS
    // policies in 0054_whatsapp_bot.sql -- keep the two lists in step.
    { title: "שיחות וואטסאפ", url: "/chat", icon: MessageSquare },
    { title: "פגישות", url: "/Meetings", icon: CalendarClock },
  ],
  photographer: [{ title: "האירועים שלי", url: "/MyEvents", icon: Camera }],
  editor: [{ title: "האירועים שלי", url: "/MyEvents", icon: Camera }],
  album_manager: [
    { title: "הזמנות אלבומים", url: "/AlbumOrders", icon: BookImage },
    { title: "קטלוג אלבומים", url: "/AlbumCatalogSettings", icon: Settings },
    { title: "מדריך אלבום", url: "/AlbumGuideSettings", icon: FileText },
  ],
};

// Sidebar v2 (2026-10-07, the owner chose design A): three sections, clean labels, the work
// waiting on each page as a number beside it. `title` stays the key of the saved menu order
// and hidden items (localStorage) — `label` is only what is shown.
const NAV_SECTIONS = [
  { key: "today", label: "היום" },
  { key: "events", label: "אירועים" },
  { key: "studio", label: "כסף וסטודיו" },
];

const primaryNavItems = [
  { title: "לוח בקרה",        url: "/",                              icon: LayoutDashboard, section: "today" },
  { title: "💬 שיחות וואטסאפ", url: "/chat",                          icon: MessageSquare, section: "today", label: "שיחות וואטסאפ" },
  { title: "לידים CRM",       url: createPageUrl("Leads"),           icon: Heart, section: "today", label: "לידים" },
  { title: "📅 פגישות", url: "/Meetings", icon: CalendarClock, section: "today", label: "פגישות" },
  { title: "רשימת אירועים",   url: createPageUrl("Events"),          icon: Calendar, section: "events" },
  { title: "שיבוץ צוות",      url: createPageUrl("StaffScheduling"), icon: Users, section: "events" },
  { title: "סטטוס עבודה",     url: createPageUrl("ProgressStatus"),  icon: CheckSquare, section: "events" },
  { title: "📅 יומן Google",   url: "/GoogleCalendarSync",           icon: Calendar, section: "events", label: "יומן Google" },
  { title: "תשלומים",         url: createPageUrl("Payments"),        icon: WalletCards, section: "studio" },
  { title: "דוחות",           url: createPageUrl("Reports"),         icon: PieChart, section: "studio" },
  { title: "📷 הזמנות אלבומים", url: "/AlbumOrders",                  icon: BookImage, section: "studio", label: "הזמנות אלבומים" },
  { title: "🤖 לוח אוטומציות", url: "/AutomationsDashboard",         icon: Zap, section: "studio", label: "לוח אוטומציות" },
  // S8 (owner's decision, 2026-10-07): "🛡️ יועץ מערכת" removed from the menu — its numbers were
  // wrong (200-event cap, partial payments as full debt). The route /SystemAdvisor stays.
  { title: "הגדרות מערכת",    url: createPageUrl("Settings"),        icon: Settings, section: "studio" },
];

const secondaryNavItems = [
  { title: "יומן אירועים",       url: createPageUrl("Calendar"),            icon: Calendar },
  { title: "אנשי צוות",         url: createPageUrl("TeamMembers"),         icon: Camera },
  { title: "חבילות ומחירים",    url: createPageUrl("Packages"),            icon: Camera },
  { title: "קטלוג אלבומים",     url: "/AlbumCatalogSettings",              icon: Settings },
  { title: "מדריך אלבום",       url: "/AlbumGuideSettings",                icon: FileText },
  { title: "ניהול חשבוניות",    url: createPageUrl("AllInvoicesPage"),     icon: FileText },
  // B4 (owner's decision, 2026-10-07): "אישור הודעות" removed from the menu — nothing queues there
  // (the two approval automations are off) and the page breaks when something does. Put it
  // back, and fix it, before turning those automations on. The route /PendingApprovals stays.
  // Routed in App.jsx since forever but never listed here, so there was no way to
  // reach it — the one screen that shows whether the automations actually ran, and
  // which messages failed.
  { title: "יומן אוטומציות",     url: "/AutomationLogs",                    icon: FileText },
  // 2026-09-24: the bot's whole chain, step by step, with its settings in place.
  { title: "🤖 מרכז שליטה לבוט", url: "/BotControlCenter",                  icon: Bot },
  { title: "מדריך",             url: "/Guide",                             icon: BookOpen },
];

// Combined for legacy localStorage order/hidden compatibility
const navigationItems = [...primaryNavItems, ...secondaryNavItems];

// The red count next to a menu row (2026-09-24): unread notifications whose type maps
// to that page (src/lib/notificationCategories.js). Same red as the bell, and drawn from
// the same list, so the two always agree.
function NavBadge({ count }) {
  if (!count) return null;
  return (
    <span className="ms-auto min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center leading-none">
      {count > 9 ? "9+" : count}
    </span>
  );
}

// The work waiting on a page (sidebar v2): red = someone is waiting, amber = to do.
function WorkCount({ value, tone = "neutral" }) {
  if (!value) return null;
  const cls = tone === "red" ? "bg-[#F05B70]/15 text-rose-300 ring-1 ring-[#F05B70]/25" : tone === "amber" ? "bg-[#F59E0B]/15 text-amber-300 ring-1 ring-[#F59E0B]/25" : "bg-[#3B82F6]/15 text-sky-300 ring-1 ring-[#3B82F6]/25";
  return <span className={`ms-auto rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none ${cls}`}>{value}</span>;
}

// The list is shared by the bell (rendered twice) and the menu, so it lives above both.
export default function Layout({ children }) {
  return (
    <NotificationsProvider>
      <LayoutShell>{children}</LayoutShell>
    </NotificationsProvider>
  );
}

function LayoutShell({ children }) {
  // Design E: pop-up windows render on <body>, outside this tree — give them the same palette
  // while the logged-in app is open (the public pages never mount this).
  useEffect(() => {
    document.body.classList.add("avira-d");
    return () => document.body.classList.remove("avira-d");
  }, []);

  const { user, logout } = useAuth();
  const location = useLocation();
  const { countsByRoute, markRouteAsRead } = useNotifications();
  // Visiting the page IS reading the news: the badge clears, and the bell drops by the
  // same number. The owner's choice over "clears only when each row is clicked in the
  // bell". Runs again when a new row arrives while he is already on that page.
  const pendingOnThisPage = countsByRoute[location.pathname] || 0;
  useEffect(() => {
    if (pendingOnThisPage > 0) markRouteAsRead(location.pathname);
  }, [location.pathname, pendingOnThisPage, markRouteAsRead]);
  const scopedRole = isLeadCoordinator(user) ? 'lead_coordinator' : isPhotographerRole(user) ? 'photographer' : isEditorRole(user) ? 'editor' : isAlbumManagerRole(user) ? 'album_manager' : null;
  const scopedNavItems = scopedRole ? scopedNavItemsByRole[scopedRole] : null;
  const isInSecondaryNav = secondaryNavItems.some(item =>
    item.url !== '/' && location.pathname === item.url
  );
  const [secondaryOpen, setSecondaryOpen] = useState(isInSecondaryNav);

  useEffect(() => {
    if (isInSecondaryNav) setSecondaryOpen(true);
  }, [location.pathname]);

  // Studio Details settings (logo_url / name) -- previously left unwired on purpose
  // ("v1/settings-only" pass), now surfaced in the sidebar/mobile header. Best-effort:
  // a failed or slow branding fetch must never block the app shell from rendering, so
  // this starts null and the existing hardcoded "Avira" + gradient-icon fallback below
  // covers both the loading state and any tenant that hasn't uploaded a logo yet.
  const [tenantBranding, setTenantBranding] = useState(null);
  useEffect(() => {
    if (!user?.tenant_id) return;
    base44.entities.Tenant.get(user.tenant_id)
      .then((data) => setTenantBranding(data))
      .catch(() => { /* keep the fallback branding */ });
  }, [user?.tenant_id]);

  const [isEditingMenu, setIsEditingMenu] = useState(false);
  const [menuItems, setMenuItems] = useState(() => {
    try {
      const savedOrder = localStorage.getItem('menuOrder');
      if (!savedOrder) return navigationItems;
      const order = JSON.parse(savedOrder);
      if (!Array.isArray(order)) return navigationItems;
      const items = order.map(title => navigationItems.find(item => item.title === title)).filter(Boolean);
      const newItems = navigationItems.filter(item => !order.includes(item.title));
      return items.length > 0 ? [...items, ...newItems] : navigationItems;
    } catch {
      return navigationItems;
    }
  });
  const [hiddenItems, setHiddenItems] = useState(() => {
    try {
      const saved = localStorage.getItem('hiddenMenuItems');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [draggedItem, setDraggedItem] = useState(null);
  const [stats, setStats] = useState({ urgentStaffing: 0, editingBacklog: 0, yearDone: 0, yearTotal: 0, waitingChats: 0, newLeads: 0, meetingsToday: 0 });

  // "מבט מהיר" (2026-10-07): the owner's three numbers, in his order — missing team (the
  // shared rule, src/lib/missingTeam.js), waiting for editing, and this year's events
  // held out of all. Money moved to the dashboard. Refreshed on every page change and
  // every 5 minutes (it used to be computed once, when the app loaded).
  useEffect(() => {
    if (scopedRole) return undefined; // lead_coordinator/photographer never fetch tenant-wide events (financial columns)
    let alive = true;
    const loadStats = async () => {
      try {
        const [events, convs, newLeads, meetings] = await Promise.all([
          base44.entities.Event.list(),
          base44.entities.WhatsAppConversation.list("-lastMessageAt", 600).catch(() => []),
          base44.entities.Lead.filter({ status: "חדש" }, undefined, 500, "id").catch(() => []),
          base44.entities.SalesMeeting.filter({ status: "scheduled" }, "startsAt", 200).catch(() => []),
        ]);
        const today = israelToday();
        const year = yearProgress(events);
        if (!alive) return;
        setStats({
          urgentStaffing: events.filter((e) => isMissingTeam(e, today)).length,
          editingBacklog: events.filter((e) => eventDay(e) < today && progressPct(e) < 100).length,
          yearDone: year.done,
          yearTotal: year.total,
          waitingChats: (convs || []).filter(needsReply).length,
          newLeads: (newLeads || []).length,
          meetingsToday: (meetings || []).filter((m) => utcToIsraelParts(m.startsAt).date === today).length,
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    };
    loadStats();
    const timer = setInterval(loadStats, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const handleDragStart = (e, index) => {
    setDraggedItem(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === dropIndex) return;
    
    const newItems = [...menuItems];
    const draggedItemContent = newItems[draggedItem];
    newItems.splice(draggedItem, 1);
    newItems.splice(dropIndex, 0, draggedItemContent);
    setMenuItems(newItems);
    setDraggedItem(null);
  };

  const toggleItemVisibility = (title) => {
    setHiddenItems(prev => 
      prev.includes(title) 
        ? prev.filter(t => t !== title)
        : [...prev, title]
    );
  };

  const handleSaveMenuChanges = () => {
    try {
      const order = menuItems.map(item => item.title);
      localStorage.setItem('menuOrder', JSON.stringify(order));
      localStorage.setItem('hiddenMenuItems', JSON.stringify(hiddenItems));
      setIsEditingMenu(false);
    } catch (error) {
      console.error('Failed to save menu changes:', error);
      toast.error('שגיאה בשמירת ההגדרות');
    }
  };

  const resetMenuToDefault = () => {
    localStorage.removeItem('menuOrder');
    localStorage.removeItem('hiddenMenuItems');
    setMenuItems(navigationItems);
    setHiddenItems([]);
    setIsEditingMenu(false);
  };

  // B8 (owner's decision, 2026-10-07): "עריכת תפריט" saved an order and hidden items that the
  // menu never read — it always drew the fixed lists. Now each group follows the saved order
  // (menuItems), hides what was hidden (except while editing), and edit mode lets you drag
  // items and show/hide them. Saved per browser (localStorage), as before.
  const orderedGroup = (groupItems) => {
    const titles = new Set(groupItems.map(i => i.title));
    return menuItems.filter(i => titles.has(i.title));
  };
  const groupForDisplay = (groupItems) =>
    isEditingMenu ? orderedGroup(groupItems) : orderedGroup(groupItems).filter(i => !hiddenItems.includes(i.title));

  const renderEditRow = (item) => {
    const index = menuItems.indexOf(item);
    const hidden = hiddenItems.includes(item.title);
    return (
      <SidebarMenuItem key={item.title}>
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, index)}
          className={`flex items-center gap-2 px-3 py-2 mb-1 rounded-lg border border-dashed border-gray-600 cursor-move ${hidden ? 'opacity-40' : 'text-gray-200'}`}
        >
          <GripVertical className="w-4 h-4 text-gray-500 shrink-0" />
          <item.icon className="w-4 h-4 shrink-0" />
          <span className="text-sm flex-1">{item.title}</span>
          <button
            type="button"
            onClick={() => toggleItemVisibility(item.title)}
            className="text-gray-400 hover:text-yellow-400"
            title={hidden ? "הצג בתפריט" : "הסתר מהתפריט"}
          >
            {hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </SidebarMenuItem>
    );
  };

  return (
    <SidebarProvider>
      <style>{`
        :root {
          --avira-gold: #F5CF00;
          --avira-blue: #0074FF;
          --avira-red: #FF4C4C;
          --avira-green: #28A745;
          --avira-dark: #1a1a1a;
          --avira-darker: #0f0f0f;
          --avira-light: #f8f9fa;
        }
        .avira-gradient {
          background: linear-gradient(135deg, var(--avira-gold) 0%, #f4c430 100%);
        }
        .avira-text-gradient {
          background: linear-gradient(135deg, var(--avira-gold) 0%, #f4c430 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
      `}</style>
      <div className="avira-d min-h-screen flex w-full bg-[#060D1B]">
        <Sidebar side="right" className="border-l border-[#22334B]/70 bg-[#08111F] [&>div]:bg-[#08111F]">
          <SidebarHeader className="px-4 pt-5 pb-3 gap-3">
            <div className="flex items-center justify-between gap-2 w-full">
              <div className="flex items-center gap-2.5 shrink-0">
              {/* The studio's own mark (2026-10-07: the heart + camera looked cheap). A logo
                  uploaded for the studio (tenants.logo_url) wins; otherwise the AVIRA "A". */}
              <img
                src={tenantBranding?.logoUrl || '/logo-192.png'}
                alt={tenantBranding?.name || 'AVIRA'}
                className="w-10 h-10 rounded-xl object-cover ring-1 ring-yellow-500/30"
              />
              <div className="leading-tight shrink-0">
                  <h2 className="text-base font-semibold tracking-[0.18em] text-yellow-400 whitespace-nowrap">AVIRA</h2>
                  <p className="text-[9px] tracking-[0.3em] text-gray-400 whitespace-nowrap">STUDIO</p>
                </div>
              </div>
              {isEditingMenu ? (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSaveMenuChanges}
                    className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold text-xs px-2"
                  >
                    שמור
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetMenuToDefault}
                    className="text-gray-400 hover:text-gray-200 text-xs px-2 border border-gray-600"
                    title="איפוס לברירת מחדל"
                  >
                    איפוס
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsEditingMenu(false)}
                    className="text-gray-400 hover:text-red-400 hover:bg-gray-800"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <NotificationBell />
                  {!scopedRole && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsEditingMenu(true)}
                      className="text-gray-400 hover:text-yellow-400 hover:bg-gray-800"
                      title="עריכת תפריט"
                    >
                      <Edit2 className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!scopedRole && !isEditingMenu && <GlobalSearch variant="pill" />}
          </SidebarHeader>
          
          <SidebarContent className="bg-[#08111F] px-3 pb-3 flex min-h-0 flex-1 flex-col gap-1 overflow-auto group-data-[collapsible=icon]:overflow-hidden">
            {(() => {
              const isActive = (item) => (item.url === '/' ? location.pathname === '/' : location.pathname === item.url);
              // What waits on each page — the same numbers the dashboard shows.
              const workFor = (url) => ({
                '/chat': { value: stats.waitingChats, tone: 'red' },
                [createPageUrl("Leads")]: { value: stats.newLeads },
                '/Meetings': { value: stats.meetingsToday ? `${stats.meetingsToday} היום` : 0, tone: 'amber' },
                [createPageUrl("StaffScheduling")]: { value: stats.urgentStaffing, tone: 'red' },
                [createPageUrl("ProgressStatus")]: { value: stats.editingBacklog, tone: 'amber' },
              }[url] || {});
              const row = (item) => {
                const on = isActive(item);
                const work = scopedRole ? {} : workFor(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={`rounded-xl transition-colors ${on ? 'bg-gradient-to-l from-[#3B82F6]/30 via-[#3B82F6]/12 to-[#06B6D4]/[0.04] text-white ring-1 ring-[#3B82F6]/35 shadow-[0_8px_24px_-12px_rgba(59,130,246,0.7)]' : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-100'}`}
                    >
                      <Link to={item.url} className="flex items-center gap-2.5 px-3 py-2">
                        <item.icon className={`w-[18px] h-[18px] shrink-0 ${on ? 'text-sky-300' : 'text-slate-500'}`} strokeWidth={1.75} />
                        <span className="text-[13.5px] font-medium truncate">{item.label || item.title}</span>
                        <WorkCount value={work.value} tone={work.tone} />
                        <NavBadge count={countsByRoute[item.url]} />
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              };
              if (scopedNavItems) {
                return <SidebarMenu className="mt-1">{scopedNavItems.map(row)}</SidebarMenu>;
              }
              if (isEditingMenu) {
                return <SidebarMenu className="mt-1">{groupForDisplay(primaryNavItems).map(renderEditRow)}</SidebarMenu>;
              }
              const visible = groupForDisplay(primaryNavItems);
              return NAV_SECTIONS.map((sec) => {
                const items = visible.filter((i) => (i.section || 'studio') === sec.key);
                if (!items.length) return null;
                return (
                  <div key={sec.key}>
                    <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-[0.14em] text-slate-500/80">{sec.label}</div>
                    <SidebarMenu className="gap-0.5">{items.map(row)}</SidebarMenu>
                  </div>
                );
              });
            })()}

            {/* Secondary nav group — collapsible (hidden entirely for scoped roles) */}
            {!scopedRole && (
            <SidebarGroup>
              <button
                onClick={() => setSecondaryOpen(prev => !prev)}
                className="mt-2 flex items-center justify-between w-full px-3 py-2 rounded-xl text-gray-600 hover:bg-white/[0.04] hover:text-gray-300 transition-colors group"
              >
                <span className="text-[10px] font-semibold tracking-[0.14em]">ניהול מתקדם</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${secondaryOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {(secondaryOpen || isEditingMenu) && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupForDisplay(secondaryNavItems).map((item) => isEditingMenu ? renderEditRow(item) : (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          className={`rounded-xl transition-colors ${
                            (item.url !== '/' && location.pathname === item.url)
                              ? 'bg-[#3B82F6]/15 text-white ring-1 ring-[#3B82F6]/30'
                              : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-200'
                          }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-3 py-2">
                            <item.icon className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" />
                            <span className="text-sm">{item.title}</span>
                            <NavBadge count={countsByRoute[item.url]} />
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
            )}

            {!scopedRole && (
              <Link
                to="/Events"
                className="mx-1 mt-auto block rounded-2xl border border-[#22334B] bg-gradient-to-b from-[#101F35] to-[#0C1728] p-3 transition-colors hover:border-[#3B82F6]/40"
              >
                <div className="flex items-baseline justify-between text-xs text-gray-400">
                  <span>אירועים השנה</span>
                  <span className="font-semibold text-gray-200">{stats.yearDone} <span className="text-gray-500">מתוך</span> {stats.yearTotal}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full bg-gradient-to-l from-[#06B6D4] to-[#3B82F6]" style={{ width: `${stats.yearTotal ? Math.round((stats.yearDone / stats.yearTotal) * 100) : 0}%` }} />
                </div>
              </Link>
            )}
          </SidebarContent>

          <SidebarFooter className="bg-[#08111F] px-4 py-3 flex flex-col gap-2 border-t border-[#22334B]/60">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full text-right hover:bg-white/[0.04] rounded-xl p-1.5 -m-1 transition-colors">
                  <div className="w-9 h-9 bg-yellow-500/10 ring-1 ring-yellow-500/30 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-yellow-400 font-semibold text-sm">
                      {(user?.full_name || user?.email || "A").charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-100 text-sm truncate">
                      {user?.full_name || user?.email || "משתמש"}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {ROLE_LABELS[user?.role] || user?.email || "Manage your events"}
                    </p>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56 bg-gray-900 border-gray-700 text-white">
                <DropdownMenuItem
                  onClick={() => logout()}
                  className="text-red-400 focus:text-red-400 focus:bg-red-950/50 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 ml-2" />
                  התנתקות
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>

        {/* min-w-0 is load-bearing. <main> is a flex ITEM of the sidebar wrapper's row
            (ui/sidebar.jsx: "flex min-h-svh w-full"), and a flex item's default
            min-width is `auto` — its content's min-content width. One long nowrap /
            `truncate` string anywhere on a page (a WhatsApp message preview, a row of
            pills) therefore made <main> WIDER THAN THE SCREEN, and on a phone the whole
            app panned left and right. Reproduced on 2026-09-23 in a mirror of this
            shell: 465px of main on a 375px screen without it, 375px with it. Truncation
            and inner horizontal scrollers only work once this is zero. */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#060D1B]">
          <header className="bg-[#08111F]/90 backdrop-blur-sm border-b border-[#22334B]/70 px-6 py-4 md:hidden">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover:bg-gray-800 p-2 rounded-lg transition-colors duration-200 text-gray-300" />
              {tenantBranding?.logoUrl && (
                <img
                  src={tenantBranding.logoUrl}
                  alt={tenantBranding?.name || 'Studio logo'}
                  className="w-8 h-8 rounded-lg object-cover"
                />
              )}
              <h1 className="text-xl font-semibold text-white flex-1">{tenantBranding?.name || 'Avira'}</h1>
              <NotificationBell />
              {!scopedRole && <GlobalSearch />}
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>

        {!scopedRole && <AIAssistant />}
        {!scopedRole && <PostSignWizardHost />}
      </div>
    </SidebarProvider>
  );
}