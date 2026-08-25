import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GetSessionResponse } from '@papercub/shared';
import { supabase, isSupabaseConfigured } from '../supabase';
import { invokeAuthFn } from './functions';

/**
 * The real, backend-backed twin of `src/features/session/SessionProvider`
 * (which is B3's mock-`apiClient` version, still used to drive every screen
 * in this Expo-Go-only build). This one calls the live `session` Edge
 * Function and re-fetches on every Supabase auth state change, so it is the
 * hook `apps/mobile/src/lib/auth/**` uses internally after a sign-in/merge —
 * per this agent's brief item 7 ("A `useSession()` hook the rest of the app
 * can consume"). Wiring the REST of the app onto this real session (instead
 * of the mock) is an integration decision outside B5's owned paths — see the
 * handover report.
 *
 * RED LINE (CLAUDE.md / brief): the client never asserts entitlement or
 * quota — every value here comes straight from the server's
 * `GetSessionResponse`, re-fetched after any auth change, never computed or
 * cached-and-trusted locally.
 */
interface AuthSessionState {
  session: GetSessionResponse | null;
  loading: boolean;
  error: boolean;
  refresh: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionState | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GetSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const res = await invokeAuthFn('session', GetSessionResponse, undefined, 'GET');
      setSession(res);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const value = useMemo(() => ({ session, loading, error, refresh }), [session, loading, error, refresh]);

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

/** The `useSession()` hook required by this agent's brief item 7. */
export function useSession(): AuthSessionState {
  const ctx = useContext(AuthSessionContext);
  if (!ctx) throw new Error('useSession must be used within AuthSessionProvider');
  return ctx;
}
