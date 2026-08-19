import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/lib/SupabaseAuthContext';
import { isAdmin, isLeadCoordinator, isPhotographerRole } from '@/lib/permissions';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import PageNotFound from '@/lib/PageNotFound';
import Layout from './pages/Layout';

// PERF: every page below used to be a static import, so visiting any single route
// (including the two public, unauthenticated ones hit by couples with no login --
// ContractPage and EventQuestionnaire) downloaded one ~2.9MB JS bundle containing the
// entire admin app (Dashboard, Reports, Settings, every automation page, etc.) plus
// heavy libs like jsPDF/html2canvas that only ContractPage actually uses. React.lazy
// below turns each page into its own chunk, fetched only when that route is visited --
// most importantly, this means the public contract-signing/questionnaire links (the
// same flow that had the html2canvas hang bug) no longer pull in unrelated admin code,
// which meaningfully cuts load time+memory pressure on the slower mobile networks/older
// phones those pages are actually used from.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Leads = lazy(() => import('./pages/Leads'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Events = lazy(() => import('./pages/Events'));
const Packages = lazy(() => import('./pages/Packages'));
const TeamMembers = lazy(() => import('./pages/TeamMembers'));
const StaffScheduling = lazy(() => import('./pages/StaffScheduling'));
const ProgressStatus = lazy(() => import('./pages/ProgressStatus'));
const Reports = lazy(() => import('./pages/Reports'));
const Payments = lazy(() => import('./pages/Payments'));
const AllInvoicesPage = lazy(() => import('./pages/AllInvoicesPage'));
const TeamPaymentsPage = lazy(() => import('./pages/TeamPaymentsPage'));
const ContractPage = lazy(() => import('./pages/ContractPage'));
const EventQuestionnaire = lazy(() => import('./pages/EventQuestionnaire'));
const Login = lazy(() => import('./pages/Login'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const Settings = lazy(() => import('./pages/Settings'));
const AutomationsDashboard = lazy(() => import('./pages/AutomationsDashboard'));
const GoogleCalendarSync = lazy(() => import('./pages/GoogleCalendarSync'));
const AutomationLogs = lazy(() => import('./pages/AutomationLogs'));
const PendingApprovals = lazy(() => import('./pages/PendingApprovals'));
const SystemAdvisor = lazy(() => import('./pages/SystemAdvisor'));
const LeadsCoordinator = lazy(() => import('./pages/LeadsCoordinator'));
const MyEvents = lazy(() => import('./pages/MyEvents'));

// Shared fallback while a lazy page chunk downloads -- matches the existing
// auth-loading spinner's look (fixed inset-0, same spinner classes) so route-change
// loading doesn't look visually different from the app's other loading states.
const PageLoadingFallback = () => (
  <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
  </div>
);


const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin, user, isAuthenticated, logout } = useAuth();

  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-950">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      navigateToLogin();
      return null;
    }
  }

  // Hard block: if not authenticated, redirect to login regardless of app public settings
  if (!isLoadingAuth && !isAuthenticated) {
    navigateToLogin();
    return null;
  }

  // Scoped role: lead_coordinator gets the full Leads page (same one owner/admin use --
  // all tenant leads, financial fields included, can create/edit) but nothing else from
  // the admin panel is reachable, and RLS (0030_lead_coordinator_full_leads_access.sql)
  // blocks lead deletion server-side regardless of what this route shows. The original
  // narrow LeadsCoordinator.jsx page + coordinator-leads edge function are left in place,
  // unused, in case this needs reverting.
  if (!isLoadingAuth && isAuthenticated && isLeadCoordinator(user)) {
    return (
      <Layout>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={<Leads />} />
            <Route path="/Leads" element={<Leads />} />
            <Route path="/LeadsCoordinator" element={<Leads />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </Layout>
    );
  }

  // Scoped role: photographer gets a strictly read-only view of only their own
  // assigned events -- no pricing/payments, one dedicated route.
  if (!isLoadingAuth && isAuthenticated && isPhotographerRole(user)) {
    return (
      <Layout>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={<MyEvents />} />
            <Route path="/MyEvents" element={<MyEvents />} />
            <Route path="*" element={<PageNotFound />} />
          </Routes>
        </Suspense>
      </Layout>
    );
  }

  // Hard block: only owner/admin/studio_manager (ADMIN_ROLES) get the full admin panel;
  // other roles (editor, album_manager) have no scoped view yet, so stay blocked.
  if (!isLoadingAuth && isAuthenticated && !isAdmin(user)) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center bg-gray-950 text-center p-8">
        <div className="text-5xl mb-4">🔒</div>
        <h2 className="text-2xl font-bold text-white mb-2">גישה אסורה</h2>
        <p className="text-gray-400 mb-6">אין לך הרשאות אדמין לגשת למערכת זו.</p>
        <button onClick={() => logout()} className="px-6 py-2 bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold rounded-lg">התנתק</button>
      </div>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/Leads" element={<Leads />} />
          <Route path="/Calendar" element={<Calendar />} />
          <Route path="/Events" element={<Events />} />
          <Route path="/Packages" element={<Packages />} />
          <Route path="/TeamMembers" element={<TeamMembers />} />
          <Route path="/StaffScheduling" element={<StaffScheduling />} />
          <Route path="/ProgressStatus" element={<ProgressStatus />} />
          <Route path="/Reports" element={<Reports />} />
          <Route path="/Payments" element={<Payments />} />
          <Route path="/AllInvoicesPage" element={<AllInvoicesPage />} />
          <Route path="/TeamPaymentsPage" element={<TeamPaymentsPage />} />
          <Route path="/Settings" element={<Settings />} />
          <Route path="/AutomationsDashboard" element={<AutomationsDashboard />} />
          <Route path="/GoogleCalendarSync" element={<GoogleCalendarSync />} />
          <Route path="/AutomationLogs" element={<AutomationLogs />} />
          <Route path="/PendingApprovals" element={<PendingApprovals />} />
          <Route path="/SystemAdvisor" element={<SystemAdvisor />} />

          <Route path="*" element={<PageNotFound />} />
        </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <BrowserRouter>
          <Suspense fallback={<PageLoadingFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path="/contract/:leadId" element={<ContractPage />} />
              <Route path="/questionnaire/:id" element={<EventQuestionnaire />} />
              <Route path="/questionnaire" element={<EventQuestionnaire />} />
              <Route path="/login" element={<Login />} />
              <Route path="/accept-invite" element={<AcceptInvite />} />

              {/* Protected routes */}
              <Route path="/*" element={<AuthenticatedApp />} />
            </Routes>
          </Suspense>
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;