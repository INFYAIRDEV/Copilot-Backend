import assert from "node:assert";
import { z } from "zod";
import {
  updateProfileSchema,
  UpdateProfileInput,
} from "../src/modules/user/user.validation.js";

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

async function runUserProfileTests() {
  console.log("==================================================");
  console.log(" FEATURE: USER PROFILE MANAGEMENT TESTS            ");
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

  await test("Profile Validation: Valid full_name and mobile are accepted", () => {
    const result = updateProfileSchema(z).safeParse({
      full_name: "Alice Smith",
      mobile: "6309450957",
    });
    assert.strictEqual(result.success, true);
  });

  await test("Profile Validation: full_name min 2 chars, max 100 chars", () => {
    const shortName = updateProfileSchema(z).safeParse({ full_name: "A" });
    assert.strictEqual(shortName.success, false);

    const emptyName = updateProfileSchema(z).safeParse({ full_name: "" });
    assert.strictEqual(emptyName.success, false);

    const longName = updateProfileSchema(z).safeParse({ full_name: "A".repeat(101) });
    assert.strictEqual(longName.success, false);
  });

  await test("Profile Validation: Reject unexpected properties in strict mode", () => {
    const injected = updateProfileSchema(z).safeParse({
      full_name: "Alice Smith",
      email: "hacked@example.com",
    });
    assert.strictEqual(injected.success, false);
  });

  await test("Profile Service: Update succeeds and updates name & mobile", async () => {
    const repo = createMockRepo();
    const result = await updateProfileService(
      1,
      { full_name: "Alice Updated", mobile: "9876543210" },
      repo,
    );
    assert.strictEqual(result.fullName, "Alice Updated");
    assert.strictEqual(result.mobile, "9876543210");
  });

  await test("Profile Service: Duplicate mobile in use by another user throws ConflictError", async () => {
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
      () => updateProfileService(1, { full_name: "Alice", mobile: "9999999999" }, repo),
      (err: ConflictError) => {
        assert.strictEqual(err.messageKey, "user.mobileAlreadyExists");
        return true;
      },
    );
  });

  await test("Profile Security: User cannot update non-existent profile", async () => {
    const repo = createMockRepo();
    await assert.rejects(
      () => updateProfileService(999, { full_name: "Ghost" }, repo),
      (err: UnauthorizedError) => {
        assert.strictEqual(err.messageKey, "user.unauthorized");
        return true;
      },
    );
  });

  console.log("==================================================");
  console.log(` USER PROFILE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================\n");
}

runUserProfileTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
