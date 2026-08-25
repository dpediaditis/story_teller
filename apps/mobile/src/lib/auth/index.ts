export { AuthProvider, useAuth } from './AuthProvider';
export { useSession } from './session';
export { ensureAnonymousSession } from './anonymous';
export { beginAccountUpgrade, confirmMerge, type LinkableProvider } from './upgrade';
export {
  ProviderUnavailableError,
  SignInCancelledError,
  type AuthProviderKind,
  type UpgradeOutcome,
} from './types';
