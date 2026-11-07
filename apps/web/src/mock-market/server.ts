import http from "node:http";
import { formatISTDisplay } from "@overwatch/shared";
import { getCanonicalMarketMetadata, listAllCanonicalMarkets } from "../lib/markets/store";
import { logger } from "../lib/logger";

const MOCK_MARKET_PORT = Number(process.env.MOCK_MARKET_PORT ?? "3001");
let serverInstance: http.Server | null = null;

function renderLightMarketHtml(market: any, currentHost: string, currentPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" contenet="width=device-width, initial-scale=1.0">
  <title>${market.question} — Demo Market / Paper Trading</title>
  <link rel="canonical" href="http://${currentHost}:${currentPort}/markets/${market.marketId}" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #F6F5F0; color: #111110; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body class="min-h-screen flex flex-col bg-[#F6F5F0] text-[#111110]">
  <!-- Top Header -->
  <header class="border-b-2 border-[#111110] bg-[#EFECE6] px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <a href="/" class="mono text-xs font-bold uppercase tracking-wider px-2.5 py-1 border border-[#111110] bg-[#F6F5F0] hover:bg-[#111110] hover:text-white transition-colors">
        ← All Markets
      </a>
      <div class="flex items-center gap-2 mono text-xs">
        <span class="text-[#52514E]">DEMO MARKET URL:</span>
        <code class="bg-white px-2 py-0.5 border border-[#D4D1C8] font-bold">
          http://${currentHost}:${currentPort}/markets/${market.marketId}
        </code>
      </div>
    </div>
    <div class="flex items-center gap-3 mono text-xs">
      <span class="px-2.5 py-0.5 bg-[#B85D00] text-white font-bold uppercase text-[11px]">
        DEMO MARKET / PAPER TRADING • PORT ${currentPort}
      </span>
      <span class="px-2.5 py-0.5 border border-[#111110] bg-white font-bold uppercase text-[11px]">
        STATUS: ${market.status}
      </span>
    </div>
  </header>

  <!-- Market Container with Overwatch Data Markers -->
  <main
    data-overwatch-market-id="${market.marketId}"
    data-overwatch-platform="${market.platform || "demo"}"
    class="flex-1 max-w-5xl w-full mx-auto p-6 lg:p-10 space-y-8"
  >
    <!-- Market Badges & Question Header -->
    <div class="border-b-2 border-[#111110] pb-6 space-y-3">
      <div class="flex flex-wrap items-center gap-2 mono text-xs">
        <span class="px-2 py-0.5 bg-[#111110] text-white font-bold">
          ${market.category}
        </span>
        <span class="px-2 py-0.5 border border-[#111110] font-semibold">
          ID: ${market.marketId}
        </span>
        <span class="px-2 py-0.5 border border-[#111110] font-semibold">
          FIXTURE #${market.fixtureId ?? 71020}
        </span>
        <span class="px-2 py-0.5 border border-[#D4D1C8] text-[#52514E]">
          FORMAT: ${market.matchFormat || "ODI"}
        </span>
      </div>

      <h1
        data-testid="market-question-heading"
        class="text-2xl lg:text-3xl font-bold tracking-tight text-[#111110] leading-tight"
      >
        ${market.question}
      </h1>

      ${market.subtitle ? `<p class="text-sm text-[#52514E]">${market.subtitle}</p>` : ""}
    </div>

    <!-- 2-Column Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      <!-- Left Column: Fixture & Rules -->
      <div class="lg:col-span-7 space-y-6">
        <div class="border border-[#D4D1C8] bg-white p-6 shadow-sm space-y-3">
          <h2 class="mono text-xs font-bold uppercase tracking-wider text-[#52514E]">
            SPORTMONKS FIXTURE VERIFICATION
          </h2>
          <div class="space-y-2 mono text-xs">
            <div class="flex justify-between py-1 border-b border-[#F0EFEA]">
              <span class="text-[#52514E]">TEAMS:</span>
              <span class="font-bold text-[#111110]">${market.homeTeam || "New Zealand"} vs ${market.awayTeam || "India"}</span>
            </div>
            <div class="flex justify-between py-1 border-b border-[#F0EFEA]">
              <span class="text-[#52514E]">COMPETITION:</span>
              <span class="font-bold text-[#111110]">${market.competition || "International ODI Series"}</span>
            </div>
            <div class="flex justify-between py-1 border-b border-[#F0EFEA]">
              <span class="text-[#52514E]">EXPECTED RESOLUTION (IST):</span>
              <span class="font-bold text-[#111110]">${formatISTDisplay(market.expectedResolutionTime || Date.now())}</span>
            </div>
          </div>
        </div>

        <div class="border border-[#D4D1C8] bg-white p-6 shadow-sm space-y-3">
          <h2 class="mono text-xs font-bold uppercase tracking-wider text-[#52514E]">
            RESOLUTION CRITERIA
          </h2>
          <div class="text-sm text-[#111110] bg-[#F6F5F0] p-4 border border-[#D4D1C8] mono leading-relaxed">
            ${market.resolutionCriteria || "Resolves YES if the criteria are met; NO otherwise."}
          </div>
        </div>
      </div>

      <!-- Right Column: Interactive Paper Position Form -->
      <div class="lg:col-span-5 space-y-6">
        <div class="border-2 border-[#111110] bg-white p-6 shadow-sm space-y-5">
          <div class="flex items-center justify-between border-b border-[#D4D1C8] pb-3">
            <span class="mono text-xs font-bold uppercase text-[#111110]">
              REGISTER PAPER POSITION
            </span>
            <span class="mono text-[10px] px-2 py-0.5 border border-[#146C43] bg-[#E8F5E9] text-[#146C43] font-bold">
              PAPER POSITION — DEMO ONLY
            </span>
          </div>

          <div>
            <label class="block mono text-xs font-bold uppercase text-[#52514E] mb-2">CHOOSE SIDE</label>
            <div class="grid grid-cols-2 gap-3">
              <button id="btn-side-yes" type="button" class="py-2.5 px-4 mono text-sm font-bold border-2 border-[#146C43] bg-[#146C43] text-white">
                YES
              </button>
              <button id="btn-side-no" type="button" class="py-2.5 px-4 mono text-sm font-bold border-2 border-[#D4D1C8] bg-[#F6F5F0] text-[#111110]">
                NO
              </button>
            </div>
          </div>

          <div>
            <label class="block mono text-xs font-bold uppercase text-[#52514E] mb-2">DEMO STAKE ($)</label>
            <input id="stake-input" type="number" min="1" max="10000" value="50" class="w-full px-3 py-2 border border-[#D4D1C8] mono text-sm" />
          </div>

          <div id="position-feedback" class="hidden p-3 mono text-xs"></div>

          <button id="btn-submit-position" type="button" class="w-full py-3 bg-[#111110] hover:bg-[#52514E] text-white mono text-xs font-bold uppercase tracking-wider">
            OPEN POSITION & ACTIVATE SENTRY
          </button>

          <!-- Registered Positions for this Market -->
          <div class="mt-6 border-t border-[#D4D1C8] pt-4 space-y-3">
            <div class="flex justify-between items-center">
              <span class="mono text-xs font-bold uppercase text-[#52514E]">OPEN POSITIONS FOR THIS MARKET</span>
              <button id="btn-refresh-positions" type="button" class="mono text-[10px] text-[#52514E] hover:text-[#111110] underline">Refresh</button>
            </div>
            <div id="positions-container" class="space-y-2 mono text-xs">
              <div class="text-[#88857E] py-2 text-center">Loading positions...</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    let selectedSide = "YES";
    const btnYes = document.getElementById("btn-side-yes");
    const btnNo = document.getElementById("btn-side-no");
    const stakeInput = document.getElementById("stake-input");
    const submitBtn = document.getElementById("btn-submit-position");
    const feedback = document.getElementById("position-feedback");
    const btnRefresh = document.getElementById("btn-refresh-positions");

    btnYes.addEventListener("click", () => {
      selectedSide = "YES";
      btnYes.className = "py-2.5 px-4 mono text-sm font-bold border-2 border-[#146C43] bg-[#146C43] text-white";
      btnNo.className = "py-2.5 px-4 mono text-sm font-bold border-2 border-[#D4D1C8] bg-[#F6F5F0] text-[#111110]";
    });

    btnNo.addEventListener("click", () => {
      selectedSide = "NO";
      btnNo.className = "py-2.5 px-4 mono text-sm font-bold border-2 border-[#D9381E] bg-[#D9381E] text-white";
      btnYes.className = "py-2.5 px-4 mono text-sm font-bold border-2 border-[#D4D1C8] bg-[#F6F5F0] text-[#111110]";
    });

    async function loadPositions() {
      const container = document.getElementById("positions-container");
      try {
        const res = await fetch("http://127.0.0.1:3000/api/positions?marketId=${market.marketId}");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json();
        const positions = data.positions || [];
        if (positions.length === 0) {
          container.innerHTML = '<div class="text-[#88857E] py-2 text-center">No positions for this market yet.</div>';
          return;
        }
        container.innerHTML = positions.map(function(pos) {
          var sideColor = pos.side === 'YES' ? 'bg-[#146C43]' : 'bg-[#D9381E]';
          var actionBtn = pos.status === 'OPEN'
            ? '<button onclick="closePosition(\'' + pos.positionId + '\')" class="px-2.5 py-1 border border-[#D9381E] text-[#D9381E] hover:bg-[#D9381E] hover:text-white font-bold text-[10px] transition-colors">CLOSE POSITION</button>'
            : '<span class="text-[10px] text-[#88857E]">Closed</span>';
          return '<div class="p-2.5 border border-[#D4D1C8] bg-[#FBFBFA] flex items-center justify-between gap-2">' +
            '<div class="flex items-center gap-2">' +
              '<span class="px-2 py-0.5 text-white font-bold text-[10px] ' + sideColor + '">' + pos.side + '</span>' +
              '<span class="font-bold text-[#111110]">$' + pos.stake + '</span>' +
              '<span class="text-[10px] text-[#52514E]">(' + pos.status + ')</span>' +
            '</div>' +
            actionBtn +
          '</div>';
        }).join('');
      } catch (e) {
        container.innerHTML = '<div class="text-[#88857E] py-1 text-center">Could not load positions.</div>';
      }
    }

    window.closePosition = async function(posId) {
      try {
        const res = await fetch("http://127.0.0.1:3000/api/positions/" + encodeURIComponent(posId), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "close" })
        });
        if (res.ok) {
          const updated = await res.json();
          window.postMessage({
            source: "OVERWATCH_DEMO_MARKET",
            type: "OVERWATCH_POSITION_UPDATED",
            payload: {
              positionId: updated.positionId,
              marketId: "${market.marketId}",
              fixtureId: ${market.fixtureId ?? 71020},
              side: updated.side,
              stake: updated.stake,
              status: "CLOSED",
              action: "CLOSED"
            }
          }, window.location.origin);
          await loadPositions();
        } else {
          alert("Error closing position.");
        }
      } catch {
        alert("Failed to connect to backend to close position.");
      }
    };

    btnRefresh.addEventListener("click", loadPositions);
    loadPositions();

    submitBtn.addEventListener("click", async () => {
      submitBtn.disabled = true;
      submitBtn.innerText = "OPENING POSITION...";
      feedback.className = "hidden";

      const stake = Number(stakeInput.value) || 50;

      try {
        const res = await fetch("http://127.0.0.1:3000/api/positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketId: "${market.marketId}",
            side: selectedSide,
            stake: stake,
          }),
        });

        let actualPos = { positionId: "pos-" + Date.now() };
        if (res.ok) {
          const resData = await res.json();
          actualPos = resData.position || resData;
        }

        await fetch("http://127.0.0.1:3000/api/watch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "TRACK",
            marketId: "${market.marketId}",
            activeSide: selectedSide,
            authorizedBackgroundInference: true,
          }),
        }).catch(() => {});

        window.postMessage({
          source: "OVERWATCH_DEMO_MARKET",
          type: "OVERWATCH_POSITION_UPDATED",
          payload: {
            positionId: actualPos.positionId,
            marketId: "${market.marketId}",
            fixtureId: ${market.fixtureId ?? 71020},
            side: selectedSide,
            stake: stake,
            status: "OPEN",
            reconRunId: "recon-${market.marketId}-initial",
            action: "OPENED"
          }
        }, window.location.origin);

        feedback.className = "p-3 bg-[#E8F5E9] border border-[#146C43] text-[#146C43] mono text-xs";
        feedback.innerText = "✓ Paper position opened (" + selectedSide + " • $" + stake + "). Guard Watch activated.";
        await loadPositions();
      } catch (err) {
        feedback.className = "p-3 bg-[#FFEBEE] border border-[#D9381E] text-[#D9381E] mono text-xs";
        feedback.innerText = "Error opening position.";
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "OPEN POSITION & ACTIVATE SENTRY";
      }
    });
  </script>
