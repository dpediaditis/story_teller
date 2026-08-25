import Constants from 'expo-constants';

/**
 * Mirrors `apps/mobile/src/lib/auth/config.ts`'s pattern (that file is owned
 * by another agent, so this is a small local twin rather than an import).
 * `revenueCatIosKey` is already threaded through `app.config.ts` `extra` from
 * `EXPO_PUBLIC_REVENUECAT_IOS_KEY`.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

function str(key: string): string | undefined {
  const v = extra[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export const purchasesConfig = {
  revenueCatIosKey: str('revenueCatIosKey'),
};

export const isRevenueCatConfigured = Boolean(purchasesConfig.revenueCatIosKey);
