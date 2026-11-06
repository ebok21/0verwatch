import crypto from "crypto";
import { getServerEnv } from "../env";

export interface EncryptedSecretRecord {
  ciphertextHex: string;
  ivHex: string;
  authTagHex: string;
  algorithm: "aes-256-gcm";
  maskedPreview: string;
  updatedAt: string;
}

function deriveAes256Key(): Buffer {
  const env = getServerEnv();
  const rawKey = env.ZERO_G_ENCRYPTION_KEY;
  if (!rawKey) {
    throw new Error(
      "Missing ZERO_G_ENCRYPTION_KEY in server environment configuration."
    );
  }

  // If 64-character hex string -> 32 bytes directly; otherwise SHA-256 digest -> 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  return crypto.createHash("sha256").update(rawKey, "utf8").digest();
}

export function maskApiKey(plaintextKey: string): string {
  const trimmed = plaintextKey.trim();
  if (trimmed.length <= 8) {
    return "****";
  }
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}••••${suffix}`;
}

/**
 * Encrypts a 0G credential (`sk-` or `mk-`) using AES-256-GCM with a random 96-bit IV.
 */
export function encryptZeroGKey(plaintextKey: string): EncryptedSecretRecord {
  const trimmed = plaintextKey.trim();
  if (!trimmed) {
    throw new Error("Cannot encrypt an empty key.");
  }

  const key = deriveAes256Key();
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encrypted = Buffer.concat([
    cipher.update(trimmed, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertextHex: encrypted.toString("hex"),
    ivHex: iv.toString("hex"),
    authTagHex: authTag.toString("hex"),
    algorithm: "aes-256-gcm",
    maskedPreview: maskApiKey(trimmed),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decrypts a stored AES-256-GCM 0G credential in backend memory only.
 */
export function decryptZeroGKey(record: EncryptedSecretRecord): string {
  if (record.algorithm !== "aes-256-gcm") {
    throw new Error(`Unsupported encryption algorithm: ${record.algorithm}`);
  }

  const key = deriveAes256Key();
  const iv = Buffer.from(record.ivHex, "hex");
  const authTag = Buffer.from(record.authTagHex, "hex");
  const ciphertext = Buffer.from(record.ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

