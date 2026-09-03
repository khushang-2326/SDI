import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { config } from "./config";

const ALGORITHM = "aes-256-cbc";
// Derive a 32-byte key from the authSecret configuration
const ENCRYPTION_KEY = Buffer.concat([Buffer.from(config.authSecret), Buffer.alloc(32)], 32);

/**
 * Encrypts a string using AES-256-CBC.
 * Returns a string formatted as "iv_hex:encrypted_hex"
 */
export function encrypt(text: string): string {
  if (!text) return "";
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return `${iv.toString("hex")}:${encrypted}`;
}

function tryDecryptWithSecret(secret: string, iv: Buffer, encrypted: string): string | null {
  try {
    const key = Buffer.concat([Buffer.from(secret), Buffer.alloc(32)], 32);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

/**
 * Decrypts a string encrypted using AES-256-CBC.
 * Supports fallback to initial development secrets if database was migrated across environments.
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 2) return "";
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];

    const primary = tryDecryptWithSecret(config.authSecret, iv, encrypted);
    if (primary) return primary;

    const fallbacks = [
      "replace-with-a-long-random-secret",
      "development-secret-change-me"
    ];

    for (const fb of fallbacks) {
      if (fb !== config.authSecret) {
        const res = tryDecryptWithSecret(fb, iv, encrypted);
        if (res) return res;
      }
    }

    return "";
  } catch (error) {
    console.error("Failed to decrypt API key:", error);
    return "";
  }
}
