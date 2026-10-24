import assert from "node:assert";
import {
  defaultUsageCalculator,
  DEFAULT_MODEL_PRICING,
} from "../src/modules/ai/usage/ai-usage.calculator.js";
import { getMonthlyTokenLimit } from "../src/modules/copilot/ai-usage.service.js";

async function runAiUsageQuotaTests() {
  console.log("==================================================");
  console.log(" FEATURE: AI USAGE, TOKEN TRACKING & QUOTA TESTS   ");
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

  // 1. Monthly Token Limits
  await test("Monthly Token Limit: Returns default 1,000,000 allowance when env unset", () => {
    const prev = process.env.COPILOT_MONTHLY_TOKEN_LIMIT;
    delete process.env.COPILOT_MONTHLY_TOKEN_LIMIT;
    try {
      const limit = getMonthlyTokenLimit();
      assert.strictEqual(limit, 1_000_000);
    } finally {
      if (prev) process.env.COPILOT_MONTHLY_TOKEN_LIMIT = prev;
    }
  });

  await test("Monthly Token Limit: Respects custom env limit override", () => {
    const prev = process.env.COPILOT_MONTHLY_TOKEN_LIMIT;
    process.env.COPILOT_MONTHLY_TOKEN_LIMIT = "500000";
    try {
      const limit = getMonthlyTokenLimit();
      assert.strictEqual(limit, 500_000);
    } finally {
      if (prev) process.env.COPILOT_MONTHLY_TOKEN_LIMIT = prev;
      else delete process.env.COPILOT_MONTHLY_TOKEN_LIMIT;
    }
  });

  // 2. Token Cost Calculation
  await test("Usage Calculator: Calculates financial cost based on model pricing table", () => {
    const model = "gemini-1.5-flash";
    const pricing = DEFAULT_MODEL_PRICING[model];
    assert.ok(pricing, "Must have pricing configuration for gemini-1.5-flash");

    const cost = defaultUsageCalculator.calculateCost("google", model, 1_000_000, 500_000);
    assert.ok(cost > 0, "Cost must be greater than zero");
    assert.strictEqual(typeof cost, "number");
  });

  // 3. Summary Aggregation
  await test("Usage Calculator: calculateSummary computes total tokens, cost and success metrics", () => {
    const summary = defaultUsageCalculator.calculateSummary([
      {
        id: 1,
        requestUuid: "req-1",
        userId: 1,
        provider: "google",
        model: "gemini-1.5-flash",
        endpoint: "/query",
        status: "SUCCESS",
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        estimatedCostUsd: 0.0002,
        latencyMs: 150,
        createdAt: new Date(),
      },
      {
        id: 2,
        requestUuid: "req-2",
        userId: 1,
        provider: "google",
        model: "gemini-1.5-flash",
        endpoint: "/query",
        status: "FAILED",
        inputTokens: 200,
        outputTokens: 0,
        totalTokens: 200,
        estimatedCostUsd: 0.00001,
        latencyMs: 50,
        createdAt: new Date(),
      },
    ]);

    assert.strictEqual(summary.totalRequests, 2);
    assert.strictEqual(summary.successfulRequests, 1);
    assert.strictEqual(summary.failedRequests, 1);
    assert.strictEqual(summary.totalInputTokens, 1200);
    assert.strictEqual(summary.totalOutputTokens, 500);
    assert.strictEqual(summary.totalTokens, 1700);
    assert.strictEqual(summary.averageLatencyMs, 100);
  });

  console.log("==================================================");
  console.log(` AI USAGE & QUOTA TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runAiUsageQuotaTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
