import { MarketIdentifier, MarketIdentifierSchema } from "./schemas";

export interface PlatformMarketAdapter {
  readonly platform: "demo";
  canHandleUrl(urlStr: string): boolean;
  extractFromUrl(urlStr: string): MarketIdentifier | null;
  extractFromDomFallback(attributes: {
    dataMarketId?: string | null;
    dataPlatform?: string | null;
    canonicalHref?: string | null;
  }): MarketIdentifier | null;
}

const SAFE_MARKET_ID_REGEX = /^[a-zA-Z0-9_-]{2,128}$/;
const VALID_DEMO_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "overwatch.demo",
]);

export function isAllowedDemoHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return VALID_DEMO_HOSTNAMES.has(lower) || lower.endsWith(".demo");
}

export function isAllowedDemoOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return isAllowedDemoHost(parsed.hostname);
  } catch {
    return false;
  }
}

export class DemoMarketAdapter implements PlatformMarketAdapter {
  public readonly platform = "demo" as const;

  public canHandleUrl(urlStr: string): boolean {
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      if (!isAllowedDemoHost(parsed.hostname)) {
        return false;
      }
      return /^\/markets\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  public extractFromUrl(urlStr: string): MarketIdentifier | null {
    if (!this.canHandleUrl(urlStr)) {
      return null;
    }
    try {
      const parsed = new URL(urlStr);
      const match = parsed.pathname.match(/^\/markets\/([a-zA-Z0-9_-]+)\/?$/);
      if (!match || !match[1]) {
        return null;
      }
      const candidateId = match[1];
      if (!SAFE_MARKET_ID_REGEX.test(candidateId)) {
        return null;
      }

      const validated = MarketIdentifierSchema.safeParse({
        platform: "demo",
        marketId: candidateId,
        detectedVia: "url",
        sourceUrl: urlStr,
      });

      return validated.success ? validated.data : null;
    } catch {
      return null;
    }
  }

  public extractFromDomFallback(attributes: {
    dataMarketId?: string | null;
    dataPlatform?: string | null;
    canonicalHref?: string | null;
  }): MarketIdentifier | null {
    if (attributes.canonicalHref) {
      const fromCanonical = this.extractFromUrl(attributes.canonicalHref);
      if (fromCanonical) {
        return { ...fromCanonical, detectedVia: "dom" };
      }
    }

    const rawId = attributes.dataMarketId?.trim();
    if (!rawId || !SAFE_MARKET_ID_REGEX.test(rawId)) {
      return null;
    }

    const validated = MarketIdentifierSchema.safeParse({
      platform: "demo",
      marketId: rawId,
      detectedVia: "dom",
    });

    return validated.success ? validated.data : null;
  }
}

export const defaultDemoMarketAdapter = new DemoMarketAdapter();

export function detectMarketFromUrlOrDom(
  urlStr: string | null | undefined,
  domFallback?: {
    dataMarketId?: string | null;
    dataPlatform?: string | null;
    canonicalHref?: string | null;
  }
): MarketIdentifier | null {
  if (urlStr) {
    const demo = defaultDemoMarketAdapter.extractFromUrl(urlStr);
    if (demo) return demo;
  }

  if (domFallback) {
    return defaultDemoMarketAdapter.extractFromDomFallback(domFallback);
  }

  return null;
}
