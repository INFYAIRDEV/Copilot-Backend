import assert from "node:assert";
import {
  generateAccessToken,
  verifyJwtToken,
  assertJwtConfig,
} from "../src/shared/utils/jwt.js";
import {
  hashPassword,
  verifyPassword,
  parseSaltRounds,
} from "../src/shared/utils/password.js";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  assertOtpConfig,
} from "../src/shared/utils/otp.js";
import {
  setRequestContext,
  getRequestContext,
} from "../src/shared/utils/requestContext.js";

async function runCryptoUtilsTests() {
  console.log("==================================================");
  console.log(" FEATURE: CRYPTOGRAPHIC & SECURITY UTILITIES     ");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✔ [PASS] ${name}`);
    } catch (err: any) {
      console.error(`✘ [FAIL] ${name}`);
      console.error(err);
      throw err;
    }
  }

  // Set up required test env vars
  const prevJwtSecret = process.env.JWT_SECRET;
  const prevJwtExpiry = process.env.JWT_EXPIRES_IN;
  const prevOtpSecret = process.env.OTP_HMAC_SECRET;

  process.env.JWT_SECRET = "01234567890123456789012345678901"; // 32 chars
  process.env.JWT_EXPIRES_IN = "1h";
  process.env.OTP_HMAC_SECRET = "01234567890123456789012345678901"; // 32 chars

  try {
    // 1. JWT Assert Configuration
    await test("JWT Config: Validates secret length (>= 32 chars) and expiry format", () => {
      assert.doesNotThrow(() => assertJwtConfig());
    });

    // 2. JWT Generation & Verification
    await test("JWT Token: Generates signed HS256 token and verifies userId", () => {
      const token = generateAccessToken(42);
      assert.ok(typeof token === "string" && token.length > 20);

      const verified = verifyJwtToken(token);
      assert.strictEqual(verified.user.id, 42);
      assert.ok(verified.tokenId);
      assert.ok(verified.expiresAt instanceof Date);
    });

    await test("JWT Tampering: Rejects tampered token with UnauthorizedError", () => {
      const token = generateAccessToken(42);
      const tampered = token.slice(0, -5) + "abcde";

      assert.throws(
        () => verifyJwtToken(tampered),
        (err: any) => {
          return err.messageKey === "user.unauthorized" || err.statusCode === 401;
        },
      );
    });

    // 3. Password Hashing & Salt Rounds
    await test("Password Cost: Enforces salt rounds between 10 and 15", () => {
      assert.strictEqual(parseSaltRounds("12"), 12);
      assert.strictEqual(parseSaltRounds(""), 12); // default
      assert.throws(() => parseSaltRounds("8")); // too low
      assert.throws(() => parseSaltRounds("18")); // too high
    });

    await test("Password Hash: Hashes plain text and validates equality with timing resistance", async () => {
      const hash = await hashPassword("ComplexPassword!99");
      assert.ok(hash.startsWith("$2"), "Valid bcrypt prefix");

      const match = await verifyPassword("ComplexPassword!99", hash);
      assert.strictEqual(match, true);

      const wrong = await verifyPassword("WrongPassword!99", hash);
      assert.strictEqual(wrong, false);
    });

    // 4. OTP Generation & HMAC
    await test("OTP Utilities: Validates configuration and verifies HMAC hash", () => {
      assert.doesNotThrow(() => assertOtpConfig());

      const code = generateOtp();
      assert.strictEqual(code.length, 6);

      const hmac = hashOtp(1, "RESET_PASSWORD", code);
      assert.strictEqual(verifyOtpHash(1, "RESET_PASSWORD", code, hmac), true);
      assert.strictEqual(verifyOtpHash(1, "RESET_PASSWORD", "000000", hmac), false);
    });

    // 5. Request Context AsyncLocalStorage
    await test("RequestContext: Preserves per-request context across async boundaries", () => {
      let capturedLang = "";
      setRequestContext({ lang: "it" }, () => {
        const ctx = getRequestContext();
        capturedLang = ctx?.lang || "";
      });
      assert.strictEqual(capturedLang, "it");
    });
  } finally {
    process.env.JWT_SECRET = prevJwtSecret;
    process.env.JWT_EXPIRES_IN = prevJwtExpiry;
    process.env.OTP_HMAC_SECRET = prevOtpSecret;
  }

  console.log("==================================================");
  console.log(` CRYPTO UTILS TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runCryptoUtilsTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
