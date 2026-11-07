# 0verwatch — Autonomous Multi-Agent Intelligence & Risk Layer for Prediction Markets

**0verwatch** is a Chrome Manifest V3 Side Panel extension and backend intelligence protocol that brings verifiable multi-agent research (**Recon**), paper position management, and autonomous continuous position defense (**Guard Watch** + **Sentry** + **Scouting**) to prediction markets on **0G Compute** (`0gm-1.0-35b-a3b`).

Built in the Swiss International Typographic Style (`#F6F5F0` warm paper canvas, `#111110` deep graphite ink, `#D9381E` vermilion signal accent), 0verwatch runs directly alongside prediction market pages so traders can audit source-backed claims with `EV-XX` traceability and protect open positions against sudden real-world match developments even after closing their browser tab.

---

## 1. Key Capabilities

### Multi-Agent Recon Workflow (`Sergeant` + 3-Specialist `Squad`)
- **Supervisor Planning (`Sergeant`):** Parses market resolution criteria (`OVER_RUNS`, `MULTI_OVER_TOTAL`, `PLAYER_RUNS`, `INNINGS_TOTAL`), target event windows, and real-time IST (`+05:30`) clock grounding to dispatch bounded tool budgets.
- **Parallel Specialist Execution:**
  - **Data Specialist:** Queries live match scorecards, batting/bowling splits, run rates, and ball-by-ball delivery telemetry via the **Sportmonks Cricket API v2.0** (`cricket.get_fixture_data`).
  - **Intelligence Specialist:** Executes real-time web searches via **Tavily** (`web.search`) and SSRF-guarded article extraction (`web.fetch_page`) for pitch reports, weather forecasts, playing XI updates, and series context.
- **Adversarial Stress-Testing (`Contrarian Specialist`):** Audits initial findings to challenge weak assumptions and separate verified counter-evidence from speculation.
- **Deterministic `EV-XX` Source Verification:** Every tool response is stamped with a sequential `evidenceId` (`EV-01`, `EV-02`, ...). Prior to synthesis, `verifyAndSanitizeClaims` strips any unverified citation so users can inspect exact underlying data sources in the Side Panel.
- **Hardware-Accelerated `ReconRadarHUD`:** Animated SVG radar sweep and stage telemetry displayed inside the Chrome Side Panel during live Recon execution.

### Continuous Guard Watch & Autonomous Sentry Stop-Loss
- **Zero-Waste In-Memory Monitoring:** An embedded 20-second in-process scheduler (and standalone worker) tracks active markets in memory and runs a generic `SnapshotComparator`—consuming **zero** 0G compute credits when match state is unchanged.
- **Autonomous Sentry Risk & Stop-Loss Agent:** When material match shifts occur (wickets, run-rate spikes, over completions, or position discrepancies), **Sentry** evaluates live Sportmonks telemetry and breaking web news against the user's open paper position (`YES` / `NO`):
  - **`NOTIFY_ONLY`:** Pushes real-time desktop alerts via Chrome MV3 notifications (capped at 3 notifications spaced at 30-second intervals).
  - **`TRIGGER_RESEARCH` (`Scouting`):** Escalates to the Sergeant for targeted specialist re-evaluation.
  - **Autonomous Stop-Loss (`CLOSE_POSITION`):** Automatically liquidates open paper positions when severe real-world shocks invalidate the user's position thesis.
- **Live Match & Shock Simulation (`/api/simulate-live`):** Built-in end-to-end simulation harness for testing live match progression, sudden wicket/collapse shocks, autonomous Sentry liquidation, and Chrome notifications.

### Decentralized 0G Compute & Cryptographic Vault
- **Verifiable 0G Inference:** Powered by `0gm-1.0-35b-a3b` on the 0G Compute Router (`https://router-api.0g.ai/v1`) with exponential backoff, automatic model fallback, and `x_0g_trace` receipt capture.
- **Wallet Challenge Auth & AES-256-GCM Vault:** EVM wallet signature verification (`viem`), server-side **AES-256-GCM** encryption for user `sk-` / `mk-` keys, live 0G account balance querying, and daily/per-market compute budget guards.

---

## 2. Monorepo Structure

