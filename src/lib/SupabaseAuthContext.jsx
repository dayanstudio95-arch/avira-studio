import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/supabaseClient';

// Replaces src/lib/AuthContext.jsx once the app is cut over to Supabase.
// Exposes the exact same shape consumed by App.jsx (`user`, `isAuthenticated`,
// `isLoadingAuth`, `isLoadingPublicSettings`, `authError`, `appPublicSettings`,
// `logout`, `navigateToLogin`, `checkAppState`) so the swap is a one-line import change.
const AuthContext = createContext();

const isPublicRoute = () => {
  const path = window.location.pathname;
  return path.startsWith('/questionnaire') || path.startsWith('/contract');
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  // Tenant-level financial defaults (VAT %/deposit amount) -- loaded alongside
  // the profile so every consuming component reads them the same way user/profile
  // are already read elsewhere, instead of each form doing its own Tenant.get().
  // Read-at-use-time only -- see FinancialDefaultsCard.jsx's own comment for the
  // snapshot-discipline rationale (never joined back live into existing records).
  const [tenantDefaults, setTenantDefaults] = useState({ defaultVatPercent: 18, defaultDepositAmount: 500 });

  useEffect(() => {
    if (isPublicRoute()) {
      setIsLoadingAuth(false);
      return;
    }

    let mounted = true;

    const loadSession = async (session) => {
      if (!session) {
        if (!mounted) return;
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
        setIsLoadingAuth(false);
        return;
      }

      // profiles row carries tenant_id + role; a Supabase-authenticated user
      // with no profile row is a signed-up-but-not-provisioned account (SaaS onboarding case).
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('id, tenant_id, role, full_name, phone')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!mounted) return;

      if (error || !profile) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'user_not_registered', message: 'No studio profile linked to this account' });
        setIsLoadingAuth(false);
        return;
      }

      setUser({ id: session.user.id, email: session.user.email, ...profile });
      setIsAuthenticated(true);
      setAuthError(null);
      setIsLoadingAuth(false);

      // Best-effort, non-blocking: fetch the tenant's financial defaults.
      // Never blocks/fails auth if this errors (e.g. RLS edge cases) -- falls
      // back to the same 18/500 hardcoded defaults used throughout the app.
      if (profile.tenant_id) {
        supabase
          .from('tenants')
          .select('default_vat_percent, default_deposit_amount')
          .eq('id', profile.tenant_id)
          .maybeSingle()
          .then(({ data }) => {
            if (!mounted || !data) return;
            setTenantDefaults({
              defaultVatPercent: data.default_vat_percent ?? 18,
              defaultDepositAmount: data.default_deposit_amount ?? 500,
            });
          })
          .catch(() => {});
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => loadSession(session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsLoadingAuth(true);
      loadSession(session);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const logout = async (shouldRedirect = true) => {
    await supabase.auth.signOut();
    setUser(null);
    setIsAuthenticated(false);
    if (shouldRedirect) {
      window.location.href = '/login';
    }
  };

  const navigateToLogin = () => {
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      tenantDefaults,
      appPublicSettings: null,
      logout,
      navigateToLogin,
      checkAppState: () => {},
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
