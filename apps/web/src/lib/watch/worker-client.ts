import { TrackedMarket } from "@overwatch/shared";
import { getServerEnv } from "../env";
import { logger } from "../logger";

export interface WorkerTrackUpdatePayload {
  action: "TRACK" | "UNTRACK" | "UPDATE";
  trackingId: string;
  status?: string;
  trackedMarket?: TrackedMarket;
}

/**
 * Synchronizes tracking state changes with the running Guard Watch worker's in-memory registry.
 * This runs via local HTTP and is completely non-blocking if the standalone worker is not currently running.
 */
export async function notifyWorkerOfTrackUpdate(
  payload: WorkerTrackUpdatePayload
): Promise<boolean> {
  let env;
  try {
    env = getServerEnv();
  } catch {
    return false;
  }

  const workerUrl = process.env.GUARD_WORKER_URL || env.GUARD_WORKER_URL || "http://127.0.0.1:3002";
  const sessionSecret = env.SESSION_SECRET;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const res = await fetch(`${workerUrl}/internal/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionSecret}`,
        "x-worker-auth": sessionSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.ok) {
      logger.info("Synchronized tracking state with Guard Watch worker in-memory registry", {
        trackingId: payload.trackingId,
        action: payload.action,
      });
      return true;
    }

    return false;
  } catch (err) {
    // If worker is offline or running in single-process mode, fail-open gracefully without affecting API responses
    logger.info("Guard Watch worker endpoint not reachable (worker will load state on startup)", {
      trackingId: payload.trackingId,
      action: payload.action,
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

