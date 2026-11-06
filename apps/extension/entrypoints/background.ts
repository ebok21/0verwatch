import { NotificationRecord } from "@overwatch/shared";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const POLL_ALARM_NAME = "overwatch-notification-poll";

async function pollQueuedNotifications(): Promise<void> {
  try {
    const storage = await chrome.storage.local.get([
      "overwatchSessionToken",
      "deliveredNotificationIds",
    ]);
    const sessionToken = storage.overwatchSessionToken as string | undefined;
    const deliveredIds = new Set<string>(
      Array.isArray(storage.deliveredNotificationIds)
        ? (storage.deliveredNotificationIds as string[])
        : []
    );

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

    let updated = false;
    for (const notif of notifications) {
      if (deliveredIds.has(notif.notificationId)) continue;
      deliveredIds.add(notif.notificationId);
      updated = true;

      chrome.notifications.create(notif.notificationId, {
        type: "basic",
        iconUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        title: notif.title,
        message: notif.message,
        priority: notif.severity === "CRITICAL" || notif.severity === "HIGH" ? 2 : 1,
      });
    }

    if (updated) {
      await chrome.storage.local.set({
        deliveredNotificationIds: Array.from(deliveredIds).slice(-100),
      });
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
});
