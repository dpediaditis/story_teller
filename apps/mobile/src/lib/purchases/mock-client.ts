import { PRODUCTS, type ProductId } from '@papercub/shared';
import { __mockGrantTopup, __mockSetEntitlement } from '../api';
import type { Offerings, PurchaseClient, PurchaseOutcome, PurchasePackage } from './types';

/**
 * Runs the app in Expo Go exactly like `mockApiClient` does for the rest of
 * the network layer. A "purchase" here flips the mock server's entitlement
 * (`__mockSetEntitlement` / `__mockGrantTopup` from `lib/api`) so that the
 * subsequent `apiClient.call('refreshEntitlement', ...)` the paywall makes —
 * unconditionally, on every path — comes back looking like a real
 * server-confirmed subscription. Nothing here is treated as entitlement by
 * itself; it only seeds what the "server" (the mock) will say next.
 */
const MOCK_PACKAGES: PurchasePackage[] = [
  { packageIdentifier: '$rc_annual', productId: 'papercub_family_annual', priceString: PRODUCTS.papercub_family_annual.displayPriceEUR },
  { packageIdentifier: '$rc_monthly', productId: 'papercub_family_monthly', priceString: PRODUCTS.papercub_family_monthly.displayPriceEUR },
  { packageIdentifier: '$rc_topup_3', productId: 'papercub_topup_3', priceString: PRODUCTS.papercub_topup_3.displayPriceEUR },
];

/** Toggle from a debug menu to exercise the non-happy paths in the mock. */
let forcedOutcome: PurchaseOutcome | null = null;
export function __mockForceNextPurchaseOutcome(outcome: PurchaseOutcome | null) {
  forcedOutcome = outcome;
}

let restoreHasEntitlement = false;
/** Simulate "this store account already owns a subscription" for restore testing. */
export function __mockSetRestorable(hasEntitlement: boolean) {
  restoreHasEntitlement = hasEntitlement;
}

function applyProduct(productId: ProductId) {
  if (productId === 'papercub_topup_3') {
    __mockGrantTopup();
  } else {
    __mockSetEntitlement('family');
  }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

export const mockPurchaseClient: PurchaseClient = {
  isAvailable() {
    return true;
  },

  async identify() {
    // No real SDK to log in to.
  },

  async getOfferings(): Promise<Offerings> {
    await settle();
    return { loaded: true, packages: MOCK_PACKAGES };
  },

  async purchasePackage(pkg: PurchasePackage): Promise<PurchaseOutcome> {
    await settle();
    if (forcedOutcome) {
      const outcome = forcedOutcome;
      forcedOutcome = null;
      return outcome;
    }
    applyProduct(pkg.productId);
    restoreHasEntitlement = true;
    return { status: 'purchased' };
  },

  async restorePurchases(): Promise<PurchaseOutcome> {
    await settle();
    if (forcedOutcome) {
      const outcome = forcedOutcome;
      forcedOutcome = null;
      return outcome;
    }
    if (!restoreHasEntitlement) {
      return { status: 'nothing_to_restore' };
    }
    __mockSetEntitlement('family');
    return { status: 'purchased' };
  },
};
