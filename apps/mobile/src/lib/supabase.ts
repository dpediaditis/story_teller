import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@papercub/shared';
import { authConfig, isSupabaseConfigured } from './auth/config';
import { secureStoreAdapter } from './auth/secureStoreAdapter';

/**
 * The one Supabase client for the app. Session persistence goes through
 * `expo-secure-store` (Keychain/Keystore) — CLAUDE.md rule 1's spirit
 * extended to auth tokens: AsyncStorage is unencrypted and must never hold a
 * session. `autoRefreshToken` keeps the access token fresh; the AppState
 * listener below starts/stops that refresh loop with foreground state, which
 * is the documented RN pattern (Supabase's timers otherwise keep firing while
 * backgrounded and drain the battery / can throw on some Android versions).
 *
 * `isSupabaseConfigured` is false in CI / a bare Expo Go preview with no
 * `EXPO_PUBLIC_SUPABASE_URL` set — the client still constructs (against a
 * placeholder host) so importing this module never crashes the app; callers
 * that need a real session should check `isSupabaseConfigured` first.
 */
export const supabase = createClient<Database>(
  authConfig.supabaseUrl ?? 'https://placeholder.supabase.co',
  authConfig.supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      storage: secureStoreAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

let appStateSubscribed = false;

/** Call once, near app boot (see `AuthProvider`). Idempotent. */
export function startSupabaseAutoRefreshLifecycle(): void {
  if (appStateSubscribed) return;
  appStateSubscribed = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}

export { isSupabaseConfigured };
