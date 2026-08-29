import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/lib/auth';
import { useSession } from '../src/features/session/SessionProvider';
import { colour } from '../src/theme';

/**
 * Launch gate.
 *
 * This used to be a module-level `hasOnboardedThisSession` boolean, which is
 * reset by every cold launch — so the app showed the welcome screen EVERY time
 * it was opened, in front of a family that had already set themselves up. It
 * read as "my account is gone": the library, the characters and the stories are
 * all still there on the server, but the way back to them was behind four
 * onboarding screens.
 *
 * The honest signal is the account itself. A family that has been through
 * onboarding has a child profile; one that has not, does not. That fact lives
 * on the server, survives a reinstall, and needs no local flag to stay true.
 *
 * Both providers are given the chance to answer before we decide. Redirecting
 * on a half-loaded session is how you send a returning family back through
 * onboarding — which is the bug this file is fixing.
 */
export default function Index() {
  const { booting } = useAuth();
  const { session, loading } = useSession();

  if (booting || loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colour.paperGround }}>
        <ActivityIndicator color={colour.violet} />
      </View>
    );
  }

  // No session at all means the backend was unreachable on a cold start. Send
  // them to the tabs, not to onboarding: the library renders its own offline
  // state, whereas onboarding would ask a returning family to set up an account
  // they already have.
  if (session && session.children.length === 0) {
    return <Redirect href="/onboarding/welcome" />;
  }
  return <Redirect href="/tabs" />;
}
