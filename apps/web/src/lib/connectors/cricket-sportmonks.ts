import {
  Delivery,
  Innings,
  Match,
  MatchSchema,
  Over,
  Player,
  Team,
  VerifiedFixtureMeta,
  VerifiedFixtureMetaSchema,
} from "@overwatch/shared";
import { getServerEnv } from "../env";
import { logger } from "../logger";

export const ALLOWED_SPORTMONKS_INCLUDES = new Set<string>([
  "localteam",
  "visitorteam",
  "runs",
  "batting",
  "bowling",
  "lineup",
  "balls",
  "balls.batsman",
  "balls.bowler",
  "balls.score",
  "venue",
  "league",
  "season",
  "tosswon",
]);

const DEFAULT_INCLUDES = [
  "localteam",
  "visitorteam",
  "runs",
  "batting",
  "bowling",
  "balls",
  "venue",
];

export function validateSportmonksIncludes(includes?: string[]): string[] {
  const input = includes && includes.length > 0 ? includes : DEFAULT_INCLUDES;
  const validated: string[] = [];

  for (const inc of input) {
    const trimmed = inc.trim();
    if (!ALLOWED_SPORTMONKS_INCLUDES.has(trimmed)) {
      throw new Error(`Disallowed Sportmonks include: "${trimmed}".`);
    }
    if (!validated.includes(trimmed)) {
      validated.push(trimmed);
    }
  }

  if (!validated.includes("localteam")) validated.push("localteam");
  if (!validated.includes("visitorteam")) validated.push("visitorteam");

  return validated;
}

