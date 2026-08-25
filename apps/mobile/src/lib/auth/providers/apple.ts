import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { ProviderUnavailableError, SignInCancelledError } from '../types';

export interface ProviderCredential {
  idToken: string;
  /** Raw (unhashed) nonce — Supabase verifies it against the hash embedded
   *  in the id token by the provider. */
  nonce: string;
}

/**
 * Sign in with Apple is mandatory here (App Review Guideline 4.8: an app
 * offering a third-party login — Google — must also offer Apple). Guarded so
 * the module loads fine in Expo Go / Android / a device not signed into
 * iCloud; those surface as `ProviderUnavailableError`, never a generic
 * sign-in failure.
 */
export async function getAppleCredential(): Promise<ProviderCredential> {
  const available = await AppleAuthentication.isAvailableAsync().catch(() => false);
  if (!available) {
    throw new ProviderUnavailableError('apple', 'Sign in with Apple is not available on this device/build.');
  }

  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    if (!credential.identityToken) {
      throw new ProviderUnavailableError('apple', 'Apple did not return an identity token.');
    }

    return { idToken: credential.identityToken, nonce: rawNonce };
  } catch (e: unknown) {
    // expo-apple-authentication rejects with code 'ERR_REQUEST_CANCELED' when
    // the user dismisses the sheet — that is not a failure.
    const code = (e as { code?: string } | null)?.code;
    if (code === 'ERR_REQUEST_CANCELED') {
      throw new SignInCancelledError('apple');
    }
    throw e;
  }
}
