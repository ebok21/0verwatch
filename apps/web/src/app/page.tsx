import Link from "next/link";
import { listAllCanonicalMarkets } from "@/lib/markets/store";

export const dynamic = "force-dynamic";

export default async function MarketDirectoryPage() {
  const markets = await listAllCanonicalMarkets();

  return (
    <div className="min-h-screen flex flex-col bg-[#F6F5F0] text-[#111110]">
      {/* Top Header */}
      <header className="border-b-2 border-[#111110] bg-[#EFECE6]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-block w-3 h-3 bg-[#B85D00]" />
            <span className="font-mono-tabular font-bold tracking-[0.2em] text-sm uppercase">
              0VERWATCH // DEMO MARKET & PAPER TRADING
            </span>
          </div>

          <div className="flex items-center gap-4 font-mono-tabular text-xs">
            <Link
              href="/admin"
              className="px-3 py-1 font-bold border-2 border-[#111110] bg-white hover:bg-[#111110] hover:text-white transition-colors"
            >
              ADMIN CONSOLE →
            </Link>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 lg:p-10 space-y-8">
        <div className="border-b-2 border-[#111110] pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-[#111110]">
            Available Cricket Prediction Markets
          </h1>
          <p className="mt-2 text-sm text-[#52514E]">
            Minimal demo prediction-market environment for testing 0verwatch continuous monitoring and paper position registration.
          </p>
        </div>

        <div className="space-y-4">
          {markets.map((market) => (
            <div
              key={market.marketId}
              className="border-2 border-[#111110] bg-white p-6 shadow-sm hover:border-[#B85D00] transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 font-mono-tabular text-xs">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-[#111110] text-white font-bold">
                    {market.category}
                  </span>
                  <span className="px-2 py-0.5 border border-[#111110] font-semibold">
                    {market.matchFormat}
                  </span>
                  <span className="px-2 py-0.5 border border-[#D4D1C8] text-[#52514E]">
                    SPORTMONKS FIXTURE #{market.fixtureId}
                  </span>
                </div>
                <span className="px-2 py-0.5 bg-[#E8F5E9] text-[#146C43] border border-[#146C43] font-bold">
                  {market.status}
                </span>
              </div>

              <h2 className="text-xl font-bold text-[#111110] mb-2">
                {market.question}
              </h2>

              <p className="text-xs text-[#52514E] font-mono-tabular mb-4">
                {market.homeTeam} vs {market.awayTeam} • {market.competition}
              </p>

              <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[#F0EFEA] font-mono-tabular text-xs">
                <div className="text-[#52514E]">
                  Expected Resolution:{" "}
                  <strong className="text-[#111110]">
                    {new Date(market.expectedResolutionTime).toUTCString()}
                  </strong>
                </div>

                <Link
                  href={`/markets/${market.marketId}`}
                  className="px-4 py-2 bg-[#111110] text-white font-bold uppercase tracking-wider hover:bg-[#B85D00] transition-colors"
                >
                  OPEN MARKET & PAPER TRADE →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
