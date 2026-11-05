import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/web/src/__tests__/**/*.test.ts"],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./apps/web/src"),
      "@overwatch/shared": path.resolve(
        __dirname,
        "./packages/shared/src/index.ts"
      ),
    },
  },
});

