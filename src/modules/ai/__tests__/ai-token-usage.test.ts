import assert from "node:assert";
import {
  AIUsageCalculator,
  DEFAULT_MODEL_PRICING,
} from "../usage/ai-usage.calculator.js";
import { AIUsageService, TrackUsageInput } from "../usage/ai-usage.service.js";
import {
  AIUsageRecord,
  AIUsageStatus,
  AIUsageSummary,
  AIUsageAuditMetadata,
} from "../usage/ai-usage.types.js";
import { IAIUsageRepository } from "../usage/ai-usage.repository.js";
import { AIService } from "../services/ai.service.js";
import { MockAIProviderAdapter } from "../adapters/mock-ai-provider.adapter.js";

let passedCount = 0;
let failedCount = 0;

async function runTest(
  description: string,
  fn: () => void | Promise<void>,
): Promise<void> {
  try {
    await fn();
    console.log(`✔ [PASS] ${description}`);
    passedCount++;
  } catch (err) {
    console.error(`✘ [FAIL] ${description}`);
    console.error(err);
    failedCount++;
  }
}

// In-Memory Mock Repository for unit and integration testing
class InMemoryUsageRepository implements IAIUsageRepository {
  public records: AIUsageRecord[] = [];
  public shouldFail: boolean = false;
  public failureError: Error = new Error("Database connection timeout");

  public async create(record: AIUsageRecord): Promise<AIUsageRecord> {
    if (this.shouldFail) {
      throw this.failureError;
    }
    const createdRecord: AIUsageRecord = {
      ...record,
      id: this.records.length + 1,
      createdAt: new Date(),
    };
    this.records.push(createdRecord);
    return createdRecord;
  }

  public async findByRequestUuid(
    requestUuid: string,
  ): Promise<AIUsageRecord[]> {
    return this.records.filter((r) => r.requestUuid === requestUuid);
  }

  public async findMany(filters: any = {}): Promise<AIUsageRecord[]> {
    return this.records.filter((r) => {
      if (filters.requestUuid && r.requestUuid !== filters.requestUuid)
        return false;
      if (filters.provider && r.provider !== filters.provider) return false;
      if (filters.model && r.model !== filters.model) return false;
      if (filters.status && r.status !== filters.status) return false;
      return true;
    });
  }

  public clear(): void {
    this.records = [];
    this.shouldFail = false;
  }
}

