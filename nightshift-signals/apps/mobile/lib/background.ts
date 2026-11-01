import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { notificationText, type LiveState } from "./live-state";

// Android lock-screen tracking: the server sends data-only pushes; this task turns each into an
// ongoing (sticky) notification for the basket, and a dismissible one when it is graded.
export const LIVE_TASK = "nightshift-signals-live-update";

interface LivePush {
  kind: "nightshift-signals.live";
  event: "update" | "end";
  basketId: string;
  state: LiveState;
}

export async function showTracking(basketId: string, headline: string, state: LiveState, ending = false) {
  const { title, body } = notificationText(headline, state);
  await Notifications.scheduleNotificationAsync({
    identifier: `live-${basketId}`,
    content: { title, body, sticky: !ending, autoDismiss: ending, data: { basketId, headline } },
    trigger: null,
  });
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(LIVE_TASK, async ({ data, error }) => {
  if (error || !data || !("data" in data) || typeof data.data?.dataString !== "string") return;
  let push: LivePush;
  try {
    push = JSON.parse(data.data.dataString) as LivePush;
  } catch {
    return;
  }
  if (push.kind !== "nightshift-signals.live") return;
  const shown = (await Notifications.getPresentedNotificationsAsync()).find((n) => n.request.identifier === `live-${push.basketId}`);
  const headline = (shown?.request.content.data?.headline as string | undefined) ?? "Nightshift Signals basket";
  await showTracking(push.basketId, headline, push.state, push.event === "end");
});

export async function registerBackgroundTask() {
  if (!(await TaskManager.isTaskRegisteredAsync(LIVE_TASK))) await Notifications.registerTaskAsync(LIVE_TASK);
}
