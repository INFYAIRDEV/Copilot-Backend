import assert from "node:assert";
import dotenv from "dotenv";
dotenv.config();

import {
  initAiUsageTable,
  recordAiTokenUsage,
  getUserTokenUsage,
  assertUserMonthlyQuota,
} from "../ai-usage.service.js";
import { generateAccessToken } from "../../../shared/utils/jwt.js";
import { prisma } from "../../../shared/utils/prismaClient.js";

async function runTokenUsageTests() {
  console.log("==================================================");
  console.log("      RUNNING AI TOKEN USAGE & QUOTA TESTS        ");
  console.log("==================================================");

  const testUserId = 99999;
  const req1 = `test-req-1-${Date.now()}`;
  const req2 = `test-req-2-${Date.now()}`;

  try {
    // Clean up any preexisting test data for this test user
    await initAiUsageTable();
    await prisma.$executeRawUnsafe(
      "DELETE FROM public.ai_token_usage WHERE user_id = $1",
      testUserId,
    );

    // ----------------------------------------------------
    // TEST 1: Table Initialization & Baseline Usage
    // ----------------------------------------------------
    console.log("\n--- TEST 1: Baseline Token Usage (Zero state) ---");
    const baseline = await getUserTokenUsage(testUserId);
    console.log("Baseline usage:", baseline);
    assert.strictEqual(baseline.used, 0, "Initial used tokens should be 0");
    assert.strictEqual(baseline.limit, 1000000, "Default monthly limit should be 1,000,000");
    assert.strictEqual(baseline.remaining, 1000000, "Remaining tokens should equal limit");
    assert.strictEqual(baseline.percentUsed, 0, "Percent used should be 0%");
    assert.ok(baseline.resetAt, "resetAt must be defined");
    console.log("✔ [PASS] Baseline token usage verified");

    // ----------------------------------------------------
    // TEST 2: Record Token Usage (/v1/query/generate)
    // ----------------------------------------------------
    console.log("\n--- TEST 2: Record Token Usage for /v1/query/generate ---");
    await recordAiTokenUsage({
      userId: testUserId,
      requestId: req1,
      endpoint: "/v1/query/generate",
      usage: {
        modelCalls: 1,
        inputTokens: 2711,
        outputTokens: 145,
        thoughtTokens: 0,
        totalTokens: 2856,
      },
    });

    const afterGen = await getUserTokenUsage(testUserId);
    console.log("Usage after query generation:", afterGen);
    assert.strictEqual(afterGen.used, 2856, "Used tokens should be 2856");
    assert.strictEqual(afterGen.remaining, 1000000 - 2856, "Remaining tokens correctly reduced");
    console.log("✔ [PASS] /v1/query/generate token consumption recorded");

    // ----------------------------------------------------
    // TEST 3: Idempotency (Retry should not count twice)
    // ----------------------------------------------------
    console.log("\n--- TEST 3: Idempotency check on retries ---");
    await recordAiTokenUsage({
      userId: testUserId,
      requestId: req1,
      endpoint: "/v1/query/generate",
      usage: {
        modelCalls: 1,
        inputTokens: 2711,
        outputTokens: 145,
        thoughtTokens: 0,
        totalTokens: 2856,
      },
    });

    const afterRetry = await getUserTokenUsage(testUserId);
    assert.strictEqual(afterRetry.used, 2856, "Retrying same (request_id, endpoint) must NOT add duplicate tokens");
    console.log("✔ [PASS] Idempotency constraint verified: duplicate calls ignored");

    // ----------------------------------------------------
    // TEST 4: Record Token Usage (/v1/result/interpret)
    // ----------------------------------------------------
    console.log("\n--- TEST 4: Record Token Usage for /v1/result/interpret ---");
    await recordAiTokenUsage({
      userId: testUserId,
      requestId: req1,
      endpoint: "/v1/result/interpret",
      usage: {
        modelCalls: 1,
        inputTokens: 1000,
        outputTokens: 500,
        thoughtTokens: 50,
        totalTokens: 1550,
      },
    });

    const afterInterpret = await getUserTokenUsage(testUserId);
    console.log("Usage after result interpretation:", afterInterpret);
    assert.strictEqual(afterInterpret.used, 2856 + 1550, "Used tokens should sum both endpoints");
    assert.strictEqual(afterInterpret.remaining, 1000000 - (2856 + 1550));
    console.log("✔ [PASS] Total tokens accurately aggregated across endpoints");

    // ----------------------------------------------------
    // TEST 5: Monthly Quota Enforcement
    // ----------------------------------------------------
    console.log("\n--- TEST 5: Monthly Quota Enforcement Gate ---");
    // Should pass when quota remains
    const allowed = await assertUserMonthlyQuota(testUserId);
    assert.ok(allowed.remaining > 0, "Quota check should allow requests when balance > 0");

    // Artificially exceed quota by inserting an entry consuming the balance
    await recordAiTokenUsage({
      userId: testUserId,
      requestId: req2,
      endpoint: "/v1/query/generate",
      usage: {
        totalTokens: 1000000,
      },
    });

    let rejected = false;
    try {
      await assertUserMonthlyQuota(testUserId);
    } catch (err: any) {
      rejected = true;
      assert.strictEqual(err.statusCode, 429, "Error status code must be 429");
      assert.strictEqual(err.code, "USAGE_LIMIT_EXCEEDED", "Error code must be USAGE_LIMIT_EXCEEDED");
      console.log("Quota rejection caught as expected:", err.message);
    }
    assert.strictEqual(rejected, true, "Exhausted quota must reject request");
    console.log("✔ [PASS] Monthly quota gate correctly rejects over-quota requests with 429");

    // ----------------------------------------------------
    // TEST 6: HTTP Endpoint GET /api/v1/copilot/usage
    // ----------------------------------------------------
    console.log("\n--- TEST 6: Live HTTP Endpoint GET /api/v1/copilot/usage ---");
    const realUser = await prisma.users.findFirst({ select: { user_id: true } });
    const authUserId = realUser ? realUser.user_id : testUserId;
    const token = generateAccessToken(authUserId);
    const port = process.env.PORT || 8080;
    const res = await fetch(`http://localhost:${port}/api/v1/copilot/usage`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    console.log("HTTP response status:", res.status);
    const json: any = await res.json();
    console.log("HTTP response payload:", json);

    assert.strictEqual(res.status, 200, "GET /api/v1/copilot/usage should return 200");
    assert.strictEqual(json.success, true);
    assert.strictEqual(typeof json.limit, "number");
    assert.strictEqual(typeof json.used, "number");
    assert.strictEqual(typeof json.remaining, "number");
    assert.strictEqual(typeof json.percentUsed, "number");
    assert.ok(json.resetAt, "resetAt must be present");
    console.log("✔ [PASS] Live API endpoint GET /api/v1/copilot/usage successfully verified");

  } finally {
    // Cleanup test data
    await prisma.$executeRawUnsafe(
      "DELETE FROM public.ai_token_usage WHERE user_id = $1",
      testUserId,
    );
    console.log("\n✔ Test cleanup completed successfully.");
    console.log("==================================================");
    console.log("       ALL TOKEN USAGE TESTS PASSED!              ");
    console.log("==================================================");
  }
}

runTokenUsageTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
  });