function asRecord(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

function asNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(val: unknown, fallback = ""): string {
  return typeof val === "string" && val.length > 0 ? val : fallback;
}

/**
 * Normalizes a raw Sportmonks v2.0 fixture payload into Overwatch's provider-independent `Match` model.
 */
export function normalizeSportmonksFixture(rawFixture: Record<string, unknown>): Match {
  const fixtureId = asNumber(rawFixture.id, 0);
  const localRaw = asRecord(rawFixture.localteam);
  const visitorRaw = asRecord(rawFixture.visitorteam);

  const localTeam: Team = {
    id: (localRaw.id as number | string) ?? asNumber(rawFixture.localteam_id, 1),
    name: asString(localRaw.name, "Home Team"),
    code: asString(localRaw.code, "HOME"),
  };

  const visitorTeam: Team = {
    id: (visitorRaw.id as number | string) ?? asNumber(rawFixture.visitorteam_id, 2),
    name: asString(visitorRaw.name, "Away Team"),
    code: asString(visitorRaw.code, "AWAY"),
  };

  const venueRaw = asRecord(rawFixture.venue);
  const venueStr =
    asString(venueRaw.name) ||
    asString(rawFixture.venue_name) ||
    "International Cricket Venue";

  const roundStr = asString(rawFixture.round) || asString(rawFixture.type) || "ODI Match";
  const rawStatus = asString(rawFixture.status, "NS");

  const rawRuns = Array.isArray(rawFixture.runs) ? rawFixture.runs : [];
  const rawBalls = Array.isArray(rawFixture.balls) ? rawFixture.balls : [];
  const rawBatting = Array.isArray(rawFixture.batting) ? rawFixture.batting : [];
  const rawBowling = Array.isArray(rawFixture.bowling) ? rawFixture.bowling : [];

  const inningsList: Innings[] = [];

  if (rawRuns.length > 0) {
    for (const r of rawRuns) {
      const runRec = asRecord(r);
      const inningNum = asNumber(runRec.inning, 1);
      const battingTeamId = asNumber(runRec.team_id, 0);
      const isLocalBatting = battingTeamId === localTeam.id;

      const battingTeam = isLocalBatting ? localTeam : visitorTeam;
      const bowlingTeam = isLocalBatting ? visitorTeam : localTeam;

      const totalRuns = asNumber(runRec.score, 0);
      const wickets = asNumber(runRec.wickets, 0);
      const oversBowled = asNumber(runRec.overs, 0);
      const runRate = asNumber(
        runRec.run_rate,
        oversBowled > 0 ? Number((totalRuns / oversBowled).toFixed(2)) : 0
      );

      const inningBalls = rawBalls.filter((b) => {
        const br = asRecord(b);
        const scoreboard = asString(br.scoreboard);
        return scoreboard === `S${inningNum}` || scoreboard === `s${inningNum}` || scoreboard === String(inningNum);
      });

      const overs = buildOversFromBalls(inningNum, inningBalls, rawBatting, rawBowling);

      inningsList.push({
        inningNumber: inningNum,
        battingTeam,
        bowlingTeam,
        totalRuns,
        wickets,
        oversBowled,
        runRate,
        overs,
      });
    }
  } else {
    inningsList.push({
      inningNumber: 1,
      battingTeam: localTeam,
      bowlingTeam: visitorTeam,
      totalRuns: 0,
      wickets: 0,
      oversBowled: 0,
      runRate: 0,
      overs: [],
    });
  }

  const rawLineup = Array.isArray(rawFixture.lineup) ? rawFixture.lineup : [];
  const lineup: Player[] = rawLineup.map((p) => {
    const pr = asRecord(p);
    const pos = asRecord(pr.position);
    const lineupMeta = asRecord(pr.lineup);
    const teamId = asNumber(lineupMeta.team_id, 0);

    return {
      id: asNumber(pr.id, 0),
      fullName: asString(pr.fullname, asString(pr.name, "Player")),
      teamId: teamId || undefined,
      role: asString(pos.name, "Player"),
    };
  });

  return MatchSchema.parse({
    fixtureId,
    provider: "sportmonks",
    leagueName: asString(asRecord(rawFixture.league).name, "International Cricket"),
    seasonName: asString(asRecord(rawFixture.season).name, undefined),
    round: roundStr,
    startingAt: asString(rawFixture.starting_at, new Date().toISOString()),
    status: rawStatus,
    note: asString(rawFixture.note) || null,
    venue: venueRaw.name ? {
      id: asNumber(venueRaw.id, 0),
      name: asString(venueRaw.name, venueStr),
      city: asString(venueRaw.city, undefined),
    } : null,
    localTeam,
    visitorTeam,
    innings: inningsList,
    lineup,
    freshness: "LIVE",
  });
}

function buildOversFromBalls(
  inningNum: number,
  balls: unknown[],
  battingStats: unknown[],
  bowlingStats: unknown[]
): Over[] {
  const overMap = new Map<number, Delivery[]>();

  for (const b of balls) {
    const br = asRecord(b);
    const ballDecimal = asNumber(br.ball, 0);
    const overNumber = Math.max(1, Math.floor(ballDecimal) + 1);
    const ballInOver = Math.max(1, Math.round((ballDecimal - Math.floor(ballDecimal)) * 10) || 1);
    const ballCoordinate = ballDecimal;

    const batsmanRaw = asRecord(br.batsman);
    const bowlerRaw = asRecord(br.bowler);
    const scoreRaw = asRecord(br.score);
    const scoreName = asString(scoreRaw.name, asString(br.note, "")).toLowerCase();
    const rawRuns = asNumber(scoreRaw.runs, asNumber(br.runs, 0));

    let wides = asNumber(scoreRaw.wide, asNumber(br.wide, 0));
    let noBalls = asNumber(scoreRaw.noball, asNumber(br.noball, 0));
    let byes = asNumber(scoreRaw.bye, asNumber(br.bye, 0));
    let legByes = asNumber(scoreRaw.legbye, asNumber(br.legbye, 0));

    if (scoreName.includes("wide") && wides === 0) {
      wides = rawRuns || 1;
    }
    if ((scoreName.includes("no ball") || scoreName.includes("noball")) && noBalls === 0) {
      noBalls = 1;
    }
    if (scoreName.includes("bye") && !scoreName.includes("leg") && byes === 0) {
      byes = rawRuns;
    }
    if ((scoreName.includes("leg bye") || scoreName.includes("legbye")) && legByes === 0) {
      legByes = rawRuns;
    }

    const totalExtras = wides + noBalls + byes + legByes;
    const runsOffBat = wides > 0 ? 0 : Math.max(0, rawRuns - totalExtras);
    const totalRuns = runsOffBat + totalExtras;
    const isWicket = Boolean(
      br.wicket ||
      scoreRaw.wicket ||
      scoreRaw.is_wicket ||
      scoreRaw.out ||
      scoreName.includes("out")
    );

    const batsman: Player = {
      id: asNumber(batsmanRaw.id, 0),
      fullName: asString(batsmanRaw.fullname, asString(batsmanRaw.name, "Batsman")),
    };
    const bowler: Player = {
      id: asNumber(bowlerRaw.id, 0),
      fullName: asString(bowlerRaw.fullname, asString(bowlerRaw.name, "Bowler")),
    };

    const delivery: Delivery = {
      id: typeof br.id === "number" || typeof br.id === "string" ? br.id : `${inningNum}-${overNumber}-${ballInOver}`,
      inningNumber: inningNum,
      overNumber,
      ballNumber: ballInOver,
      ballCoordinate,
      batsman,
      bowler,
      runsOffBat,
      extras: {
        wides,
        noBalls,
        byes,
        legByes,
        penalty: 0,
        totalExtras,
      },
      totalRuns,
      isWicket,
      wicketType: isWicket ? asString(br.dismissal, "OUT") : undefined,
      scoreLabel: asString(scoreRaw.name, asString(br.note, undefined)),
    };

    const existing = overMap.get(overNumber) ?? [];
    existing.push(delivery);
    overMap.set(overNumber, existing);
  }

  return Array.from(overMap.entries()).map(([overNumber, deliveries]) => {
    const totalRuns = deliveries.reduce((s, d) => s + d.totalRuns, 0);
    const totalExtras = deliveries.reduce((s, d) => s + d.extras.totalExtras, 0);
    const wickets = deliveries.filter((d) => d.isWicket).length;
    const legalBallsBowled = deliveries.filter((d) => d.extras.wides === 0 && d.extras.noBalls === 0).length;

    return {
      inningNumber: inningNum,
      overNumber,
      totalRuns,
      totalExtras,
      wickets,
      legalBallsBowled,
      isComplete: legalBallsBowled >= 6,
      deliveries,
    };
  });
}

/**
 * Validates a Sportmonks fixture ID against the real Sportmonks Cricket API v2.0.
 * Used by admin market creation and the /api/markets/validate-fixture endpoint.
 * Does NOT trigger inference.
 */
export async function validateSportmonksFixtureById(
  fixtureId: number
): Promise<VerifiedFixtureMeta> {
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    throw new Error(`Invalid Sportmonks fixture ID: ${fixtureId}. Must be a positive integer.`);
  }

  const env = getServerEnv();
  const apiToken = env.SPORTMONKS_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      "SPORTMONKS_API_TOKEN is not configured in the server environment. Cannot validate fixture."
    );
  }

  const url = `https://cricket.sportmonks.com/api/v2.0/fixtures/${fixtureId}?include=localteam,visitorteam,venue,league,season&api_token=${encodeURIComponent(
    apiToken
  )}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Sportmonks API returned HTTP ${res.status} when looking up fixture #${fixtureId}.`);
    }

    const body = (await res.json()) as { data?: Record<string, unknown> };
    if (!body.data) {
      throw new Error(`Sportmonks fixture #${fixtureId} not found or data is empty.`);
    }

    const raw = body.data;
    const local = asRecord(raw.localteam);
    const visitor = asRecord(raw.visitorteam);
    const venue = asRecord(raw.venue);
    const league = asRecord(raw.league);

    const homeTeam = asString(local.name, "Local Team");
    const awayTeam = asString(visitor.name, "Visitor Team");
    const scheduledStartTime = asString(raw.starting_at, new Date().toISOString());
    const matchDate = scheduledStartTime.slice(0, 10);
    const matchFormat = asString(raw.type, asString(league.name, "ODI"));
    const venueName = asString(venue.name, asString(raw.venue_name, "N/A"));
    const status = asString(raw.status, "NS");

    const verified = VerifiedFixtureMetaSchema.parse({
      fixtureId,
      homeTeam,
      awayTeam,
      startingAt: scheduledStartTime,
      scheduledStartTime,
      matchDate,
      format: matchFormat,
      matchFormat,
      venue: venueName,
      status,
      competition: asString(league.name, "International Cricket"),
      verifiedAt: new Date().toISOString(),
    });

    logger.info(`[MARKET] Fixture validated | fixtureId=${fixtureId} | ${homeTeam} vs ${awayTeam}`);
    return verified;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Sportmonks fixture lookup timed out for fixture #${fixtureId}.`);
    }
    throw err;
  }
}

