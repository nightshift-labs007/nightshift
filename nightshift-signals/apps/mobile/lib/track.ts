import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { LiveActivity } from "../modules/live-activity";
import { api } from "./api";
import { registerBackgroundTask, showTracking } from "./background";
import type { LiveState } from "./live-state";

export interface TrackInput {
  basketId: string;
  headline: string;
  initial: LiveState;
}

/**
 * Starts lock-screen tracking until the 9:45 ET grade. iOS: a Live Activity whose push token goes to
 * the API, so the server can update it while the app is closed. Android: an ongoing notification,
 * refreshed by data-only pushes to this device's Expo push token.
 */
export async function startTracking(token: string, t: TrackInput): Promise<"ios" | "android"> {
  if (Platform.OS === "ios") {
    if (!LiveActivity.isSupported()) throw new Error("Live Activities are off for Nightshift Signals in Settings, or need iOS 16.2+.");
    const sub = LiveActivity.onPushToken(async ({ basketId, token: pushToken }) => {
      if (basketId !== t.basketId) return;
      await api("/me/live-activities", { method: "POST", token, body: JSON.stringify({ basket_id: basketId, platform: "ios", push_token: pushToken }) });
      sub.remove();
    });
    await LiveActivity.start(t.basketId, t.headline, t.initial);
    return "ios";
  }

  if (!Device.isDevice) throw new Error("Push tracking needs a physical device.");
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") throw new Error("Notifications are blocked for Nightshift Signals.");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("tracking", { name: "Basket tracking", importance: Notifications.AndroidImportance.DEFAULT });
  }
  await registerBackgroundTask();
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const { data: pushToken } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await api("/me/live-activities", { method: "POST", token, body: JSON.stringify({ basket_id: t.basketId, platform: "android", push_token: pushToken }) });
  await showTracking(t.basketId, t.headline, t.initial);
  return "android";
}
