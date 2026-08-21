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
  Bell,
  WalletCards,
  CheckSquare,
  Users,
  Zap,
  FileText,
  Edit2,
  X,
  Shield,
  LogOut,
  BookImage,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
import NotificationBell from "@/components/notifications/NotificationBell";
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
  lead_coordinator: [{ title: "לידים", url: "/Leads", icon: Heart }],
  photographer: [{ title: "האירועים שלי", url: "/MyEvents", icon: Camera }],
  editor: [{ title: "האירועים שלי", url: "/MyEvents", icon: Camera }],
  album_manager: [
    { title: "הזמנות אלבומים", url: "/AlbumOrders", icon: BookImage },
    { title: "קטלוג אלבומים", url: "/AlbumCatalogSettings", icon: Settings },
  ],
};

const primaryNavItems = [
  { title: "לוח בקרה",        url: "/",                              icon: LayoutDashboard },
  { title: "לידים CRM",       url: createPageUrl("Leads"),           icon: Heart },
  { title: "רשימת אירועים",   url: createPageUrl("Events"),          icon: Calendar },
  { title: "סטטוס עבודה",     url: createPageUrl("ProgressStatus"),  icon: CheckSquare },
  { title: "תשלומים",         url: createPageUrl("Payments"),        icon: WalletCards },
  { title: "דוחות",           url: createPageUrl("Reports"),         icon: PieChart },
  { title: "שיבוץ צוות",      url: createPageUrl("StaffScheduling"), icon: Users },
  { title: "🤖 לוח אוטומציות", url: "/AutomationsDashboard",         icon: Zap },
  { title: "📅 יומן Google",   url: "/GoogleCalendarSync",           icon: Calendar },
  { title: "📷 הזמנות אלבומים", url: "/AlbumOrders",                  icon: BookImage },
  { title: "🛡️ יועץ מערכת",   url: "/SystemAdvisor",                 icon: Shield },
  { title: "הגדרות מערכת",    url: createPageUrl("Settings"),        icon: Settings },
];

const secondaryNavItems = [
  { title: "יומן אירועים",       url: createPageUrl("Calendar"),            icon: Calendar },
  { title: "אנשי צוות",         url: createPageUrl("TeamMembers"),         icon: Camera },
  { title: "חבילות ומחירים",    url: createPageUrl("Packages"),            icon: Camera },
  { title: "קטלוג אלבומים",     url: "/AlbumCatalogSettings",              icon: Settings },
  { title: "ניהול חשבוניות",    url: createPageUrl("AllInvoicesPage"),     icon: FileText },
  { title: "אישור הודעות",      url: "/PendingApprovals",                  icon: Bell },
];

