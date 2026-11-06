import dns from "dns";
import net from "net";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { getServerEnv } from "../env";
import { logger } from "../logger";

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  score?: number;
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResultItem[];
  provider: "tavily";
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();

  if (trimmed.startsWith("::ffff:")) {
    const mappedIpv4 = trimmed.slice(7);
    if (net.isIPv4(mappedIpv4)) {
      return isPrivateOrReservedIp(mappedIpv4);
    }
  }

  if (net.isIPv4(trimmed)) {
    const parts = trimmed.split(".").map((n) => Number(n));
    const [a = 0, b = 0] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(trimmed)) {
    if (trimmed === "::" || trimmed === "::1") return true;
    if (trimmed.startsWith("fc") || trimmed.startsWith("fd")) return true; // fc00::/7 Unique Local
    if (
      trimmed.startsWith("fe8") ||
      trimmed.startsWith("fe9") ||
      trimmed.startsWith("fea") ||
      trimmed.startsWith("feb")
    ) {
      return true; // fe80::/10 Link-Local
    }
    return false;
  }

  return true;
}

export async function validateSafePublicUrl(
  urlStr: string,
  options?: { skipDnsLookupForUnitTests?: boolean }
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid URL format: "${urlStr}"`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `Blocked URL protocol "${parsed.protocol}". Only https:// public URLs are allowed.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Blocked URL containing embedded credentials.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localhost")
  ) {
    throw new Error(`Blocked SSRF attempt to internal or local hostname: "${hostname}"`);
  }

  if (options?.skipDnsLookupForUnitTests) {
    return parsed;
  }

  try {
    const addresses = await dns.promises.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateOrReservedIp(addr.address)) {
        throw new Error(
          `Blocked SSRF attempt: Hostname "${hostname}" resolved to reserved/internal IP ${addr.address}`
        );
      }
    }
  } catch (dnsErr) {
    if (
      dnsErr instanceof Error &&
      dnsErr.message.includes("Blocked SSRF attempt")
    ) {
      throw dnsErr;
    }
    throw new Error(`DNS resolution failed for hostname "${hostname}": ${dnsErr}`);
  }

  return parsed;
}

export function wrapUntrustedWebEvidence(
  sourceUrl: string,
  title: string,
  content: string
): string {
  const sanitized = content
    .replace(/<system>[\s\S]*?<\/system>/gi, "[filtered-system-tag]")
    .replace(/<script[\s\S]*?<\/script>/gi, "[filtered-script]")
    .replace(/\b(ignore previous instructions|disregard instructions)\b/gi, "[filtered-prompt-injection]");

  return [
    `<UNTRUSTED_WEB_EVIDENCE source="${sourceUrl}" title="${title.replace(/"/g, "'")}">`,
    sanitized.trim(),
    `</UNTRUSTED_WEB_EVIDENCE>`,
  ].join("\n");
}

// 5-minute in-memory cache for Tavily web search results
interface SearchCacheEntry {
  response: WebSearchResponse;
  expiresAt: number;
}
const searchCache = new Map<string, SearchCacheEntry>();

/**
 * Runtime operation: `web.search` using real Tavily API.
 * Guarantees real external intelligence only — NO synthetic fallbacks.
 * Enforces query deduplication, source count limits (3-5), 5-minute caching,
 * and wraps all web snippets in <UNTRUSTED_WEB_EVIDENCE>.
 */
export async function executeWebSearch(params: {
  query: string;
  maxResults?: number;
}): Promise<WebSearchResponse> {
  const query = params.query.trim();
  if (query.length < 2) {
    throw new Error("Search query must be at least 2 characters.");
  }

  const normalizedKey = query.toLowerCase().replace(/\s+/g, " ");
  const cached = searchCache.get(normalizedKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.response;
  }

  const maxResults = Math.min(params.maxResults ?? 5, 5);
  const env = getServerEnv();
  const apiKey = env.TAVILY_API_KEY;

  if (!apiKey) {
    logger.warn("[TAVILY] TAVILY_API_KEY is not configured in server environment; web search returning empty results.");
    return {
      query,
      results: [],
      provider: "tavily",
    };
  }

  logger.info(`[TAVILY] Search started | queryCount=1 | query="${query}"`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        include_answer: false,
        max_results: maxResults,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          title?: string;
          url?: string;
          content?: string;
          published_date?: string;
          score?: number;
        }>;
      };

      const rawResults = data.results ?? [];
      const results: WebSearchResultItem[] = rawResults.map((r) => ({
        title: r.title ?? "Search Result",
        url: r.url ?? "",
        snippet: wrapUntrustedWebEvidence(
          r.url ?? "",
          r.title ?? "Search Result",
          r.content ?? ""
        ),
        publishedDate: r.published_date,
        score: r.score,
      }));

      logger.info(`[TAVILY] Search completed | sources=${results.length}`);

      const response: WebSearchResponse = {
        query,
        results,
        provider: "tavily",
      };

      searchCache.set(normalizedKey, {
        response,
        expiresAt: Date.now() + 5 * 60 * 1000, // 5 min TTL
      });

      return response;
    }

    logger.warn(`[TAVILY] Endpoint returned HTTP ${res.status}`);
  } catch (err) {
    clearTimeout(timeoutId);
    logger.warn("[TAVILY] Search request failed", {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return {
    query,
    results: [],
    provider: "tavily",
  };
}

export async function executeSafeWebFetchPage(params: {
  url: string;
}): Promise<{
  url: string;
  finalUrl: string;
  title: string;
  extractedText: string;
  byteLength: number;
}> {
  let currentUrl = await validateSafePublicUrl(params.url);
  const maxRedirects = 3;
  const maxBytes = 512 * 1024; // 512 KB cap

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          "User-Agent": "OverwatchResearchBot/0.1 (+https://overwatch.local)",
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(`Redirect status ${res.status} without Location header.`);
        }
        const resolvedRedirect = new URL(location, currentUrl).toString();
        currentUrl = await validateSafePublicUrl(resolvedRedirect);
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} when fetching ${currentUrl.toString()}`);
      }

      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (
        contentType &&
        !contentType.includes("text/html") &&
        !contentType.includes("text/plain") &&
        !contentType.includes("application/xhtml+xml")
      ) {
        throw new Error(`Unsupported content-type for page extraction: ${contentType}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("Response body stream unavailable.");
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.byteLength;
          if (totalBytes > maxBytes) {
            await reader.cancel();
            break;
          }
          chunks.push(value);
        }
      }

      const rawHtml = Buffer.concat(chunks).toString("utf-8");
      const dom = new JSDOM(rawHtml, { url: currentUrl.toString() });
      const readerArticle = new Readability(dom.window.document).parse();

      const title =
        readerArticle?.title?.trim() ||
        dom.window.document.title?.trim() ||
        currentUrl.hostname;
      const plainText =
        readerArticle?.textContent?.replace(/\s+/g, " ").trim() ||
        dom.window.document.body?.textContent?.replace(/\s+/g, " ").trim() ||
        "";

      return {
        url: params.url,
        finalUrl: currentUrl.toString(),
        title,
        extractedText: wrapUntrustedWebEvidence(
          currentUrl.toString(),
          title,
          plainText.slice(0, 5000)
        ),
        byteLength: totalBytes,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  throw new Error(`Exceeded maximum redirect hops (${maxRedirects}) for ${params.url}`);
}
