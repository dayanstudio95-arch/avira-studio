import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { queryClientInstance } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/lib/SupabaseAuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import PageNotFound from '@/lib/PageNotFound';
import Layout from './pages/Layout';

import Dashboard from './pages/Dashboard';
import Leads from './pages/Leads';
import Calendar from './pages/Calendar';
import Events from './pages/Events';
import Packages from './pages/Packages';
import TeamMembers from './pages/TeamMembers';
import StaffScheduling from './pages/StaffScheduling';
import ProgressStatus from './pages/ProgressStatus';
import Reports from './pages/Reports';
import Payments from './pages/Payments';
import AllInvoicesPage from './pages/AllInvoicesPage';
import TeamPaymentsPage from './pages/TeamPaymentsPage';
import ContractPage from './pages/ContractPage';
import EventQuestionnaire from './pages/EventQuestionnaire';
import Login from './pages/Login';
import AcceptInvite from './pages/AcceptInvite';
import Settings from './pages/Settings';
import AutomationsDashboard from './pages/AutomationsDashboard';
import AutomationLogs from './pages/AutomationLogs';
import PendingApprovals from './pages/PendingApprovals';
import SystemAdvisor from './pages/SystemAdvisor';


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

  // Hard block: only owner/admin/studio_manager get the full admin panel;
  // other roles (photographer, editor, album_manager) will get scoped views later.
  if (!isLoadingAuth && isAuthenticated && !['owner', 'admin', 'studio_manager'].includes(user?.role)) {
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
        <Route path="/AutomationLogs" element={<AutomationLogs />} />
        <Route path="/PendingApprovals" element={<PendingApprovals />} />
        <Route path="/SystemAdvisor" element={<SystemAdvisor />} />

        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Layout>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <BrowserRouter>
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
          <Toaster />
        </BrowserRouter>
      </QueryClientProvider>
    </AuthProvider>
  );
}

export default App;