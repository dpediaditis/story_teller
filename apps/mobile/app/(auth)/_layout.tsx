import { Stack } from 'expo-router';
import { colour } from '../../src/theme';

/**
 * B5's route group. Presented as a modal stack over whatever screen prompted
 * it (paywall or "Sign in to keep the library" in Account) — never entered
 * at launch. Each screen owns its own header via `TopBar`.
 */
export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colour.paperGround },
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="merge-conflict" options={{ gestureEnabled: false }} />
      <Stack.Screen name="merge-success" options={{ gestureEnabled: false }} />
      <Stack.Screen name="sign-in-failed" />
    </Stack>
  );
}
