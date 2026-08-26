import type { ReactNode } from 'react';
import { AuthSessionProvider, useSession as useAuthSession } from '../../lib/auth/session';

/**
 * DECISIONS.md §13 is now resolved: this is a thin re-export of B5's real,
 * backend-backed session, not a second implementation beside it.
 *
 * There used to be two providers mounted at once — this one reading the mock
 * `apiClient`, and B5's `AuthSessionProvider` calling the live `session` Edge
 * Function — which was deliberate while there was no Supabase project to point
 * at. There is one now, so the mock session path is gone and every screen that
 * imports `useSession` from here gets the live session, re-fetched on every
 * Supabase auth state change.
 *
 * The name and shape are kept so no screen had to change. `offlineNoCache` maps
 * onto the real hook's `error`: both mean "we asked the server and have nothing
 * to show", which is the state the design renders as offline.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  return <AuthSessionProvider>{children}</AuthSessionProvider>;
}

export function useSession() {
  const { session, loading, error, refresh } = useAuthSession();
  return { session, loading, offlineNoCache: error && session === null, refresh };
}
