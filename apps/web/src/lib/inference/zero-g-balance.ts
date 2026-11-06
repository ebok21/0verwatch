import { logger } from "../logger";

export interface ZeroGBalanceSummary {
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
}

/**
 * Queries 0G Router management API using the user's decrypted `mk-` management key:
 * - https://router-api.0g.ai/v1/account/balance (total and credit balance)
 * - https://router-api.0g.ai/v1/api-keys (active key usage)
 */
export async function fetchZeroGBalanceAndUsage(
  mkKey: string
): Promise<ZeroGBalanceSummary> {
  const trimmed = mkKey.trim();
  if (!trimmed.startsWith("mk-")) {
    return {
      ok: false,
      currency: "USD",
      totalBalanceUsd: 0,
      creditBalanceUsd: 0,
      depositBalanceUsd: 0,
      formattedBalance: "$0.00",
      totalUsedUsd: 0,
      activeKeyCount: 0,
      error: "Invalid 0G management key: must start with 'mk-'.",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const [balanceRes, keysRes] = await Promise.all([
      fetch("https://router-api.0g.ai/v1/account/balance", {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }).catch((err) => {
        logger.warn("[0G] Account balance fetch failed", { error: String(err) });
        return null;
      }),
      fetch("https://router-api.0g.ai/v1/api-keys", {
        headers: {
          Authorization: `Bearer ${trimmed}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      }).catch((err) => {
        logger.warn("[0G] API keys fetch failed", { error: String(err) });
        return null;
      }),
    ]);

    clearTimeout(timeoutId);

    let address = "0x0...";
    let totalBalanceUsd = 0;
    let creditBalanceUsd = 0;
    let depositBalanceUsd = 0;

    if (balanceRes && balanceRes.ok) {
      const bData = (await balanceRes.json()) as Record<string, unknown>;
      address = typeof bData.address === "string" ? bData.address : address;

      // 0G balance values are returned in micro-units (1,000,000 = $1.00 USD)
      const parseAmount = (raw: unknown): number => {
        const num = Number(raw);
        if (isNaN(num)) return 0;
        // If greater than 1000, it is represented in micro-units
        return num > 1000 ? Number((num / 1_000_000).toFixed(4)) : num;
      };

      totalBalanceUsd = parseAmount(bData.total_balance ?? bData.balance);
      creditBalanceUsd = parseAmount(bData.credit_balance);
      depositBalanceUsd = parseAmount(bData.deposit_balance);
    }

    let totalUsedUsd = 0;
    let activeKeyCount = 0;

    if (keysRes && keysRes.ok) {
      const kData = (await keysRes.json()) as { data?: Array<Record<string, unknown>> };
      if (Array.isArray(kData.data)) {
        activeKeyCount = kData.data.filter((k) => k.status === "active" && !k.revoked).length;
        for (const k of kData.data) {
          const usedNum = Number(k.used);
          if (!isNaN(usedNum)) {
            totalUsedUsd += usedNum;
          }
        }
      }
    }

    const formattedBalance = `$${totalBalanceUsd.toFixed(2)}`;

    logger.info(
      `[0G] Balance queried | total=${formattedBalance} | credits=$${creditBalanceUsd.toFixed(2)} | used=$${totalUsedUsd.toFixed(4)}`
    );

    return {
      ok: true,
      address,
      currency: "USD",
      totalBalanceUsd,
      creditBalanceUsd,
      depositBalanceUsd,
      formattedBalance,
      totalUsedUsd: Number(totalUsedUsd.toFixed(4)),
      activeKeyCount,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      currency: "USD",
      totalBalanceUsd: 0,
      creditBalanceUsd: 0,
      depositBalanceUsd: 0,
      formattedBalance: "$0.00",
      totalUsedUsd: 0,
      activeKeyCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

