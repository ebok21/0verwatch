import { NotificationRecord } from "@overwatch/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const POLL_ALARM_NAME = "overwatch-notification-poll";
const MAX_NOTIFICATIONS_PER_MARKET = 3;
const NOTIFICATION_INTERVAL_MS = 30_000;

const deliveredIdsMemory = new Set<string>();
const marketNotificationCounts = new Map<string, number>();
const marketLastNotificationAt = new Map<string, number>();

async function acknowledgeNotificationsOnBackend(
  notificationIds: string[],
  headers: Record<string, string>
): Promise<void> {
  if (notificationIds.length === 0) return;
  try {
    await fetch(`${API_BASE_URL}/api/notifications`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ notificationIds }),
    });
  } catch {
    // Non-fatal
  }
}

async function dispatchRateLimitedNotification(params: {
  notificationId: string;
  marketId?: string;
  title: string;
  message: string;
  priority?: number;
  bypassInterval?: boolean;
}): Promise<boolean> {
  if (!params.notificationId || deliveredIdsMemory.has(params.notificationId)) {
    return false;
  }

  const storage = await chrome.storage.local
    .get(["deliveredNotificationIds"])
    .catch(() => ({ deliveredNotificationIds: [] }));
  const storedIds = new Set<string>(
    Array.isArray(storage.deliveredNotificationIds)
      ? (storage.deliveredNotificationIds as string[])
      : []
  );
  if (storedIds.has(params.notificationId)) {
    deliveredIdsMemory.add(params.notificationId);
    return false;
  }

  const marketKey = params.marketId || "default-market";
  const currentCount = marketNotificationCounts.get(marketKey) ?? 0;
  if (currentCount >= MAX_NOTIFICATIONS_PER_MARKET) {
    return false;
  }

  const lastAt = marketLastNotificationAt.get(marketKey) ?? 0;
  const now = Date.now();
  if (!params.bypassInterval && lastAt > 0 && now - lastAt < NOTIFICATION_INTERVAL_MS) {
    return false;
  }

  deliveredIdsMemory.add(params.notificationId);
  storedIds.add(params.notificationId);
  marketNotificationCounts.set(marketKey, currentCount + 1);
  marketLastNotificationAt.set(marketKey, now);

  await chrome.storage.local
    .set({
      deliveredNotificationIds: Array.from(storedIds).slice(-150),
    })
    .catch(() => {});

  chrome.notifications.create(params.notificationId, {
    type: "basic",
    iconUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    title: params.title,
    message: params.message,
    priority: params.priority ?? 2,
  });

  void acknowledgeNotificationsOnBackend([params.notificationId], {});
  return true;
}

async function pollQueuedNotifications(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(["overwatchSessionToken"]);
    const sessionToken = storage.overwatchSessionToken as string | undefined;

    const headers: Record<string, string> = {};
    if (sessionToken) {
      headers.Authorization = `Bearer ${sessionToken}`;
    }

    const res = await fetch(
      `${API_BASE_URL}/api/notifications?pendingOnly=true`,
      { headers }
    );
    if (!res.ok) return;

    const data = (await res.json()) as {
      notifications?: NotificationRecord[];
    };
    const notifications = data.notifications ?? [];
    if (notifications.length === 0) return;

    // Process in chronological order (oldest to newest among fresh unacknowledged alerts)
    const freshNotifications = [...notifications].reverse();
    const toAckIds: string[] = [];

    for (const notif of freshNotifications) {
      const ageMs = Date.now() - new Date(notif.createdAt).getTime();
      // Only pop OS banner for notifications generated within the last 60s
      if (ageMs <= 60_000) {
        await dispatchRateLimitedNotification({
          notificationId: notif.notificationId,
          marketId: notif.marketId,
          title: notif.title,
          message: notif.message,
          priority:
            notif.severity === "CRITICAL" || notif.severity === "HIGH" ? 2 : 1,
        });
      }
      toAckIds.push(notif.notificationId);
    }

    if (toAckIds.length > 0) {
      await acknowledgeNotificationsOnBackend(toAckIds, headers);
    }
  } catch {
    // MV3 service worker ignores offline/transient poll errors; Guard Watch runs persistently on backend
  }
}

export default defineBackground(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: true })
      .catch(() => {});
  }

  chrome.alarms.create(POLL_ALARM_NAME, {
    periodInMinutes: 0.5,
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM_NAME) {
      void pollQueuedNotifications();
    }
  });

  // Notify Side Panel on tab changes
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      chrome.runtime
        .sendMessage({
          type: "OVERWATCH_ACTIVE_TAB_UPDATED",
          tabId: tab.id,
          url: tab.url ?? "",
        })
        .catch(() => {});
    } catch {
      // Ignore
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === "complete") {
      chrome.runtime
        .sendMessage({
          type: "OVERWATCH_ACTIVE_TAB_UPDATED",
          tabId,
          url: tab.url ?? changeInfo.url ?? "",
        })
        .catch(() => {});
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "OVERWATCH_TRIGGER_CHROME_NOTIFICATION") {
      const notifId = msg.notificationId || `sim-notif-${Date.now()}`;
      void dispatchRateLimitedNotification({
        notificationId: notifId,
        marketId: msg.marketId,
        title: msg.title || "⚠️ 0verwatch Sentry Alert",
        message:
          msg.message ||
          "Critical match development detected against your paper position.",
        priority: 2,
        bypassInterval: Boolean(msg.bypassInterval),
      });
    } else if (msg?.type === "OVERWATCH_RESET_NOTIFICATION_CAP") {
      marketNotificationCounts.clear();
      marketLastNotificationAt.clear();
      if (msg.clearDeliveredIds) {
        deliveredIdsMemory.clear();
        void chrome.storage.local.set({ deliveredNotificationIds: [] }).catch(() => {});
      }
    } else if (msg?.type === "OVERWATCH_DEMO_POSITION_EVENT") {
      // Reset per-market notification cap when a new paper position is opened
      if (msg.action === "OPEN") {
        marketNotificationCounts.clear();
        marketLastNotificationAt.clear();
      }
    } else if (msg?.type === "OVERWATCH_POLL_NOTIFICATIONS_NOW") {
      void pollQueuedNotifications();
    }
  });
});
