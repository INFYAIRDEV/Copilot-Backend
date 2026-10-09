import assert from "node:assert";
import { createCopilotService } from "../copilot.service.js";
import { ContextService } from "../context.service.js";
import { createMockConversationRepository } from "./test-utils.js";
import { message_kind } from "@prisma/client";
import { CopilotError } from "../copilot.error.js";
import { FORBIDDEN_CONTEXT_KEYS } from "../context.types.js";

async function runContextSecurityTests() {
  console.log("==================================================");
  console.log("        COPILOT CONTEXT SECURITY TESTS            ");
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

  // 1. Cross-user context isolation
  await test("Security: User A cannot retrieve User B's analytical context (403 COPILOT_PERMISSION_DENIED)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const convUserB = await repo.create(200); // Owned by user 200

    let threw = false;
    try {
      await service.getAnalyticalContext(100, convUserB.conversation_uuid); // User 100 requesting
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must reject cross-user context retrieval");
  });

  await test("Security: User A cannot update User B's analytical context (403 COPILOT_PERMISSION_DENIED)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const convUserB = await repo.create(200);

    let threw = false;
    try {
      await service.updateAnalyticalContext(
        100,
        convUserB.conversation_uuid,
        1,
        {
          metrics: ["sales"],
        },
      );
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must reject cross-user context update");
  });

  // 2. Client cannot inject authorization scope into context
  await test("Security: Context rejects injection of authorization/security scope keys", () => {
    const service = new ContextService();

    for (const forbiddenKey of FORBIDDEN_CONTEXT_KEYS) {
      const maliciousPayload = {
        metricRefs: ["sales_total"],
        dimensionRefs: [],
        filters: [],
        groupBy: [],
        sort: [],
        version: 1,
        [forbiddenKey]: "admin_superuser_all_access",
      };

      const res = service.validateContext(maliciousPayload as any, {
        userId: 1,
        roleId: "user",
      });
      assert.strictEqual(
        res.isValid,
        false,
        `Forbidden key '${forbiddenKey}' must fail validation`,
      );
    }
  });

  // 3. LLM output cannot modify server-owned authorization fields or bypass role policies
  await test("Security: Operator role cannot access executive metrics via candidate context", () => {
    const service = new ContextService();
    const executiveContext = {
      metricRefs: ["executive_cost_margin"],
      dimensionRefs: ["country"],
      filters: [],
      groupBy: [],
      sort: [],
      version: 1,
    };

    const res = service.validateContext(executiveContext as any, {
      userId: 42,
      roleId: "operator", // Role cannot view executive margin
    });

    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) =>
        e.includes("cannot access 'executive_cost_margin'"),
      ),
    );
  });

  // 4. SQL statements cannot be persisted as context
  await test("Security: Raw SQL statements in filters or fields are rejected", () => {
    const service = new ContextService();
    const sqlInjectionContext = {
      metricRefs: ["sales_total"],
      dimensionRefs: [],
      filters: [
        {
          field: "country",
          operator: "=",
          value: "IT'; DROP TABLE conversation; --",
        },
      ],
      groupBy: [],
      sort: [],
      version: 1,
    };

    const res = service.validateContext(sqlInjectionContext as any, {
      userId: 1,
      roleId: "user",
    });

    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) =>
        e.includes("Raw SQL statements are strictly forbidden"),
      ),
    );
  });

  // 5. Credentials/secrets cannot be persisted in context
  await test("Security: Injected passwords, API keys, or tokens in context are rejected", () => {
    const service = new ContextService();
    const credentialsContext = {
      metricRefs: ["sales_total"],
      dimensionRefs: [],
      filters: [],
      groupBy: [],
      sort: [],
      version: 1,
      password: "secret_db_password_123",
    };

    const res = service.validateContext(credentialsContext as any, {
      userId: 1,
      roleId: "user",
    });

    assert.strictEqual(res.isValid, false);
  });

  // 6. Raw provider payloads or unrestricted business result rows are not persisted
  await test("Security: Context cannot be hijacked to store raw database result sets", () => {
    const service = new ContextService();
    const dirtyContext = {
      metricRefs: ["sales_total"],
      dimensionRefs: [],
      filters: [],
      groupBy: [],
      sort: [],
      version: 1,
      raw_dataset_rows: [
        { customer_id: 1, balance: 1000000 },
        { customer_id: 2, balance: 2500000 },
      ],
    };

    const res = service.validateContext(dirtyContext as any, {
      userId: 1,
      roleId: "user",
    });

    assert.strictEqual(res.isValid, false);
  });

  console.log("==================================================");
  console.log(` CONTEXT SECURITY TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runContextSecurityTests().catch((err) => {
  console.error("Context security tests failed:", err);
  process.exit(1);
});
