import { defineConfig } from "wxt";

export default defineConfig({
  vite: () => ({
    esbuild: {
      jsx: "automatic",
    },
  }),
  manifest: {
    name: "0verwatch — Prediction Market Intelligence",
    description:
      "AI-powered research and continuous monitoring layer for prediction markets on 0G Compute.",
    version: "0.1.0",
    permissions: [
      "tabs",
      "activeTab",
      "sidePanel",
      "alarms",
      "notifications",
      "storage",
    ],
    host_permissions: [
      "http://localhost:3000/*",
      "http://127.0.0.1:3000/*",
      "http://localhost:3001/*",
      "http://127.0.0.1:3001/*",
      "https://*/*",
    ],
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Open 0verwatch Intelligence Panel",
    },
  },
});