```text
overwatch/
├── apps/
│   ├── web/                        # @overwatch/web — Next.js 16 App, REST API & Guard Watch Engine
│   │   ├── src/app/                # Market Index (/), Market Detail (/markets/[marketId]), Admin & API routes
│   │   ├── src/components/         # PaperPositionForm & Swiss Typographic UI components
│   │   ├── src/lib/
│   │   │   ├── agents/             # Sergeant, Data/Intelligence/Contrarian Squad & prompts
│   │   │   ├── auth/               # EVM wallet session auth & AES-256-GCM crypto-vault
│   │   │   ├── connectors/         # Sportmonks Cricket v2.0, Tavily Search, SSRF-safe Web Fetch & ToolRegistry
│   │   │   ├── inference/          # ZeroGInferenceProvider, live 0G balance query, Mock provider & BudgetGuard
│   │   │   ├── markets/            # Canonical seeded markets & Firestore store
│   │   │   ├── positions/          # Paper trading position store & lifecycle management
│   │   │   └── watch/              # GuardWatchRegistry, SnapshotComparator, Autonomous Sentry & 20s scheduler
│   │   ├── src/mock-market/        # Standalone local demo market HTTP server (port 3001)
│   │   ├── src/worker/             # Standalone Guard Watch Node worker (guard-watch.ts)
│   │   └── e2e/                    # Playwright Chromium end-to-end acceptance suite
│   └── extension/                  # @overwatch/extension — WXT + React 19 Chrome MV3 Side Panel Extension
│       └── entrypoints/
│           ├── background.ts       # Service worker, tab URL detection, 30s-spaced notification queue
│           ├── content.ts          # Market page context & DOM fallback bridge
│           └── sidepanel/          # Main Side Panel UI + animated SVG ReconRadarHUD
├── packages/
│   └── shared/                     # @overwatch/shared — Zod schemas, cricket models, IST time utilities & URL adapter
├── docs/
│   ├── WHITEPAPER.md               # Concise protocol whitepaper
│   └── IMPLEMENTATION_PLAN.md      # Technical architecture reference
├── scripts/
│   └── phase0-verify.ts            # External verification script (Firebase ADC, Sportmonks, Tavily)
└── DEVELOPMENT_LOG.md              # Engineering log & milestone report
```

---

## 3. Environment Configuration

Copy `.env.example` to `.env.local` (and `apps/web/.env.local`):

```bash
cp .env.example .env.local
cp .env.example apps/web/.env.local
```

### Required Environment Variables (`.env.local`)

| Variable | Description |
|---|---|
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to your Firebase Admin service account JSON file (loaded via ADC). |
| `GOOGLE_CLOUD_PROJECT` | Your Firebase / Google Cloud project ID. |
| `SPORTMONKS_API_TOKEN` | Sportmonks Cricket API v2.0 token for live fixture and ball-by-ball telemetry. |
| `TAVILY_API_KEY` | Tavily API key for real-time news and match intelligence search. |
| `ZERO_G_ENCRYPTION_KEY` | 32-byte (64 hex chars) master key for server-side AES-256-GCM encryption of 0G keys. |
| `SESSION_SECRET` | Secret string (>= 32 chars) for HMAC wallet session token signing. |
| `INFERENCE_PROVIDER` | `zero-g` for live 0G Compute (`0gm-1.0-35b-a3b`) or `mock` for local deterministic testing. |
| `ZERO_G_SK` / `ZERO_G_MK` | Optional server fallback 0G `sk-` inference key and `mk-` balance key when not linked via the extension vault. |

---

## 4. Quickstart, Development & Build Commands

Requires **Node.js >= 22** and `npm`:

```bash
# 1. Install all workspace dependencies
npm install

# 2. Seed canonical cricket prediction markets into Firestore
npm run seed

# 3. Start Next.js web application, API backend & embedded 20s Guard Watch scheduler (http://localhost:3000)
npm run dev:web

# 4. (Optional) Start standalone demo market server on http://localhost:3001
npm run mock:standalone

# 5. Start WXT Chrome MV3 extension in development mode
npm run dev:ext

# 6. Run Vitest unit & integration test suites (57 tests across 7 suites)
npm test

# 7. Run strict TypeScript verification across all workspaces
npm run typecheck

# 8. Build production bundles (@overwatch/shared, @overwatch/web, @overwatch/extension)
npm run build
```

---

## 5. Loading the Chrome MV3 Extension

1. Build the extension bundle:
   ```bash
   npm run build:ext
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select:
   ```text
   apps/extension/.output/chrome-mv3
   ```
5. Navigate to `http://localhost:3000` (or `http://localhost:3001`), open any cricket prediction market, and click the **0verwatch** extension icon to launch the Side Panel.
6. Link your 0G `sk-` / `mk-` credentials in the **0G CONFIG** drawer, click **Run Recon** to execute the 4-agent research pipeline, open a paper position (`YES` / `NO`), and activate **Guard Watch** for continuous autonomous Sentry protection.