// Combined for legacy localStorage order/hidden compatibility
const navigationItems = [...primaryNavItems, ...secondaryNavItems];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
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
  const [stats, setStats] = useState({
    urgentStaffing: 0,
    editingBacklog: 0,
    pendingCollection: 0,
    thisMonthIncome: 0,
    totalEventsCount: 0
  });

  useEffect(() => {
    if (scopedRole) return; // lead_coordinator/photographer never fetch tenant-wide events (financial columns)
    const loadStats = async () => {
      try {
        const events = await base44.entities.Event.list();
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();

        // Calculate stats
        const endOfYear = new Date(currentYear, 11, 31, 23, 59, 59);
        const urgentCount = events.filter(e => {
          const eventDate = new Date(e.date);
          if (eventDate < today || eventDate > endOfYear) return false;
          const requiredCrew = e.requiredCrew || 3;
          const assignedTeam = (e.team || []).filter(m => m.staffMemberName);
          return assignedTeam.length < requiredCrew;
        }).length;

        const thisMonthEvents = events.filter(e => {
          const eventDate = new Date(e.date);
          return eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
        });
        const monthIncome = thisMonthEvents.reduce((sum, e) => sum + (e.totalAmountGross || 0), 0);
        const ROLE_DONE_FIELDS = {
          photographer1: "photographer1Done",
          photographer2: "photographer2Done",
          videographer:  "video1Done",
          editor:        "editorDone",
        };
        const getEventProgress = (e) => {
          const items = [];
          (e.team || []).forEach(m => {
            const field = ROLE_DONE_FIELDS[m?.role];
            if (field) items.push(!!e[field]);
          });
          items.push(!!(e.rawLink || e.rawDoneManual));
          items.push(!!(e.finalLink || e.finalDoneManual));
          const total = items.length;
          const completed = items.filter(Boolean).length;
          return total > 0 ? Math.round((completed / total) * 100) : 0;
        };
        const editingCount = events.filter(e => {
          const eventDate = new Date(e.date);
          return eventDate < today && getEventProgress(e) < 100;
        }).length;
        const unpaidAmount = events.reduce((sum, e) => {
          const eventDate = new Date(e.date);
          if (eventDate < today && e.clientPaymentStatus !== 'Paid') return sum + (e.totalAmountGross || 0);
          return sum;
        }, 0);

        setStats({
          urgentStaffing: urgentCount,
          editingBacklog: editingCount,
          pendingCollection: unpaidAmount,
          thisMonthIncome: monthIncome,
          totalEventsCount: events.length
        });
      } catch (error) {
        console.error('Failed to load stats:', error);
      }
    };
    loadStats();
  }, []);

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

  const visibleItems = menuItems.filter(item => !hiddenItems.includes(item.title));

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
      <div className="min-h-screen flex w-full bg-gray-950">
        <Sidebar side="right" className="border-l border-gray-800 bg-gray-900">
          <SidebarHeader className="border-b border-gray-800 p-6">
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-3">
              <div className="relative">
                {tenantBranding?.logoUrl ? (
                  <img
                    src={tenantBranding.logoUrl}
                    alt={tenantBranding?.name || 'Studio logo'}
                    className="w-10 h-10 rounded-xl object-cover shadow-lg"
                  />
                ) : (
                  <div className="w-10 h-10 avira-gradient rounded-xl flex items-center justify-center shadow-lg">
                    <Heart className="w-5 h-5 text-gray-900" />
                  </div>
                )}
                <Camera className="w-4 h-4 text-yellow-400 absolute -top-1 -right-1" />
              </div>
              <div>
                  <h2 className="font-bold text-xl text-white avira-text-gradient">{tenantBranding?.name || 'Avira'}</h2>
                  <p className="text-xs text-gray-400">Wedding Finance Studio</p>
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
                  {!scopedRole && <GlobalSearch />}
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
          </SidebarHeader>
          
          <SidebarContent className="bg-slate-700 p-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden">
            {/* Primary nav group */}
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2">
                תפריט ראשי
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {(scopedNavItems || primaryNavItems).map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        className={`hover:bg-gray-800 hover:text-yellow-400 transition-all duration-300 rounded-xl mb-1 group ${
                          (item.url === '/' && location.pathname === '/') ||
                          (item.url !== '/' && location.pathname === item.url)
                            ? 'bg-gray-800 text-yellow-400 shadow-lg'
                            : 'text-gray-300'
                        }`}
                      >
                        <Link to={item.url} className="flex items-center gap-3 px-4 py-3">
                          <item.icon className="w-5 h-5 group-hover:scale-110 transition-transform duration-200" />
                          <span className="font-medium">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {/* Secondary nav group — collapsible (hidden entirely for scoped roles) */}
            {!scopedRole && (
            <SidebarGroup>
              <button
                onClick={() => setSecondaryOpen(prev => !prev)}
                className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-gray-400 hover:bg-gray-800 hover:text-gray-200 transition-all duration-200 group"
              >
                <span className="text-xs font-medium uppercase tracking-wider">ניהול מתקדם</span>
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${secondaryOpen ? 'rotate-180' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {secondaryOpen && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {secondaryNavItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton
                          asChild
                          className={`hover:bg-gray-700 hover:text-gray-200 transition-all duration-200 rounded-lg mb-0.5 group ${
                            (item.url !== '/' && location.pathname === item.url)
                              ? 'bg-gray-800 text-yellow-400 shadow-lg'
                              : 'text-gray-500'
                          }`}
                        >
                          <Link to={item.url} className="flex items-center gap-3 px-3 py-2">
                            <item.icon className="w-4 h-4 group-hover:scale-110 transition-transform duration-200" />
                            <span className="text-sm">{item.title}</span>
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
            <SidebarGroup className="mt-8">
              <SidebarGroupLabel className="text-xs font-medium text-gray-500 uppercase tracking-wider px-3 py-2">
                מבט מהיר
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <div className="px-4 py-3 space-y-3">
                  <Link to={createPageUrl("Events?filter=urgentStaffing")} className="flex items-center gap-3 text-sm hover:bg-gray-800/50 p-2 rounded-lg transition-colors cursor-pointer">
                    <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                    <span className="text-gray-400">חסר צוות</span>
                    <span className="ml-auto font-semibold text-orange-400">{stats.urgentStaffing}</span>
                  </Link>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                    <span className="text-gray-400">ממתינים לעריכה</span>
                    <span className="ml-auto font-semibold text-purple-400">{stats.editingBacklog}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span className="text-gray-400">לתשלום</span>
                    <span className="ml-auto font-semibold text-red-400">₪{stats.pendingCollection.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-gray-400">הכנסות החודש</span>
                    <span className="ml-auto font-semibold text-green-400">₪{stats.thisMonthIncome.toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                    <span className="text-gray-400">סה״כ אירועים</span>
                    <span className="ml-auto font-semibold text-yellow-400">{stats.totalEventsCount}</span>
                  </div>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
            )}
          </SidebarContent>

          <SidebarFooter className="bg-slate-700 p-4 flex flex-col gap-2 border-t border-gray-800">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-3 w-full text-right hover:bg-slate-600/50 rounded-lg p-1 -m-1 transition-colors">
                  <div className="w-10 h-10 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-gray-900 font-bold text-sm">
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

        <main className="flex-1 flex flex-col bg-gray-950">
          <header className="bg-gray-900/50 backdrop-blur-sm border-b border-gray-800 px-6 py-4 md:hidden">
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
      </div>
    </SidebarProvider>
  );
}