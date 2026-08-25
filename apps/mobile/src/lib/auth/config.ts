import Constants from 'expo-constants';

/**
 * Reads the handful of auth-related values threaded through
 * `apps/mobile/app.config.ts` `extra`. Every value is optional at the type
 * level because the app must still boot in stock Expo Go / CI without real
 * project credentials — screens that need a missing value show an
 * unavailable state rather than throwing at import time.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function str(key: string): string | undefined {
  const v = extra[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export const authConfig = {
  supabaseUrl: str('supabaseUrl'),
  supabaseAnonKey: str('supabaseAnonKey'),
  /** OAuth client id for the iOS bundle, used by the Google id_token flow. */
  googleIosClientId: str('googleIosClientId'),
  /** "Web" client id — required by Google as the `client_id` on the token
   *  request even for the native/iOS flow. */
  googleWebClientId: str('googleWebClientId'),
};

export const isSupabaseConfigured = Boolean(authConfig.supabaseUrl && authConfig.supabaseAnonKey);
export const isGoogleSignInConfigured = Boolean(authConfig.googleWebClientId);
