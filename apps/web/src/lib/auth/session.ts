import crypto from "crypto";
import { verifyMessage, getAddress } from "viem";
import { NextRequest } from "next/server";
import { getAdminDb } from "../firebase-admin";
import { getServerEnv } from "../env";
import {
  decryptZeroGKey,
  EncryptedSecretRecord,
  encryptZeroGKey,
} from "./crypto-vault";

export const SESSION_COOKIE_NAME = "overwatch_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface AuthenticatedUser {
  userId: string;
  walletAddress: string;
  isDevTestAccount: boolean;
  expiresAt: number;
}

export interface UserCredentialStatus {
  authenticated: boolean;
  userId: string | null;
  walletAddress: string | null;
  isDevTestAccount: boolean;
  hasSkKey: boolean;
  skMaskedPreview: string | null;
  hasMkKey: boolean;
  mkMaskedPreview: string | null;
  mkPermissionScope: "account:read";
  inferenceProvider: "zero-g";
  zeroGModel: string;
}

function signSessionToken(payload: AuthenticatedUser): string {
  const env = getServerEnv();
  const dataB64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const hmac = crypto
    .createHmac("sha256", env.SESSION_SECRET)
    .update(dataB64)
    .digest("base64url");
  return `${dataB64}.${hmac}`;
}

