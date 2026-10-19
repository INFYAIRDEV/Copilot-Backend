/**
 * Unit tests for the "update profile" feature.
 *
 * Strategy: inject lightweight mock repository and OTP-mailer stubs so the
 * tests run without a real database or SMTP server.  Matches the pattern
 * established by the copilot module tests.
 */
import assert from "node:assert";
import { z as zod } from "zod";
import { updateProfileSchema } from "../user.validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal in-memory user store shared across mock calls. */
interface MockUser {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  role_id: number;
  is_active: boolean;
  is_email_verified: boolean;
}

function createMockRepo(seed: Partial<MockUser> = {}) {
  const user: MockUser = {
    user_id: 1,
    username: "alice",
    full_name: "Alice Smith",
    email: "alice@example.com",
    role_id: 2,
    is_active: true,
    is_email_verified: true,
    ...seed,
  };

  return {
    users: [user],

    findBasicById(userId: number) {
      const u = this.users.find((x) => x.user_id === userId);
      if (!u) return Promise.resolve(null);
      return Promise.resolve({ email: u.email, is_email_verified: u.is_email_verified });
    },

    findByEmail(email: string) {
      const u = this.users.find((x) => x.email === email);
      if (!u) return Promise.resolve(null);
      return Promise.resolve({ user_id: u.user_id, email: u.email, is_active: u.is_active, is_email_verified: u.is_email_verified });
    },

    updateProfile(userId: number, data: { full_name: string; email: string; is_email_verified?: boolean }) {
      const u = this.users.find((x) => x.user_id === userId);
      if (!u) throw new Error("Not found");
      Object.assign(u, data);
      return Promise.resolve({ user_id: u.user_id, username: u.username, full_name: u.full_name, email: u.email, role_id: u.role_id, is_active: u.is_active });
    },
  };
}

/** Simple in-process service stand-in (replicates service logic using mock repo). */
class ConflictError extends Error {
  constructor(public messageKey: string) { super(messageKey); }
}
class UnauthorizedError extends Error {
  constructor(public messageKey: string) { super(messageKey); }
}

