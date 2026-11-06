# OVERWATCH — DEVELOPMENT LOG & MIGRATION REPORT

## Phase 0 — Repository Assessment, Migration Report & External Verification

### 1. Assessment of Legacy Workspace (`c:\Users\diksh\ebok\eth-global`)

| Area | Legacy Location / Artifact | Assessment | Migration Decision |
|---|---|---|---|
| **Canonical Documentation** | `WHITEPAPER.md`, `IMPLEMENTATION_PLAN.md` | Authoritative v4.3 specifications for Overwatch MVP architecture, terminology, and scope. | **MIGRATED** into `docs/WHITEPAPER.md` and `docs/IMPLEMENTATION_PLAN.md` (and retained at root). |
| **Web Application Shell** | `cre-gcp-prediction-market-demo/frontend/` | Next.js `16.2.6`, React `19.2.6`, Tailwind CSS `v4`, TypeScript `5`, ESLint `9`, Geist Sans & Geist Mono fonts. | **SELECTIVELY MIGRATED** into `apps/web` (`@overwatch/web`) with upgraded strict TypeScript configuration and Swiss International Typographic Style tokens. |
| **Legacy Home Page** | `frontend/src/app/page.tsx` | Displayed settled Chainlink CRE / Gemini settlement documents from a `demo` collection. | **REPLACED** with the Overwatch Curated Market Intelligence Index (`/`) and `/markets/[marketId]` detail pages. |
| **Firebase Setup** | `frontend/src/lib/firebase.ts` | Client-side `firebase` SDK requiring `NEXT_PUBLIC_FIREBASE_*` keys. | **REPLACED** on backend/worker with singleton-safe `firebase-admin` using Application Default Credentials (`GOOGLE_APPLICATION_CREDENTIALS` + `GOOGLE_CLOUD_PROJECT`) per Post-Script instructions. |
| **Smart Contracts & CRE** | `contracts/` (`SimpleMarket.sol`), `cre-workflow/` | Inherited Solidity contracts, Anvil scripts, and Chainlink CRE workflows. | **DISCARDED / ARCHIVED** (left untouched in legacy `eth-global` archive; excluded from `overwatch`). |
| **PDF Generator** | `build_pdf.js`, `*.pdf` | Standalone Node utility for rendering Markdown to PDF. | **KEPT SEPARATE** in `eth-global`; no PDF dependencies introduced into `overwatch`. |
| **Environment & Secrets** | `.env.example` | Contained live development tokens for Sportmonks, Tavily, and Firebase ADC path. | **SANITIZED** `.env.example` to placeholder values only; moved live credentials to gitignored `.env.local` and `apps/web/.env.local`. |

---

### 2. Phase 0 External Verification Spike Results (`scripts/phase0-verify.ts`)

1. **Firebase Admin SDK via Application Default Credentials (ADC)**:
   - Verified `applicationDefault()` with `GOOGLE_APPLICATION_CREDENTIALS` and `GOOGLE_CLOUD_PROJECT=overwatch-alpha-27c6d`.
   - Enabled `ignoreUndefinedProperties: true` on the singleton `Firestore` instance.
2. **Sportmonks Cricket API v2.0 Fixture Discovery & Nested `balls` Includes**:
   - Discovered **Fixture `#71020`**: New Zealand vs. India, 2nd ODI (`2026-11-07T02:00:00Z`, `status: "NS"`).
   - Discovered **Fixture `#71019`**: New Zealand vs. India, 1st ODI at Eden Park, Auckland (`2026-11-04T02:00:00Z`, `status: "Finished"`, 387 ball-by-ball deliveries).
   - Verified that `include=localteam,visitorteam,runs,batting,bowling,lineup,balls,venue,league` populates full `batsman`, `bowler`, `score`, and `team` records on each delivery in `balls`, and that Sportmonks marks wide deliveries with `score.ball = false` and `score.name = "5 Wides"`.
3. **Tavily Web Search API**:
   - Verified live search results for New Zealand vs. India ODI pitch and matchup reports.

---

## Completed Implementation Phases

- [x] **Phase 0 — Workspace Inspection, Clean Repository & Verification Spike**
  - Created npm workspaces monorepo (`packages/shared`, `apps/web`, `apps/extension`), strict `tsconfig.base.json`, sanitized `.env.example`, and `.gitignore`.
