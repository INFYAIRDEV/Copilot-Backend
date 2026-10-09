import assert from "node:assert";
import { createCopilotService } from "../copilot.service.js";
import { ContextService } from "../context.service.js";
import { createMockConversationRepository } from "./test-utils.js";
import { message_kind, message_role, conversation_state } from "@prisma/client";
import { CopilotError } from "../copilot.error.js";

async function runContextIntegrationTests() {
  console.log("==================================================");
  console.log("      COPILOT CONTEXT INTEGRATION TESTS           ");
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

  // 1. Context persisted after valid analytical turn
  await test("Integration: Context is persisted after a valid analytical turn", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    const result = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy in Q2",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
        period: { type: "QUARTER", value: "Q2" },
      },
    });

    assert.ok(result.analyticalContext);
    assert.deepStrictEqual(result.analyticalContext.metricRefs, [
      "sales_total",
    ]);
    assert.deepStrictEqual(result.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(result.analyticalContext.period?.value, "Q2");
    assert.strictEqual(result.analyticalContext.version, 2);

    // Verify persisted directly in repo
    const loaded = await service.getAnalyticalContext(
      1,
      conv.conversation_uuid,
    );
    assert.deepStrictEqual(loaded.context.metricRefs, ["sales_total"]);
    assert.strictEqual(loaded.version, 2);
  });

  // 2. Context retrieved for next follow-up and inherited
  await test("Integration: Context is retrieved for follow-up and inherits established properties", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1
    await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy in Q2",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
        period: { type: "QUARTER", value: "Q2" },
      },
    });

    // Turn 2: Follow-up question adding comparison
    const result2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Compare it with Q1",
      },
      candidateContextUpdate: {
        comparison: { type: "EXPLICIT", value: "Q1" },
      },
    });

    assert.deepStrictEqual(result2.analyticalContext.metricRefs, [
      "sales_total",
    ]);
    assert.deepStrictEqual(result2.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(result2.analyticalContext.period?.value, "Q2");
    assert.strictEqual(result2.analyticalContext.comparison?.value, "Q1");
    assert.strictEqual(result2.analyticalContext.version, 3);
  });

  // 3. Explicit changes override appropriate context property
  await test("Integration: Explicit follow-up changes override matching context property", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1: Period Q2
    await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy in Q2",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
        period: { type: "QUARTER", value: "Q2" },
      },
    });

    // Turn 2: Now show Q3
    const result2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Now show Q3",
      },
      candidateContextUpdate: {
        period: { type: "QUARTER", value: "Q3" },
      },
    });

    assert.deepStrictEqual(result2.analyticalContext.metricRefs, [
      "sales_total",
    ]);
    assert.deepStrictEqual(result2.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(result2.analyticalContext.period?.value, "Q3");
    assert.strictEqual(result2.analyticalContext.version, 3);
  });

  // 4. Unresolved clarification does not corrupt existing context
  await test("Integration: Unresolved clarification request does not corrupt existing context", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1: Establish context
    await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
      },
    });

    // Turn 2: Ambiguous question requiring clarification
    const result2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show the order value",
      },
      aiProcessor: async () => ({
        kind: message_kind.CLARIFICATION_REQUEST,
        text: "Do you mean net sales or gross booked order value?",
      }),
    });

    // Existing context must remain untouched
    assert.deepStrictEqual(result2.analyticalContext.metricRefs, [
      "sales_total",
    ]);
    assert.deepStrictEqual(result2.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(result2.analyticalContext.version, 2); // Not incremented

    const loaded = await service.getAnalyticalContext(
      1,
      conv.conversation_uuid,
    );
    assert.deepStrictEqual(loaded.context.metricRefs, ["sales_total"]);
    assert.strictEqual(loaded.version, 2);
  });

  // 5. Invalid candidate plans are not persisted as authoritative context
  await test("Integration: Invalid candidate plan is rejected and not persisted", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Initial valid turn
    await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1-key",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
      },
    });

    // Invalid turn proposing uncertified metric
    let threw = false;
    try {
      await service.processConversationTurn({
        userId: 1,
        conversationUuid: conv.conversation_uuid,
        idempotencyKey: "turn-2-key",
        message: {
          kind: message_kind.QUESTION,
          text: "Show unknown fake metric",
        },
        candidateContextUpdate: {
          metrics: ["fraudulent_metric_123"],
        },
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, "INVALID_ANALYTICAL_CONTEXT");
    }
    assert.ok(threw, "Must reject invalid context update");

    // Authoritative context remains the previous valid state
    const current = await service.getAnalyticalContext(
      1,
      conv.conversation_uuid,
    );
    assert.deepStrictEqual(current.context.metricRefs, ["sales_total"]);
    assert.strictEqual(current.version, 2);
  });

  // 6. Optimistic concurrency conflict prevents race conditions
  await test("Integration: Stale conversation version rejected with 409 CONVERSATION_VERSION_CONFLICT", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Update with expected version 1 -> succeeds, version becomes 2
    await service.updateAnalyticalContext(1, conv.conversation_uuid, 1, {
      metrics: ["sales"],
    });

    // Concurrent request attempts to update using stale version 1
    let threw = false;
    try {
      await service.updateAnalyticalContext(1, conv.conversation_uuid, 1, {
        metrics: ["orders"],
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 409);
      assert.strictEqual(err.code, "CONVERSATION_VERSION_CONFLICT");
    }
    assert.ok(threw, "Must throw 409 on version mismatch");
  });

  // 7. Deleted/unauthorized conversations cannot expose context
  await test("Integration: Deleted conversation cannot expose or update context", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Delete conversation
    const stored = await repo.findById(1);
    if (stored) {
      stored.state = conversation_state.DELETED;
      stored.deleted_at = new Date();
    }

    let threw = false;
    try {
      await service.getAnalyticalContext(1, conv.conversation_uuid);
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw);
  });

  console.log("==================================================");
  console.log(` CONTEXT INTEGRATION TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runContextIntegrationTests().catch((err) => {
  console.error("Context integration tests failed:", err);
  process.exit(1);
});
