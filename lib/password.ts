import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, originalHash] = storedHash.split(":");

  if (!salt || !originalHash) {
    return false;
  }

  const originalBuffer = Buffer.from(originalHash, "hex");
  const candidateBuffer = scryptSync(password, salt, KEY_LENGTH);

  return (
    originalBuffer.length === candidateBuffer.length &&
    timingSafeEqual(originalBuffer, candidateBuffer)
  );
}
