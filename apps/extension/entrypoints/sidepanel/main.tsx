import React, { useEffect, useState, useCallback, useMemo } from "react";
import ReactDOM from "react-dom/client";
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

  // Collapsible sections
  const [showFactors, setShowFactors] = useState(true);
  const [showRisks, setShowRisks] = useState(true);
  const [showSources, setShowSources] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);

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

  const loadMarketData = useCallback(async (marketId: string) => {
    setIsLoadingMarket(true);
    setErrorMsg(null);
    try {
      const [mRes, rRes, pRes, wRes, nRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/markets/${encodeURIComponent(marketId)}`),
        fetch(`${API_BASE_URL}/api/recon?marketId=${encodeURIComponent(marketId)}`),
        fetch(`${API_BASE_URL}/api/positions?marketId=${encodeURIComponent(marketId)}&status=OPEN`),
        fetch(`${API_BASE_URL}/api/watch?marketId=${encodeURIComponent(marketId)}`),
        fetch(`${API_BASE_URL}/api/notifications`),
      ]);

      if (mRes.ok) {
        const mData = await mRes.json();
        setMarket(mData.market ?? null);
      }

      if (rRes.ok) {
        const rData = await rRes.json();
        setReport(rData.report ?? null);
      }

      if (pRes.ok) {
        const pData = await pRes.json();
        setPosition(pData.positions?.[0] ?? null);
      }

      if (wRes.ok) {
        const wData = await wRes.json();
        setTrackedMarket(wData.trackedMarkets?.[0] ?? null);
      }

      if (nRes.ok) {
        const nData = await nRes.json();
        setNotifications(nData.notifications ?? []);
      }
    } catch (err) {
      setErrorMsg("Failed to load market data from backend.");
    } finally {
      setIsLoadingMarket(false);
    }
  }, []);

  // Inspect current tab URL
  const refreshCurrentTab = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url ?? "";
      setActiveTabUrl(url);

      // Check if URL is a demo market URL
      const detected = detectMarketFromUrlOrDom({
        url,
        adapters: [defaultDemoMarketAdapter],
      });

      if (detected) {
        setIdentifier(detected);
        loadMarketData(detected.marketId);
      } else {
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
              setIdentifier(domId);
              loadMarketData(domId.marketId);
              return;
            }
          } catch {
            // Content script not ready
          }
        }
        // Stale context fix: clear market state immediately when not on a market URL
        setIdentifier(null);
        setMarket(null);
        setReport(null);
        setPosition(null);
        setTrackedMarket(null);
      }
    } catch {
      // Tab query error
    }
  }, [loadMarketData]);

  useEffect(() => {
    refreshCurrentTab();
    loadReadiness();

    const messageListener = (msg: any) => {
      if (msg?.type === "OVERWATCH_ACTIVE_TAB_UPDATED") {
        refreshCurrentTab();
      } else if (msg?.type === "OVERWATCH_DEMO_POSITION_EVENT") {
        if (identifier) {
          loadMarketData(identifier.marketId);
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    return () => chrome.runtime.onMessage.removeListener(messageListener);
  }, [refreshCurrentTab, loadReadiness, identifier]);

  // Execute Recon workflow
  const handleRunRecon = async () => {
    if (!identifier || isRunningRecon) return;
    setIsRunningRecon(true);
    setErrorMsg(null);
    setReconProgressStep("Planning Squad Mission...");

    try {
      const stepTimer1 = setTimeout(() => {
        setReconProgressStep("Parallel Specialists Active: Data & Intelligence...");
      }, 2500);

      const stepTimer2 = setTimeout(() => {
        setReconProgressStep("Sergeant Synthesizing Empirical Evidence...");
      }, 15000);

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

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setReport(data.report);
      loadReadiness();
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
        setSkInput("");
        setMkInput("");
        loadReadiness();
        setTestResult("✓ 0G credentials saved in encrypted vault.");
      }
    } catch {
      setTestResult("Failed to save credentials.");
    }
  };

  // Manual Guard Watch Tick
  const handleTickWatch = async () => {
    if (!trackedMarket || isRunningTick) return;
    setIsRunningTick(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/watch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TICK",
          trackingId: trackedMarket.trackingId,
          bypassCooldown: true,
        }),
      });
      if (res.ok) {
        const tickData = await res.json();
        if (identifier) loadMarketData(identifier.marketId);
      }
    } catch {
      // Non-fatal
    } finally {
      setIsRunningTick(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] text-[#F0F6FC] font-sans text-xs flex flex-col">
      {/* 1. Header & Readiness Banner */}
      <header className="border-b border-[#30363D] bg-[#161B22] p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 bg-[#2EA043] rounded-full inline-block" />
          <span className="font-mono text-xs font-bold tracking-wider text-white">
            OVERWATCH // FIELD OPS
          </span>
        </div>

        <div className="flex items-center gap-2">
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
        {/* Error notification */}
        {errorMsg && (
          <div className="p-3 bg-[#F85149]/10 border border-[#F85149] text-[#F85149] font-mono text-xs rounded">
            {errorMsg}
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

            {/* 3. Recon Action or Timeline */}
            {!report && (
              <div className="p-4 bg-[#161B22] border border-[#30363D] rounded space-y-3 text-center">
                {isRunningRecon ? (
                  <div className="space-y-3 py-2 font-mono">
                    <div className="inline-block w-4 h-4 border-2 border-[#2EA043] border-t-transparent rounded-full animate-spin" />
                    <div className="text-xs font-bold text-[#3FB950]">
                      {reconProgressStep}
                    </div>
                    <div className="text-[10px] text-[#8B949E]">
                      Parallel Specialists: Data & Intelligence active on 0G Compute
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleRunRecon}
                    className="w-full py-2.5 bg-[#238636] hover:bg-[#2EA043] text-white font-mono text-xs font-bold uppercase tracking-wider rounded transition-colors"
                  >
                    START RECON RESEARCH →
                  </button>
                )}
              </div>
            )}

            {/* 4. Large Final Estimate Display */}
            {report && (
              <div className="p-4 bg-[#161B22] border-2 border-[#30363D] rounded space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-mono text-[10px] uppercase font-bold text-[#8B949E]">
                    AI ESTIMATE — UNCALIBRATED
                  </span>
                  <span className="font-mono text-[10px] text-[#8B949E]">
                    Duration: {Math.round(report.telemetry.durationMs / 1000)}s
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
            <div className="p-3.5 bg-[#161B22] border border-[#30363D] rounded space-y-2">
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
                      className={`text-xs px-2 py-0.5 font-bold uppercase rounded ${position.side === "YES" ? "bg-[#238636] text-white" : "bg-[#DA3633] text-white"
                        }`}
                    >
                      {position.side}
                    </span>
                    <span className="text-xs font-bold text-white">
                      ${position.stake} Demo Stake
                    </span>
                  </div>
                  <span className="text-[10px] text-[#3FB950] font-bold">
                    ● ACTIVE IN SENTRY
                  </span>
                </div>
              ) : (
                <div className="font-mono text-[11px] text-[#8B949E]">
                  No position registered yet. Open a position on the market page to activate continuous position-aware monitoring.
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
                  {isRunningTick ? "CHECKING..." : "CHECK MATCH NOW"}
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
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(<ExtensionSidePanelApp />);
}
