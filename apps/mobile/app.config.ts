import type { ExpoConfig } from 'expo/config';

// The design (design_v2/Papercub iOS MVP.dc.html) is a single warm-paper
// light theme — no dark-mode artboards exist — hence userInterfaceStyle: 'light'.
const config: ExpoConfig = {
  name: 'Papercub',
  slug: 'papercub',
  scheme: 'papercub',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#fbf7f0',
  },
  ios: {
    bundleIdentifier: process.env.APPLE_BUNDLE_ID ?? 'com.papercub.app',
    supportsTablet: false,
    infoPlist: {
      NSCameraUsageDescription:
        "Papercub uses the camera to photograph your child's drawing. The photo stays on this phone; only the cut-out drawing is uploaded.",
      NSPhotoLibraryUsageDescription:
        "Papercub can use a photo of your child's drawing from your library. The photo stays on this phone; only the cut-out drawing is uploaded.",
    },
  },
  plugins: ['expo-router', '@papercub/vision-module'],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    revenueCatIosKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
};

export default config;
