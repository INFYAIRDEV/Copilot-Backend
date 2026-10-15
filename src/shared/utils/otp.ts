import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

export type OtpPurpose = "VERIFY_EMAIL" | "RESET_PASSWORD";

export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
export const OTP_MAX_SENDS_PER_HOUR = 5;

// Call at startup so the app stops if the secret is missing.
export const assertOtpConfig = (): void => {
  const secret = process.env.OTP_HMAC_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("OTP_HMAC_SECRET must be set and at least 32 characters");
  }
};

// 6-digit code from a secure random source.
export const generateOtp = (): string =>
  String(randomInt(0, 1_000_000)).padStart(6, "0");

// Only this hash is stored, never the code itself.
export const hashOtp = (
  userId: number,
  purpose: OtpPurpose,
  otp: string,
): string =>
  createHmac("sha256", process.env.OTP_HMAC_SECRET as string)
    .update(`${userId}:${purpose}:${otp}`)
    .digest("hex");

export const verifyOtpHash = (
  userId: number,
  purpose: OtpPurpose,
  otp: string,
  storedHash: string,
): boolean => {
  const a = Buffer.from(hashOtp(userId, purpose, otp), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
};