</body>
</html>`;
}

function renderIndexHtml(markets: any[], currentHost: string, currentPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Demo Markets — 0verwatch Paper Trading</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #F6F5F0; color: #111110; font-family: ui-sans-serif, system-ui, sans-serif; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body class="min-h-screen bg-[#F6F5F0] text-[#111110] p-8 max-w-4xl mx-auto space-y-6">
  <div class="border-b-2 border-[#111110] pb-4">
    <span class="mono text-xs font-bold uppercase px-2 py-0.5 bg-[#B85D00] text-white">
      DEMO MARKET / PAPER TRADING
    </span>
    <h1 class="text-3xl font-bold mt-2">Available Prediction Markets</h1>
  </div>
  <div class="space-y-4">
    ${markets.map((m) => `
      <div class="border-2 border-[#111110] bg-white p-5 shadow-sm space-y-2">
        <div class="flex justify-between items-center mono text-xs text-[#52514E]">
          <span>ID: ${m.marketId} • FIXTURE #${m.fixtureId}</span>
          <span class="font-bold text-[#146C43]">${m.status}</span>
        </div>
        <h2 class="text-xl font-bold text-[#111110]">${m.question}</h2>
        <div class="pt-2">
          <a href="/markets/${m.marketId}" class="inline-block px-4 py-2 bg-[#111110] text-white mono text-xs font-bold uppercase hover:bg-[#B85D00]">
            VIEW DEMO MARKET →
          </a>
        </div>
      </div>
    `).join("")}
  </div>
</body>
</html>`;
}

