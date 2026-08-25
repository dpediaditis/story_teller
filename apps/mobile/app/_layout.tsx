import { Slot } from 'expo-router';

// TODO(B3): wrap with providers (Supabase session, SafeAreaProvider, theme,
// RevenueCat) and the real navigation shell once those are built.
export default function RootLayout() {
  return <Slot />;
}
