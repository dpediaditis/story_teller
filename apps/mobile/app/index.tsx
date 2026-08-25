import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import { colour } from '../src/theme';

/**
 * Launch gate: show onboarding once, then always land on the tabs. Persisted
 * only in memory for this pass — a real build would back this with
 * SecureStore/AsyncStorage (out of scope: no such dependency is installed
 * yet, and this file does not touch src/lib/auth*).
 */
let hasOnboardedThisSession = false;

export default function Index() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 0);
    return () => clearTimeout(t);
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colour.paperGround }}>
        <ActivityIndicator color={colour.violet} />
      </View>
    );
  }

  if (!hasOnboardedThisSession) {
    hasOnboardedThisSession = true;
    return <Redirect href="/onboarding/welcome" />;
  }
  return <Redirect href="/tabs" />;
}
