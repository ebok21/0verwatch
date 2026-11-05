# OVERWATCH — AI Research & Continuous Monitoring Layer for Prediction Markets

**Overwatch** is a Chrome Manifest V3 browser extension and backend intelligence platform that provides contextual multi-agent research (**Recon**) and persistent two-tier continuous monitoring (**Guard Watch** + **Sentry** + **Scouting**) for prediction markets on **0G Compute** (`0gm-1.0-35b-a3b`).

Overwatch is **not** a prediction-market exchange, wagering protocol, or settlement oracle. It operates alongside supported prediction-market pages so users can investigate resolution criteria, inspect source-backed claims with `evidenceId` traceability, and monitor live real-world developments after closing their browser tab.

---

## 1. Repository Structure

```text
overwatch/
├── apps/
│   ├── web/                  # @overwatch/web — Next.js 16 App + REST API + Guard Watch Worker
│   │   ├── src/app/          # Swiss International Style Market Index, Detail & API routes
│   │   ├── src/components/   # OverwatchSidePanel (Swiss Typographic Style 360-420px panel)
│   │   ├── src/lib/          # Firebase Admin (ADC), Auth, Vault, Connectors, Inference, Agents, Watch
│   │   ├── src/worker/       # Standalone persistent Guard Watch Node worker (guard-watch.ts)
│   │   └── e2e/              # Playwright end-to-end test suite
│   └── extension/            # @overwatch/extension — WXT + React 19 Chrome MV3 Side Panel Extension
│       └── entrypoints/      # background.ts, content.ts, sidepanel/
├── packages/
│   └── shared/               # @overwatch/shared — Shared Zod schemas, domain models & URL adapter
├── docs/
│   ├── WHITEPAPER.md
│   └── IMPLEMENTATION_PLAN.md
├── scripts/
│   └── phase0-verify.ts      # Phase 0 verification spike (Firebase ADC, Sportmonks, Tavily)
├── .env.example              # Sanitized environment template (placeholders only)
├── package.json              # npm workspaces root
├── tsconfig.base.json        # Strict TypeScript base configuration
└── DEVELOPMENT_LOG.md        # Engineering log & migration report
```

---

## 2. Environment Setup & Firebase Admin ADC

Copy `.env.example` to `.env.local` (and `apps/web/.env.local`):

```bash
cp .env.example .env.local
cp .env.example apps/web/.env.local
```

### Required Environment Variables (`.env.local`)

- **`GOOGLE_APPLICATION_CREDENTIALS`**: Absolute path to your downloaded Firebase Admin service account JSON file (used via `applicationDefault()`).
- **`GOOGLE_CLOUD_PROJECT`**: Your Firebase project ID.
- **`SPORTMONKS_API_TOKEN`**: Sportmonks Cricket API v2.0 token.
- **`TAVILY_API_KEY`**: Tavily Web Search API key.
- **`ZERO_G_ENCRYPTION_KEY`**: 32-byte (64 hex chars) key used for server-side AES-256-GCM encryption of user `sk-` and `mk-` keys.
- **`SESSION_SECRET`**: Secret string (at least 32 chars) for HMAC session signing.
- **`INFERENCE_PROVIDER`**:
  - `mock` — Development-only `MockInferenceProvider` exercising the full multi-turn tool-calling loop, `ToolRegistry`, and Zod validation without requiring 0G credits.
  - `zero-g` — Live `ZeroGInferenceProvider` (`https://router-api.0g.ai/v1`, model `0gm-1.0-35b-a3b`).

> **Security Note:** `.env.local` and all `*firebase-adminsdk*.json` / `*service-account*.json` files are strictly gitignored. Never commit real credentials.

---

## 3. Development, Testing & Build Commands

Use `npm` (Node.js >= 22):

```bash
# Install all workspace dependencies
npm install

# Run Phase 0 external API & Firebase ADC verification spike
npm run verify:phase0

# Seed canonical demonstration markets into Firestore
npm run seed

# Start Next.js web application & API backend (http://localhost:3000)
npm run dev:web

# Start standalone Guard Watch persistent worker
npm run worker
# Or execute a single Guard Watch sweep and exit:
npx tsx apps/web/src/worker/guard-watch.ts --once

# Start WXT Chrome MV3 extension in development mode
npm run dev:ext

# Run Vitest unit & integration test suite
npm test

# Run strict TypeScript typecheck across all workspaces
npm run typecheck

# Build shared package, Next.js production app, and Chrome MV3 extension bundle
npm run build
```

---

## 4. Installing the Chrome MV3 Extension (Developer Mode)

1. Build the extension:
   ```bash
   npm run build:ext
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select:
   ```text
   apps/extension/.output/chrome-mv3
   ```
5. Open `http://localhost:3000/markets/ind-nz-over-15` and click the **Overwatch** toolbar icon to open the Side Panel.

---

## 5. Switching to Live 0G Compute Inference

When hackathon 0G credits are active:

1. Update `.env.local` and `apps/web/.env.local`:
   ```env
   INFERENCE_PROVIDER=zero-g
   ZERO_G_BASE_URL=https://router-api.0g.ai/v1
   ZERO_G_MODEL=0gm-1.0-35b-a3b
   ```
2. Open the **0G CONFIG** drawer in the Overwatch Side Panel, sign the wallet challenge, and link your `sk-` inference key (encrypted at rest in Firestore using AES-256-GCM).
3. Run Recon and Guard Watch — the exact same Sergeant, Squad, Sentry, and Tool Registry orchestration pipeline will execute against live 0G Compute and record real `x_0g_trace` request IDs.