async function runAllTests(): Promise<void> {
  console.log("==================================================");
  console.log(" AI Token Usage & Telemetry Test Suite");
  console.log("==================================================\n");

  const mockRepo = new InMemoryUsageRepository();
  const calculator = new AIUsageCalculator();

  // ----------------------------------------------------
  // Category 1: Token Usage Extraction & Normalization
  // ----------------------------------------------------
  await runTest(
    "1.1 Token counts: correctly extracts input, output, and calculates total tokens",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const result = await service.trackUsage({
        requestUuid: "11111111-1111-1111-1111-111111111111",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 1500,
        outputTokens: 350,
        latencyMs: 250,
      });

      assert.strictEqual(result.inputTokens, 1500);
      assert.strictEqual(result.outputTokens, 350);
      assert.strictEqual(result.totalTokens, 1850);
    },
  );

  await runTest(
    "1.2 Token counts: safely handles zero or negative values without corruption",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const result = await service.trackUsage({
        requestUuid: "11111111-1111-1111-1111-111111111111",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: -10 as any,
        outputTokens: 0,
        latencyMs: 100,
      });

      assert.strictEqual(result.inputTokens, 0);
      assert.strictEqual(result.outputTokens, 0);
      assert.strictEqual(result.totalTokens, 0);
    },
  );

  await runTest(
    "1.3 trackFromTelemetry: normalizes provider usage telemetry envelope",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const result = await service.trackFromTelemetry(
        {
          providerName: "google",
          modelName: "gemini-1.5-flash",
          inputTokens: 800,
          outputTokens: 200,
          totalTokens: 1000,
          latencyMs: 310,
          retryCount: 1,
        },
        {
          requestUuid: "22222222-2222-2222-2222-222222222222",
          purpose: "CANDIDATE_PLAN",
          status: "SUCCESS",
        },
      );

      assert.strictEqual(result.provider, "google");
      assert.strictEqual(result.model, "gemini-1.5-flash");
      assert.strictEqual(result.inputTokens, 800);
      assert.strictEqual(result.outputTokens, 200);
      assert.strictEqual(result.totalTokens, 1000);
      assert.strictEqual(result.retryCount, 1);
    },
  );

  // ----------------------------------------------------
  // Category 2: Model Pricing & Estimated Cost Calculation
  // ----------------------------------------------------
  await runTest(
    "2.1 Cost calculation: accurate for Gemini 1.5 Flash ($0.075 / $0.30 per 1M tokens)",
    () => {
      // 1,000,000 input tokens = $0.075, 1,000,000 output tokens = $0.30
      const cost = calculator.calculateCost(
        "google",
        "gemini-1.5-flash",
        1_000_000,
        1_000_000,
      );
      assert.strictEqual(cost, 0.375);

      // Realistic small prompt: 2000 input tokens, 500 output tokens
      // input = 2000 / 1e6 * 0.075 = 0.00015
      // output = 500 / 1e6 * 0.30 = 0.00015
      // total = 0.0003
      const realisticCost = calculator.calculateCost(
        "google",
        "gemini-1.5-flash",
        2000,
        500,
      );
      assert.strictEqual(realisticCost, 0.0003);
    },
  );

  await runTest(
    "2.2 Cost calculation: accurate for Gemini 1.5 Pro ($3.50 / $10.50 per 1M tokens)",
    () => {
      // 10,000 input tokens, 2,000 output tokens
      // input: 10000 / 1e6 * 3.5 = 0.035
      // output: 2000 / 1e6 * 10.5 = 0.021
      // total: 0.056
      const cost = calculator.calculateCost(
        "google",
        "gemini-1.5-pro",
        10_000,
        2_000,
      );
      assert.strictEqual(cost, 0.056);
    },
  );

  await runTest(
    "2.3 Cost calculation: accurate for OpenAI models (gpt-4o and gpt-4o-mini)",
    () => {
      // gpt-4o-mini: 100,000 in, 10,000 out => 0.015 + 0.006 = 0.021
      const costMini = calculator.calculateCost(
        "openai",
        "gpt-4o-mini",
        100_000,
        10_000,
      );
      assert.strictEqual(costMini, 0.021);

      // gpt-4o: 10,000 in, 1,000 out => 0.05 + 0.015 = 0.065
      const cost4o = calculator.calculateCost(
        "openai",
        "gpt-4o",
        10_000,
        1_000,
      );
      assert.strictEqual(cost4o, 0.065);
    },
  );

  await runTest(
    "2.4 Cost calculation: mock and fallback engines compute zero cost",
    () => {
      const mockCost = calculator.calculateCost(
        "mock",
        "mock-model-v1",
        50_000,
        50_000,
      );
      assert.strictEqual(mockCost, 0.0);

      const fallbackCost = calculator.calculateCost(
        "STRUCTURED_FALLBACK",
        "deterministic-template-engine-v1",
        20_000,
        10_000,
      );
      assert.strictEqual(fallbackCost, 0.0);
    },
  );

  await runTest(
    "2.5 Cost calculation: unregistered models safely default to 0.0",
    () => {
      const unregCost = calculator.calculateCost(
        "unknown-vendor",
        "future-model-99",
        5000,
        500,
      );
      assert.strictEqual(unregCost, 0.0);
    },
  );

  await runTest(
    "2.6 Pricing table: supports external custom pricing configuration without code modification",
    () => {
      const customCalc = new AIUsageCalculator({
        "custom-llama-3": {
          provider: "groq",
          model: "llama-3-70b",
          inputCostPerMillion: 0.59,
          outputCostPerMillion: 0.79,
          currency: "USD",
        },
      });

      // 1,000,000 input tokens = $0.59
      const cost = customCalc.calculateCost(
        "groq",
        "llama-3-70b",
        1_000_000,
        0,
      );
      assert.strictEqual(cost, 0.59);
    },
  );

  // ----------------------------------------------------
  // Category 3: Retry Tracking & Multi-Attempt Integrity
  // ----------------------------------------------------
  await runTest(
    "3.1 Retry tracking: initial attempt records retryCount = 0",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const result = await service.trackUsage({
        requestUuid: "33333333-3333-3333-3333-333333333333",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 500,
        outputTokens: 100,
        latencyMs: 180,
        retryCount: 0,
        status: "SUCCESS",
      });

      assert.strictEqual(result.retryCount, 0);
    },
  );

  await runTest(
    "3.2 Retry tracking: retry attempt records retryCount = 1 without overwriting previous attempts",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);
      const requestUuid = "44444444-4444-4444-4444-444444444444";

      // Attempt 1: Failed transiently
      await service.trackUsage({
        requestUuid,
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 600,
        outputTokens: 0,
        latencyMs: 500,
        retryCount: 0,
        status: "FAILED",
      });

      // Attempt 2: Retry succeeded
      await service.trackUsage({
        requestUuid,
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 600,
        outputTokens: 250,
        latencyMs: 400,
        retryCount: 1,
        status: "SUCCESS",
      });

      const records = await service.getUsageByRequestUuid(requestUuid);
      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0].retryCount, 0);
      assert.strictEqual(records[0].status, "FAILED");
      assert.strictEqual(records[1].retryCount, 1);
      assert.strictEqual(records[1].status, "SUCCESS");
    },
  );

  // ----------------------------------------------------
  // Category 4: Operation Statuses & Outcomes
  // ----------------------------------------------------
  await runTest(
    "4.1 Status tracking: distinguishes SUCCESS, FAILED, DEGRADED, and FALLBACK",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const statuses: AIUsageStatus[] = [
        "SUCCESS",
        "FAILED",
        "DEGRADED",
        "FALLBACK",
      ];
      for (const status of statuses) {
        const record = await service.trackUsage({
          requestUuid: `req-status-${status}`,
          provider: "google",
          model: "gemini-1.5-flash",
          inputTokens: 100,
          outputTokens: 50,
          latencyMs: 120,
          status,
        });
        assert.strictEqual(record.status, status);
      }

      assert.strictEqual(mockRepo.records.length, 4);
    },
  );

  // ----------------------------------------------------
  // Category 5: Operational Summary & Cost Per Successful Answer
  // ----------------------------------------------------
  await runTest(
    "5.1 Summary calculation: aggregates tokens, cost, latency, and computes costPerSuccessfulAnswer",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      // Record 1: SUCCESS ($0.000300)
      await service.trackUsage({
        requestUuid: "summary-req-1",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 2000,
        outputTokens: 500,
        latencyMs: 200,
        status: "SUCCESS",
      });

      // Record 2: SUCCESS ($0.000300)
      await service.trackUsage({
        requestUuid: "summary-req-2",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 2000,
        outputTokens: 500,
        latencyMs: 300,
        status: "SUCCESS",
      });

      // Record 3: FAILED ($0.000150)
      await service.trackUsage({
        requestUuid: "summary-req-3",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 2000,
        outputTokens: 0,
        latencyMs: 100,
        status: "FAILED",
      });

      // Record 4: FALLBACK ($0.000000)
      await service.trackUsage({
        requestUuid: "summary-req-4",
        provider: "STRUCTURED_FALLBACK",
        model: "deterministic-template-engine-v1",
        inputTokens: 500,
        outputTokens: 100,
        latencyMs: 20,
        status: "FALLBACK",
      });

      const summary: AIUsageSummary = await service.getUsageSummary();

      assert.strictEqual(summary.totalRequests, 4);
      assert.strictEqual(summary.successfulRequests, 2);
      assert.strictEqual(summary.failedRequests, 1);
      assert.strictEqual(summary.fallbackRequests, 1);
      assert.strictEqual(summary.totalInputTokens, 6500);
      assert.strictEqual(summary.totalOutputTokens, 1100);
      assert.strictEqual(summary.totalTokens, 7600);
      // Cost: 0.0003 + 0.0003 + 0.00015 + 0 = 0.00075
      assert.strictEqual(summary.totalEstimatedCostUsd, 0.00075);
      // Latency avg: (200 + 300 + 100 + 20) / 4 = 155
      assert.strictEqual(summary.averageLatencyMs, 155);
      // Cost per successful answer: totalCost / 2 = 0.00075 / 2 = 0.000375
      assert.strictEqual(summary.costPerSuccessfulAnswerUsd, 0.000375);
    },
  );

  // ----------------------------------------------------
  // Category 6: Audit Integration
  // ----------------------------------------------------
  await runTest(
    "6.1 Audit integration: getAuditMetadata provides all fields required by audit_event workflow",
    () => {
      const service = new AIUsageService(mockRepo, calculator);
      const auditMeta: AIUsageAuditMetadata = service.getAuditMetadata({
        requestUuid: "audit-test-uuid",
        provider: "google",
        model: "gemini-1.5-flash",
        promptVersion: "v1.2.0",
        inputTokens: 1200,
        outputTokens: 300,
        latencyMs: 240,
        retryCount: 0,
        status: "SUCCESS",
      });

      assert.strictEqual(auditMeta.requestUuid, "audit-test-uuid");
      assert.strictEqual(auditMeta.provider, "google");
      assert.strictEqual(auditMeta.model, "gemini-1.5-flash");
      assert.strictEqual(auditMeta.promptVersion, "v1.2.0");
      assert.strictEqual(auditMeta.inputTokens, 1200);
      assert.strictEqual(auditMeta.outputTokens, 300);
      assert.strictEqual(auditMeta.totalTokens, 1500);
      assert.strictEqual(auditMeta.retryCount, 0);
      assert.strictEqual(auditMeta.status, "SUCCESS");
      assert.strictEqual(typeof auditMeta.estimatedCostUsd, "number");
    },
  );

  // ----------------------------------------------------
  // Category 7: Privacy, Data Minimization & Security
  // ----------------------------------------------------
  await runTest(
    "7.1 Security & Privacy: AIUsageRecord strictly contains no prompts, questions, or raw payload data",
    async () => {
      mockRepo.clear();
      const service = new AIUsageService(mockRepo, calculator);

      const record = await service.trackUsage({
        requestUuid: "privacy-test-uuid",
        provider: "google",
        model: "gemini-1.5-flash",
        promptVersion: "v1.0",
        purpose: "CANDIDATE_PLAN",
        inputTokens: 500,
        outputTokens: 120,
        latencyMs: 200,
      });

      const recordKeys = Object.keys(record);
      // Explicitly verify prohibited keys are NOT present
      assert.ok(!recordKeys.includes("prompt"), "Must not persist raw prompt");
      assert.ok(
        !recordKeys.includes("systemPrompt"),
        "Must not persist system prompt",
      );
      assert.ok(
        !recordKeys.includes("userQuery"),
        "Must not persist user query",
      );
      assert.ok(
        !recordKeys.includes("question"),
        "Must not persist question text",
      );
      assert.ok(
        !recordKeys.includes("rawResponse"),
        "Must not persist raw AI response",
      );
      assert.ok(!recordKeys.includes("apiKey"), "Must not persist API key");
      assert.ok(!recordKeys.includes("token"), "Must not persist credentials");
    },
  );

  // ----------------------------------------------------
  // Category 8: Resilience & Fail-Open Telemetry Behavior
  // ----------------------------------------------------
  await runTest(
    "8.1 Fail-Open: database persistence failure does not throw or crash primary request",
    async () => {
      mockRepo.clear();
      mockRepo.shouldFail = true;
      const service = new AIUsageService(mockRepo, calculator, true); // failOpen = true

      // Must NOT throw
      const result = await service.trackUsage({
        requestUuid: "fail-open-test-uuid",
        provider: "google",
        model: "gemini-1.5-flash",
        inputTokens: 800,
        outputTokens: 200,
        latencyMs: 150,
      });

      assert.strictEqual(result.requestUuid, "fail-open-test-uuid");
      assert.strictEqual(result.totalTokens, 1000);
      assert.strictEqual(mockRepo.records.length, 0); // Not written to DB
    },
  );

  await runTest(
    "8.2 Fail-Closed: throws error when failOpen is configured to false",
    async () => {
      mockRepo.clear();
      mockRepo.shouldFail = true;
      const service = new AIUsageService(mockRepo, calculator, false); // failOpen = false

      await assert.rejects(async () => {
        await service.trackUsage({
          requestUuid: "fail-closed-test-uuid",
          provider: "google",
          model: "gemini-1.5-flash",
          inputTokens: 800,
          outputTokens: 200,
          latencyMs: 150,
        });
      }, /Database connection timeout/);
    },
  );

  // ----------------------------------------------------
  // Category 9: AIService Integration
  // ----------------------------------------------------
  await runTest(
    "9.1 AIService Integration: automatically triggers usage tracking during candidate plan generation",
    async () => {
      mockRepo.clear();
      const serviceRepo = new InMemoryUsageRepository();
      const usageService = new AIUsageService(serviceRepo, calculator);
      const mockProvider = new MockAIProviderAdapter("gemini");

      const aiService = new AIService(
        mockProvider,
        undefined,
        undefined,
        undefined,
        usageService,
      );

      const result = await aiService.generateCandidatePlan({
        prompt: "Show sales breakdown by category for last quarter",
        context: {
          userId: 101,
          roleId: "analyst",
          locale: "en",
          allowedEntities: ["sales", "products"],
        },
        tokenBudget: {
          maxInputTokens: 1024,
          maxOutputTokens: 512,
        },
        correlationId: "55555555-5555-5555-5555-555555555555",
      });

      assert.ok(result.candidatePlan);
      assert.strictEqual(result.usage.provider, "gemini");
      assert.ok(result.usage.inputTokens > 0);
      assert.ok(result.usage.outputTokens > 0);

      // Wait a brief tick for async fire-and-forget tracking
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify record in repository
      assert.strictEqual(serviceRepo.records.length, 1);
      const trackedRecord = serviceRepo.records[0];
      assert.strictEqual(
        trackedRecord.requestUuid,
        "55555555-5555-5555-5555-555555555555",
      );
      assert.strictEqual(trackedRecord.provider, "gemini");
      assert.ok(trackedRecord.inputTokens > 0);
      assert.ok(trackedRecord.outputTokens > 0);
      assert.strictEqual(trackedRecord.status, "SUCCESS");
    },
  );

  // Summary
  console.log("\n==================================================");
  console.log(
    ` RESULTS: ${passedCount}/${passedCount + failedCount} Tests Passed!`,
  );
  console.log("==================================================");

  if (failedCount > 0) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
