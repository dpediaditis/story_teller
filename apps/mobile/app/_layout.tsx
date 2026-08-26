import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { SessionProvider } from '../src/features/session/SessionProvider';
import { AuthProvider } from '../src/lib/auth';
import { colour } from '../src/theme';

/**
 * App shell: gesture root + safe-area + session bootstrap, then a plain Stack
 * so every top-level route group (onboarding, tabs, create, story, paywall)
 * controls its own header. No native module is imported here that would
 * crash Expo Go — vision-module usage is guarded behind `isAvailable()` at
 * the call site (src/features/create), never at module scope.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* Anonymous sign-in at first launch lives here (DECISIONS.md §12) —
            AuthProvider bootstraps it before anything else mounts, with no
            screen of its own. It MUST wrap SessionProvider: the session is now
            the live one (DECISIONS.md §13 resolved), and calling the `session`
            Edge Function before an anonymous JWT exists returns 401. */}
        <AuthProvider>
          <SessionProvider>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colour.paperGround },
              }}
            >
              <Stack.Screen name="tabs" />
              <Stack.Screen name="onboarding" />
              <Stack.Screen name="create" />
              <Stack.Screen name="story" />
              <Stack.Screen
                name="paywall"
                options={{ presentation: 'modal' }}
              />
              <Stack.Screen
                name="parental-gate"
                options={{ presentation: 'transparentModal', animation: 'fade' }}
              />
              <Stack.Screen
                name="(auth)"
                options={{ presentation: 'modal' }}
              />
            </Stack>
          </SessionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
