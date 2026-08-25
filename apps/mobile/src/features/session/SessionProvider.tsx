import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GetSessionResponse } from '@papercub/shared';
import { apiClient } from '../../lib/api';

interface SessionState {
  session: GetSessionResponse | null;
  loading: boolean;
  /** True after a failed getSession with no cached session — drives the offline/nothing-cached state. */
  offlineNoCache: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

/**
 * One call on launch (CLAUDE.md contract note: "One call the app makes on
 * launch and on foreground"). Reading is never gated behind this — screens
 * that only read cached/local data must not block on `loading`.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<GetSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offlineNoCache, setOfflineNoCache] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await apiClient.call('getSession', undefined);
      setSession(res);
      setOfflineNoCache(false);
    } catch {
      setOfflineNoCache((prev) => prev && true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ session, loading, offlineNoCache, refresh }),
    [session, loading, offlineNoCache, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