/**
 * In-memory cache for Sportmonks fixture data to avoid rapid duplicate external fetches
 * while respecting match state freshness requirements.
 */
interface CacheEntry {
  match: Match;
  retrievedAt: string;
  expiresAt: number;
  freshness: "LIVE" | "CACHED" | "FINAL" | "PRE_MATCH";
}

const fixtureDataCache = new Map<number, CacheEntry>();

/**
 * Deterministic Sportmonks data-preparation service.
 * Selects minimal allowlisted includes based on marketType and match stage,
 * applies state-aware caching, and attaches data freshness metadata.
 */
export async function prepareMarketCricketData(params: {
  fixtureId: number;
  marketType?: string;
  forceFresh?: boolean;
}): Promise<{
  match: Match | null;
  retrievedAt: string | null;
  freshness: "LIVE" | "CACHED" | "FINAL" | "PRE_MATCH";
  sourceUrlOrOrigin: string;
  unavailableReason?: string;
}> {
  const { fixtureId, marketType, forceFresh } = params;
  const now = Date.now();

  if (!forceFresh) {
    const cached = fixtureDataCache.get(fixtureId);
    if (cached && cached.expiresAt > now) {
      return {
        match: cached.match,
        retrievedAt: cached.retrievedAt,
        freshness: "CACHED",
        sourceUrlOrOrigin: `https://cricket.sportmonks.com/api/v2.0/fixtures/${fixtureId}`,
      };
    }
  }

  // Choose minimal allowlisted includes based on market type
  let includes = ["localteam", "visitorteam", "runs", "venue"];
  if (
    marketType === "OVER_RUNS" ||
    marketType === "INNINGS_TOTAL" ||
    marketType === "INNINGS_RUNS" ||
    marketType === "PHASE_RUNS"
  ) {
    includes = ["localteam", "visitorteam", "runs", "batting", "balls", "venue"];
  } else if (
    marketType === "PLAYER_RUNS" ||
    marketType === "PLAYER_WICKETS" ||
    marketType === "PLAYER_PERFORMANCE" ||
    marketType === "WICKETS"
  ) {
    includes = ["localteam", "visitorteam", "lineup", "batting", "bowling", "balls"];
  } else if (marketType === "MATCH_WINNER") {
    includes = ["localteam", "visitorteam", "runs", "venue", "league"];
  }

  const result = await fetchSportmonksFixtureData({
    fixtureId,
    include: includes,
  });

  if (!result.match) {
    return {
      match: null,
      retrievedAt: null,
      freshness: "PRE_MATCH",
      sourceUrlOrOrigin: result.sourceUrlOrOrigin,
      unavailableReason: result.unavailableReason,
    };
  }

  const status = result.match.status.toUpperCase();
  let freshness: "LIVE" | "CACHED" | "FINAL" | "PRE_MATCH" = "LIVE";
  let ttlMs = 20 * 1000; // 20s default for live matches

  if (status === "NS" || status === "UPCOMING" || status === "DELAYED") {
    freshness = "PRE_MATCH";
    ttlMs = 5 * 60 * 1000; // 5m for pre-match
  } else if (status === "FINISHED" || status === "FT" || status === "COMPLETED" || status === "ABANDONED") {
    freshness = "FINAL";
    ttlMs = 60 * 60 * 1000; // 1 hour for final matches
  }

  const retrievedAt = new Date().toISOString();
  fixtureDataCache.set(fixtureId, {
    match: result.match,
    retrievedAt,
    expiresAt: now + ttlMs,
    freshness,
  });

  return {
    match: result.match,
    retrievedAt,
    freshness,
    sourceUrlOrOrigin: result.sourceUrlOrOrigin,
  };
}

