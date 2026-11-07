"use client";

import React, { useState, useEffect } from "react";
import { PaperPosition, formatISTTimeOnly } from "@overwatch/shared";

interface Props {
  marketId: string;
  fixtureId: number;
}

export function PaperPositionForm({ marketId, fixtureId }: Props) {
  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [stake, setStake] = useState<number>(50);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const fetchPositions = async () => {
    try {
      const res = await fetch(`/api/positions?marketId=${encodeURIComponent(marketId)}`);
      if (res.ok) {
        const data = await res.json();
        setPositions(data.positions ?? []);
      }
    } catch {
      // Non-fatal
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchPositions();
    const interval = setInterval(fetchPositions, 10000);
    return () => clearInterval(interval);
  }, [marketId]);

  const handleOpenPosition = async (e?: React.SyntheticEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (isSubmitting) return;

    const numericStake = Number(stake);
    if (!numericStake || numericStake <= 0) {
      setErrorMsg("Please enter a valid stake amount greater than $0.");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const idempotencyKey = `open-${marketId}-${side}-${numericStake}-${Date.now()}`;

    try {
      const res = await fetch("/api/positions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId,
          side,
          stake: numericStake,
          idempotencyKey,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || `HTTP ${res.status}`);
      }

      const resJson = await res.json();
      const position: PaperPosition = resJson.position || resJson;
      setSuccessMsg(
        `Position #${(position.positionId || "").slice(-6)} opened successfully (${side} • $${numericStake}). Guard Watch activated.`
      );
      void fetchPositions();

      // Ensure Guard Watch is also notified
      fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "TRACK",
          marketId,
          activeSide: side,
          authorizedBackgroundInference: true,
        }),
      }).catch(() => {});

      // Dispatch window.postMessage for Chrome Extension Content Script
      if (typeof window !== "undefined") {
        window.postMessage(
          {
            source: "OVERWATCH_DEMO_MARKET",
            type: "OVERWATCH_POSITION_UPDATED",
            payload: {
              positionId: position.positionId,
              marketId: position.marketId || marketId,
              fixtureId: position.fixtureId || fixtureId,
              side: position.side || side,
              stake: position.stake || numericStake,
              status: position.status || "OPEN",
              reconRunId: position.reconRunId || "recon-initial",
              action: "OPENED",
            },
          },
          window.location.origin
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    try {
      const res = await fetch(`/api/positions/${encodeURIComponent(positionId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });

      if (res.ok) {
        const updated: PaperPosition = await res.json();
        setSuccessMsg(`Position #${positionId.slice(-6)} closed.`);
        fetchPositions();

        if (typeof window !== "undefined") {
          window.postMessage(
            {
              source: "OVERWATCH_DEMO_MARKET",
              type: "OVERWATCH_POSITION_UPDATED",
              payload: {
                positionId: updated.positionId || positionId,
                marketId: updated.marketId || marketId,
                fixtureId: updated.fixtureId || fixtureId,
                side: updated.side,
                stake: updated.stake,
                status: "CLOSED",
                action: "CLOSED",
              },
            },
            window.location.origin
          );
        }
      } else {
        setErrorMsg("Failed to close position.");
      }
    } catch {
      setErrorMsg("Failed to close position.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Paper Trading Card */}
      <div className="border-2 border-[#111110] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D4D1C8] pb-4 mb-5">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-[#146C43] rounded-full inline-block" />
            <span className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[#111110]">
              PAPER POSITION REGISTRATION
            </span>
          </div>
          <span className="font-mono-tabular text-[10px] px-2 py-0.5 border border-[#146C43] bg-[#E8F5E9] text-[#146C43] font-bold">
            PAPER POSITION — DEMO ONLY
          </span>
        </div>

        <div className="space-y-5">
          {/* Side Selection */}
          <div>
            <label className="block font-mono-tabular text-xs font-bold uppercase text-[#52514E] mb-2">
              SELECT POSITION SIDE
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSide("YES")}
                className={`py-3 px-4 font-mono-tabular text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  side === "YES"
                    ? "border-[#146C43] bg-[#146C43] text-white shadow-sm"
                    : "border-[#D4D1C8] bg-[#F6F5F0] text-[#111110] hover:border-[#111110]"
                }`}
              >
                <span>YES</span>
              </button>
              <button
                type="button"
                onClick={() => setSide("NO")}
                className={`py-3 px-4 font-mono-tabular text-sm font-bold border-2 transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  side === "NO"
                    ? "border-[#D9381E] bg-[#D9381E] text-white shadow-sm"
                    : "border-[#D4D1C8] bg-[#F6F5F0] text-[#111110] hover:border-[#111110]"
                }`}
              >
                <span>NO</span>
              </button>
            </div>
          </div>

          {/* Stake Selection */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="font-mono-tabular text-xs font-bold uppercase text-[#52514E]">
                DEMO STAKE (USD)
              </label>
              <span className="font-mono-tabular text-xs font-bold text-[#111110]">
                ${stake}
              </span>
            </div>
            <div className="flex gap-2 mb-2">
              {[10, 25, 50, 100, 250].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setStake(preset)}
                  className={`flex-1 py-1.5 font-mono-tabular text-xs border cursor-pointer ${
                    stake === preset
                      ? "border-[#111110] bg-[#111110] text-white font-bold"
                      : "border-[#D4D1C8] bg-white text-[#52514E] hover:border-[#111110]"
                  }`}
                >
                  ${preset}
                </button>
              ))}
            </div>
            <input
              type="number"
              min={1}
              max={10000}
              value={stake === 0 ? "" : stake}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setStake(isNaN(val) ? 0 : Math.max(1, Math.min(10000, val)));
              }}
              className="w-full px-3 py-2 border border-[#D4D1C8] font-mono-tabular text-sm focus:outline-none focus:border-[#111110]"
              placeholder="Custom stake (1 - 10000)"
            />
          </div>

          {errorMsg && (
            <div className="p-3 bg-[#FFEBEE] border border-[#D9381E] font-mono-tabular text-xs text-[#D9381E]">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-[#E8F5E9] border border-[#146C43] font-mono-tabular text-xs text-[#146C43]">
              {successMsg}
            </div>
          )}

          <button
            type="button"
            onClick={handleOpenPosition}
            disabled={isSubmitting}
            className={`w-full py-3.5 font-mono-tabular text-sm font-bold uppercase tracking-wider text-white border-2 border-[#111110] transition-colors cursor-pointer ${
              side === "YES"
                ? "bg-[#146C43] hover:bg-[#0E4F30]"
                : "bg-[#D9381E] hover:bg-[#B72A13]"
            } ${isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {isSubmitting ? "REGISTERING POSITION..." : `OPEN PAPER POSITION (${side} • $${stake})`}
          </button>
        </div>
      </div>

      {/* Active Positions List */}
      <div className="border border-[#D4D1C8] bg-white p-6 shadow-sm">
        <h3 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[#52514E] mb-4">
          REGISTERED POSITIONS FOR THIS MARKET ({positions.length})
        </h3>

        {!mounted ? (
          <div className="py-4 text-center text-xs font-mono-tabular text-[#88857E]">
            Loading registered positions...
          </div>
        ) : positions.length === 0 ? (
          <div className="py-6 text-center text-sm font-mono-tabular text-[#88857E]">
            No paper positions open for this market yet.
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map((pos) => (
              <div
                key={pos.positionId}
                className="border border-[#E2DFD7] p-3.5 flex flex-wrap items-center justify-between gap-3 bg-[#FBFBFA]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`font-mono-tabular text-xs px-2 py-0.5 font-bold uppercase text-white ${
                      pos.side === "YES" ? "bg-[#146C43]" : "bg-[#D9381E]"
                    }`}
                  >
                    {pos.side}
                  </span>
                  <div>
                    <div className="font-mono-tabular text-xs font-bold text-[#111110]">
                      ${pos.stake} • Position #{(pos.positionId || "").slice(-6)}
                    </div>
                    <div className="font-mono-tabular text-[10px] text-[#52514E]" suppressHydrationWarning>
                      Opened: {formatISTTimeOnly(pos.openedAt)} • Status:{" "}
                      <span className="font-bold">{pos.status}</span>
                    </div>
                  </div>
                </div>

                {pos.status === "OPEN" && (
                  <button
                    type="button"
                    onClick={() => handleClosePosition(pos.positionId)}
                    className="font-mono-tabular text-xs px-3 py-1 border border-[#D9381E] text-[#D9381E] hover:bg-[#D9381E] hover:text-white font-bold transition-colors cursor-pointer"
                  >
                    CLOSE POSITION
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
