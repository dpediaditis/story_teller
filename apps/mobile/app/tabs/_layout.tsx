import { Tabs } from 'expo-router';
import { BookIcon, CharacterIcon, FamilyIcon } from '../../src/components';
import { colour, inkAlpha, type } from '../../src/theme';

/**
 * E-series: three tabs, no centre button — "creation lives on Characters"
 * (per docs/AGENT_BRIEFS.md). Icons are plain Views (see TabIcons.tsx), not
 * SVG or an icon font, since neither is an installed dependency.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colour.violet,
        tabBarInactiveTintColor: inkAlpha.textMuted,
        tabBarStyle: { backgroundColor: colour.paperGround, borderTopColor: inkAlpha.hairline },
        tabBarLabelStyle: { ...type.labelEyebrow, fontSize: 10.5, letterSpacing: 0 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Stories', tabBarIcon: ({ color }) => <BookIcon color={color} /> }}
      />
      <Tabs.Screen
        name="characters/index"
        options={{ title: 'Characters', tabBarIcon: ({ color }) => <CharacterIcon color={color} /> }}
      />
      <Tabs.Screen
        name="family/index"
        options={{ title: 'Family', tabBarIcon: ({ color }) => <FamilyIcon color={color} /> }}
      />
      {/* Detail/sub-routes: reachable via push, hidden from the tab bar itself. */}
      <Tabs.Screen name="characters/[id]" options={{ href: null }} />
      <Tabs.Screen name="family/privacy" options={{ href: null }} />
      <Tabs.Screen name="family/account" options={{ href: null }} />
    </Tabs>
  );
}
