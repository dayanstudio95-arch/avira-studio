import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import { supabase } from '@/api/supabaseClient';

// Replaces src/lib/AuthContext.jsx once the app is cut over to Supabase.
// Exposes the exact same shape consumed by App.jsx (`user`, `isAuthenticated`,
// `isLoadingAuth`, `isLoadingPublicSettings`, `authError`, `appPublicSettings`,
// `logout`, `navigateToLogin`, `checkAppState`) so the swap is a one-line import change.
const AuthContext = createContext();

// The modules Studio Plan sells one by one; Avira has these on (films/video galleries off). Same list as
// tenant_has_module in migration 0095.
const AVIRA_MODULES = ['photos', 'crm'];

const isPublicRoute = () => {
  const path = window.location.pathname;
  return path.startsWith('/questionnaire') || path.startsWith('/contract');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const looksLikeAuthError = (e) =>
  e && (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt/i.test(String(e.message || '')));

// The profile lookup, tried up to three times. A login-token error refreshes the session
// before the next try. Returns { profile } (null = no profile row) or { error }.
async function loadProfileWithRetry(userId, isMounted) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      if (looksLikeAuthError(lastError)) await supabase.auth.refreshSession().catch(() => {});
      await sleep(attempt * 1200);
      if (!isMounted()) return { error: null, profile: null };
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, tenant_id, role, full_name, phone')
        .eq('id', userId)
        .maybeSingle();
      if (!error) return { profile: data || null, error: null };
      lastError = error;
    } catch (e) {
      lastError = e;
    }
  }
  console.error('[auth] profile lookup failed after 3 tries:', lastError);
  return { error: lastError || new Error('unknown error'), profile: null };
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState(null);
  // Who is signed in right now — lets the auth listener ignore events about the same user.
  const currentUserIdRef = useRef(null);
  // "נסה שוב" on the connection-problem screen re-runs the session check (set below).
  const retryRef = useRef(null);
  // Tenant-level financial defaults (VAT %/deposit amount) -- loaded alongside
  // the profile so every consuming component reads them the same way user/profile
  // are already read elsewhere, instead of each form doing its own Tenant.get().
  // Read-at-use-time only -- see FinancialDefaultsCard.jsx's own comment for the
  // snapshot-discipline rationale (never joined back live into existing records).
  const [tenantDefaults, setTenantDefaults] = useState({ defaultVatPercent: 18, defaultDepositAmount: 500 });
  // The studio row the photo galleries' screens read (src/pages/films, from Studio Plan): name, address in links
  // (slug), logo and colour. Its own query, so a failure here never touches the financial defaults above.
  const [tenant, setTenant] = useState(null);

  useEffect(() => {
    if (isPublicRoute()) {
      setIsLoadingAuth(false);
      return;
    }

    let mounted = true;

    const loadSession = async (session) => {
      if (!session) {
        if (!mounted) return;
        currentUserIdRef.current = null;
        setUser(null);
        setIsAuthenticated(false);
        setAuthError(null);
        setIsLoadingAuth(false);
        return;
      }

      // profiles row carries tenant_id + role; a Supabase-authenticated user
      // with no profile row is a signed-up-but-not-provisioned account (SaaS onboarding case).
      //
      // 2026-10-14: a FAILED lookup (network blip, expired token, a server hiccup) used to be
      // shown as "Access Restricted — you are not registered", which never retried and sent
      // the owner hunting for a permissions problem that did not exist. Now: up to three
      // tries (refreshing the login in between), and a real error is shown as a connection
      // problem with "נסה שוב". "Not registered" only when the lookup worked and found nothing.
      const { profile, error } = await loadProfileWithRetry(session.user.id, () => mounted);

      if (!mounted) return;

      if (error) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'connection', message: error.message || String(error), code: error.code || error.status || null });
        setIsLoadingAuth(false);
        return;
      }
      if (!profile) {
        setUser(null);
        setIsAuthenticated(false);
        setAuthError({ type: 'user_not_registered', message: 'No studio profile linked to this account' });
        setIsLoadingAuth(false);
        return;
      }

      try { sessionStorage.removeItem('auth_auto_retries'); } catch { /* private mode */ }
      currentUserIdRef.current = session.user.id;
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
        supabase
          .from('tenants')
          .select('id, name, display_name_to_clients, logo_url, slug, accent_color')
          .eq('id', profile.tenant_id)
          .maybeSingle()
          .then(({ data }) => { if (mounted && data) setTenant(data); })
          .catch(() => {});
      }
    };

    supabase.auth.getSession()
      .then(({ data: { session } }) => loadSession(session))
      .catch((e) => {
        if (!mounted) return;
        setAuthError({ type: 'connection', message: e?.message || String(e), code: null });
        setIsLoadingAuth(false);
      });
    retryRef.current = async () => {
      setIsLoadingAuth(true);
      setAuthError(null);
      const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
      await loadSession(session);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // UX-01 (audit 2026-10-05): Supabase fires SIGNED_IN when the tab comes back to the
      // foreground and TOKEN_REFRESHED about every hour — for the SAME user. Each one used to
      // set isLoadingAuth, App.jsx swapped the whole app for a spinner, and every open screen
      // remounted: a half-filled form was simply gone. Same user → nothing to do. A real
      // change (sign-in as someone else, sign-out) still goes through the full reload.
      const sameUser = !!session?.user?.id && session.user.id === currentUserIdRef.current;
      if (sameUser && event !== 'USER_UPDATED') return;
      if (!sameUser) setIsLoadingAuth(true);
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

  // Remembers where you were going (2026-10-05): "אווירה צ'אט" opens at /chat from the
  // iPhone home screen, and after logging in it must come back there, not to the
  // dashboard.
  const navigateToLogin = () => {
    const here = window.location.pathname + window.location.search;
    const next = here && here !== '/' && !here.startsWith('/login') ? `?next=${encodeURIComponent(here)}` : '';
    window.location.href = `/login${next}`;
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError,
      tenantDefaults,
      tenant,
      // Studio Plan's per-studio modules, fixed for Avira: photo galleries and the CRM on, films off.
      hasModule: (key) => AVIRA_MODULES.includes(key),
      appPublicSettings: null,
      logout,
      navigateToLogin,
      retryAuth: () => retryRef.current?.(),
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
