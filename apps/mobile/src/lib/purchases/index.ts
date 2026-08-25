export type {
  Offerings,
  PurchaseClient,
  PurchaseFailureReason,
  PurchaseOutcome,
  PurchasePackage,
} from './types';
export { mockPurchaseClient, __mockForceNextPurchaseOutcome, __mockSetRestorable } from './mock-client';
export { revenueCatPurchaseClient } from './revenuecat-client';

import { mockPurchaseClient } from './mock-client';
import { revenueCatPurchaseClient } from './revenuecat-client';

/**
 * The single purchases client every screen imports — mirrors
 * `apps/mobile/src/lib/api/index.ts`'s `apiClient` selection.
 *
 * `react-native-purchases` is not installed yet (see this package's handover
 * report), and even once it is, `revenueCatPurchaseClient.isAvailable()` is
 * false in stock Expo Go (no native module) and whenever
 * `EXPO_PUBLIC_REVENUECAT_IOS_KEY` isn't set. In every one of those cases we
 * fall back to the mock automatically, which is what keeps the app runnable
 * in Expo Go exactly as it is today. On a real dev-client/TestFlight build
 * with the key configured, the real client takes over — same call sites,
 * same paywall code, no branching in feature code.
 */
export const purchasesClient = revenueCatPurchaseClient.isAvailable()
  ? revenueCatPurchaseClient
  : mockPurchaseClient;
