import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DemoMarketAdapter, defaultDemoMarketAdapter } from "@overwatch/shared";
import { startMockMarketServer, stopMockMarketServer } from "../mock-market/server";
import { CORS_HEADERS } from "../lib/http";
import fs from "fs";
import path from "path";

describe("Phase 2 — Local Development Server & Extension Origin Fixes", () => {
  const TEST_MOCK_PORT = 3001;

  beforeAll(async () => {
    await startMockMarketServer(TEST_MOCK_PORT);
  });

  afterAll(async () => {
    await stopMockMarketServer();
  });

  describe("1. DemoMarketAdapter Hostname & URL Recognition", () => {
    const adapter = new DemoMarketAdapter();

    it("recognizes http://localhost:3001/markets/{marketId}", () => {
      const url = "http://localhost:3001/markets/ind-nz-over-15";
      expect(adapter.canHandleUrl(url)).toBe(true);

      const parsed = adapter.extractFromUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed?.platform).toBe("demo");
      expect(parsed?.marketId).toBe("ind-nz-over-15");
      expect(parsed?.detectedVia).toBe("url");
      expect(parsed?.sourceUrl).toBe(url);
    });

    it("recognizes http://127.0.0.1:3001/markets/{marketId}", () => {
      const url = "http://127.0.0.1:3001/markets/ind-nz-over-15";
      expect(adapter.canHandleUrl(url)).toBe(true);

      const parsed = adapter.extractFromUrl(url);
      expect(parsed).not.toBeNull();
      expect(parsed?.platform).toBe("demo");
      expect(parsed?.marketId).toBe("ind-nz-over-15");
      expect(parsed?.detectedVia).toBe("url");
      expect(parsed?.sourceUrl).toBe(url);
    });

    it("supports legacy port 3000 local dev URL", () => {
      const url = "http://localhost:3000/markets/ind-nz-over-15";
      expect(adapter.canHandleUrl(url)).toBe(true);

      const parsed = adapter.extractFromUrl(url);
      expect(parsed?.marketId).toBe("ind-nz-over-15");
    });

    it("rejects non-local origins", () => {
      expect(adapter.canHandleUrl("http://unauthorized-domain.com/markets/ind-nz-over-15")).toBe(false);
      expect(adapter.extractFromUrl("http://unauthorized-domain.com/markets/ind-nz-over-15")).toBeNull();
    });

    it("extracts market via DOM fallback when attributes are present", () => {
      const fallback = defaultDemoMarketAdapter.extractFromDomFallback({
        dataMarketId: "ind-nz-over-15",
        dataPlatform: "OVERWATCH_DEMO",
      });
      expect(fallback).not.toBeNull();
      expect(fallback?.marketId).toBe("ind-nz-over-15");
      expect(fallback?.detectedVia).toBe("dom");
    });
  });

  describe("2. Mock Prediction Market Server on Port 3001", () => {
    it("responds to /api/health with status 200 and port 3001", async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_MOCK_PORT}/api/health`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.status).toBe("healthy");
      expect(data.app).toBe("overwatch-mock-market");
      expect(data.port).toBe(TEST_MOCK_PORT);
    });

    it("loads market page on http://localhost:3001/markets/ind-nz-over-15 with required DOM markers", async () => {
      const res = await fetch(`http://localhost:${TEST_MOCK_PORT}/markets/ind-nz-over-15`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const html = await res.text();
      // Verify Overwatch DOM attributes for extension detection
      expect(html).toContain('data-overwatch-market-id="ind-nz-over-15"');
      expect(html).toContain('data-overwatch-platform="demo"');
      expect(html).toContain('data-testid="market-question-heading"');
      expect(html).toContain("Over #15");
      expect(html).toContain(`http://localhost:${TEST_MOCK_PORT}/markets/ind-nz-over-15`);
    });

    it("loads market page on http://127.0.0.1:3001/markets/ind-nz-over-15 with required DOM markers", async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_MOCK_PORT}/markets/ind-nz-over-15`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain('data-overwatch-market-id="ind-nz-over-15"');
      expect(html).toContain(`http://127.0.0.1:${TEST_MOCK_PORT}/markets/ind-nz-over-15`);
    });

    it("serves market JSON metadata via /api/markets/ind-nz-over-15", async () => {
      const res = await fetch(`http://127.0.0.1:${TEST_MOCK_PORT}/api/markets/ind-nz-over-15`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.marketId).toBe("ind-nz-over-15");
      expect(json.category).toBe("CRICKET");
      expect(json.fixtureId).toBe(71020);
    });
  });

  describe("3. Chrome Extension Configuration & Host Permissions", () => {
    it("wxt.config.ts includes both localhost:3001 and 127.0.0.1:3001 in host_permissions", () => {
      const configPath = path.resolve(process.cwd(), "apps/extension/wxt.config.ts");
      const content = fs.readFileSync(configPath, "utf-8");

      expect(content).toContain("http://localhost:3001/*");
      expect(content).toContain("http://127.0.0.1:3001/*");
    });

    it("entrypoints/content.ts includes both localhost:3001 and 127.0.0.1:3001 in matches", () => {
      const contentPath = path.resolve(process.cwd(), "apps/extension/entrypoints/content.ts");
      const content = fs.readFileSync(contentPath, "utf-8");

      expect(content).toContain("http://localhost:3001/*");
      expect(content).toContain("http://127.0.0.1:3001/*");
    });
  });

  describe("4. Backend CORS Configuration", () => {
    it("allows cross-origin requests from extension and local origins", () => {
      expect(CORS_HEADERS["Access-Control-Allow-Origin"]).toBe("*");
      expect(CORS_HEADERS["Access-Control-Allow-Methods"]).toContain("GET");
      expect(CORS_HEADERS["Access-Control-Allow-Headers"]).toContain("Content-Type");
    });
  });
});
