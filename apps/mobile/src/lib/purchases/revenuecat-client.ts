import { Platform } from 'react-native';
import type { ProductId } from '@papercub/shared';
import { PRODUCTS } from '@papercub/shared';
import { isRevenueCatConfigured, purchasesConfig } from './config';
import { optionalRequire } from './optionalRequire';
import type { Offerings, PurchaseClient, PurchaseFailureReason, PurchaseOutcome, PurchasePackage } from './types';

/**
 * Structural subset of `react-native-purchases`' public surface — just what
 * this file calls. Written by hand because the package isn't installed
 * (`pnpm add react-native-purchases` still needs to run; this agent was told
 * not to run installs — see the handover report), so there is no shipped
 * `.d.ts` to import against. Once the real package lands, this can be
 * replaced by its own types; the shape below was modelled on RevenueCat's
 * documented v7 JS API and should match closely, but treat it as unverified
 * until compiled against the real package.
 */
interface RNPurchasesProduct {
  identifier: string;
  priceString: string;
}
interface RNPurchasesPackage {
  identifier: string;
  product: RNPurchasesProduct;
}
interface RNPurchasesOffering {
  identifier: string;
  availablePackages: RNPurchasesPackage[];
}
interface RNPurchasesOfferings {
  current: RNPurchasesOffering | null;
}
interface RNPurchasesError {
  code?: string;
  userCancelled?: boolean;
  message?: string;
}
interface RNPurchasesModuleShape {
  configure(options: { apiKey: string; appUserID?: string }): void;
  logIn(appUserId: string): Promise<unknown>;
  getOfferings(): Promise<RNPurchasesOfferings>;
  purchasePackage(pkg: RNPurchasesPackage): Promise<unknown>;
  restorePurchases(): Promise<unknown>;
}

/**
 * RevenueCat's iOS SDK error codes that matter for this UI. Names come from
 * RevenueCat's `PURCHASES_ERROR_CODE` enum documentation; unverified against
 * the real package (see the header comment).
 */
const RC_ERROR_TO_REASON: Record<string, PurchaseFailureReason> = {
  NetworkError: 'network_error',
  StoreProblemError: 'store_unavailable',
  ProductNotAvailableForPurchaseError: 'store_unavailable',
  PurchaseNotAllowedError: 'not_allowed',
  ProductAlreadyPurchasedError: 'already_subscribed',
  ReceiptAlreadyInUseError: 'already_subscribed',
};

/** RC's `PurchasesPackage.product.identifier` for each of our SKUs. Same string as `ProductId`. */
const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];

function toPurchasePackage(pkg: RNPurchasesPackage): PurchasePackage | null {
  const productId = PRODUCT_IDS.find((id) => id === pkg.product.identifier);
  if (!productId) return null; // Anything RevenueCat serves that isn't one of our three SKUs is ignored, never rendered.
  return {
    packageIdentifier: pkg.identifier,
    productId,
    priceString: pkg.product.priceString,
  };
}

function classifyError(err: unknown): PurchaseFailureReason {
  const e = err as RNPurchasesError | undefined;
  if (e?.userCancelled) return 'not_allowed'; // handled separately before this is reached; kept as a safe fallback
  if (e?.code && RC_ERROR_TO_REASON[e.code]) return RC_ERROR_TO_REASON[e.code] as PurchaseFailureReason;
  return 'unknown';
}

function isCancelled(err: unknown): boolean {
  const e = err as RNPurchasesError | undefined;
  return e?.userCancelled === true || e?.code === 'PurchaseCancelledError';
}

function isPending(err: unknown): boolean {
  const e = err as RNPurchasesError | undefined;
  return e?.code === 'PaymentPendingError';
}

let configured = false;
let identifiedUid: string | null = null;

function getSdk(): RNPurchasesModuleShape | null {
  if (Platform.OS !== 'ios') return null; // §1: iOS-only key configured today; DECISIONS.md has no Android SKU yet.
  const mod = optionalRequire<{ default?: RNPurchasesModuleShape } & RNPurchasesModuleShape>('react-native-purchases');
  if (!mod) return null;
  // RevenueCat ships a default export in recent versions; fall back to the module itself for older ones.
  return (mod.default ?? mod) as RNPurchasesModuleShape;
}

function ensureConfigured(): RNPurchasesModuleShape | null {
  const sdk = getSdk();
  if (!sdk || !isRevenueCatConfigured || !purchasesConfig.revenueCatIosKey) return null;
  if (!configured) {
    sdk.configure({ apiKey: purchasesConfig.revenueCatIosKey });
    configured = true;
  }
  return sdk;
}

export const revenueCatPurchaseClient: PurchaseClient = {
  isAvailable() {
    return ensureConfigured() !== null;
  },

  async identify(parentUid: string) {
    const sdk = ensureConfigured();
    if (!sdk) return;
    if (identifiedUid === parentUid) return;
    // RevenueCat app_user_id = our Supabase parent uid, so the webhook lands
    // against the right `subscriptions` row (brief item 2 / DECISIONS.md §8).
    // Never the child's display name or any other user-facing identifier.
    await sdk.logIn(parentUid);
    identifiedUid = parentUid;
  },

  async getOfferings(): Promise<Offerings> {
    const sdk = ensureConfigured();
    if (!sdk) return { loaded: false, packages: [] };
    try {
      const offerings = await sdk.getOfferings();
      const raw = offerings.current?.availablePackages ?? [];
      const packages = raw.map(toPurchasePackage).filter((p): p is PurchasePackage => p !== null);
      return { loaded: true, packages };
    } catch {
      return { loaded: false, packages: [] };
    }
  },

  async purchasePackage(pkg: PurchasePackage): Promise<PurchaseOutcome> {
    const sdk = ensureConfigured();
    if (!sdk) return { status: 'failed', reason: 'store_unavailable' };
    try {
      // The RC package object itself, not our narrowed `PurchasePackage`,
      // is what `purchasePackage` needs — refetch offerings just-in-time
      // would be more robust, but callers always pass a package that came
      // straight from `getOfferings()` this session, so we reconstruct the
      // minimal shape the SDK call needs from what we cached.
      await sdk.purchasePackage({
        identifier: pkg.packageIdentifier,
        product: { identifier: pkg.productId, priceString: pkg.priceString },
      });
      return { status: 'purchased' };
    } catch (err) {
      if (isCancelled(err)) return { status: 'cancelled' };
      if (isPending(err)) return { status: 'pending' };
      return { status: 'failed', reason: classifyError(err) };
    }
  },

  async restorePurchases(): Promise<PurchaseOutcome> {
    const sdk = ensureConfigured();
    if (!sdk) return { status: 'failed', reason: 'store_unavailable' };
    try {
      await sdk.restorePurchases();
      // Whether this restored an active entitlement is NOT decided here —
      // the caller always re-fetches `entitlement` from the server next and
      // renders that. `purchased` just means the store call itself succeeded.
      return { status: 'purchased' };
    } catch (err) {
      if (isCancelled(err)) return { status: 'cancelled' };
      return { status: 'failed', reason: classifyError(err) };
    }
  },
};