/**
 * Core runtime operation: `cricket.get_fixture_data`.
 * Calls Sportmonks Cricket API v2.0 without synthetic data fallbacks.
 */
export async function fetchSportmonksFixtureData(params: {
  fixtureId: number;
  include?: string[];
}): Promise<{
  match: Match | null;
  sourceUrlOrOrigin: string;
  unavailableReason?: string;
}> {
  if (!Number.isInteger(params.fixtureId) || params.fixtureId <= 0) {
    throw new Error(`Invalid fixtureId: ${params.fixtureId}`);
  }

  const validatedIncludes = validateSportmonksIncludes(params.include);
  const includeQuery = validatedIncludes.join(",");
  const publicOrigin = `https://cricket.sportmonks.com/api/v2.0/fixtures/${params.fixtureId}?include=${includeQuery}`;

  const env = getServerEnv();
  const apiToken = env.SPORTMONKS_API_TOKEN;

  if (!apiToken) {
    return {
      match: null,
      sourceUrlOrOrigin: publicOrigin,
      unavailableReason:
        "SPORTMONKS_API_TOKEN is not configured in server environment. Real cricket match delivery data is unavailable.",
    };
  }

  const url = `${publicOrigin}&api_token=${encodeURIComponent(apiToken)}`;
  logger.info(`[SPORTMONKS] Fixture fetch started | fixtureId=${params.fixtureId}`);

  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status === 429 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      if (response.ok) {
        const body = (await response.json()) as { data?: Record<string, unknown> };
        if (body.data) {
          const normalized = normalizeSportmonksFixture(body.data);
          logger.info(`[SPORTMONKS] Fixture data received | fixtureId=${params.fixtureId} records=1`);
          return {
            match: normalized,
            sourceUrlOrOrigin: publicOrigin,
          };
        }
      }

      logger.warn(`Sportmonks endpoint returned HTTP ${response.status} for fixture #${params.fixtureId}`);
      break;
    } catch (err) {
      clearTimeout(timeoutId);
      if (attempt === 2) {
        logger.warn("Sportmonks request failed after retry", {
          fixtureId: params.fixtureId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return {
    match: null,
    sourceUrlOrOrigin: publicOrigin,
    unavailableReason: `Sportmonks fixture #${params.fixtureId} could not be retrieved from provider API.`,
  };
}

export interface HistoricalFixtureData {
  fixtureId: number;
  title: string;
  matchDate: string;
  status: string;
  resultNote: string | null;
  innings: Array<{
    inningNumber: number;
    teamName: string;
    score: number;
    wickets: number;
    overs: number;
  }>;
  targetOverSummary?: string;
  sourceUrlOrOrigin: string;
}

const historicalFixtureCache = new Map<number, HistoricalFixtureData[]>();

/**
 * Pre-fetches prior completed fixtures in the series from Sportmonks v2.0
 * and extracts historical over-by-over milestones, runs, and team outcomes.
 */
export async function fetchHistoricalCricketFixtures(params: {
  currentFixtureId: number;
  targetOver?: number;
  limit?: number;
}): Promise<HistoricalFixtureData[]> {
  const { currentFixtureId, targetOver = 15, limit = 2 } = params;
  if (historicalFixtureCache.has(currentFixtureId)) {
    return historicalFixtureCache.get(currentFixtureId)!;
  }

  const env = getServerEnv();
  const apiToken = env.SPORTMONKS_API_TOKEN;
  if (!apiToken) return [];

  const results: HistoricalFixtureData[] = [];
  const candidateIds: number[] = [];
  for (let i = 1; i <= Math.min(limit, 3); i++) {
    candidateIds.push(currentFixtureId - i);
  }

  for (const histId of candidateIds) {
    if (histId <= 0) continue;
    try {
      const url = `https://cricket.sportmonks.com/api/v2.0/fixtures/${histId}?include=localteam,visitorteam,runs,balls&api_token=${encodeURIComponent(apiToken)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const json = (await res.json()) as { data?: Record<string, unknown> };
      if (!json.data) continue;

      const raw = json.data;
      const status = asString(raw.status, "");
      const local = asRecord(raw.localteam);
      const visitor = asRecord(raw.visitorteam);
      const localName = asString(local.name, "Home Team");
      const visitorName = asString(visitor.name, "Away Team");
      const matchDate = asString(raw.starting_at, "").slice(0, 10);
      const resultNote = typeof raw.note === "string" ? raw.note : null;

      const rawRuns = Array.isArray(raw.runs) ? raw.runs : [];
      const innings = rawRuns.map((r: any) => ({
        inningNumber: asNumber(r.inning, 1),
        teamName: r.team_id === local.id ? localName : visitorName,
        score: asNumber(r.score, 0),
        wickets: asNumber(r.wickets, 0),
        overs: asNumber(r.overs, 0),
      }));

      let targetOverSummary: string | undefined;
      const rawBalls = Array.isArray(raw.balls) ? raw.balls : [];
      if (rawBalls.length > 0 && targetOver) {
        const overDecMin = targetOver - 1;
        const overDecMax = targetOver;
        const targetDeliveries = rawBalls.filter((b: any) => {
          const ball = Number(b.ball);
          return ball >= overDecMin && ball < overDecMax;
        });

        if (targetDeliveries.length > 0) {
          const runsScored = targetDeliveries.reduce((sum: number, b: any) => {
            const r = Number(b.score?.runs ?? b.runs ?? 0);
            return sum + (isNaN(r) ? 0 : r);
          }, 0);
          targetOverSummary = `Over #${targetOver} had ${runsScored} total runs scored across ${targetDeliveries.length} recorded balls.`;
        }
      }

      results.push({
        fixtureId: histId,
        title: `${localName} vs ${visitorName} (${matchDate})`,
        matchDate,
        status,
        resultNote,
        innings,
        targetOverSummary,
        sourceUrlOrOrigin: `https://cricket.sportmonks.com/api/v2.0/fixtures/${histId}`,
      });
    } catch {
      // Continue next candidate
    }
  }

  historicalFixtureCache.set(currentFixtureId, results);
  if (results.length > 0) {
    logger.info(
      `[SPORTMONKS] Historical fixtures pre-fetched | count=${results.length} for fixture #${currentFixtureId}`
    );
  }
  return results;
}
