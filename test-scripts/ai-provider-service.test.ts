import assert from "node:assert";
import {
  AIService,
  AIServiceRequest,
  MockAIProviderAdapter,
  AIServiceException,
  CandidatePlanValidator,
} from "../src/modules/ai/index.js";

async function runAiProviderServiceTests() {
  console.log("==================================================");
  console.log(" FEATURE: AI PROVIDER ABSTRACTION & AISERVICE TESTS");
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

  // 1. Candidate Plan Generation
  await test("AIService: Successfully generates ModelCandidatePlan via provider", async () => {
    const mockAdapter = new MockAIProviderAdapter("TEST_PROVIDER");
    const aiService = new AIService(mockAdapter);

    const request: AIServiceRequest = {
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
      correlationId: "corr-1",
    };

    const result = await aiService.generateCandidatePlan(request);
    assert.ok(result.candidatePlan !== undefined, "Candidate plan must be populated");
    assert.ok(result.candidatePlan?.planId.startsWith("plan-"), "Candidate plan has valid planId");
    assert.ok(result.candidatePlan?.candidateIntents.length > 0, "Candidate plan has intents");
    assert.strictEqual(result.usage.requestOutcome, "SUCCESS");
    assert.ok(result.usage.totalTokens > 0);
  });

  // 2. Candidate Plan Validation
  await test("CandidatePlanValidator: Validates structural integrity of candidate plans", () => {
    const validPlan = {
      planId: "plan-valid-123",
      candidateIntents: [
        {
          intentType: "AGGREGATION",
          primaryEntity: "sales_orders",
          dimensions: ["region"],
          metrics: ["total_amount"],
        },
      ],
      confidenceScore: 0.95,
      suggestedVisualization: "BAR_CHART",
      isFallback: false,
    };

    const validation = CandidatePlanValidator.validate(validPlan);
    assert.strictEqual(validation.isValid, true);
    assert.strictEqual(validation.errors.length, 0);

    const invalidPlan = { ...validPlan, planId: "" };
    const invalidResult = CandidatePlanValidator.validate(invalidPlan);
    assert.strictEqual(invalidResult.isValid, false);
    assert.ok(invalidResult.errors.some((e) => e.includes("planId")));
  });

  // 3. Provider Contract / Validation Failure
  await test("AIService: Rejects empty prompt with validation error", async () => {
    const mockAdapter = new MockAIProviderAdapter("TEST_PROVIDER");
    const aiService = new AIService(mockAdapter);

    await assert.rejects(
      async () => aiService.generateCandidatePlan({
        prompt: "",
        context: { userId: 1, roleId: "user", locale: "en" },
      }),
      (err: any) => {
        return err instanceof AIServiceException || err.name === "AIServiceException";
      },
    );
  });

  // 4. Provider failure handling
  await test("AIService: Gracefully handles simulated provider outage", async () => {
    const failingAdapter = new MockAIProviderAdapter("FAILING_PROVIDER");
    failingAdapter.setSimulateNonTransientError(true);
    const aiService = new AIService(failingAdapter);

    await assert.rejects(
      async () => aiService.generateCandidatePlan({
        prompt: "Show delayed orders",
        context: { userId: 1, roleId: "analyst", locale: "en" },
      }),
      (err: any) => {
        return err instanceof AIServiceException || err.name === "AIServiceException";
      },
    );
  });

  console.log("==================================================");
  console.log(` AI PROVIDER & SERVICE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runAiProviderServiceTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