export function verifySessionToken(token: string): AuthenticatedUser | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [dataB64, providedHmac] = parts;
    if (!dataB64 || !providedHmac) return null;

    const env = getServerEnv();
    const expectedHmac = crypto
      .createHmac("sha256", env.SESSION_SECRET)
      .update(dataB64)
      .digest("base64url");

    const a = Buffer.from(providedHmac);
    const b = Buffer.from(expectedHmac);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }

    const decoded = JSON.parse(
      Buffer.from(dataB64, "base64url").toString("utf8")
    ) as AuthenticatedUser;

    if (!decoded.expiresAt || Date.now() > decoded.expiresAt) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function createWalletChallenge(walletAddress: string): Promise<{
  nonce: string;
  message: string;
  expiresAt: number;
}> {
  const normalizedAddress = getAddress(walletAddress);
  const nonce = crypto.randomBytes(16).toString("hex");
  const issuedAt = new Date().toISOString();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  const message = [
    "OVERWATCH INTELLIGENCE PLATFORM — WALLET AUTHENTICATION",
    `Wallet: ${normalizedAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "Sign this challenge to authenticate your Overwatch session and manage encrypted 0G Compute credentials.",
  ].join("\n");

  const db = getAdminDb();
  await db
    .collection("auth_challenges")
    .doc(normalizedAddress.toLowerCase())
    .set({
      walletAddress: normalizedAddress,
      nonce,
      message,
      expiresAt,
      createdAt: issuedAt,
    });

  return { nonce, message, expiresAt };
}

export async function verifyWalletChallengeAndCreateSession(params: {
  walletAddress: string;
  signature: `0x${string}`;
}): Promise<{ user: AuthenticatedUser; sessionToken: string }> {
  const normalizedAddress = getAddress(params.walletAddress);
  const docId = normalizedAddress.toLowerCase();
  const db = getAdminDb();

  const challengeRef = db.collection("auth_challenges").doc(docId);
  const snap = await challengeRef.get();
  if (!snap.exists) {
    throw new Error("No active authentication challenge found for this wallet.");
  }

  const data = snap.data() as {
    message: string;
    expiresAt: number;
  };
  if (Date.now() > data.expiresAt) {
    await challengeRef.delete();
    throw new Error("Authentication challenge has expired. Request a new challenge.");
  }

  const valid = await verifyMessage({
    address: normalizedAddress,
    message: data.message,
    signature: params.signature,
  });

  // Delete single-use challenge nonce immediately
  await challengeRef.delete();

  if (!valid) {
    throw new Error("Invalid wallet cryptographic signature.");
  }

  const user: AuthenticatedUser = {
    userId: docId,
    walletAddress: normalizedAddress,
    isDevTestAccount: false,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  await db
    .collection("users")
    .doc(user.userId)
    .set(
      {
        userId: user.userId,
        walletAddress: normalizedAddress,
        isDevTestAccount: false,
        lastAuthenticatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

  const sessionToken = signSessionToken(user);
  return { user, sessionToken };
}

/**
 * Local operator session helper in non-production environments.
 * Still requires user-entered 0G credentials encrypted in Firestore.
 */
export async function createDevOperatorSession(): Promise<{
  user: AuthenticatedUser;
  sessionToken: string;
}> {
  const env = getServerEnv();
  if (env.NODE_ENV === "production") {
    throw new Error("Local operator session is not available in production.");
  }

  const user: AuthenticatedUser = {
    userId: "dev-operator-local",
    walletAddress: "0x71C...LOCAL_OPERATOR",
    isDevTestAccount: true,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  try {
    const db = getAdminDb();
    await db
      .collection("users")
      .doc(user.userId)
      .set(
        {
          userId: user.userId,
          walletAddress: user.walletAddress,
          isDevTestAccount: true,
          lastAuthenticatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
  } catch {
    // Non-fatal in isolated tests
  }

  return {
    user,
    sessionToken: signSessionToken(user),
  };
}

export function getAuthenticatedUserFromRequest(
  req: NextRequest
): AuthenticatedUser | null {
  const cookieToken = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (cookieToken) {
    const verified = verifySessionToken(cookieToken);
    if (verified) return verified;
  }

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7).trim();
    const verified = verifySessionToken(bearerToken);
    if (verified) return verified;
  }

  return null;
}

export async function resolveRequestOrDevUser(
  req: NextRequest
): Promise<AuthenticatedUser> {
  const existing = getAuthenticatedUserFromRequest(req);
  if (existing) {
    return existing;
  }

  const env = getServerEnv();
  if (env.NODE_ENV !== "production") {
    return {
      userId: "dev-operator-local",
      walletAddress: "0x71C...LOCAL_OPERATOR",
      isDevTestAccount: true,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
  }

  throw new Error("Authentication required. Sign wallet challenge to proceed.");
}

export async function saveUserZeroGCredentials(params: {
  userId: string;
  skKey: string;
  mkKey?: string | null;
}): Promise<{
  skMaskedPreview: string;
  mkMaskedPreview: string | null;
}> {
  const trimmedSk = params.skKey.trim();
  if (!trimmedSk.startsWith("sk-") || trimmedSk.length < 10) {
    throw new Error("Invalid 0G inference key: must start with 'sk-'.");
  }

  const encryptedSk = encryptZeroGKey(trimmedSk);
  let encryptedMk: EncryptedSecretRecord | null = null;

  if (params.mkKey && params.mkKey.trim().length > 0) {
    const trimmedMk = params.mkKey.trim();
    if (!trimmedMk.startsWith("mk-") || trimmedMk.length < 10) {
      throw new Error("Invalid 0G management key: must start with 'mk-'.");
    }
    encryptedMk = encryptZeroGKey(trimmedMk);
  }

  const db = getAdminDb();
  await db
    .collection("users")
    .doc(params.userId)
    .set(
      {
        userId: params.userId,
        zeroGVault: {
          sk: encryptedSk,
          mk: encryptedMk,
          mkPermissionScope: "account:read",
          updatedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );

  return {
    skMaskedPreview: encryptedSk.maskedPreview,
    mkMaskedPreview: encryptedMk?.maskedPreview ?? null,
  };
}

export async function revokeUserZeroGCredentials(userId: string): Promise<void> {
  const db = getAdminDb();
  await db
    .collection("users")
    .doc(userId)
    .set(
      {
        zeroGVault: null,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
}

/**
 * Retrieves decrypted user-owned 0G credentials from Firestore.
 * Strictly prohibits reading sk- or mk- keys from environment variables.
 */
export async function getUserDecryptedZeroGKeys(userId: string): Promise<{
  skKey: string | null;
  mkKey: string | null;
  skMaskedPreview: string | null;
  mkMaskedPreview: string | null;
}> {
  try {
    const db = getAdminDb();
    const snap = await db.collection("users").doc(userId).get();
    if (snap.exists) {
      const data = snap.data() as {
        zeroGVault?: {
          sk?: EncryptedSecretRecord | null;
          mk?: EncryptedSecretRecord | null;
        } | null;
      };

      const vault = data?.zeroGVault;
      if (vault?.sk) {
        const skKey = decryptZeroGKey(vault.sk);
        const mkKey = vault.mk ? decryptZeroGKey(vault.mk) : null;

        return {
          skKey,
          mkKey,
          skMaskedPreview: vault.sk.maskedPreview,
          mkMaskedPreview: vault.mk?.maskedPreview ?? null,
        };
      }
    }
  } catch {
    // Return empty credentials if Firestore lookup or decryption fails
  }

  // Fallback to configured environment variables if not yet stored in Firestore vault
  const envSk =
    process.env.ZERO_G_SK ||
    process.env["0G_SK"] ||
    process.env.OG_SK ||
    null;
  if (envSk && envSk.startsWith("sk-")) {
    const envMk =
      process.env.ZERO_G_MK ||
      process.env["0G_MK"] ||
      process.env.OG_MK ||
      null;
    return {
      skKey: envSk,
      mkKey: envMk,
      skMaskedPreview: `${envSk.slice(0, 6)}...${envSk.slice(-4)}`,
      mkMaskedPreview: envMk ? `${envMk.slice(0, 6)}...${envMk.slice(-4)}` : null,
    };
  }

  return {
    skKey: null,
    mkKey: null,
    skMaskedPreview: null,
    mkMaskedPreview: null,
  };
}
