import type { ExpoConfig } from "expo/config";

// Native identifiers and the API URL come from the environment so nothing vendor-specific is hard-coded.
const bundleId = process.env.APP_BUNDLE_ID ?? "com.nightshiftsignals.app";

const config: ExpoConfig = {
  name: "Nightshift Signals",
  slug: "nightshift-signals",
  scheme: "nightshiftsignals",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: bundleId,
    appleTeamId: process.env.APPLE_TEAM_ID,
    supportsTablet: false,
    infoPlist: {
      // Lock-screen tracking: Live Activities updated by APNs pushes overnight.
      NSSupportsLiveActivities: true,
      NSSupportsLiveActivitiesFrequentUpdates: true,
      UIBackgroundModes: ["remote-notification"],
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE ?? bundleId,
    permissions: ["POST_NOTIFICATIONS"],
  },
  plugins: ["expo-router", "expo-secure-store", ["expo-notifications", { enableBackgroundRemoteNotifications: true }], "@bacons/apple-targets"],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787",
    appUrl: process.env.EXPO_PUBLIC_APP_URL ?? "http://localhost:3000",
    eas: { projectId: process.env.EAS_PROJECT_ID },
  },
  experiments: { typedRoutes: false },
};

export default config;
