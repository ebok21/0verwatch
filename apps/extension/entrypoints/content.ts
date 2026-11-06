import { DemoMarketPositionEventSchema } from "@overwatch/shared";

export default defineContentScript({
  matches: [
    "http://localhost:3000/*",
    "http://127.0.0.1:3000/*",
    "http://localhost:3001/*",
    "http://127.0.0.1:3001/*",
  ],
  main() {
    // 1. Forward origin-validated window messages from Demo Market to Extension runtime
    window.addEventListener("message", (event) => {
      // Validate origin
      if (
        event.origin !== window.location.origin &&
        !event.origin.includes("localhost") &&
        !event.origin.includes("127.0.0.1")
      ) {
        return;
      }

      if (event.data?.source === "OVERWATCH_DEMO_MARKET" && event.data?.type === "OVERWATCH_POSITION_UPDATED") {
        const parsed = DemoMarketPositionEventSchema.safeParse(event.data);
        if (parsed.success) {
          chrome.runtime.sendMessage({
            type: "OVERWATCH_DEMO_POSITION_EVENT",
            event: parsed.data,
          }).catch(() => {});
        }
      }
    });

    // 2. DOM fallback extractor used when active tab URL lacks a clean marketId
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "OVERWATCH_EXTRACT_DOM_FALLBACK") {
        const marketEl = document.querySelector("[data-overwatch-market-id]");
        const canonicalEl = document.querySelector(
          'link[rel="canonical"]'
        ) as HTMLLinkElement | null;

        sendResponse({
          dataMarketId: marketEl?.getAttribute("data-overwatch-market-id") ?? null,
          dataPlatform: marketEl?.getAttribute("data-overwatch-platform") ?? "demo",
          canonicalHref: canonicalEl?.href ?? null,
        });
        return true;
      }
      return false;
    });
  },
});
