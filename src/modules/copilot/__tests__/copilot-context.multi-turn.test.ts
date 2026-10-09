import assert from "node:assert";
import { createCopilotService } from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";
import { message_kind, message_role } from "@prisma/client";

async function runContextMultiTurnTests() {
  console.log("==================================================");
  console.log("       COPILOT CONTEXT MULTI-TURN TESTS           ");
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

  // Scenario 1: Sales for Italy in Q2 -> Compare with Q1
  await test("Multi-Turn Scenario 1: 'Show sales for Italy in Q2' -> 'Compare it with Q1'", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1
    const turn1 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy in Q2.",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
        period: { type: "QUARTER", value: "q2" },
      },
      aiProcessor: async () => ({
        text: "Here are the sales figures for Italy in Q2.",
      }),
    });

    assert.deepStrictEqual(turn1.analyticalContext.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(turn1.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(turn1.analyticalContext.period?.value, "Q2");
    assert.strictEqual(turn1.analyticalContext.comparison, null);

    // Turn 2: Follow-up question
    const turn2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2",
      message: {
        kind: message_kind.QUESTION,
        text: "Compare it with Q1.",
      },
      candidateContextUpdate: {
        comparison: { type: "EXPLICIT", value: "q1" },
      },
      aiProcessor: async () => ({
        text: "Here is the comparison with Q1 for sales in Italy.",
      }),
    });

    // Verification: Existing metric and Italy filter retained. Comparison period becomes Q1.
    assert.deepStrictEqual(turn2.analyticalContext.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(turn2.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(turn2.analyticalContext.period?.value, "Q2");
    assert.strictEqual(turn2.analyticalContext.comparison?.value, "Q1");
  });

  // Scenario 2: Show delayed orders -> Group them by customer
  await test("Multi-Turn Scenario 2: 'Show delayed orders.' -> 'Group them by customer.'", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1
    const turn1 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show delayed orders.",
      },
      candidateContextUpdate: {
        metrics: ["delayed_orders"],
      },
      aiProcessor: async () => ({
        text: "Found 42 delayed orders across all accounts.",
      }),
    });

    assert.deepStrictEqual(turn1.analyticalContext.metricRefs, [
      "delayed_orders",
    ]);
    assert.deepStrictEqual(turn1.analyticalContext.groupBy, []);

    // Turn 2
    const turn2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2",
      message: {
        kind: message_kind.QUESTION,
        text: "Group them by customer.",
      },
      candidateContextUpdate: {
        groupBy: ["customer"],
      },
      aiProcessor: async () => ({
        text: "Here are the delayed orders broken down by customer.",
      }),
    });

    // Verification: Delayed-order analytical meaning retained. Grouping changes to customer.
    assert.deepStrictEqual(turn2.analyticalContext.metricRefs, [
      "delayed_orders",
    ]);
    assert.deepStrictEqual(turn2.analyticalContext.groupBy, ["customer"]);
  });

  // Scenario 3: Show sales -> Clarification: Which sales do you mean?
  await test("Multi-Turn Scenario 3: Clarification preserves context untouched until resolved", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1);

    // Turn 1: Establish base sales context
    const turn1 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales.",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "IT" }],
      },
      aiProcessor: async () => ({
        text: "Displaying total sales for IT.",
      }),
    });

    const baselineContext = turn1.analyticalContext;
    assert.deepStrictEqual(baselineContext.metricRefs, ["sales_total"]);
    assert.strictEqual(baselineContext.version, 2);

    // Turn 2: Ambiguous input -> System issues clarification request
    const turn2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2",
      message: {
        kind: message_kind.QUESTION,
        text: "Show the new sales.",
      },
      aiProcessor: async () => ({
        kind: message_kind.CLARIFICATION_REQUEST,
        text: "Which sales do you mean? Total sales, recurring revenue, or booked orders?",
      }),
    });

    // Verification: Existing context remains completely unchanged until clarification is resolved.
    assert.deepStrictEqual(turn2.analyticalContext.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(turn2.analyticalContext.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(turn2.analyticalContext.version, 2);

    // Turn 3: User clarifies
    const turn3 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-3",
      message: {
        kind: message_kind.CLARIFICATION_REPLY,
        text: "I mean total sales.",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
      },
      aiProcessor: async () => ({
        text: "Understood. Showing confirmed total sales.",
      }),
    });

    assert.deepStrictEqual(turn3.analyticalContext.metricRefs, ["sales_total"]);
    assert.strictEqual(turn3.analyticalContext.version, 3);
  });

  // Scenario 4: Presentation language switching without altering analytical plan
  await test("Multi-Turn Scenario 4: 'Show sales in English.' -> 'Mostrami gli stessi dati in italiano.'", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, "en" as any);

    // Turn 1: English
    const turn1 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales for Italy in Q2.",
        locale: "en",
      },
      candidateContextUpdate: {
        metrics: ["sales"],
        filters: [{ field: "country", operator: "=", value: "italy" }],
        period: { type: "QUARTER", value: "q2" },
      },
      aiProcessor: async () => ({
        text: "Here is your sales data for Italy in Q2.",
      }),
    });

    assert.strictEqual(turn1.userMessage.locale, "en");
    const enPlan = turn1.analyticalContext;

    // Turn 2: Switch language to Italian, ask for same data
    const turn2 = await service.processConversationTurn({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "turn-2",
      message: {
        kind: message_kind.QUESTION,
        text: "Mostrami gli stessi dati in italiano.",
        locale: "it",
      },
      candidateContextUpdate: {
        metrics: ["vendite"],
        filters: [{ field: "paese", operator: "=", value: "italia" }],
        period: { type: "QUARTER", value: "q2" },
      },
      aiProcessor: async () => ({
        text: "Ecco i dati di vendita per l'Italia nel secondo trimestre.",
      }),
    });

    assert.strictEqual(turn2.userMessage.locale, "it");
    const itPlan = turn2.analyticalContext;

    // Verification: Presentation language changes without changing the analytical plan.
    assert.deepStrictEqual(itPlan.metricRefs, enPlan.metricRefs);
    assert.deepStrictEqual(itPlan.filters, enPlan.filters);
    assert.deepStrictEqual(itPlan.period, enPlan.period);
    assert.deepStrictEqual(itPlan.dimensionRefs, enPlan.dimensionRefs);
    assert.strictEqual(itPlan.metricRefs[0], "sales_total");
    assert.strictEqual(itPlan.filters[0].field, "country");
    assert.strictEqual(itPlan.filters[0].value, "IT");
  });

  console.log("==================================================");
  console.log(` CONTEXT MULTI-TURN TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runContextMultiTurnTests().catch((err) => {
  console.error("Context multi-turn tests failed:", err);
  process.exit(1);
});
