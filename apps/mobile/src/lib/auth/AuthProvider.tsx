import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, startSupabaseAutoRefreshLifecycle } from '../supabase';
import { ensureAnonymousSession } from './anonymous';
import { AuthSessionProvider } from './session';

interface AuthState {
  /** True until the boot-time anonymous sign-in has resolved. Never gates
   *  reading a story — screens should ignore this outside the (auth) flows. */
  booting: boolean;
  supabaseSession: Session | null;
  isAnonymous: boolean;
  /**
   * Sign-out that does NOT delete anonymous content, and never leaves the
   * app without a usable session (RED LINE: reading is never gated behind
   * sign-in). Immediately re-establishes a fresh anonymous session.
   */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Mounted once at the app root (see `apps/mobile/app/_layout.tsx`), exactly
 * like the existing `SessionProvider` wrap. Bootstraps the anonymous session
 * required by DECISIONS.md §12 ("no account, no sign-in screen, before the
 * first story") and keeps local auth state (used by the merge/sign-in
 * screens under `app/(auth)/`) in sync via `onAuthStateChange`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [supabaseSession, setSupabaseSession] = useState<Session | null>(null);

  useEffect(() => {
    startSupabaseAutoRefreshLifecycle();

    let cancelled = false;
    (async () => {
      if (isSupabaseConfigured) {
        await ensureAnonymousSession().catch(() => {
          // Offline / backend unreachable on first launch. The rest of the
          // app already runs against local/mock state until a session
          // exists; (auth) screens surface the failure if the user then
          // tries to sign in explicitly.
        });
      }
      if (!cancelled) setBooting(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseSession(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useMemo(
    () => async () => {
      await supabase.auth.signOut();
      // Never leave the app signed out entirely — a fresh anonymous session
      // takes over immediately, same as first launch.
      await ensureAnonymousSession().catch(() => {});
    },
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      booting,
      supabaseSession,
      isAnonymous: supabaseSession?.user?.is_anonymous ?? true,
      signOut,
    }),
    [booting, supabaseSession, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      <AuthSessionProvider>{children}</AuthSessionProvider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
