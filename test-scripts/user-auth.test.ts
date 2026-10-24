import assert from "node:assert";
import { z } from "zod";
import {
  registerSchema,
  loginSchema,
} from "../src/modules/user/user.validation.js";
import { hashPassword, verifyPassword } from "../src/shared/utils/password.js";

async function runUserAuthTests() {
  console.log("==================================================");
  console.log(" FEATURE: USER AUTHENTICATION & REGISTRATION TESTS");
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

  // 1. Registration Schema Validations
  await test("Register: Valid payload with USER role succeeds", () => {
    const parsed = registerSchema(z).safeParse({
      full_name: "John Doe",
      username: "johndoe",
      email: "john@example.com",
      mobile: "+12345678901",
      password: "Password123",
      confirm_password: "Password123",
      role: "USER",
    });
    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.role_id, "USER");
      assert.strictEqual(parsed.data.username, "johndoe");
    }
  });

  await test("Register: Defaults to USER role when role is omitted", () => {
    const parsed = registerSchema(z).safeParse({
      full_name: "Jane Doe",
      username: "janedoe",
      email: "jane@example.com",
      password: "Password123",
      confirm_password: "Password123",
    });
    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.role_id, "USER");
    }
  });

  await test("Register: Supports ADMIN and SUPER_ADMIN roles (case-insensitive)", () => {
    const adminParsed = registerSchema(z).safeParse({
      full_name: "Admin User",
      username: "adminuser",
      email: "admin@example.com",
      password: "Password123",
      confirm_password: "Password123",
      role: "admin",
    });
    assert.strictEqual(adminParsed.success, true);
    if (adminParsed.success) {
      assert.strictEqual(adminParsed.data.role_id, "ADMIN");
    }
  });

  await test("Register: Rejects password without uppercase or digit", () => {
    const noUpper = registerSchema(z).safeParse({
      full_name: "Test User",
      username: "testuser",
      email: "test@example.com",
      password: "password123",
      confirm_password: "password123",
    });
    assert.strictEqual(noUpper.success, false);

    const noDigit = registerSchema(z).safeParse({
      full_name: "Test User",
      username: "testuser",
      email: "test@example.com",
      password: "Passwordabc",
      confirm_password: "Passwordabc",
    });
    assert.strictEqual(noDigit.success, false);
  });

  await test("Register: Rejects password shorter than 8 characters", () => {
    const short = registerSchema(z).safeParse({
      full_name: "Test User",
      username: "testuser",
      email: "test@example.com",
      password: "Pass1",
      confirm_password: "Pass1",
    });
    assert.strictEqual(short.success, false);
  });

  await test("Register: Rejects password mismatch", () => {
    const mismatch = registerSchema(z).safeParse({
      full_name: "Test User",
      username: "testuser",
      email: "test@example.com",
      password: "Password123",
      confirm_password: "Password456",
    });
    assert.strictEqual(mismatch.success, false);
    if (!mismatch.success) {
      assert.strictEqual(mismatch.error.issues[0].message, "user.confirmPasswordMismatch");
    }
  });

  await test("Register: Rejects invalid email format", () => {
    const badEmail = registerSchema(z).safeParse({
      full_name: "Test User",
      username: "testuser",
      email: "not-an-email",
      password: "Password123",
      confirm_password: "Password123",
    });
    assert.strictEqual(badEmail.success, false);
  });

  // 2. Login Schema Validations
  await test("Login: Valid credentials succeed with sanitized username", () => {
    const parsed = loginSchema(z).safeParse({
      username: "  JohnDoe  ",
      password: "Password123",
    });
    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.strictEqual(parsed.data.username, "johndoe");
      assert.strictEqual(parsed.data.password, "Password123");
    }
  });

  await test("Login: Rejects missing username or password", () => {
    const missingUser = loginSchema(z).safeParse({ password: "Password123" });
    assert.strictEqual(missingUser.success, false);

    const missingPass = loginSchema(z).safeParse({ username: "johndoe" });
    assert.strictEqual(missingPass.success, false);
  });

  await test("Login: Strict schema rejects injected fields like role or userId", () => {
    const injected = loginSchema(z).safeParse({
      username: "johndoe",
      password: "Password123",
      role: "ADMIN",
      userId: 1,
    });
    assert.strictEqual(injected.success, false);
  });

  // 3. Password Hashing and Verification
  await test("Auth Crypto: Password hashing produces secure bcrypt hash and matches", async () => {
    const plain = "SuperSecret123";
    const hash = await hashPassword(plain);
    assert.ok(hash.startsWith("$2"), "Expected bcrypt hash format");

    const validMatch = await verifyPassword(plain, hash);
    assert.strictEqual(validMatch, true);

    const invalidMatch = await verifyPassword("WrongPassword123", hash);
    assert.strictEqual(invalidMatch, false);
  });

  console.log("==================================================");
  console.log(` USER AUTH TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================\n");
}

runUserAuthTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
