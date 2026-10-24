import assert from "node:assert";
import { z } from "zod";
import {
  emailOnlySchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
} from "../src/modules/user/user.validation.js";
import {
  generateOtp,
  hashOtp,
  verifyOtpHash,
  OTP_TTL_MINUTES,
  OTP_MAX_ATTEMPTS,
} from "../src/shared/utils/otp.js";

async function runUserPasswordResetTests() {
  console.log("==================================================");
  console.log(" FEATURE: PASSWORD RESET, FORGOT & OTP TESTS       ");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`✔ [PASS] ${name}`);
    } catch (err) {
      console.error(`✘ [FAIL] ${name}`);
      console.error(err);
      throw err;
    }
  }

  // 1. Forgot Password / Email validation
  await test("Forgot Password: Valid email passes and normalizes to lowercase", () => {
    const parsed = emailOnlySchema(z).safeParse({
      email: "  USER@EXAMPLE.COM  ",
    });
    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.email, "user@example.com");
    }
  });

  await test("Forgot Password: Invalid email rejected with proper key", () => {
    const parsed = emailOnlySchema(z).safeParse({
      email: "invalid-email-address",
    });
    assert.strictEqual(parsed.success, false);
    if (!parsed.success) {
      assert.strictEqual(parsed.error.issues[0].message, "user.emailInvalid");
    }
  });

  // 2. OTP Generation & Verification Logic
  await test("OTP Security: generateOtp produces 6-digit numeric string", () => {
    for (let i = 0; i < 10; i++) {
      const code = generateOtp();
      assert.match(code, /^\d{6}$/, "Must be exactly 6 digits");
    }
  });

  await test("OTP Verification Schema: Valid 6-digit code accepted", () => {
    const parsed = verifyEmailSchema(z).safeParse({
      email: "user@example.com",
      otp: "123456",
    });
    assert.strictEqual(parsed.success, true);
  });

  await test("OTP Verification Schema: Non 6-digit code rejected", () => {
    const shortOtp = verifyEmailSchema(z).safeParse({
      email: "user@example.com",
      otp: "12345",
    });
    assert.strictEqual(shortOtp.success, false);

    const alphaOtp = verifyEmailSchema(z).safeParse({
      email: "user@example.com",
      otp: "12345a",
    });
    assert.strictEqual(alphaOtp.success, false);
  });

  await test("OTP Cryptography: hashOtp and timingSafe verifyOtpHash match", () => {
    const prevSecret = process.env.OTP_HMAC_SECRET;
    process.env.OTP_HMAC_SECRET = "01234567890123456789012345678901"; // 32 chars
    try {
      const userId = 42;
      const purpose = "RESET_PASSWORD";
      const code = "654321";

      const storedHash = hashOtp(userId, purpose, code);
      assert.ok(storedHash && storedHash.length === 64, "SHA-256 HMAC must be 64 hex characters");

      const isValid = verifyOtpHash(userId, purpose, code, storedHash);
      assert.strictEqual(isValid, true);

      const isWrongCode = verifyOtpHash(userId, purpose, "111111", storedHash);
      assert.strictEqual(isWrongCode, false);

      const isWrongPurpose = verifyOtpHash(userId, "VERIFY_EMAIL", code, storedHash);
      assert.strictEqual(isWrongPurpose, false);

      const isWrongUser = verifyOtpHash(999, purpose, code, storedHash);
      assert.strictEqual(isWrongUser, false);
    } finally {
      process.env.OTP_HMAC_SECRET = prevSecret;
    }
  });

  // 3. Reset Password Schema
  await test("Reset Password: Valid payload with matching passwords succeeds", () => {
    const parsed = resetPasswordSchema(z).safeParse({
      email: "user@example.com",
      otp: "123456",
      new_password: "NewPassword123",
      confirm_password: "NewPassword123",
    });
    assert.strictEqual(parsed.success, true);
  });

  await test("Reset Password: Password mismatch rejected with confirmPasswordMismatch", () => {
    const parsed = resetPasswordSchema(z).safeParse({
      email: "user@example.com",
      otp: "123456",
      new_password: "NewPassword123",
      confirm_password: "OtherPassword123",
    });
    assert.strictEqual(parsed.success, false);
    if (!parsed.success) {
      assert.strictEqual(parsed.error.issues[0].message, "user.confirmPasswordMismatch");
    }
  });

  // 4. Change Password Schema
  await test("Change Password: Rejects new password if identical to old password", () => {
    const parsed = changePasswordSchema(z).safeParse({
      old_password: "OldPassword123",
      new_password: "OldPassword123",
      confirm_password: "OldPassword123",
    });
    assert.strictEqual(parsed.success, false);
    if (!parsed.success) {
      assert.strictEqual(parsed.error.issues[0].message, "user.newPasswordSameAsOld");
    }
  });

  await test("OTP Constants: TTL is 10 minutes and max attempts is 5", () => {
    assert.strictEqual(OTP_TTL_MINUTES, 10);
    assert.strictEqual(OTP_MAX_ATTEMPTS, 5);
  });

  console.log("==================================================");
  console.log(` USER PASSWORD RESET & OTP TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================\n");
}

runUserPasswordResetTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
