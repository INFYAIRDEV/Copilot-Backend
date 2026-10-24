import assert from "node:assert";
import {
  ContextService,
  resolveCanonicalTerm,
} from "../src/modules/copilot/context.service.js";
import {
  createDefaultAnalyticalContext,
  FORBIDDEN_CONTEXT_KEYS,
} from "../src/modules/copilot/context.types.js";
import { createMockConversationRepository } from "../src/modules/copilot/__tests__/test-utils.js";

async function runCopilotContextTests() {
  console.log("==================================================");
  console.log(" FEATURE: COPILOT CONTEXT ASSEMBLY & HISTORY TESTS");
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

  // 1. Canonical Term Mapping & Resolution
  await test("Canonical Mapping: Maps Italian and English metric synonyms correctly", () => {
    assert.strictEqual(resolveCanonicalTerm("vendite"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("sales"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("revenue"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("ordini"), "orders_count");
    assert.strictEqual(resolveCanonicalTerm("delayed_orders"), "delayed_orders");
    assert.strictEqual(resolveCanonicalTerm("italy"), "IT");
    assert.strictEqual(resolveCanonicalTerm("germania"), "DE");
  });

  // 2. Default Analytical Context
  await test("Default Context: Generates clean normalized context structure", () => {
    const defaultCtx = createDefaultAnalyticalContext();
    assert.strictEqual(defaultCtx.metricRefs.length, 0);
    assert.strictEqual(defaultCtx.dimensionRefs.length, 0);
    assert.strictEqual(defaultCtx.filters.length, 0);
    assert.strictEqual(defaultCtx.period, null);
    assert.strictEqual(defaultCtx.version, 1);
  });

  // 3. Forbidden Keys Guard
  await test("Context Security: Prohibits sensitive keys in context updates", () => {
    assert.ok(FORBIDDEN_CONTEXT_KEYS.includes("password"));
    assert.ok(FORBIDDEN_CONTEXT_KEYS.includes("token"));
    assert.ok(FORBIDDEN_CONTEXT_KEYS.includes("secret"));
    assert.ok(FORBIDDEN_CONTEXT_KEYS.includes("raw_sql"));
  });

  // 4. Multi-turn Context Merging
  await test("Context Merge: Updates metrics and preserves untouched dimensions", () => {
    const repo = createMockConversationRepository();
    const service = new ContextService(repo as any);

    const initial = createDefaultAnalyticalContext();
    initial.dimensionRefs = ["customer"];
    initial.period = "Q3";

    const update = {
      metrics: ["sales_total"],
      isReset: false,
    };

    const merged = service.mergeContext(initial, update as any);
    assert.deepStrictEqual(merged.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(merged.dimensionRefs, ["customer"]);
    assert.strictEqual(merged.period, "Q3");
  });

  // 5. Context Reset
  await test("Context Reset: Full reset clears inherited fields", () => {
    const repo = createMockConversationRepository();
    const service = new ContextService(repo as any);

    const initial = createDefaultAnalyticalContext();
    initial.metricRefs = ["sales_total"];
    initial.dimensionRefs = ["customer"];

    const resetUpdate = {
      isReset: true,
      metrics: ["orders_count"],
    };

    const merged = service.mergeContext(initial, resetUpdate as any);
    assert.deepStrictEqual(merged.metricRefs, ["orders_count"]);
    assert.strictEqual(merged.dimensionRefs.length, 0);
  });

  // 6. Clarification Gate preserves context
  await test("Clarification Gate: Leaves existing analytical context unmodified", () => {
    const repo = createMockConversationRepository();
    const service = new ContextService(repo as any);

    const initial = createDefaultAnalyticalContext();
    initial.metricRefs = ["sales_total"];

    const preserved = service.handleClarification(initial, "CLARIFICATION_REQUEST");
    assert.deepStrictEqual(preserved, initial);
  });

  console.log("==================================================");
  console.log(` COPILOT CONTEXT TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runCopilotContextTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
