import type { ProductId } from '@papercub/shared';

/**
 * RevenueCat is a CONVENIENCE LAYER, NOT AN AUTHORIZATION SOURCE
 * (DECISIONS.md §8, this package's brief). `PurchaseClient` exists only to
 * PRESENT a paywall and TRIGGER a purchase/restore. Nothing in this module —
 * or in any caller of it — may treat its return values as entitlement.
 * After every call the caller MUST re-fetch `entitlement`/`session` from the
 * server and render the server's `EntitlementSnapshot` as truth.
 */

/** One purchasable package as the store/RevenueCat presents it. */
export interface PurchasePackage {
  /** RevenueCat's package identifier within the current offering, e.g. `$rc_annual`. */
  packageIdentifier: string;
  /** Our own catalog id — DECISIONS.md §1. Always one of the three SKUs. */
  productId: ProductId;
  /** Store-localised price string, e.g. "€79.99" — never hardcode a price in UI copy. */
  priceString: string;
}

/** The current offering, already narrowed to packages we recognise. */
export interface Offerings {
  /** True once a real fetch (or the mock's canned data) has completed. */
  loaded: boolean;
  packages: PurchasePackage[];
}

/**
 * Why a purchase/restore did not end in a completed transaction. Every value
 * here must be handleable by the paywall without leaving the user stuck —
 * see this package's brief, "Handle" list.
 */
export type PurchaseFailureReason =
  | 'network_error'
  | 'store_unavailable'
  | 'already_subscribed'
  | 'not_allowed'
  | 'unknown';

export type PurchaseOutcome =
  /** Transaction completed store-side. Still NOT entitlement — reconcile with the server next. */
  | { status: 'purchased' }
  /** Awaiting approval — Ask to Buy / SCA / bank confirmation. Not a failure, not yet a grant. */
  | { status: 'pending' }
  /** The parent backed out of the sheet. Not an error; show nothing scary. */
  | { status: 'cancelled' }
  /** Restore found no active purchase for this store account. Distinct from an error. */
  | { status: 'nothing_to_restore' }
  | { status: 'failed'; reason: PurchaseFailureReason };

/**
 * Mirrors `apps/mobile/src/lib/api/client.ts`'s mock/real split. One
 * interface, a mock implementation the app runs on today, and a RevenueCat
 * implementation that is only ever selected once `react-native-purchases` is
 * actually installed and configured.
 */
export interface PurchaseClient {
  /** False in Expo Go / whenever the native SDK isn't linked. Callers must check this before assuming purchasePackage/restorePurchases will do anything store-side. */
  isAvailable(): boolean;

  /**
   * Identifies the RevenueCat app user id as our own Supabase parent uid, so
   * the RevenueCat webhook lands against the right account (this package's
   * brief item 2). Safe to call repeatedly with the same id; a no-op on the
   * mock.
   */
  identify(parentUid: string): Promise<void>;

  getOfferings(): Promise<Offerings>;

  purchasePackage(pkg: PurchasePackage): Promise<PurchaseOutcome>;

  /** App Review requires this be reachable from the paywall at all times. */
  restorePurchases(): Promise<PurchaseOutcome>;
}
