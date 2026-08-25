import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import { authConfig, isGoogleSignInConfigured } from '../config';
import { ProviderUnavailableError, SignInCancelledError } from '../types';
import type { ProviderCredential } from './apple';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
};

/**
 * Native id_token flow via `expo-auth-session` (no `@react-native-google-
 * signin/google-signin` dependency — that's a native module this app does
 * not install, and would break the stock-Expo-Go requirement). Requires
 * `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (and ideally
 * `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`) to be provisioned — see
 * `app.config.ts`. Until then this surfaces `ProviderUnavailableError`
 * rather than a broken button.
 */
export async function getGoogleCredential(): Promise<ProviderCredential> {
  if (!isGoogleSignInConfigured) {
    throw new ProviderUnavailableError('google', 'Google sign-in is not configured (missing client id).');
  }

  const clientId = authConfig.googleIosClientId ?? authConfig.googleWebClientId!;
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  const request = new AuthSession.AuthRequest({
    clientId,
    scopes: ['openid', 'email', 'profile'],
    redirectUri: AuthSession.makeRedirectUri({ scheme: 'papercub' }),
    responseType: AuthSession.ResponseType.IdToken,
    extraParams: { nonce: hashedNonce },
  });

  const result = await request.promptAsync(GOOGLE_DISCOVERY);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new SignInCancelledError('google');
  }
  if (result.type !== 'success' || !result.params.id_token) {
    throw new ProviderUnavailableError('google', `Google sign-in did not complete (${result.type}).`);
  }

  return { idToken: result.params.id_token, nonce: rawNonce };
}
