import { supabase, isSupabaseConfigured } from '../supabase';

/**
 * DECISIONS.md §7 / §12: anonymous sign-in at first launch, no account and no
 * sign-in screen before the first story. Called once from `AuthProvider` on
 * boot. Idempotent — if a session (anonymous or otherwise) already exists in
 * SecureStore from a previous launch, this is a no-op; `autoRefreshToken`
 * keeps it alive.
 *
 * Deliberately swallows nothing silently: a failure here means the device is
 * offline or the backend is unreachable on first launch. The caller decides
 * how to render that (never a permanent spinner — CLAUDE.md "Client: no
 * try/catch that swallows").
 */
export async function ensureAnonymousSession(): Promise<void> {
  if (!isSupabaseConfigured) {
    // No backend configured (bare Expo Go preview / CI). The rest of the app
    // already runs on `mockApiClient` in that mode — nothing to bootstrap.
    return;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session) return; // already signed in — anonymous or upgraded, doesn't matter

  const { error: signInError } = await supabase.auth.signInAnonymously();
  if (signInError) throw signInError;
}
