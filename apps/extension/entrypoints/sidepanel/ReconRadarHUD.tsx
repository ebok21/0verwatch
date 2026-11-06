import React, { useEffect, useState } from "react";

interface ReconRadarHUDProps {
  currentStep: string | null;
  onAbort?: () => void;
}

export const ReconRadarHUD: React.FC<ReconRadarHUDProps> = ({ currentStep }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [azimuth, setAzimuth] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    // Azimuth rotation ticker: completes full 360° every 2.4 seconds
    const azTimer = setInterval(() => {
      setAzimuth((prev) => (prev + 6) % 360);
    }, 40);

    return () => {
      clearInterval(timer);
      clearInterval(azTimer);
    };
  }, []);

  // Calibrated pacing curve for actual 0G inference and network execution (typical runs take 45-120s):
  // Phase 1 (0-12s): Squad Planning & Vector Initialization (5% -> 20%)
  // Phase 2 (12-50s): Parallel Specialist Intelligence & Scorecard Ingestion (20% -> 55%)
  // Phase 3 (50-90s): Cross-Verification & Evidence Corroboration (55% -> 78%)
  // Phase 4 (90-135s): Sergeant Multi-Claim Synthesis (78% -> 90%)
  // Phase 5 (135s+): Smooth asymptotic crawl approaching 96% so the radar never gets stuck
  let progressRatio = 0.05;
  if (elapsedSeconds <= 12) {
    progressRatio = 0.05 + (elapsedSeconds / 12) * 0.15;
  } else if (elapsedSeconds <= 50) {
    progressRatio = 0.20 + ((elapsedSeconds - 12) / 38) * 0.35;
  } else if (elapsedSeconds <= 90) {
    progressRatio = 0.55 + ((elapsedSeconds - 50) / 40) * 0.23;
  } else if (elapsedSeconds <= 135) {
    progressRatio = 0.78 + ((elapsedSeconds - 90) / 45) * 0.12;
  } else {
    const extraTime = elapsedSeconds - 135;
    progressRatio = 0.90 + 0.06 * (1 - Math.exp(-extraTime / 60));
  }

  // Radius for HUD in SVG units (center is at 110, 110; max radius 88)
  const maxRadius = 88;
  const cx = 110;
  const cy = 110;

  // Data Specialist blip coordinates (angle -45°) - gradually converging toward the center
  const dataDist = Math.max(10, maxRadius * (1 - progressRatio * 0.88));
  const dataAngleRad = (-45 * Math.PI) / 180;
  const dataX = cx + dataDist * Math.cos(dataAngleRad);
  const dataY = cy + dataDist * Math.sin(dataAngleRad);

  // Intel Specialist blip coordinates (angle 135°) - gradually converging toward the center
  const intelDist = Math.max(12, maxRadius * (1 - progressRatio * 0.84));
  const intelAngleRad = (135 * Math.PI) / 180;
  const intelX = cx + intelDist * Math.cos(intelAngleRad);
  const intelY = cy + intelDist * Math.sin(intelAngleRad);

  const isSynthesisPhase = elapsedSeconds >= 75 || (currentStep && currentStep.toLowerCase().includes("synthesis"));

  return (
    <div className="p-4 bg-[#080C10] border-2 border-[#1F6FEB]/60 rounded space-y-3 font-mono select-none text-left shadow-[0_0_20px_rgba(31,111,235,0.15)] relative overflow-hidden">
      {/* Background HUD Scanline Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#1f6feb15_1px,transparent_1px)] [background-size:12px_12px] opacity-40 pointer-events-none" />

      {/* Top Header & Tactical Status */}
      <div className="flex justify-between items-center text-[10px] relative z-10">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#3FB950] animate-pulse" />
          <span className="font-bold text-[#3FB950] tracking-wider uppercase">
            LIVE RECON RADAR ACTIVE
          </span>
        </div>
        <div className="text-[#58A6FF] font-bold">
          T+{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:
          {String(elapsedSeconds % 60).padStart(2, "0")}s
        </div>
      </div>

      {/* Circular Radar HUD Visualizer */}
      <div className="flex justify-center items-center py-2 relative z-10">
        <div className="relative w-[220px] h-[220px]">
          <svg className="w-full h-full" viewBox="0 0 220 220">
            <defs>
              {/* Rotating Sweep Beam Conic Gradient */}
              <linearGradient id="radarSweep" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#2EA043" stopOpacity="0.55" />
                <stop offset="40%" stopColor="#2EA043" stopOpacity="0.20" />
                <stop offset="100%" stopColor="#2EA043" stopOpacity="0.0" />
              </linearGradient>

              {/* Glowing Blip Filter */}
              <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="glow-amber" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
                <feMerge>
                  <feMergeNode in="coloredBlur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Radar Background Circle */}
            <circle cx={cx} cy={cy} r={maxRadius} fill="#0D1117" stroke="#30363D" strokeWidth="1.5" />

            {/* Concentric Range Rings */}
            <circle cx={cx} cy={cy} r={maxRadius * 0.75} fill="none" stroke="#21262D" strokeDasharray="3,3" strokeWidth="1" />
            <circle cx={cx} cy={cy} r={maxRadius * 0.5} fill="none" stroke="#21262D" strokeDasharray="2,2" strokeWidth="1" />
            <circle cx={cx} cy={cy} r={maxRadius * 0.25} fill="none" stroke="#21262D" strokeDasharray="2,2" strokeWidth="1" />

            {/* Crosshairs */}
            <line x1={cx} y1={cy - maxRadius} x2={cx} y2={cy + maxRadius} stroke="#21262D" strokeWidth="1" />
            <line x1={cx - maxRadius} y1={cy} x2={cx + maxRadius} y2={cy} stroke="#21262D" strokeWidth="1" />
            <line x1={cx - maxRadius * 0.7} y1={cy - maxRadius * 0.7} x2={cx + maxRadius * 0.7} y2={cy + maxRadius * 0.7} stroke="#161B22" strokeWidth="1" strokeDasharray="2,4" />
            <line x1={cx - maxRadius * 0.7} y1={cy + maxRadius * 0.7} x2={cx + maxRadius * 0.7} y2={cy - maxRadius * 0.7} stroke="#161B22" strokeWidth="1" strokeDasharray="2,4" />

            {/* Azimuth Cardinal Tick Labels */}
            <text x={cx} y="15" fill="#8B949E" fontSize="7" textAnchor="middle" fontWeight="bold">000°</text>
            <text x="212" y={cy + 3} fill="#8B949E" fontSize="7" textAnchor="end" fontWeight="bold">090°</text>
            <text x={cx} y="215" fill="#8B949E" fontSize="7" textAnchor="middle" fontWeight="bold">180°</text>
            <text x="8" y={cy + 3} fill="#8B949E" fontSize="7" textAnchor="start" fontWeight="bold">270°</text>

            {/* Rotating Radar Scanner Sweep: Both native SVG animateTransform AND React transform fallback */}
            <g transform={`rotate(${azimuth} ${cx} ${cy})`}>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${cy}`}
                to={`360 ${cx} ${cy}`}
                dur="2.4s"
                repeatCount="indefinite"
              />
              <path
                d={`M ${cx} ${cy} L ${cx} ${cy - maxRadius} A ${maxRadius} ${maxRadius} 0 0 1 ${cx + maxRadius * 0.707} ${cy - maxRadius * 0.707} Z`}
                fill="url(#radarSweep)"
              />
              <line x1={cx} y1={cy} x2={cx} y2={cy - maxRadius} stroke="#3FB950" strokeWidth="1.8" />
            </g>

            {/* Target Origin Center Reticle */}
            <circle cx={cx} cy={cy} r="4.5" fill={isSynthesisPhase ? "#2EA043" : "#21262D"} stroke="#3FB950" strokeWidth="1.5" />
            {isSynthesisPhase && (
              <circle cx={cx} cy={cy} r="6" fill="none" stroke="#3FB950" strokeWidth="1.5">
                <animate attributeName="r" values="5;20" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0" dur="1.2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* BLIP 1: DATA SPECIALIST (Electric Cyan) */}
            <g>
              {/* Concentric Pulse radiating strictly outward from dataX, dataY */}
              <circle cx={dataX} cy={dataY} r="3.5" fill="none" stroke="#58A6FF" strokeWidth="1">
                <animate attributeName="r" values="3.5;15" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0" dur="1.8s" repeatCount="indefinite" />
              </circle>
              {/* Core Dot */}
              <circle cx={dataX} cy={dataY} r="3.5" fill="#58A6FF" filter="url(#glow-cyan)" />
              {/* Specialist Label */}
              <text x={dataX + 6} y={dataY - 4} fill="#58A6FF" fontSize="7" fontWeight="bold">
                DATA-SPEC
              </text>
            </g>

            {/* BLIP 2: INTELLIGENCE SPECIALIST (Tactical Amber) */}
            <g>
              {/* Concentric Pulse radiating strictly outward from intelX, intelY */}
              <circle cx={intelX} cy={intelY} r="3.5" fill="none" stroke="#F59E0B" strokeWidth="1">
                <animate attributeName="r" values="3.5;15" dur="1.8s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.85;0" dur="1.8s" repeatCount="indefinite" />
              </circle>
              {/* Core Dot */}
              <circle cx={intelX} cy={intelY} r="3.5" fill="#F59E0B" filter="url(#glow-amber)" />
              {/* Specialist Label */}
              <text x={intelX + 6} y={intelY - 4} fill="#F59E0B" fontSize="7" fontWeight="bold">
                INTEL-SPEC
              </text>
            </g>

            {/* Lock-on Reticle during Sergeant Synthesis */}
            {isSynthesisPhase && (
              <g stroke="#3FB950" strokeWidth="1.2" fill="none">
                <path d="M 98 100 L 98 98 L 100 98" />
                <path d="M 122 100 L 122 98 L 120 98" />
                <path d="M 98 120 L 98 122 L 100 122" />
                <path d="M 122 120 L 122 122 L 120 122" />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Tactical Step Readout & Specialist Convergence Status */}
      <div className="space-y-2 relative z-10 border-t border-[#21262D] pt-2.5">
        <div className="flex justify-between items-center text-[10px]">
          <span className="text-[#8B949E] uppercase font-bold">RADAR TELEMETRY</span>
          <span className="text-[#3FB950] font-bold">AZ: {azimuth}° • RANGE: {(maxRadius - progressRatio * maxRadius).toFixed(0)}m</span>
        </div>

        {/* Dynamic Status Progress Pill */}
        <div className="p-2 bg-[#161B22] border border-[#30363D] rounded space-y-1">
          <div className="text-xs font-bold text-white flex items-center justify-between">
            <span className="text-[#3FB950]">
              {currentStep || "Acquiring Target Vectors..."}
            </span>
            <span className="text-[10px] text-[#8B949E]">
              {Math.min(100, Math.round(progressRatio * 100))}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-[#0D1117] h-1.5 rounded-full overflow-hidden border border-[#30363D]/60">
            <div
              className="bg-gradient-to-r from-[#1F6FEB] via-[#2EA043] to-[#3FB950] h-full transition-all duration-500 rounded-full"
              style={{ width: `${Math.min(100, Math.round(progressRatio * 100))}%` }}
            />
          </div>

          <div className="flex justify-between items-center text-[9px] text-[#8B949E] pt-0.5">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#58A6FF]" />
              Data Specialist: {progressRatio > 0.4 ? "Sportmonks Intercepted" : "Parsing Scorecards"}
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" />
              Intel: {progressRatio > 0.6 ? "Tavily Extracted" : "Scanning Pitch"}
            </span>
          </div>
        </div>

        <div className="text-[9px] text-[#6E7681] text-center">
          Inference running on 0G Compute Decentralized AI Network
        </div>
      </div>
    </div>
  );
};
