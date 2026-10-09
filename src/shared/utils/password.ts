// Central place for password hashing and checking.
// No other file should call bcrypt directly (COP-15).
import bcrypt from "bcryptjs";
import { logger } from "./logger.js";

// Allowed range for the hashing cost (higher = safer but slower).
const MIN_SALT_ROUNDS = 10;
const MAX_SALT_ROUNDS = 15;
const DEFAULT_SALT_ROUNDS = 12;

// bcrypt only reads the first 72 bytes of a password, so we refuse anything longer.
export const MAX_PASSWORD_BYTES = 72;

// Saved after the first read so we don't re-check .env on every call.
let saltRounds: number | undefined;

// A fake hash used to waste the same time when the user does not exist.
let dummyHashPromise: Promise<string> | undefined;

// Turns the .env text into a valid hashing cost, or throws a clear error.
export const parseSaltRounds = (raw?: string): number => {
  // Use the default when the value is not set.
  const value =
    raw === undefined || raw === "" ? DEFAULT_SALT_ROUNDS : Number(raw);
  // Reject anything that is not a whole number inside the allowed range.
  if (
    !Number.isInteger(value) ||
    value < MIN_SALT_ROUNDS ||
    value > MAX_SALT_ROUNDS
  ) {
    throw new Error(
      `BCRYPT_SALT_ROUNDS must be a whole number between ${MIN_SALT_ROUNDS} and ${MAX_SALT_ROUNDS}`,
    );
  }
  return value;
};

// Reads and checks the hashing cost once; call it at startup to fail fast.
export const assertPasswordConfig = (): number => {
  saltRounds ??= parseSaltRounds(process.env.BCRYPT_SALT_ROUNDS);
  return saltRounds;
};

// Turns a plain password into a hash that is safe to store in the database.
export const hashPassword = async (plainPassword: string): Promise<string> => {
  // Refuse empty or non-text input.
  if (typeof plainPassword !== "string" || plainPassword.length === 0) {
    throw new Error("password.hashInputInvalid");
  }
  // Refuse passwords that bcrypt would silently cut short.
  if (Buffer.byteLength(plainPassword, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error("password.hashInputInvalid");
  }
  // Hash with the configured cost (a random salt is added automatically).
  return bcrypt.hash(plainPassword, assertPasswordConfig());
};

// Checks a typed password against the stored hash; true only when they match.
export const verifyPassword = async (
  plainPassword: string,
  storedHash?: string | null,
): Promise<boolean> => {
  try {
    // No stored hash means the user does not exist.
    if (!storedHash) {
      // Do a fake check anyway so the response time looks the same as for a real user.
      dummyHashPromise ??= bcrypt.hash(
        "copilot-dummy-password",
        assertPasswordConfig(),
      );
      await bcrypt.compare(plainPassword, await dummyHashPromise);
      return false;
    }
    // Real check: bcrypt compares safely, we never compare the texts ourselves.
    return await bcrypt.compare(plainPassword, storedHash);
  } catch {
    // A broken hash counts as a failed login. Never log the password or the hash.
    logger.warn("Password verification could not be completed");
    return false;
  }
};
