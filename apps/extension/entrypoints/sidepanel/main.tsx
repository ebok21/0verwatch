import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import { ReconRadarHUD } from "./ReconRadarHUD";
import {
  defaultDemoMarketAdapter,
  detectMarketFromUrlOrDom,
  EvidenceRecord,
  MarketIdentifier,
  MarketMetadata,
  NotificationRecord,
  PaperPosition,
  ReconReport,
  TrackedMarket,
} from "@overwatch/shared";
import "./style.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

interface ReadinessStatus {
  ready: boolean;
  user: {
    hasSkKey: boolean;
    skMaskedPreview: string | null;
    hasMkKey: boolean;
  };
  zeroGBalance?: {
    ok: boolean;
    address?: string;
    currency: string;
    totalBalanceUsd: number;
    creditBalanceUsd: number;
    depositBalanceUsd: number;
    formattedBalance: string;
    totalUsedUsd: number;
    activeKeyCount: number;
    error?: string;
  } | null;
  services: {
    zeroGInferenceKey: { status: string; notice: string };
    vaultEncryptionKey: { status: string };
    sportmonksApi: { status: string };
    tavilySearchApi: { status: string };
    firestoreDatabase: { status: string };
  };
  budgetTelemetry: {
    config: {
      inferenceEnabled: boolean;
      sentryEnabled: boolean;
      maxDailyModelCalls: number;
    };
    dailyCallsUsed: number;
    dailyCallsRemaining: number;
  };
}

