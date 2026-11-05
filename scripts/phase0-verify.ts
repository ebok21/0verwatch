import * as dotenv from "dotenv";
import path from "path";
import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function verifyFirebaseAdminAdc(): Promise<{
  ok: boolean;
  projectId: string | undefined;
  detail: string;
}> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!projectId || !credsPath) {
    return {
      ok: false,
      projectId,
      detail: "Missing GOOGLE_CLOUD_PROJECT or GOOGLE_APPLICATION_CREDENTIALS in .env.local",
    };
  }

  try {
    const app =
      getApps().length > 0
        ? getApps()[0]!
        : initializeApp({
            credential: applicationDefault(),
            projectId,
          });
    const db = getFirestore(app);
    const ref = db.collection("_system_health").doc("phase0_verify");
    const timestamp = new Date().toISOString();
    await ref.set(
      {
        service: "overwatch-phase0",
        verifiedAt: timestamp,
        adcEnabled: true,
      },
      { merge: true }
    );
    const snap = await ref.get();
    return {
      ok: snap.exists,
      projectId,
      detail: `Firestore ADC read/write verified (verifiedAt=${snap.data()?.verifiedAt})`,
    };
  } catch (err) {
    return {
      ok: false,
      projectId,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function verifySportmonks(): Promise<{
  ok: boolean;
  nov7FixturesCount: number;
  discoveredFixtureId: number | null;
  sampleCompletedFixtureId: number | null;
  nestedBallsIncludeStatus: string;
  sampleBallKeys: string[];
}> {
  const token = process.env.SPORTMONKS_API_TOKEN;
  if (!token) {
    return {
      ok: false,
      nov7FixturesCount: 0,
      discoveredFixtureId: null,
      sampleCompletedFixtureId: null,
      nestedBallsIncludeStatus: "Missing SPORTMONKS_API_TOKEN",
      sampleBallKeys: [],
    };
  }

  const baseUrl = "https://cricket.sportmonks.com/api/v2.0";

  // 1. Check Nov 7-8, 2026 window
  const novUrl = `${baseUrl}/fixtures?api_token=${encodeURIComponent(
    token
  )}&filter[starts_between]=2026-11-01,2026-11-15&include=localteam,visitorteam,league`;
  const novRes = await fetch(novUrl);
  const novJson = (await novRes.json()) as { data?: Array<Record<string, unknown>> };
  const novFixtures = Array.isArray(novJson.data) ? novJson.data : [];

  let discoveredFixtureId: number | null = null;
  for (const f of novFixtures) {
    if (typeof f.id === "number") {
      discoveredFixtureId = f.id;
      break;
    }
  }

  // 2. Also query available fixtures in the plan to test nested balls includes on a real completed match
  const listUrl = `${baseUrl}/fixtures?api_token=${encodeURIComponent(
    token
  )}&include=localteam,visitorteam,league`;
  const listRes = await fetch(listUrl);
  const listJson = (await listRes.json()) as {
    data?: Array<Record<string, unknown>>;
    message?: string;
  };
  const allFixtures = Array.isArray(listJson.data) ? listJson.data : [];

  const finishedFixture =
    allFixtures.find((f) => f.status === "Finished") ?? allFixtures[0] ?? null;
  const sampleFixtureId =
    finishedFixture && typeof finishedFixture.id === "number"
      ? finishedFixture.id
      : discoveredFixtureId;

  let nestedBallsIncludeStatus = "No sample fixture available";
  let sampleBallKeys: string[] = [];

  if (sampleFixtureId) {
    // Test enriched include vs standard include
    const includeStr = "localteam,visitorteam,runs,batting,bowling,lineup,balls,venue";
    const detailUrl = `${baseUrl}/fixtures/${sampleFixtureId}?api_token=${encodeURIComponent(
      token
    )}&include=${includeStr}`;
    const detailRes = await fetch(detailUrl);
    const detailJson = (await detailRes.json()) as {
      data?: Record<string, unknown>;
      message?: string;
    };

    if (detailRes.ok && detailJson.data) {
      const balls = detailJson.data.balls;
      if (Array.isArray(balls) && balls.length > 0) {
        const firstBall = balls[0] as Record<string, unknown>;
        sampleBallKeys = Object.keys(firstBall);
        nestedBallsIncludeStatus = `HTTP ${detailRes.status}: returned ${balls.length} ball deliveries with keys [${sampleBallKeys.join(", ")}]`;
      } else {
        nestedBallsIncludeStatus = `HTTP ${detailRes.status}: fixture fetched (${String(
          detailJson.data.status
        )}), balls count = ${Array.isArray(balls) ? balls.length : 0}`;
      }
    } else {
      nestedBallsIncludeStatus = `HTTP ${detailRes.status}: ${
        detailJson.message ?? "Unknown error"
      }`;
    }
  }

  return {
    ok: listRes.ok,
    nov7FixturesCount: novFixtures.length,
    discoveredFixtureId: discoveredFixtureId ?? sampleFixtureId,
    sampleCompletedFixtureId: sampleFixtureId,
    nestedBallsIncludeStatus,
    sampleBallKeys,
  };
}

async function verifyTavily(): Promise<{
  ok: boolean;
  resultCount: number;
  detail: string;
}> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { ok: false, resultCount: 0, detail: "Missing TAVILY_API_KEY" };
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: "India vs New Zealand ODI cricket pitch report",
        max_results: 3,
        search_depth: "basic",
      }),
    });
    const json = (await res.json()) as {
      results?: Array<{ title: string; url: string }>;
      error?: string;
    };
    const results = Array.isArray(json.results) ? json.results : [];
    return {
      ok: res.ok && results.length > 0,
      resultCount: results.length,
      detail: res.ok
        ? `Returned ${results.length} results (first: "${results[0]?.title ?? "n/a"}")`
        : `HTTP ${res.status}: ${json.error ?? "Failed"}`,
    };
  } catch (err) {
    return {
      ok: false,
      resultCount: 0,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  console.log("=== OVERWATCH PHASE 0 VERIFICATION SPIKE ===");
  const [firebaseResult, sportmonksResult, tavilyResult] = await Promise.all([
    verifyFirebaseAdminAdc(),
    verifySportmonks(),
    verifyTavily(),
  ]);

  console.log(
    JSON.stringify(
      {
        firebaseAdminAdc: firebaseResult,
        sportmonks: sportmonksResult,
        tavily: tavilyResult,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error("Phase 0 verification failed:", err);
  process.exit(1);
});

