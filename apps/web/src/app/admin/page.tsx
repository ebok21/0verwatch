"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  MarketMetadata,
  VerifiedFixtureMeta,
  formatISTDisplay,
  toISTDateTimeLocalInput,
  toISTIsoString,
} from "@overwatch/shared";

export default function AdminMarketManagementPage() {
  const [markets, setMarkets] = useState<MarketMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  // New market form state
  const [fixtureIdInput, setFixtureIdInput] = useState<string>("71020");
  const [validatingFixture, setValidatingFixture] = useState(false);
  const [verifiedFixture, setVerifiedFixture] = useState<VerifiedFixtureMeta | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [marketType, setMarketType] = useState<any>("OVER_RUNS");
  const [resolutionCriteria, setResolutionCriteria] = useState("");
  const [openingTime, setOpeningTime] = useState("");
  const [expectedResolutionTime, setExpectedResolutionTime] = useState("");
  const [creatingMarket, setCreatingMarket] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  // Deletion feedback
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteSummary, setDeleteSummary] = useState<string | null>(null);

  const loadMarkets = async () => {
    try {
      const res = await fetch("/api/markets");
      if (res.ok) {
        const data = await res.json();
        setMarkets(data.markets ?? []);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMarkets();
    const now = new Date();
    const openIstLocal = toISTDateTimeLocalInput(new Date(now.getTime() - 5 * 60 * 1000));
    const resolveIstLocal = toISTDateTimeLocalInput(new Date(now.getTime() + 60 * 60 * 1000));
    setOpeningTime(openIstLocal);
    setExpectedResolutionTime(resolveIstLocal);
  }, []);

  const handleValidateFixture = async () => {
    const id = Number(fixtureIdInput.trim());
    if (!Number.isInteger(id) || id <= 0) {
      setValidationError("Please enter a valid positive integer fixture ID.");
      return;
    }

    setValidatingFixture(true);
    setValidationError(null);
    setVerifiedFixture(null);

    try {
      const res = await fetch("/api/markets/validate-fixture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fixtureId: id }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }

      const verified: VerifiedFixtureMeta = await res.json();
      setVerifiedFixture(verified);
      if (!question) {
        setQuestion(`Will ${verified.homeTeam} score 10+ runs in Over #10 against ${verified.awayTeam}?`);
      }
      if (!resolutionCriteria) {
        setResolutionCriteria(`Resolves YES if 10 or more total runs are scored in Over #10 by ${verified.homeTeam}. Resolves NO otherwise.`);
      }
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidatingFixture(false);
    }
  };

  const handleCreateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    setCreateSuccess(null);

    if (!verifiedFixture) {
      setCreateError("Please validate the Sportmonks fixture ID before creating the market.");
      return;
    }

    const openMs = new Date(openingTime).getTime();
    const resolveMs = new Date(expectedResolutionTime).getTime();
    const horizonMin = (resolveMs - openMs) / (60 * 1000);

    if (horizonMin < 10) {
      setCreateError(`Resolution horizon is ${horizonMin.toFixed(1)} minutes. Minimum requirement is 10 minutes.`);
      return;
    }

    setCreatingMarket(true);
    const marketId = `market-${Date.now()}`;

    try {
      const res = await fetch("/api/markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId,
          platform: "demo",
          question,
          category: "CRICKET",
          competition: verifiedFixture.competition || "International Cricket Series",
          homeTeam: verifiedFixture.homeTeam,
          awayTeam: verifiedFixture.awayTeam,
          matchDate: verifiedFixture.startingAt.slice(0, 10),
          scheduledStartTime: verifiedFixture.startingAt,
          matchFormat: verifiedFixture.format,
          fixtureId: verifiedFixture.fixtureId,
          marketType,
          openingTime: toISTIsoString(new Date(`${openingTime}:00+05:30`)),
          expectedResolutionTime: toISTIsoString(new Date(`${expectedResolutionTime}:00+05:30`)),
          minimumResolutionHorizonMinutes: 10,
          resolutionCriteria,
          verifiedFixtureMeta: verifiedFixture,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || err.error || `HTTP ${res.status}`);
      }

      const created: MarketMetadata = await res.json();
      setCreateSuccess(`Market "${created.marketId}" created successfully.`);
      loadMarkets();
      setQuestion("");
      setResolutionCriteria("");
      setVerifiedFixture(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreatingMarket(false);
    }
  };

  const handleDeleteMarket = async (marketId: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete market "${marketId}"? All associated positions, tracking records, and snapshots will be purged.`)) {
      return;
    }

    setDeletingId(marketId);
    setDeleteSummary(null);

    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(marketId)}`, {
        method: "DELETE",
      });

      if (res.ok) {
        const data = await res.json();
        setDeleteSummary(`Market "${marketId}" deleted. Cascading purge summary: ${JSON.stringify(data.counts)}`);
        loadMarkets();
      }
    } catch {
      setDeleteSummary("Error during deletion.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F5F0] text-[#111110]">
      <header className="border-b-2 border-[#111110] bg-[#EFECE6] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="font-mono-tabular text-xs font-bold uppercase tracking-wider px-2.5 py-1 border border-[#111110] bg-white hover:bg-[#111110] hover:text-white transition-colors"
          >
            ← BACK TO MARKETS
          </Link>
          <span className="font-mono-tabular font-bold tracking-wider text-sm uppercase">
            0VERWATCH // ADMIN MARKET MANAGEMENT
          </span>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 lg:p-10 space-y-10">
        {deleteSummary && (
          <div className="p-4 bg-[#FFEBEE] border border-[#D9381E] font-mono-tabular text-xs text-[#D9381E]">
            {deleteSummary}
          </div>
        )}

        <section className="border-2 border-[#111110] bg-white p-6 shadow-sm space-y-4">
          <h2 className="font-mono-tabular text-sm font-bold uppercase tracking-wider text-[#111110] border-b border-[#D4D1C8] pb-3">
            ALL CONFIGURED MARKETS ({markets.length})
          </h2>

          {loading ? (
            <div className="py-6 text-center font-mono-tabular text-sm text-[#88857E]">
              Loading markets...
            </div>
          ) : markets.length === 0 ? (
            <div className="py-6 text-center font-mono-tabular text-sm text-[#88857E]">
              No active markets found.
            </div>
          ) : (
            <div className="divide-y divide-[#F0EFEA]">
              {markets.map((m) => (
                <div key={m.marketId} className="py-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 font-mono-tabular text-xs">
                      <code className="bg-[#F6F5F0] px-1.5 py-0.5 border border-[#D4D1C8] font-bold">
                        {m.marketId}
                      </code>
                      <span className="text-[#52514E]">Fixture #{m.fixtureId}</span>
                      <span className="text-[#146C43] font-bold">({m.homeTeam} vs {m.awayTeam})</span>
                    </div>
                    <div className="font-bold text-sm text-[#111110]">
                      {m.question}
                    </div>
                    <div className="font-mono-tabular text-[11px] text-[#52514E]">
                      Resolution (IST): {formatISTDisplay(m.expectedResolutionTime)} • Horizon: ≥10m
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Link
                      href={`/markets/${m.marketId}`}
                      className="px-3 py-1 font-mono-tabular text-xs font-bold border border-[#111110] hover:bg-[#111110] hover:text-white transition-colors"
                    >
                      VIEW MARKET
                    </Link>
                    <button
                      type="button"
                      disabled={deletingId === m.marketId}
                      onClick={() => handleDeleteMarket(m.marketId)}
                      className="px-3 py-1 font-mono-tabular text-xs font-bold border border-[#D9381E] text-[#D9381E] hover:bg-[#D9381E] hover:text-white transition-colors"
                    >
                      {deletingId === m.marketId ? "DELETING..." : "DELETE"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border-2 border-[#111110] bg-white p-6 shadow-sm space-y-6">
          <h2 className="font-mono-tabular text-sm font-bold uppercase tracking-wider text-[#111110] border-b border-[#D4D1C8] pb-3">
            CREATE NEW CRICKET MARKET
          </h2>

          <div className="border border-[#D4D1C8] p-4 bg-[#FBFBFA] space-y-3">
            <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E]">
              STEP 1: ENTER & VALIDATE SPORTMONKS FIXTURE ID
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={fixtureIdInput}
                onChange={(e) => setFixtureIdInput(e.target.value)}
                placeholder="e.g. 71020"
                className="w-48 px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
              />
              <button
                type="button"
                disabled={validatingFixture}
                onClick={handleValidateFixture}
                className="px-4 py-2 bg-[#111110] text-white font-mono-tabular text-xs font-bold uppercase tracking-wider hover:bg-[#52514E] transition-colors"
              >
                {validatingFixture ? "VALIDATING..." : "VALIDATE FIXTURE →"}
              </button>
            </div>

            {validationError && (
              <div className="p-3 bg-[#FFEBEE] border border-[#D9381E] font-mono-tabular text-xs text-[#D9381E]">
                {validationError}
              </div>
            )}

            {verifiedFixture && (
              <div className="p-4 bg-[#E8F5E9] border border-[#146C43] font-mono-tabular text-xs space-y-1">
                <div className="font-bold text-[#146C43]">
                  ✓ FIXTURE #{verifiedFixture.fixtureId} VERIFIED
                </div>
                <div>Match: {verifiedFixture.homeTeam} vs {verifiedFixture.awayTeam}</div>
                <div>Starting At (IST) & Format: {formatISTDisplay(verifiedFixture.startingAt)} • {verifiedFixture.format}</div>
                <div>Venue: {verifiedFixture.venue} • Status: {verifiedFixture.status}</div>
              </div>
            )}
          </div>

          <form onSubmit={handleCreateMarket} className="space-y-4">
            <div>
              <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-1">
                MARKET QUESTION
              </label>
              <input
                type="text"
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Will India score 10+ runs in Over #10?"
                className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
              />
            </div>

            <div>
              <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-1">
                MARKET TYPE
              </label>
              <select
                value={marketType}
                onChange={(e) => setMarketType(e.target.value)}
                className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
              >
                <option value="OVER_RUNS">OVER_RUNS</option>
                <option value="MATCH_WINNER">MATCH_WINNER</option>
                <option value="INNINGS_TOTAL">INNINGS_TOTAL</option>
                <option value="PLAYER_RUNS">PLAYER_RUNS</option>
                <option value="PLAYER_WICKETS">PLAYER_WICKETS</option>
                <option value="PHASE_RUNS">PHASE_RUNS</option>
                <option value="CUSTOM_CRICKET">CUSTOM_CRICKET</option>
              </select>
            </div>

            <div>
              <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-1">
                RESOLUTION CRITERIA
              </label>
              <textarea
                required
                rows={3}
                value={resolutionCriteria}
                onChange={(e) => setResolutionCriteria(e.target.value)}
                placeholder="Specific rules under which the market resolves YES or NO..."
                className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-1">
                  OPENING TIME
                </label>
                <input
                  type="datetime-local"
                  required
                  value={openingTime}
                  onChange={(e) => setOpeningTime(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
                />
              </div>

              <div>
                <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-1">
                  EXPECTED RESOLUTION TIME (MIN ≥ 10M AFTER OPEN)
                </label>
                <input
                  type="datetime-local"
                  required
                  value={expectedResolutionTime}
                  onChange={(e) => setExpectedResolutionTime(e.target.value)}
                  className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
                />
              </div>
            </div>

            {createError && (
              <div className="p-3 bg-[#FFEBEE] border border-[#D9381E] font-mono-tabular text-xs text-[#D9381E]">
                {createError}
              </div>
            )}

            {createSuccess && (
              <div className="p-3 bg-[#E8F5E9] border border-[#146C43] font-mono-tabular text-xs text-[#146C43]">
                {createSuccess}
              </div>
            )}

            <button
              type="submit"
              disabled={creatingMarket || !verifiedFixture}
              className={`w-full py-3.5 bg-[#111110] text-white font-mono-tabular text-sm font-bold uppercase tracking-wider border-2 border-[#111110] hover:bg-[#52514E] transition-colors ${
                creatingMarket || !verifiedFixture ? "opacity-50 cursor-not-allowed" : ""
              }`}
            >
              {creatingMarket ? "CREATING MARKET..." : "CREATE CANONICAL MARKET →"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
