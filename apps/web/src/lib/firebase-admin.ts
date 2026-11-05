import {
  initializeApp,
  applicationDefault,
  getApps,
  getApp,
  type App,
} from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

function ensureEnvLoaded(): void {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    const candidates = [
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(process.cwd(), "../../.env.local"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ candidate)) {
        dotenv.config({ path: candidate });
        break;
      }
    }
  }
}

let cachedFirestore: Firestore | null = null;

import {
  instrumentFirestoreInstance,
  getFirestoreMetrics,
  resetFirestoreMetrics,
  type FirestoreMetrics,
} from "./firestore-metrics";
import {
  getIsolatedInMemoryFirestore,
  resetIsolatedInMemoryFirestore,
  IsolatedInMemoryFirestore,
} from "./test-firestore-mock";

export {
  getFirestoreMetrics,
  resetFirestoreMetrics,
  type FirestoreMetrics,
  resetIsolatedInMemoryFirestore,
  getIsolatedInMemoryFirestore,
  IsolatedInMemoryFirestore,
};

function isTestEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    Boolean(process.env.VITEST) ||
    process.env.OVERWATCH_TEST_FIRESTORE === "in-memory"
  );
}

/**
 * Singleton-safe Firebase Admin initialization using Application Default Credentials (ADC).
 * Reads GOOGLE_APPLICATION_CREDENTIALS and GOOGLE_CLOUD_PROJECT from environment (.env.local).
 * Fails safely if a test attempts to connect to production/dev Firebase unexpectedly.
 */
export function getFirebaseAdminApp(): App {
  ensureEnvLoaded();

  // Safety block: prevent test execution from accidentally connecting to cloud Firebase
  if (
    isTestEnvironment() &&
    !process.env.FIRESTORE_EMULATOR_HOST &&
    process.env.OVERWATCH_ALLOW_DEV_FIRESTORE_IN_TESTS !== "true"
  ) {
    throw new Error(
      "SAFETY GUARD: Test execution attempted to connect to live Firebase project without an emulator. " +
        "Unit and integration tests must use the isolated test environment or set FIRESTORE_EMULATOR_HOST. " +
        "To explicitly allow dev project access in tests, set OVERWATCH_ALLOW_DEV_FIRESTORE_IN_TESTS=true."
    );
  }

  const existingApps = getApps();
  if (existingApps.length > 0) {
    return getApp();
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error(
      "Missing GOOGLE_CLOUD_PROJECT environment variable for Firebase Admin initialization."
    );
  }

  // When running against Firebase Emulator, credential file is optional;
  // otherwise verify GOOGLE_APPLICATION_CREDENTIALS is set for ADC.
  if (
    !process.env.FIRESTORE_EMULATOR_HOST &&
    !process.env.GOOGLE_APPLICATION_CREDENTIALS
  ) {
    throw new Error(
      "Missing GOOGLE_APPLICATION_CREDENTIALS environment variable for Firebase Admin ADC initialization."
    );
  }

  return initializeApp({
    credential: applicationDefault(),
    projectId,
  });
}

export function getAdminDb(): Firestore {
  if (cachedFirestore) {
    return cachedFirestore;
  }

  // 1. If explicit Firestore emulator host is configured, connect to emulator
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    const app = getFirebaseAdminApp();
    const db = getFirestore(app);
    try {
      db.settings({ ignoreUndefinedProperties: true });
    } catch {
      // Ignore if settings already applied
    }
    cachedFirestore = instrumentFirestoreInstance(db);
    return cachedFirestore;
  }

  // 2. If running in test mode without an emulator, use isolated in-memory test store
  if (
    isTestEnvironment() &&
    process.env.OVERWATCH_ALLOW_DEV_FIRESTORE_IN_TESTS !== "true"
  ) {
    const mockStore = getIsolatedInMemoryFirestore();
    cachedFirestore = instrumentFirestoreInstance(
      mockStore as unknown as Firestore
    );
    return cachedFirestore;
  }

  // 3. Normal development / production runtime via Google Cloud ADC
  const app = getFirebaseAdminApp();
  const db = getFirestore(app);
  try {
    db.settings({ ignoreUndefinedProperties: true });
  } catch {
    // Ignore if settings were already applied on this Firestore instance
  }
  cachedFirestore = instrumentFirestoreInstance(db);
  return cachedFirestore;
}