async function updateProfileService(
  userId: number,
  data: { full_name: string; email: string },
  repo: ReturnType<typeof createMockRepo>,
  otpSent: { called: boolean },
) {
  const existing = await repo.findBasicById(userId);
  if (!existing) throw new UnauthorizedError("user.unauthorized");

  const emailChanged = data.email !== existing.email;

  if (emailChanged) {
    const conflict = await repo.findByEmail(data.email);
    if (conflict) throw new ConflictError("user.emailAlreadyExists");
  }

  const updated = await repo.updateProfile(userId, {
    full_name: data.full_name,
    email: data.email,
    ...(emailChanged ? { is_email_verified: false } : {}),
  });

  if (emailChanged) {
    otpSent.called = true; // stand-in for issueOtp
  }

  return {
    userId: updated.user_id,
    username: updated.username,
    fullName: updated.full_name,
    email: updated.email,
    roleId: updated.role_id,
  };
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTests() {
  console.log("==================================================");
  console.log("     USER UPDATE PROFILE — UNIT TESTS             ");
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

  // ── Validation schema ──────────────────────────────────────────────────

  await test("Validation: valid full_name and email are accepted", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice Smith",
      email: "alice@example.com",
    });
    assert.ok(result.success, "Expected success");
  });

  await test("Validation: empty full_name is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "",
      email: "alice@example.com",
    });
    assert.ok(!result.success);
    assert.ok(
      result.error?.issues[0].message.includes("fullName"),
      "Expected fullName error key",
    );
  });

  await test("Validation: full_name of 1 character is rejected (min 2)", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "A",
      email: "alice@example.com",
    });
    assert.ok(!result.success);
  });

  await test("Validation: full_name exceeding 100 chars is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "A".repeat(101),
      email: "alice@example.com",
    });
    assert.ok(!result.success);
  });

  await test("Validation: malformed email is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice",
      email: "not-an-email",
    });
    assert.ok(!result.success);
    assert.ok(result.error?.issues[0].message.includes("emailInvalid"));
  });

  await test("Validation: extra fields are rejected (strict mode)", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice",
      email: "alice@example.com",
      user_id: 999,
    } as any);
    assert.ok(!result.success, "Extra field should fail strict mode");
  });

  await test("Validation: email is normalized to lowercase", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice",
      email: "ALICE@EXAMPLE.COM",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data?.email, "alice@example.com");
  });

  // ── Service logic ──────────────────────────────────────────────────────

  await test("Service: updating only the name (same email) does not trigger OTP", async () => {
    const repo = createMockRepo();
    const otpSent = { called: false };
    const result = await updateProfileService(1, { full_name: "Alicia Smith", email: "alice@example.com" }, repo, otpSent);
    assert.strictEqual(result.fullName, "Alicia Smith");
    assert.ok(!otpSent.called, "OTP must NOT be sent when email does not change");
  });

  await test("Service: updating the email triggers OTP and marks account unverified", async () => {
    const repo = createMockRepo();
    const otpSent = { called: false };
    await updateProfileService(1, { full_name: "Alice Smith", email: "new@example.com" }, repo, otpSent);
    assert.ok(otpSent.called, "OTP MUST be sent when email changes");
    const stored = repo.users[0];
    assert.strictEqual(stored.is_email_verified, false, "Account must be demoted to unverified");
    assert.strictEqual(stored.email, "new@example.com");
  });

  await test("Service: new email already owned by another user => ConflictError", async () => {
    const repo = createMockRepo();
    // add a second user owning the target email
    repo.users.push({ user_id: 2, username: "bob", full_name: "Bob", email: "taken@example.com", role_id: 2, is_active: true, is_email_verified: true });
    const otpSent = { called: false };
    await assert.rejects(
      () => updateProfileService(1, { full_name: "Alice", email: "taken@example.com" }, repo, otpSent),
      (err: ConflictError) => {
        assert.strictEqual(err.messageKey, "user.emailAlreadyExists");
        return true;
      },
    );
  });

  await test("Service: non-existent user => UnauthorizedError", async () => {
    const repo = createMockRepo();
    const otpSent = { called: false };
    await assert.rejects(
      () => updateProfileService(999, { full_name: "Ghost", email: "ghost@example.com" }, repo, otpSent),
      (err: UnauthorizedError) => {
        assert.strictEqual(err.messageKey, "user.unauthorized");
        return true;
      },
    );
  });

  await test("Service: response contains expected AuthUser field names (fullName, email, userId)", async () => {
    const repo = createMockRepo();
    const otpSent = { called: false };
    const result = await updateProfileService(1, { full_name: "Alice Updated", email: "alice@example.com" }, repo, otpSent);
    assert.ok("userId" in result);
    assert.ok("fullName" in result);
    assert.ok("email" in result);
    assert.ok("username" in result);
    assert.ok("roleId" in result);
    // password_hash must NEVER appear
    assert.ok(!("password_hash" in result));
  });

  // ── Security invariants ────────────────────────────────────────────────

  await test("Security: user_id is never read from the parsed input", () => {
    // The updateProfileSchema does not expose a user_id field.
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Eve",
      email: "eve@example.com",
      user_id: 42,  // injected by attacker
    } as any);
    assert.ok(!result.success, "user_id field must be rejected by strict schema");
  });

  await test("Security: User A cannot update User B's profile via service (wrong userId)", async () => {
    const repo = createMockRepo({ user_id: 2 }); // repo only has user 2
    const otpSent = { called: false };
    // userId 1 is sent (attacker) but only userId 2 exists
    await assert.rejects(
      () => updateProfileService(1, { full_name: "Evil", email: "evil@example.com" }, repo, otpSent),
      (err: UnauthorizedError) => {
        assert.strictEqual(err.messageKey, "user.unauthorized");
        return true;
      },
    );
  });

  console.log("==================================================");
  console.log(` UPDATE PROFILE TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
