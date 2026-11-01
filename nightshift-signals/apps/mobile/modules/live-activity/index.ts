import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";
import type { LiveState } from "../../lib/live-state";

interface PushTokenEvent {
  activityId: string;
  basketId: string;
  token: string;
}

interface NativeLiveActivity {
  isSupported(): boolean;
  start(basketId: string, headline: string, stateJson: string): Promise<string>;
  end(activityId: string): Promise<void>;
  addListener(event: "onPushToken", listener: (e: PushTokenEvent) => void): EventSubscription;
}

// iOS only; on Android and in Expo Go the native module is absent and every call is a safe no-op.
const native = requireOptionalNativeModule<NativeLiveActivity>("LiveActivity");

export const LiveActivity = {
  isSupported: () => native?.isSupported() ?? false,
  start: (basketId: string, headline: string, state: LiveState) => {
    if (!native) throw new Error("Live Activities are not available on this device.");
    return native.start(basketId, headline, JSON.stringify(state));
  },
  end: (activityId: string) => native?.end(activityId) ?? Promise.resolve(),
  onPushToken: (listener: (e: PushTokenEvent) => void): EventSubscription => native?.addListener("onPushToken", listener) ?? { remove() {} },
};