export function ExtensionSidePanelApp() {
  const [activeTabUrl, setActiveTabUrl] = useState<string>("");
  const [identifier, setIdentifier] = useState<MarketIdentifier | null>(null);
  const [market, setMarket] = useState<MarketMetadata | null>(null);
  const [report, setReport] = useState<ReconReport | null>(null);
  const [position, setPosition] = useState<PaperPosition | null>(null);
  const [trackedMarket, setTrackedMarket] = useState<TrackedMarket | null>(null);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [readiness, setReadiness] = useState<ReadinessStatus | null>(null);

  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [isRunningRecon, setIsRunningRecon] = useState(false);
  const [reconProgressStep, setReconProgressStep] = useState<string | null>(null);
  const [isRunningTick, setIsRunningTick] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Settings & Modal state
  const [showSettings, setShowSettings] = useState(false);
  const [skInput, setSkInput] = useState("");
  const [mkInput, setMkInput] = useState("");
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // Collapsible sections - collapsed by default
  const [showFactors, setShowFactors] = useState(false);
  const [showRisks, setShowRisks] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);

  // Paper position & utility controls
  const [isClosingPosition, setIsClosingPosition] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulationBanner, setSimulationBanner] = useState<string | null>(null);

  // References to prevent re-entrant loops and unbounded fetch spam
  const identifierRef = useRef<MarketIdentifier | null>(null);
  const loadedMarketIdRef = useRef<string | null>(null);
  const attemptedMarketIdRef = useRef<string | null>(null);
  const isLoadingMarketRef = useRef<boolean>(false);
  const isSimulatingRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const loadReadiness = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/readiness`);
      if (res.ok) {
        setReadiness(await res.json());
      }
    } catch {
      // Offline/connecting
    }
  }, []);

  const loadMarketData = useCallback(async (marketId: string, force: boolean = false) => {
    if (!force && attemptedMarketIdRef.current === marketId) {
      return;
    }
    attemptedMarketIdRef.current = marketId;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    const signal = abortController.signal;

    setIsLoadingMarket(true);
    isLoadingMarketRef.current = true;
    setErrorMsg(null);

    try {
      const storage = await chrome.storage?.local?.get(["overwatchSessionToken"]).catch(() => ({}));
      const sessionToken = (storage as any)?.overwatchSessionToken as string | undefined;
      const headers: Record<string, string> = {};
      if (sessionToken) {
        headers.Authorization = `Bearer ${sessionToken}`;
      }

      const [mSettled, rSettled, pSettled, wSettled, nSettled] = await Promise.allSettled([
        fetch(`${API_BASE_URL}/api/markets/${encodeURIComponent(marketId)}`, { signal, headers }),
        fetch(`${API_BASE_URL}/api/recon?marketId=${encodeURIComponent(marketId)}`, { signal, headers }),
        fetch(`${API_BASE_URL}/api/positions?marketId=${encodeURIComponent(marketId)}&status=OPEN`, { signal, headers }),
        fetch(`${API_BASE_URL}/api/watch?marketId=${encodeURIComponent(marketId)}`, { signal, headers }),
        fetch(`${API_BASE_URL}/api/notifications`, { signal, headers }),
      ]);

      if (signal.aborted) return;

      // 1. Core Market Metadata
      let marketResolved = false;
      if (mSettled.status === "fulfilled" && mSettled.value.ok) {
        const mData = await mSettled.value.json().catch(() => ({}));
        const resolvedMarket = mData.market ?? (mData.marketId ? mData : null);
        if (resolvedMarket) {
          setMarket(resolvedMarket);
          if (mData.latestReport) {
            setReport(mData.latestReport);
          }
          loadedMarketIdRef.current = marketId;
          setErrorMsg(null);
          marketResolved = true;
        }
      }

      // Fallback: If port 3000 did not return the market, query port 3001 (Mock Market server)
      if (!marketResolved && !signal.aborted) {
        try {
          const fallbackRes = await fetch(
            `http://127.0.0.1:3001/api/markets/${encodeURIComponent(marketId)}`,
            { signal }
          );
          if (fallbackRes.ok) {
            const fbData = await fallbackRes.json().catch(() => ({}));
            const resolvedMarket = fbData.market ?? (fbData.marketId ? fbData : null);
            if (resolvedMarket) {
              setMarket(resolvedMarket);
              loadedMarketIdRef.current = marketId;
              setErrorMsg(null);
              marketResolved = true;
            }
          }
        } catch {
          // Port 3001 offline or unreachable
        }
      }

      if (!marketResolved) {
        if (mSettled.status === "fulfilled") {
          const errBody = await mSettled.value.json().catch(() => ({}));
          const msg = errBody.message || `Backend returned HTTP ${mSettled.value.status} for market.`;
          console.warn("[Extension] Market fetch non-ok:", mSettled.value.status, errBody);
          setErrorMsg(msg);
        } else if ((mSettled.reason as any)?.name !== "AbortError") {
          console.error("[Extension] Failed to connect to backend for market data:", mSettled.reason);
          setErrorMsg(`Failed to connect to 0verwatch backend (${API_BASE_URL}). Ensure Next.js is running (npm run dev:web).`);
        }
      }

      // 2. Latest Recon Report
      if (rSettled.status === "fulfilled" && rSettled.value.ok) {
        const rData = await rSettled.value.json().catch(() => ({}));
        if (rData.report) {
          setReport(rData.report);
        }
      }

      // 3. Open Positions
      if (pSettled.status === "fulfilled" && pSettled.value.ok) {
        const pData = await pSettled.value.json().catch(() => ({}));
        setPosition(pData.positions?.[0] ?? null);
      }

      // 4. Guard Watch State
      if (wSettled.status === "fulfilled" && wSettled.value.ok) {
        const wData = await wSettled.value.json().catch(() => ({}));
        setTrackedMarket(wData.trackedMarkets?.[0] ?? null);
      }

      // 5. Notifications
      if (nSettled.status === "fulfilled" && nSettled.value.ok) {
        const nData = await nSettled.value.json().catch(() => ({}));
        setNotifications(nData.notifications ?? []);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("[Extension] loadMarketData unexpected error:", err);
        setErrorMsg("Failed to load market data from backend.");
      }
    } finally {
      if (!signal.aborted) {
        setIsLoadingMarket(false);
        isLoadingMarketRef.current = false;
      }
    }
  }, []);

  // Inspect current tab URL with deduplication and race protection
  const refreshCurrentTab = useCallback(async () => {
    if (isSimulatingRef.current) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? "";
      setActiveTabUrl(url);

      // Check if URL is a demo market URL
      const detected = detectMarketFromUrlOrDom(url);

      if (detected) {
        const prev = identifierRef.current;
        const isSame = prev && prev.marketId === detected.marketId && prev.platform === detected.platform;
        if (!isSame) {
          identifierRef.current = detected;
          setIdentifier(detected);
        }
        if (attemptedMarketIdRef.current !== detected.marketId) {
          void loadMarketData(detected.marketId);
        }
        return;
      }

      // Fallback: query DOM from content script
      if (tab?.id) {
        try {
          const domRes = await chrome.tabs.sendMessage(tab.id, {
            type: "OVERWATCH_EXTRACT_DOM_FALLBACK",
          });
          if (domRes?.dataMarketId) {
            const domId: MarketIdentifier = {
              platform: "demo",
              marketId: domRes.dataMarketId,
              detectedVia: "dom",
            };
            const prev = identifierRef.current;
            const isSame = prev && prev.marketId === domId.marketId && prev.platform === domId.platform;
            if (!isSame) {
              identifierRef.current = domId;
              setIdentifier(domId);
            }
            if (attemptedMarketIdRef.current !== domId.marketId) {
              void loadMarketData(domId.marketId);
            }
            return;
          }
        } catch {
          // Content script not ready
        }
      }

      // Stale context fix: clear market state immediately when not on a market URL
      if (identifierRef.current !== null) {
        identifierRef.current = null;
        loadedMarketIdRef.current = null;
        attemptedMarketIdRef.current = null;
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        setIdentifier(null);
        setMarket(null);
        setReport(null);
        setPosition(null);
        setTrackedMarket(null);
        setErrorMsg(null);
      }
    } catch {
      // Tab query error
    }
  }, [loadMarketData]);

  useEffect(() => {
    void refreshCurrentTab();
    void loadReadiness();

    const messageListener = (msg: any) => {
      if (msg?.type === "OVERWATCH_ACTIVE_TAB_UPDATED") {
        void refreshCurrentTab();
      } else if (msg?.type === "OVERWATCH_DEMO_POSITION_EVENT") {
        const mid = identifierRef.current?.marketId;
        if (mid) {
          void loadMarketData(mid, true);
        }
      }
    };

    // Periodic telemetry polling: checks sweeps, positions, and Sentry alerts every 10 seconds
    const telemetryInterval = setInterval(() => {
      const mid = identifierRef.current?.marketId;
      if (mid && !isLoadingMarketRef.current && !isSimulatingRef.current) {
        void loadMarketData(mid, true);
      }
    }, 10000);

    chrome.runtime.onMessage.addListener(messageListener);
    return () => {
      clearInterval(telemetryInterval);
      chrome.runtime.onMessage.removeListener(messageListener);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [refreshCurrentTab, loadReadiness, loadMarketData]);

  // Execute Recon workflow
  const handleRunRecon = async () => {
    if (!identifier || isRunningRecon) return;
    setIsRunningRecon(true);
    setErrorMsg(null);
    setReconProgressStep("Planning Squad Mission...");

    try {
      const stepTimer1 = setTimeout(() => {
        setReconProgressStep("Parallel Specialists Active: Data & Intelligence...");
      }, 8000);

      const stepTimer2 = setTimeout(() => {
        setReconProgressStep("Cross-Validating Live Scorecards & News Coverage...");
      }, 40000);

      const stepTimer3 = setTimeout(() => {
        setReconProgressStep("Sergeant Synthesizing Empirical Evidence...");
      }, 80000);

      const stepTimer4 = setTimeout(() => {
        setReconProgressStep("Finalizing Thesis & Probability Calibration...");
      }, 120000);

      const res = await fetch(`${API_BASE_URL}/api/recon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: identifier.marketId,
          platform: "demo",
        }),
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      clearTimeout(stepTimer3);
      clearTimeout(stepTimer4);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setReport(data.report);
      void loadReadiness();
      if (identifierRef.current?.marketId) {
        void loadMarketData(identifierRef.current.marketId, true);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningRecon(false);
      setReconProgressStep(null);
    }
  };

  // Test 0G Connection
  const handleTest0G = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/0g/test-connection`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult(`✓ Connected to 0G (${data.model}) in ${data.latencyMs}ms. ${data.billedRequestDisclosure}`);
      } else {
        setTestResult(`✗ Failed: ${data.message || data.error}`);
      }
    } catch (err) {
      setTestResult("✗ Could not reach test endpoint.");
    } finally {
      setTestingConnection(false);
    }
  };

  // Save 0G Keys
  const handleSaveKeys = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/0g/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skKey: skInput.trim(),
          mkKey: mkInput.trim() || null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkInput("");
        setMkInput("");
        void loadReadiness();
        if (data.balance?.ok) {
          setTestResult(`✓ Keys stored! Live 0G Balance: ${data.balance.formattedBalance} (${data.balance.activeKeyCount} active key, $${data.balance.totalUsedUsd} used)`);
        } else {
          setTestResult("✓ 0G credentials saved in encrypted vault.");
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setTestResult(`✗ Failed: ${err.message || "Could not save credentials"}`);
      }
    } catch {
      setTestResult("Failed to save credentials.");
    }
  };

  // Manual Guard Watch & Sentry Trigger
  const handleTickWatch = async () => {
    if (isRunningTick) return;
    setIsRunningTick(true);
    try {
      if (trackedMarket) {
        await fetch(`${API_BASE_URL}/api/watch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "TICK",
            trackingId: trackedMarket.trackingId,
            bypassCooldown: true,
          }),
        });
      } else if (identifier?.marketId) {
        await fetch(`${API_BASE_URL}/api/watch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "TRACK",
            marketId: identifier.marketId,
            activeSide: position?.side,
          }),
        });
      }
      if (identifierRef.current?.marketId) {
        await loadMarketData(identifierRef.current.marketId, true);
      }
    } catch {
      // Non-fatal
    } finally {
      setIsRunningTick(false);
    }
  };

  const handleClosePositionInExtension = async () => {
    if (!position || isClosingPosition) return;
    setIsClosingPosition(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/positions/${position.positionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      if (res.ok) {
        setPosition(null);
        if (identifierRef.current?.marketId) {
          void loadMarketData(identifierRef.current.marketId, true);
        }
      }
    } catch {
      // Non-fatal
    } finally {
      setIsClosingPosition(false);
    }
  };

  const handleRunLiveSimulation = async () => {
    if (isSimulating || isRunningRecon) return;
    setIsSimulating(true);
    isSimulatingRef.current = true;
    setErrorMsg(null);

    const simId: MarketIdentifier = {
      platform: "demo",
      marketId: "ind-nz-match-winner",
      detectedVia: "url",
    };
    identifierRef.current = simId;
    loadedMarketIdRef.current = simId.marketId;
    attemptedMarketIdRef.current = simId.marketId;
    setIdentifier(simId);
    setReport(null);
    setPosition(null);
    setTrackedMarket(null);
    setNotifications([]);

    try {
      // STAGE 1: Simulated Live Match Recon (with Radar HUD)
      setSimulationBanner(
        "STAGE 1/3 • LIVE MATCH RECON: IND vs NZ (Innings 1, Over 14.2 — IND 89/1)"
      );
      setIsRunningRecon(true);
      setReconProgressStep("Intercepting Live Sportmonks Feed: IND 89/1 (14.2 ov)...");

      const t1 = setTimeout(() => {
        setReconProgressStep("Data & Intel: Gill 48*(44) & Kohli 27*(26) • RR 6.21...");
      }, 1500);
      const t2 = setTimeout(() => {
        setReconProgressStep("Sergeant Synthesizing Live Win Probability (68% YES)...");
      }, 3000);

      const [reconRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/simulate-live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "RECON", marketId: "ind-nz-match-winner" }),
        }),
        new Promise((r) => setTimeout(r, 4200)),
      ]);

      clearTimeout(t1);
      clearTimeout(t2);
      setIsRunningRecon(false);
      setReconProgressStep(null);

      if (!reconRes.ok) {
        const err = await reconRes.json().catch(() => ({}));
        throw new Error(err.message || "Failed during Simulation Stage 1 (RECON).");
      }
      const reconData = await reconRes.json();
      setMarket(reconData.market);
      setReport(reconData.report);
      setSimulationBanner(
        "✓ STAGE 1 COMPLETE: Sergeant Assessed 68% YES (India 89/1 in 14.2 ov). Executing Paper Trade..."
      );

      // Pause briefly so user can inspect the 68% YES Recon card
      await new Promise((r) => setTimeout(r, 2200));

      // STAGE 2: Open $100 YES Paper Position & Arm Guard Watch
      setSimulationBanner(
        "STAGE 2/3 • OPENING PAPER POSITION: Buying $100 YES Shares on India & Arming Sentry..."
      );
      const posRes = await fetch(`${API_BASE_URL}/api/simulate-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "OPEN_POSITION",
          marketId: "ind-nz-match-winner",
        }),
      });
      if (!posRes.ok) {
        throw new Error("Failed during Simulation Stage 2 (OPEN_POSITION).");
      }
      const posData = await posRes.json();
      setPosition(posData.position);
      setTrackedMarket(posData.trackedMarket);
      setSimulationBanner(
        "✓ STAGE 2 COMPLETE: $100 YES Position Active • Guard Watch Monitoring Live Match..."
      );

      await new Promise((r) => setTimeout(r, 2600));

      // STAGE 3: Simulate Live Match Condition Shock (Over 16.4 Triple Wicket Collapse!)
      setSimulationBanner(
        "⚡ STAGE 3/3 • LIVE MATCH SHOCK (Over 16.4): Gill, Kohli & Iyer Dismissed (IND 94/4)! Invoking Sentry..."
      );
      await new Promise((r) => setTimeout(r, 1600));

      const shockRes = await fetch(`${API_BASE_URL}/api/simulate-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "SHOCK", marketId: "ind-nz-match-winner" }),
      });
      if (!shockRes.ok) {
        throw new Error("Failed during Simulation Stage 3 (SHOCK).");
      }
      const shockData = await shockRes.json();
      if (shockData.trackedMarket) {
        setTrackedMarket(shockData.trackedMarket);
      }
      if (shockData.report) {
        setReport(shockData.report);
      }
      if (shockData.notification) {
        setNotifications((prev) => [shockData.notification, ...prev]);

        // Fire Native Chrome OS Notification via both direct API and Background Service Worker
        const notifId = shockData.notification.notificationId || `sim-notif-${Date.now()}`;
        const notifTitle =
          shockData.notification.title ||
          "⚠️ 0verwatch Sentry Alert [POSITION_THESIS_WEAKENED]";
        const notifMsg =
          shockData.notification.message ||
          "CRITICAL MATCH SHOCK (Over 16.4): India collapsed from 89/1 to 94/4! Win probability dropped 68% → 38%.";

        try {
          chrome.notifications?.create(notifId, {
            type: "basic",
            iconUrl:
              "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            title: notifTitle,
            message: notifMsg,
            priority: 2,
          });
        } catch {
          // Fallback to background script
        }

        try {
          chrome.runtime
            .sendMessage({
              type: "OVERWATCH_TRIGGER_CHROME_NOTIFICATION",
              notificationId: `${notifId}-bg`,
              title: notifTitle,
              message: notifMsg,
            })
            .catch(() => {});
        } catch {
          // Ignore
        }
      }

      setSimulationBanner(
        "🚨 LIVE SIMULATION COMPLETE: Sentry detected the 89/1 → 94/4 collapse, downgraded India YES from 68% → 38%, and dispatched a Chrome Notification!"
      );
    } catch (err) {
      setIsRunningRecon(false);
      setReconProgressStep(null);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setSimulationBanner(null);
    } finally {
      setIsSimulating(false);
      isSimulatingRef.current = false;
    }
  };

  const handleClearAllData = async () => {
    if (isClearingData) return;
    const confirmed = window.confirm(
      "Clear all paper positions, recon reports, and sentry alerts? Configured prediction markets will be retained."
    );
    if (!confirmed) return;

    setIsClearingData(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/clear-data`, {
        method: "POST",
      });
      if (res.ok) {
        setReport(null);
        setPosition(null);
        setTrackedMarket(null);
        setNotifications([]);
        setErrorMsg(null);
        setSimulationBanner(null);
        setTestResult("✓ Operational data cleared. Configured markets retained.");
        if (identifierRef.current?.marketId) {
          void loadMarketData(identifierRef.current.marketId, true);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMsg(err.message || "Failed to clear data.");
      }
    } catch {
      setErrorMsg("Failed to reach clear data endpoint.");
    } finally {
      setIsClearingData(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#F0F6FC] font-sans text-xs flex flex-col">
      {/* 1. Header & Readiness Banner */}
      <header className="border-b border-[#30363D] bg-[#161B22] p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-[#2EA043] rounded-full inline-block" />
          <span className="font-mono text-xs font-bold tracking-wider text-white">
            0VERWATCH // FIELD OPS
          </span>
        </div>

        <div className="flex items-center gap-2">
          {readiness?.zeroGBalance?.ok && (
            <span className="font-mono text-[10px] px-2 py-0.5 bg-[#238636]/10 border border-[#238636]/40 text-[#3FB950] font-bold rounded">
              0G: {readiness.zeroGBalance.formattedBalance}
            </span>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`font-mono text-[10px] px-2 py-0.5 border rounded font-bold transition-colors ${readiness?.ready
              ? "border-[#238636] bg-[#238636]/20 text-[#3FB950]"
              : "border-[#D29922] bg-[#D29922]/20 text-[#E3B341]"
              }`}
          >
            {readiness?.ready ? "SYS: READY" : "SYS: SETUP"} ⚙
          </button>
        </div>
      </header>

      {/* Settings Modal / Drawer */}
      {showSettings && (
        <div className="bg-[#161B22] border-b border-[#30363D] p-4 space-y-4 font-mono text-xs">
          <div className="flex justify-between items-center border-b border-[#30363D] pb-2">
            <span className="font-bold text-white uppercase">0G CREDENTIALS & READINESS</span>
            <button onClick={() => setShowSettings(false)} className="text-[#8B949E] hover:text-white">✕</button>
          </div>

          {readiness?.zeroGBalance?.ok && (
            <div className="p-2.5 bg-[#0D1117] border border-[#238636]/40 rounded space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-[#8B949E]">0G INFERENCE BALANCE:</span>
                <span className="font-bold text-[#3FB950] text-xs">
                  {readiness.zeroGBalance.formattedBalance}
                </span>
              </div>
              <div className="flex justify-between items-center text-[10px] text-[#8B949E]">
                <span>Credits: ${readiness.zeroGBalance.creditBalanceUsd}</span>
                <span>Used: ${readiness.zeroGBalance.totalUsedUsd}</span>
                <span>{readiness.zeroGBalance.activeKeyCount} Active Key(s)</span>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div>
              <label className="block text-[#8B949E] text-[10px] uppercase mb-1">
                0G INFERENCE SECRET KEY (sk-) *
              </label>
              <input
                type="password"
                placeholder={readiness?.user.skMaskedPreview || "sk-..."}
                value={skInput}
                onChange={(e) => setSkInput(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0D1117] border border-[#30363D] text-white rounded text-xs"
              />
            </div>

            <div>
              <label className="block text-[#8B949E] text-[10px] uppercase mb-1">
                OPTIONAL MANAGEMENT KEY (mk-)
              </label>
              <input
                type="password"
                placeholder="mk-... (account:read balance/usage only)"
                value={mkInput}
                onChange={(e) => setMkInput(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0D1117] border border-[#30363D] text-white rounded text-xs"
              />
              <span className="text-[10px] text-[#8B949E]">
                Notice: used exclusively for read-only balance telemetry.
              </span>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveKeys}
                className="flex-1 py-1.5 bg-[#238636] hover:bg-[#2EA043] text-white font-bold rounded"
              >
                SAVE KEYS
              </button>
              <button
                type="button"
                disabled={testingConnection}
                onClick={handleTest0G}
                className="flex-1 py-1.5 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-white font-bold rounded"
              >
                {testingConnection ? "TESTING..." : "TEST 0G (1 TOKEN)"}
              </button>
            </div>

            {testResult && (
              <div className="p-2 bg-[#0D1117] border border-[#30363D] text-[11px] text-[#58A6FF] rounded">
                {testResult}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Extension Body */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {/* Prominent setup notification if user has not entered 0G keys */}
        {readiness && !readiness.user.hasSkKey && (
          <div className="p-3 bg-[#D29922]/10 border border-[#D29922] text-[#E3B341] font-mono text-xs rounded space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-xs">
              <span>⚠</span> 0G CREDENTIALS REQUIRED
            </div>
            <p className="text-[11px] text-[#C9D1D9]">
              0verwatch requires your user 0G Secret Key (sk-) and Management Key (mk-) to run decentralized inference and track credits. Environment fallbacks are strictly disabled.
            </p>
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="px-3 py-1 bg-[#D29922] hover:bg-[#E3B341] text-[#0D1117] font-bold rounded text-[10px] uppercase transition-colors"
            >
              Enter 0G Keys in Settings
            </button>
          </div>
        )}

        {/* Simulation Telemetry Banner */}
        {simulationBanner && (
          <div
            className={`p-3 border font-mono text-[11px] rounded flex items-start justify-between gap-2 ${
              simulationBanner.startsWith("🚨")
                ? "bg-[#D29922]/15 border-[#D29922] text-[#E3B341]"
                : "bg-[#1F6FEB]/15 border-[#1F6FEB] text-[#58A6FF]"
            }`}
          >
            <span className="flex-1 leading-snug font-bold">{simulationBanner}</span>
            {!isSimulating && (
              <button
                type="button"
                onClick={() => setSimulationBanner(null)}
                className="text-[10px] opacity-75 hover:opacity-100 px-1"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Error notification */}
        {errorMsg && (
          <div className="p-3 bg-[#F85149]/10 border border-[#F85149] text-[#F85149] font-mono text-xs rounded flex items-start justify-between gap-2">
            <span className="flex-1 break-words">{errorMsg}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              {identifier && (
                <button
                  type="button"
                  onClick={() => void loadMarketData(identifier.marketId, true)}
                  className="px-2 py-0.5 bg-[#F85149]/20 hover:bg-[#F85149]/30 text-[#F85149] border border-[#F85149]/40 rounded text-[10px] uppercase font-bold transition-colors"
                >
                  Retry
                </button>
              )}
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                aria-label="Dismiss error"
                className="px-1.5 py-0.5 text-[#8B949E] hover:text-[#C9D1D9] text-[10px] transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* 2. Active Market Detection */}
        {!identifier ? (
          <div className="p-6 border border-[#30363D] bg-[#161B22] rounded text-center space-y-3 font-mono">
            <div className="text-sm font-bold text-[#8B949E]">NO MARKET DETECTED</div>
            <p className="text-xs text-[#8B949E] leading-relaxed">
              Navigate to a Demo Prediction Market page in your active tab to begin research.
            </p>
            <div className="text-[11px] text-[#58A6FF]">
              Target: http://localhost:3000/markets/ind-nz-over-15
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Market Info Card */}
            <div className="p-3.5 bg-[#161B22] border border-[#30363D] rounded space-y-2 font-mono">
              <div className="flex justify-between items-center text-[10px]">
                <span className="px-1.5 py-0.5 bg-[#21262D] border border-[#30363D] text-[#58A6FF] font-bold rounded">
                  {market?.category || "CRICKET"} • {market?.matchFormat || "ODI"}
                </span>
                <span className="text-[#8B949E]">FIXTURE #{market?.fixtureId}</span>
              </div>
              <h2 className="text-xs font-bold text-white leading-snug">
                {market?.question || identifier.marketId}
              </h2>
              <div className="text-[11px] text-[#8B949E]">
                {market?.homeTeam} vs {market?.awayTeam} • {market?.competition}
              </div>
            </div>

            {/* 3. Recon Action or Radar HUD */}
            {isRunningRecon ? (
              <ReconRadarHUD currentStep={reconProgressStep} />
            ) : !report ? (
              <div className="p-4 bg-[#161B22] border border-[#30363D] rounded space-y-3 text-center">
                <button
                  onClick={handleRunRecon}
                  className="w-full py-2.5 bg-[#238636] hover:bg-[#2EA043] text-white font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors"
                >
                  START RECON RESEARCH →
                </button>
              </div>
            ) : null}

            {/* 4. Large Final Estimate Display */}
            {report && (
              <div className="p-4 bg-[#161B22] border-2 border-[#30363D] rounded space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[10px] uppercase font-bold text-[#8B949E]">
                    AI ESTIMATE — UNCALIBRATED
                  </span>
                  <span className="font-mono text-[10px] text-[#8B949E]">
                    Duration: {Math.round((report.telemetry?.durationMs ?? 0) / 1000)}s
                  </span>
                </div>

                <div className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-3xl font-black ${report.assessment === "YES"
                      ? "text-[#3FB950]"
                      : report.assessment === "NO"
                        ? "text-[#F85149]"
                        : "text-[#D29922]"
                      }`}
                  >
                    {report.assessment === "INCONCLUSIVE"
                      ? "INCONCLUSIVE"
                      : `${report.yesProbability}% YES`}
                  </span>
                  {report.noProbability !== null && (
                    <span className="font-mono text-xs text-[#8B949E]">
                      ({report.noProbability}% NO)
                    </span>
                  )}
                </div>

                <p className="text-xs text-[#E6EDF3] leading-relaxed">
                  {report.summary}
                </p>
              </div>
            )}

            {/* 5. Active Paper Position Card */}
            <div className="p-3.5 bg-[#161B22] border border-[#30363D] rounded space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-mono text-[10px] uppercase font-bold text-[#8B949E]">
                  ACTIVE PAPER POSITION
                </span>
                <span className="font-mono text-[9px] px-1.5 py-0.5 border border-[#238636] bg-[#238636]/20 text-[#3FB950] font-bold rounded">
                  PAPER POSITION — DEMO ONLY
                </span>
              </div>

              {position ? (
                <div className="flex justify-between items-center font-mono">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 font-bold uppercase rounded ${
                        position.side === "YES" ? "bg-[#238636] text-white" : "bg-[#DA3633] text-white"
                      }`}
                    >
                      {position.side}
                    </span>
                    <span className="text-xs font-bold text-white">
                      ${position.stake} Demo Stake
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#3FB950] font-bold">
                      ● ON SENTRY
                    </span>
                    <button
                      type="button"
                      disabled={isClosingPosition}
                      onClick={handleClosePositionInExtension}
                      className="px-2 py-0.5 bg-[#21262D] hover:bg-[#30363D] text-[#8B949E] hover:text-[#F85149] border border-[#30363D] rounded text-[10px] font-mono transition-colors"
                    >
                      {isClosingPosition ? "..." : "Close"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="py-2.5 px-3 bg-[#0D1117] border border-[#21262D] rounded text-center space-y-1.5 font-mono">
                  <div className="text-[11px] text-[#8B949E]">
                    No open paper position for this market.
                  </div>
                  <div className="text-[10px] text-[#6E7681]">
                    Trades are placed directly on the Demo Market to trigger Sentry & Guard Watch.
                  </div>
                </div>
              )}
            </div>

            {/* 6. Guard Watch & Sentry Card */}
            <div className="p-3.5 bg-[#161B22] border border-[#30363D] rounded space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-mono text-[10px] uppercase font-bold text-[#8B949E]">
                  GUARD WATCH & SENTRY
                </span>
                <span className="font-mono text-[10px] text-[#3FB950] font-bold">
                  {trackedMarket?.status === "WATCHING" ? "● ON WATCH" : "IDLE"}
                </span>
              </div>

              <div className="flex justify-between items-center font-mono text-[11px]">
                <span className="text-[#8B949E]">
                  Sweeps: {trackedMarket?.snapshotCount || 0} • Sentry: {trackedMarket?.sentryCallCount || 0}/3
                </span>
                <button
                  type="button"
                  disabled={isRunningTick}
                  onClick={handleTickWatch}
                  className="px-2 py-1 bg-[#21262D] hover:bg-[#30363D] border border-[#30363D] text-[10px] font-bold text-white rounded"
                >
                  {isRunningTick ? "EVALUATING..." : "EVALUATE SENTRY NOW"}
                </button>
              </div>

              {/* Latest Meaningful Sentry Alert */}
              {notifications.length > 0 && notifications[0] && (
                <div className="mt-2 p-2.5 bg-[#0D1117] border border-[#D29922] rounded font-mono space-y-1">
                  <div className="flex justify-between text-[10px]">
                    <span className="font-bold text-[#E3B341]">
                      {notifications[0].alertCategory || "MATCH DEVELOPMENT"}
                    </span>
                    <span className="text-[#8B949E]">
                      {new Date(notifications[0].createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="text-xs text-white">
                    {notifications[0].message}
                  </div>
                </div>
              )}
            </div>

            {/* 7. Collapsible Progressive Disclosure: Factors & Risks */}
            {report && (
              <div className="space-y-2 font-mono">
                {/* Key Factors */}
                <div className="border border-[#30363D] bg-[#161B22] rounded">
                  <button
                    onClick={() => setShowFactors(!showFactors)}
                    className="w-full p-2.5 flex justify-between items-center text-xs font-bold text-left text-white"
                  >
                    <span>SUPPORTING EVIDENCE ({report.keyFactors.length})</span>
                    <span>{showFactors ? "−" : "+"}</span>
                  </button>
                  {showFactors && (
                    <div className="p-2.5 pt-0 space-y-2 text-xs border-t border-[#30363D]/50">
                      {report.keyFactors.map((f, i) => (
                        <div key={i} className="flex items-start gap-2 text-[#E6EDF3]">
                          <span className="text-[10px] px-1 bg-[#238636]/20 border border-[#238636] text-[#3FB950] rounded">
                            {f.evidenceIds[0] || "EV"}
                          </span>
                          <span className="leading-snug">{f.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Risks & Counter Factors */}
                <div className="border border-[#30363D] bg-[#161B22] rounded">
                  <button
                    onClick={() => setShowRisks(!showRisks)}
                    className="w-full p-2.5 flex justify-between items-center text-xs font-bold text-left text-white"
                  >
                    <span>RISKS & COUNTER-THESES ({report.risks.length})</span>
                    <span>{showRisks ? "−" : "+"}</span>
                  </button>
                  {showRisks && (
                    <div className="p-2.5 pt-0 space-y-2 text-xs border-t border-[#30363D]/50">
                      {report.risks.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-[#E6EDF3]">
                          <span className="text-[10px] px-1 bg-[#DA3633]/20 border border-[#DA3633] text-[#F85149] rounded">
                            RISK
                          </span>
                          <span className="leading-snug">{r.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Source Registry */}
                <div className="border border-[#30363D] bg-[#161B22] rounded">
                  <button
                    onClick={() => setShowSources(!showSources)}
                    className="w-full p-2.5 flex justify-between items-center text-xs font-bold text-left text-white"
                  >
                    <span>SOURCE REGISTRY ({report.evidenceIds.length})</span>
                    <span>{showSources ? "−" : "+"}</span>
                  </button>
                  {showSources && (
                    <div className="p-2.5 pt-0 space-y-1.5 text-[11px] border-t border-[#30363D]/50">
                      {Object.values(report.evidenceMap).map((ev) => (
                        <div key={ev.evidenceId} className="flex justify-between items-center text-[#8B949E]">
                          <span>{ev.evidenceId} • {ev.title || ev.toolOperation}</span>
                          <span className="text-[9px] truncate max-w-[140px]">{ev.sourceUrlOrOrigin}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 6. Bottom Simulation & Clear All Data Utilities */}
        <div className="pt-4 border-t border-[#30363D] text-center space-y-2.5 font-mono">
          <div className="space-y-1">
            <button
              type="button"
              disabled={isSimulating || isRunningRecon}
              onClick={handleRunLiveSimulation}
              className="w-full py-2.5 bg-[#1F6FEB]/20 hover:bg-[#1F6FEB]/35 border border-[#1F6FEB] text-[#58A6FF] hover:text-white text-[10px] font-bold uppercase rounded transition-colors disabled:opacity-50"
            >
              {isSimulating
                ? "⚡ RUNNING LIVE MATCH & SENTRY SIMULATION..."
                : "▶ SIMULATE LIVE MATCH & SENTRY SCENARIO (IND vs NZ)"}
            </button>
            <div className="text-[9px] text-[#8B949E]">
              Simulates live IND vs NZ match (68% YES) → opens $100 YES trade → triggers Over 16.4 collapse & Chrome Sentry alert
            </div>
          </div>

          <div className="space-y-1 pt-1">
            <button
              type="button"
              disabled={isClearingData || isSimulating}
              onClick={handleClearAllData}
              className="w-full py-2 bg-[#21262D] hover:bg-[#DA3633]/20 border border-[#30363D] hover:border-[#DA3633] text-[#8B949E] hover:text-[#F85149] text-[10px] font-bold uppercase rounded transition-colors disabled:opacity-50"
            >
              {isClearingData ? "CLEARING OPERATIONAL DATA..." : "🗑 CLEAR ALL DATA (RETAIN MARKETS)"}
            </button>
            <div className="text-[9px] text-[#6E7681]">
              Clears positions, recon runs & alerts • Preserves configured markets
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<ExtensionSidePanelApp />);
}