- [x] **Phase 1 — Shared Schemas, Swiss Design System & Firestore ADC**
  - Implemented `@overwatch/shared` (`schemas.ts`, `cricket.ts`, `inference.ts`, `adapter.ts`) and singleton-safe `firebase-admin.ts` with ADC.
  - Applied Swiss International Typographic Style (`#F6F5F0` warm paper canvas, `#111110` deep graphite ink, `#D9381E` vermilion signal accent, `0px` sharp grid geometry, tabular monospace telemetry).
- [x] **Phase 2 — Mock Market Directory, Detail Page & URL-First Detection**
  - Seeded canonical markets (`ind-nz-over-15`, `ind-nz-overs-11-15`, `ind-nz-1st-odi-over-15`) into Firestore (`npm run seed`).
  - Built `/` (Curated Market Intelligence Index), `/markets/[marketId]`, and `/api/markets/[marketId]`.
  - Implemented `DemoMarketAdapter` (URL-first extraction with DOM attribute fallback).
- [x] **Phase 3 — Sportmonks Connector, Safe Web Search/Fetch & Tool Registry**
  - Implemented `cricket-sportmonks.ts` (`validateSportmonksIncludes`, `normalizeSportmonksFixture`, `fetchSportmonksFixtureData`).
  - Implemented `web-tools.ts` (`executeWebSearch` via Tavily, `executeSafeWebFetchPage` with DNS resolution + private/loopback/metadata IP SSRF blocklist + Readability + `<UNTRUSTED_WEB_EVIDENCE>` delimiters).
  - Implemented `ToolRegistry` and `EvidenceCollector` assigning sequential `EV-XX` IDs.
- [x] **Phase 4 — `InferenceProvider` Abstraction, `ZeroGInferenceProvider` & `MockInferenceProvider`**
  - Implemented `runCompletionWithToolLoop` shared across both mock and live 0G providers.
  - Implemented `ZeroGInferenceProvider` (`https://router-api.0g.ai/v1`, `0gm-1.0-35b-a3b`, capturing `x_0g_trace` request IDs).
  - Implemented multi-turn `MockInferenceProvider` supporting `standard_cricket`, `live_match_development`, `conflicting_evidence`, `insufficient_evidence`, `sentry_notify_only`, `sentry_escalate_scouting`, and error simulation scenarios.
  - Added startup guard prohibiting `INFERENCE_PROVIDER=mock` when `NODE_ENV=production`.
- [x] **Phase 5 — Sergeant, 3-Specialist Squad, Recon & Report UI**
  - Implemented `executeReconWorkflow` (Step 1 Sergeant Planning -> Step 2 Parallel Data & Intelligence Specialists -> Step 3 Contrarian Adversarial Review -> Step 4 Sergeant Synthesis & `verifyAndSanitizeClaims` evidence verification).
  - Built `OverwatchSidePanel` rendering all required states and inspectable `EV-XX` evidence sources.
- [x] **Phase 6 — Guard Watch Worker, Generic Snapshot Comparator, Sentry & Scouting**
  - Implemented `compareNormalizedSnapshots` (`comparator.ts`), `runSentryEvaluation`, `evaluateSergeantScoutingDecision`, `executeScoutingWorkflow`, Firestore transaction lease claiming (`claimTrackedMarketLease`), cooldowns (`45s`), Sentry/Scouting hard caps, credit-exhaustion pause (`PAUSED_CREDITS`), and standalone `src/worker/guard-watch.ts`.
- [x] **Phase 7 — Chrome MV3 Extension, Wallet Challenge Auth & AES-256-GCM 0G Key Vault**
  - Built WXT Chrome MV3 extension (`apps/extension/entrypoints/background.ts`, `content.ts`, `sidepanel/main.tsx`) using `chrome.tabs`, `chrome.sidePanel`, `chrome.alarms`, and `chrome.notifications`.
  - Implemented `viem` wallet challenge signature verification (`/api/auth/challenge`, `/api/auth/verify`) and AES-256-GCM key encryption (`crypto-vault.ts`, `/api/0g/credentials`).
- [x] **Phase 8 — Testing, Typecheck, Production Build & E2E Acceptance Verification**
  - Vitest unit and integration suites: `18/18` passing (`unit.test.ts` & `integration.test.ts`).
  - Playwright Chromium E2E acceptance suite: `2/2` passing (`overwatch.spec.ts` verifying the full Open Market → Detect → Recon → Evidence Inspection → Track Market → Guard Watch → Sentry → Scouting → Notification lifecycle).
  - Production builds verified: Next.js (`apps/web/.next`) and Chrome MV3 Extension (`apps/extension/.output/chrome-mv3`).
