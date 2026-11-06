import Link from "next/link";
import { notFound } from "next/navigation";
import { getCanonicalMarketMetadata } from "@/lib/markets/store";
import { PaperPositionForm } from "@/components/PaperPositionForm";

export const dynamic = "force-dynamic";

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;
  const market = await getCanonicalMarketMetadata(marketId);

  if (!market) {
    notFound();
  }

  return (
    <div
      data-overwatch-market-id={market.marketId}
      data-overwatch-platform={market.platform}
      className="min-h-screen flex flex-col bg-[#F6F5F0] text-[#111110]"
    >
      {/* Top Banner */}
      <header className="border-b-2 border-[#111110] bg-[#EFECE6] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="font-mono-tabular text-xs font-bold uppercase tracking-wider px-2.5 py-1 border border-[#111110] bg-[#F6F5F0] hover:bg-[#111110] hover:text-white transition-colors"
          >
            ← DEMO MARKETS
          </Link>
          <div className="flex items-center gap-2 font-mono-tabular text-xs">
            <span className="text-[#52514E]">MARKET ID:</span>
            <code className="bg-white px-2 py-0.5 border border-[#D4D1C8] font-bold">
              {market.marketId}
            </code>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono-tabular text-xs">
          <span className="px-2.5 py-0.5 bg-[#B85D00] text-white font-bold uppercase text-[11px]">
            DEMO MARKET / PAPER TRADING
          </span>
          <span className="px-2.5 py-0.5 border border-[#111110] bg-white font-bold uppercase text-[11px]">
            STATUS: {market.status}
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 lg:p-10 space-y-8">
        {/* Market Title Block */}
        <section className="border-b-2 border-[#111110] pb-6 space-y-3">
          <div className="flex flex-wrap items-center gap-2 font-mono-tabular text-xs">
            <span className="px-2 py-0.5 bg-[#111110] text-white font-bold">
              {market.category}
            </span>
            <span className="px-2 py-0.5 border border-[#111110] font-semibold">
              FORMAT: {market.matchFormat}
            </span>
            <span className="px-2 py-0.5 border border-[#111110] font-semibold">
              SPORTMONKS FIXTURE #{market.fixtureId}
            </span>
          </div>

          <h1
            data-testid="market-question-heading"
            className="text-2xl lg:text-3xl font-bold tracking-tight text-[#111110]"
          >
            {market.question}
          </h1>

          {market.subtitle && (
            <p className="text-sm text-[#52514E] font-medium">
              {market.subtitle}
            </p>
          )}
        </section>

        {/* 2-Column Grid: Left (Market Metadata & Resolution), Right (Paper Trading Form) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Context & Resolution Criteria */}
          <div className="lg:col-span-7 space-y-6">
            {/* Match Information Card */}
            <div className="border border-[#D4D1C8] bg-white p-6 shadow-sm space-y-4">
              <h2 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[#52514E]">
                SPORTMONKS FIXTURE VERIFICATION
              </h2>

              <div className="space-y-2 font-mono-tabular text-xs">
                <div className="flex justify-between py-1 border-b border-[#F0EFEA]">
                  <span className="text-[#52514E]">TEAMS:</span>
                  <span className="font-bold text-[#111110]">
                    {market.homeTeam} vs {market.awayTeam}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F0EFEA]">
                  <span className="text-[#52514E]">COMPETITION:</span>
                  <span className="font-bold text-[#111110]">{market.competition}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F0EFEA]">
                  <span className="text-[#52514E]">VENUE:</span>
                  <span className="font-bold text-[#111110]">
                    {market.verifiedFixtureMeta?.venue || market.resolutionContext?.venue || "Seddon Park / Eden Park"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F0EFEA]">
                  <span className="text-[#52514E]">SCHEDULED START:</span>
                  <span className="font-bold text-[#111110]">
                    {new Date(market.scheduledStartTime).toUTCString()}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#F0EFEA]">
                  <span className="text-[#52514E]">FIXTURE STATUS:</span>
                  <span className="font-bold text-[#146C43]">
                    {market.verifiedFixtureMeta?.status || "NS (Not Started)"}
                  </span>
                </div>
              </div>
            </div>

            {/* Resolution Criteria Card */}
            <div className="border border-[#D4D1C8] bg-white p-6 shadow-sm space-y-4">
              <h2 className="font-mono-tabular text-xs font-bold uppercase tracking-wider text-[#52514E]">
                RESOLUTION CRITERIA & RULES
              </h2>

              <div className="text-sm text-[#111110] leading-relaxed bg-[#F6F5F0] p-4 border border-[#D4D1C8] font-mono-tabular">
                {market.resolutionCriteria}
              </div>

              <div className="grid grid-cols-2 gap-4 font-mono-tabular text-xs pt-2">
                <div>
                  <span className="text-[#52514E] block">OPENING TIME:</span>
                  <span className="font-bold text-[#111110]">
                    {market.openingTime.replace("T", " ").replace("Z", " UTC")}
                  </span>
                </div>
                <div>
                  <span className="text-[#52514E] block">EXPECTED RESOLUTION:</span>
                  <span className="font-bold text-[#111110]">
                    {market.expectedResolutionTime.replace("T", " ").replace("Z", " UTC")}
                  </span>
                </div>
              </div>

              {market.resolutionContext?.voidConditions && (
                <div className="pt-2 border-t border-[#D4D1C8]">
                  <span className="font-mono-tabular text-[11px] font-bold uppercase text-[#D9381E] block mb-1">
                    VOID CONDITIONS:
                  </span>
                  <ul className="list-disc pl-5 font-mono-tabular text-xs text-[#52514E] space-y-1">
                    {market.resolutionContext.voidConditions.map((cond, idx) => (
                      <li key={idx}>{cond}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Interactive Paper Position Form */}
          <div className="lg:col-span-5">
            <PaperPositionForm marketId={market.marketId} fixtureId={market.fixtureId} />
          </div>
        </div>
      </main>
    </div>
  );
}
