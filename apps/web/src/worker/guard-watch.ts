import http from "node:http";
import { TrackedMarket, TrackedMarketSchema } from "@overwatch/shared";
import { getAdminDb, getFirestoreMetrics } from "../lib/firebase-admin";
import { getCanonicalMarketMetadata } from "../lib/markets/store";
import { guardWatchRegistry } from "../lib/watch/in-memory-registry";
import { getServerEnv } from "../lib/env";
import { logger } from "../lib/logger";

const WORKER_ID = `guard-watch-worker-${process.pid}`;
const DEFAULT_POLL_INTERVAL_MS = Number(
  process.env.GUARD_WATCH_TICK_MS ?? "20000"
);
const GUARD_WORKER_PORT = Number(
  process.env.GUARD_WORKER_PORT ?? "3002"
);

let shuttingDown = false;
let serverInstance: http.Server | null = null;
let timerId: NodeJS.Timeout | null = null;

function parseJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function isAuthorized(req: http.IncomingMessage): boolean {
  let sessionSecret: string | undefined;
  try {
    sessionSecret = getServerEnv().SESSION_SECRET;
  } catch {
    sessionSecret = process.env.SESSION_SECRET;
  }

  // If secret not configured in local dev, allow local requests
  if (!sessionSecret) return true;

  const authHeader = req.headers.authorization;
  const workerAuth = req.headers["x-worker-auth"];
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : undefined;

  return token === sessionSecret || workerAuth === sessionSecret;
}

export function createWorkerServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "127.0.0.1"}`
    );

    if (req.method === "GET" && url.pathname === "/internal/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          workerId: WORKER_ID,
          activeCount: guardWatchRegistry.size,
          uptime: process.uptime(),
        })
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/metrics") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          metrics: getFirestoreMetrics(),
          activeCount: guardWatchRegistry.size,
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/internal/track") {
      if (!isAuthorized(req)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "UNAUTHORIZED" }));
        return;
      }

      try {
        const body = await parseJsonBody<{
          action: "TRACK" | "UNTRACK" | "UPDATE";
          trackingId: string;
          status?: TrackedMarket["status"];
          trackedMarket?: TrackedMarket;
        }>(req);

        if (body.action === "UNTRACK") {
          guardWatchRegistry.unregisterMarket(body.trackingId);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              action: "UNTRACK",
              trackingId: body.trackingId,
              activeCount: guardWatchRegistry.size,
            })
          );
          return;
        }

        if (body.action === "UPDATE" && body.status && body.status !== "WATCHING") {
          guardWatchRegistry.updateStatus(body.trackingId, body.status);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              ok: true,
              action: "UPDATE",
              trackingId: body.trackingId,
              status: body.status,
              activeCount: guardWatchRegistry.size,
            })
          );
          return;
        }

        // Action is TRACK or UPDATE to WATCHING
        let tracked = body.trackedMarket;
        if (!tracked) {
          const db = getAdminDb();
          const snap = await db
            .collection("tracked_markets")
            .doc(body.trackingId)
            .get();
          if (snap.exists) {
            const parsed = TrackedMarketSchema.safeParse(snap.data());
            if (parsed.success) {
              tracked = parsed.data;
            }
          }
        }

        if (tracked) {
          let market = guardWatchRegistry.get(tracked.trackingId)?.market;
          if (!market) {
            const fetched = await getCanonicalMarketMetadata(tracked.marketId);
            if (fetched) market = fetched;
          }
          if (market) {
            guardWatchRegistry.registerMarket({
              trackedMarket: tracked,
              market,
            });
          }
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            action: body.action,
            trackingId: body.trackingId,
            activeCount: guardWatchRegistry.size,
          })
        );
        return;
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "BAD_REQUEST",
            message: err instanceof Error ? err.message : String(err),
          })
        );
        return;
      }
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });

  return server;
}

/**
 * Runs a monitoring sweep across all active tracked markets in memory.
 * ZERO recurring Firestore reads occur from this scheduler sweep.
 */
export async function runGuardWatchSweep(): Promise<{
  inspectedCount: number;
  processedIds: string[];
}> {
  const result = await guardWatchRegistry.runSweep();
  return {
    inspectedCount: result.inspectedCount,
    processedIds: result.processedIds,
  };
}

export async function startWorkerServer(
  port = GUARD_WORKER_PORT
): Promise<http.Server> {
  const server = createWorkerServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  serverInstance = server;
  logger.info(
    `Guard Watch internal worker server listening on http://127.0.0.1:${port}`
  );
  return server;
}

export async function stopWorkerServer(): Promise<void> {
  shuttingDown = true;
  if (timerId) {
    clearTimeout(timerId);
    timerId = null;
  }
  if (serverInstance) {
    await new Promise<void>((resolve) => {
      serverInstance?.close(() => resolve());
    });
    serverInstance = null;
  }
}

export async function startWorkerLoop(): Promise<void> {
  const runOnce = process.argv.includes("--once");

  logger.info("Overwatch Guard Watch worker starting", {
    workerId: WORKER_ID,
    mode: runOnce ? "SINGLE_SWEEP" : "PERSISTENT_DAEMON",
    tickMs: DEFAULT_POLL_INTERVAL_MS,
    port: GUARD_WORKER_PORT,
  });

  // 1. Start internal HTTP server for track/untrack synchronization
  try {
    await startWorkerServer(GUARD_WORKER_PORT);
  } catch (err) {
    logger.warn(
      "Worker HTTP server could not start (likely port in use or test mode)",
      {
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }

  // 2. Load active tracked-market records ONCE from Firestore at startup
  const loadedCount = await guardWatchRegistry.initFromFirestore();
  logger.info(
    `Guard Watch worker initialized with ${loadedCount} active market(s) from Firestore`
  );

  const handleSignal = (sig: string) => {
    logger.info("Guard Watch worker received shutdown signal", {
      workerId: WORKER_ID,
      signal: sig,
    });
    void stopWorkerServer();
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));

  if (runOnce) {
    const res = await runGuardWatchSweep();
    logger.info("Guard Watch single sweep completed", {
      workerId: WORKER_ID,
      ...res,
    });
    await stopWorkerServer();
    return;
  }

  // Recurring loop: Sweeps in-memory Map only. Zero recurring Firestore reads!
  while (!shuttingDown) {
    try {
      const res = await runGuardWatchSweep();
      logger.info("Guard Watch in-memory sweep tick completed", {
        workerId: WORKER_ID,
        ...res,
      });
    } catch (err) {
      logger.error("Guard Watch top-level tick error (recovering)", {
        workerId: WORKER_ID,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (shuttingDown) break;
    await new Promise((resolve) => {
      timerId = setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS);
    });
  }

  logger.info("Guard Watch worker shut down cleanly", { workerId: WORKER_ID });
}

export { guardWatchRegistry };

if (
  process.argv[1] &&
  (process.argv[1].endsWith("guard-watch.ts") ||
    process.argv[1].endsWith("guard-watch.js"))
) {
  startWorkerLoop().catch((err) => {
    logger.error("Guard Watch fatal startup error", {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
}
