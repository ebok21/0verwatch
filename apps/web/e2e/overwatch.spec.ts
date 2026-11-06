import { test, expect } from "@playwright/test";

test.describe("Overwatch MVP End-to-End Acceptance Suite", () => {
  test("1. Market Directory & API Metadata Retrieval", async ({
    page,
    request,
  }) => {
    // Verify API metadata endpoint directly
    const apiRes = await request.get("/api/markets/ind-nz-over-15");
    expect(apiRes.ok()).toBeTruthy();
    const apiData = await apiRes.json();
    expect(apiData.market.marketId).toBe("ind-nz-over-15");
    expect(apiData.market.fixtureId).toBe(71020);
    expect(apiData.market.simulatedMarketData.isDemoMarketData).toBe(true);

    // Visit Market Directory
    await page.goto("/");
    await expect(
      page.getByText("OVERWATCH // INTELLIGENCE INDEX")
    ).toBeVisible();
    await expect(
      page.getByTestId("market-index-row-ind-nz-over-15")
    ).toBeVisible();
    await expect(
      page.getByTestId("market-index-row-ind-nz-overs-11-15")
    ).toBeVisible();
  });

  test("2. Full E2E Journey: Open Market -> Detect -> Recon -> Inspect Evidence -> Track -> Guard Watch -> Sentry -> Scouting -> Alert", async ({
    page,
  }) => {
    await page.goto("/markets/ind-nz-over-15");

    // 1. Verify market detail page and DEMO MARKET DATA label
    await expect(page.getByTestId("market-question-heading")).toContainText(
      "Will India score 8 or more runs in Over #15 of the 1st Innings?"
    );
    await expect(page.getByTestId("demo-market-data-label")).toContainText(
      "DEMO MARKET DATA"
    );

    // 2. Verify Overwatch Side Panel detects market from URL
    await expect(page.getByTestId("market-detection-badge")).toContainText(
      "DETECTED VIA URL"
    );
    await expect(page.getByTestId("inference-mode-badge")).toContainText(
      "DEV MOCK PROVIDER"
    );

    // 3. Initiate Recon
    await page.getByTestId("run-recon-button").click();

    // 4. Verify Recon Report renders with probability, supporting & contrarian claims, and inspectable evidence
    await expect(page.getByTestId("recon-report-container")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("report-probability-yes")).toContainText(
      "47%"
    );

    // 5. Inspect Evidence source EV-01
    await page.getByTestId("evidence-row-EV-01").click();
    await expect(page.getByTestId("evidence-detail-EV-01")).toBeVisible();

    // 6. Track Market (Activate Guard Watch)
    const trackBtn = page.getByTestId("track-market-button");
    if (await trackBtn.isVisible()) {
      await trackBtn.click();
    }
    await expect(page.getByTestId("guard-watch-active-panel")).toBeVisible();
    await expect(page.getByTestId("guard-watch-status-badge")).toContainText(
      "WATCHING"
    );

    // 7. Trigger Unchanged Poll -> skips inference
    await page.getByTestId("poll-unchanged-button").click();
    await expect(page.getByText("SNAPSHOT_UNCHANGED").first()).toBeVisible();

    // 8. Trigger Simulated Over #15 Live Surge -> Sentry -> Sergeant -> Scouting -> Notification Banner
    await page.getByTestId("simulate-live-surge-button").click();
    await expect(page.getByTestId("report-probability-yes")).toContainText(
      "78%",
      { timeout: 30_000 }
    );
    await expect(page.getByTestId("active-notification-banner")).toBeVisible();
  });
});