export function createMockMarketServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const hostHeader = req.headers.host ?? "127.0.0.1:3001";
    const [currentHost = "127.0.0.1"] = hostHeader.split(":");
    const url = new URL(req.url ?? "/", `http://${hostHeader}`);

    // Universal CORS headers for extension and client compatibility
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          app: "overwatch-mock-market",
          port: MOCK_MARKET_PORT,
        })
      );
      return;
    }

    const apiMarketMatch = url.pathname.match(/^\/api\/markets\/([a-zA-Z0-9_-]+)$/);
    if (apiMarketMatch && apiMarketMatch[1]) {
      const marketId = apiMarketMatch[1];
      const market = await getCanonicalMarketMetadata(marketId);
      if (!market) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "MARKET_NOT_FOUND",
            message: `Market "${marketId}" not found.`,
          })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      // Return shape supporting both direct market fields and nested { market, latestReport }
      res.end(JSON.stringify({ ...market, market, latestReport: null }));
      return;
    }

    if (url.pathname === "/") {
      const markets = await listAllCanonicalMarkets();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderIndexHtml(markets, currentHost, MOCK_MARKET_PORT));
      return;
    }

    const marketMatch = url.pathname.match(/^\/markets\/([a-zA-Z0-9_-]+)$/);
    if (marketMatch && marketMatch[1]) {
      const marketId = marketMatch[1];
      const market = await getCanonicalMarketMetadata(marketId);
      if (!market) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Market Not Found");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderLightMarketHtml(market, currentHost, MOCK_MARKET_PORT));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  return server;
}

export async function startMockMarketServer(port = MOCK_MARKET_PORT): Promise<http.Server> {
  const server = createMockMarketServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  serverInstance = server;
  logger.info(`[DEMO MARKET] Plain light-theme Demo Market running on http://127.0.0.1:${port}`);
  return server;
}

export async function stopMockMarketServer(): Promise<void> {
  if (serverInstance) {
    await new Promise<void>((resolve) => {
      serverInstance?.close(() => resolve());
    });
    serverInstance = null;
  }
}

if (process.argv[1]?.includes("mock-market/server") || process.argv[1]?.includes("mock-market\\server")) {
  startMockMarketServer(MOCK_MARKET_PORT).catch((err) => {
    logger.error("Failed to start Demo Market server", { error: String(err) });
    process.exit(1);
  });
}
