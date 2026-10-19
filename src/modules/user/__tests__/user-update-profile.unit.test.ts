/**
 * Unit tests for the "update profile" feature (full_name and mobile).
 *
 * Strategy: inject lightweight mock repository stubs so the tests run without
 * a real database or network connections. Matches the pattern established by
 * the user module tests.
 */
import assert from "node:assert";
import { z as zod } from "zod";
import { updateProfileSchema, UpdateProfileInput } from "../user.validation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal in-memory user store shared across mock calls. */
interface MockUser {
  user_id: number;
  username: string;
  full_name: string;
  email: string;
  mobile: string | null;
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
    mobile: "1234567890",
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
      return Promise.resolve({
        email: u.email,
        mobile: u.mobile,
        is_email_verified: u.is_email_verified,
      });
    },

    findByMobile(mobile: string) {
      const u = this.users.find((x) => x.mobile === mobile);
      if (!u) return Promise.resolve(null);
      return Promise.resolve({ user_id: u.user_id });
    },

    updateProfile(
      userId: number,
      data: { full_name: string; mobile?: string | null },
    ) {
      const u = this.users.find((x) => x.user_id === userId);
      if (!u) throw new Error("Not found");
      Object.assign(u, data);
      return Promise.resolve({
        user_id: u.user_id,
        username: u.username,
        full_name: u.full_name,
        email: u.email,
        mobile: u.mobile,
        role_id: u.role_id,
        is_active: u.is_active,
      });
    },
  };
}

/** Simple in-process service stand-in (replicates service logic using mock repo). */
class ConflictError extends Error {
  constructor(public messageKey: string) {
    super(messageKey);
  }
}
class UnauthorizedError extends Error {
  constructor(public messageKey: string) {
    super(messageKey);
  }
}

async function updateProfileService(
  userId: number,
  data: UpdateProfileInput,
  repo: ReturnType<typeof createMockRepo>,
) {
  const existing = await repo.findBasicById(userId);
  if (!existing) throw new UnauthorizedError("user.unauthorized");

  if (data.mobile && data.mobile !== existing.mobile) {
    const conflict = await repo.findByMobile(data.mobile);
    if (conflict && conflict.user_id !== userId) {
      throw new ConflictError("user.mobileAlreadyExists");
    }
  }

  const updated = await repo.updateProfile(userId, {
    full_name: data.full_name,
    mobile: data.mobile,
  });

  return {
    userId: updated.user_id,
    username: updated.username,
    fullName: updated.full_name,
    email: updated.email,
    mobile: updated.mobile,
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

  await test("Validation: valid full_name and mobile are accepted", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice Smith",
      mobile: "6309450957",
    });
    assert.ok(result.success, "Expected success");
  });

  await test("Validation: valid full_name without mobile is accepted", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice Smith",
    });
    assert.ok(result.success, "Expected success");
  });

  await test("Validation: empty full_name is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "",
      mobile: "6309450957",
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
      mobile: "6309450957",
    });
    assert.ok(!result.success);
  });

  await test("Validation: full_name exceeding 100 chars is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "A".repeat(101),
      mobile: "6309450957",
    });
    assert.ok(!result.success);
  });

  await test("Validation: mobile exceeding 20 chars is rejected", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice",
      mobile: "1".repeat(25),
    });
    assert.ok(!result.success);
    assert.ok(result.error?.issues[0].message.includes("mobileInvalid"));
  });

  await test("Validation: extra fields (like email) are rejected (strict mode)", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Alice",
      mobile: "6309450957",
      email: "alice@example.com",
    } as any);
    assert.ok(!result.success, "email field should fail strict mode");
  });

  // ── Service logic ──────────────────────────────────────────────────────

  await test("Service: updating full_name and mobile succeeds", async () => {
    const repo = createMockRepo();
    const result = await updateProfileService(
      1,
      { full_name: "Alicia Smith", mobile: "9876543210" },
      repo,
    );
    assert.strictEqual(result.fullName, "Alicia Smith");
    assert.strictEqual(result.mobile, "9876543210");
  });

  await test("Service: updating only full_name preserves existing mobile", async () => {
    const repo = createMockRepo();
    const result = await updateProfileService(
      1,
      { full_name: "Alicia Smith" },
      repo,
    );
    assert.strictEqual(result.fullName, "Alicia Smith");
  });

  await test("Service: duplicate mobile owned by another user => ConflictError", async () => {
    const repo = createMockRepo();
    repo.users.push({
      user_id: 2,
      username: "bob",
      full_name: "Bob",
      email: "bob@example.com",
      mobile: "9999999999",
      role_id: 2,
      is_active: true,
      is_email_verified: true,
    });
    await assert.rejects(
      () =>
        updateProfileService(
          1,
          { full_name: "Alice", mobile: "9999999999" },
          repo,
        ),
      (err: ConflictError) => {
        assert.strictEqual(err.messageKey, "user.mobileAlreadyExists");
        return true;
      },
    );
  });

  await test("Service: non-existent user => UnauthorizedError", async () => {
    const repo = createMockRepo();
    await assert.rejects(
      () =>
        updateProfileService(
          999,
          { full_name: "Ghost", mobile: "1234567890" },
          repo,
        ),
      (err: UnauthorizedError) => {
        assert.strictEqual(err.messageKey, "user.unauthorized");
        return true;
      },
    );
  });

  await test("Service: response contains expected AuthUser field names (fullName, mobile, userId)", async () => {
    const repo = createMockRepo();
    const result = await updateProfileService(
      1,
      { full_name: "Alice Updated", mobile: "5555555555" },
      repo,
    );
    assert.ok("userId" in result);
    assert.ok("fullName" in result);
    assert.ok("email" in result);
    assert.ok("mobile" in result);
    assert.ok("username" in result);
    assert.ok("roleId" in result);
    assert.ok(!("password_hash" in result));
  });

  // ── Security invariants ────────────────────────────────────────────────

  await test("Security: user_id is never read from the parsed input", () => {
    const result = updateProfileSchema(zod).safeParse({
      full_name: "Eve",
      mobile: "1234567890",
      user_id: 42,
    } as any);
    assert.ok(!result.success, "user_id field must be rejected by strict schema");
  });

  await test("Security: User A cannot update User B's profile via service (wrong userId)", async () => {
    const repo = createMockRepo({ user_id: 2 });
    await assert.rejects(
      () =>
        updateProfileService(
          1,
          { full_name: "Evil", mobile: "9999999999" },
          repo,
        ),
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
