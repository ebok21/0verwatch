import { guardWatchRegistry } from "./in-memory-registry";
import { logger } from "../logger";

let watcherInterval: NodeJS.Timeout | null = null;
let isSweeping = false;

/**
 * Runs a single in-process Guard Watch sweep across all active tracked markets.
 * Groups by fixtureId to query Sportmonks once per fixture, evaluates Sentry,
 * and updates in-memory registry & Firestore records.
 */
export async function runInProcessSweep(options?: {
  bypassCooldown?: boolean;
}): Promise<{
  inspectedCount: number;
  processedIds: string[];
}> {
  if (isSweeping) {
    return { inspectedCount: 0, processedIds: [] };
  }
  isSweeping = true;
  try {
    // If in-memory registry has not loaded Firestore state yet, populate it
    if (guardWatchRegistry.size === 0) {
      await guardWatchRegistry.initFromFirestore();
    }

    const result = await guardWatchRegistry.runSweep({
      bypassCooldown: options?.bypassCooldown,
    });

    if (result.inspectedCount > 0) {
      logger.info(
        `[GUARD] In-process sweep completed | inspected=${result.inspectedCount} | processed=${result.processedIds.length}`
      );
    }

    return {
      inspectedCount: result.inspectedCount,
      processedIds: result.processedIds,
    };
  } catch (err) {
    logger.error("[GUARD] In-process sweep error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { inspectedCount: 0, processedIds: [] };
  } finally {
    isSweeping = false;
  }
}

/**
 * Ensures the recurring in-process Guard Watch sweep loop is active.
 * Replaces the need for a separate standalone worker process.
 */
export function ensureInProcessWatcherStarted(intervalMs = 20000): void {
  if (watcherInterval) return;

  logger.info(
    `[GUARD] In-process Guard Watch loop started (tick interval: ${intervalMs / 1000}s)`
  );

  // Initial sweep shortly after activation
  setTimeout(() => {
    void runInProcessSweep();
  }, 1000);

  watcherInterval = setInterval(() => {
    void runInProcessSweep();
  }, intervalMs);
}

/**
 * Halts the in-process watcher (used in test teardown or process shutdown).
 */
export function stopInProcessWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    logger.info("[GUARD] In-process Guard Watch loop stopped");
  }
}

