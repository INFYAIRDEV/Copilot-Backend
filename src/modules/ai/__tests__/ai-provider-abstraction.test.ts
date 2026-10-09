import {
  MockAIProviderAdapter,
  ResilientAIProvider,
  StructuredFallbackProvider,
  AIProviderException,
  AIProviderRequest,
} from "../index.js";

async function runAIAbstractionTests() {
  console.log("==================================================");
  console.log("   AI PROVIDER ABSTRACTION LAYER TEST SUITE       ");
  console.log("==================================================");

  let passedTests = 0;
  let totalTests = 0;

  function assertTest(condition: boolean, testName: string) {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✔ [PASS] ${testName}`);
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      throw new Error(`Test failed: ${testName}`);
    }
  }

  // 1. Interface & Success Flow Test
  console.log("\n--- Test Group 1: Interface & Response Normalization ---");
  {
    const mockAdapter = new MockAIProviderAdapter("TEST_PROVIDER");
    const resilientProvider = new ResilientAIProvider(mockAdapter);

    const request: AIProviderRequest = {
      prompt: "Show revenue trend by region for 2026",
      context: { userId: 101, roleId: "analyst" },
      tokenBudget: { maxInputTokens: 500, maxOutputTokens: 200 },
    };

    const response = await resilientProvider.generateCandidatePlan(request);

    assertTest(
      response.candidatePlan !== undefined,
      "Returns candidate typed analytical plan",
    );
    assertTest(
      response.candidatePlan.planId.startsWith("plan-"),
      "Plan contains valid candidate planId",
    );
    assertTest(
      response.candidatePlan.candidateIntents.length > 0,
      "Plan contains query intents",
    );
    assertTest(
      response.candidatePlan.isFallback === false,
      "Success response is not fallback",
    );
    assertTest(response.fromFallback === false, "fromFallback flag is false");
    assertTest(
      response.usage.inputTokens > 0,
      "Usage telemetry captures input tokens",
    );
    assertTest(
      response.usage.outputTokens > 0,
      "Usage telemetry captures output tokens",
    );
    assertTest(
      response.usage.providerName === "TEST_PROVIDER",
      "Telemetry records application provider name",
    );
  }

  // 2. Single Retry Policy Test for Transient Failures
  console.log(
    "\n--- Test Group 2: Single Retry Policy (Transient vs Non-Transient) ---",
  );
  {
    const mockAdapter = new MockAIProviderAdapter("RETRY_PROVIDER");
    mockAdapter.setSimulateTransientError(true);

    const resilientProvider = new ResilientAIProvider(mockAdapter);

    const request: AIProviderRequest = {
      prompt: "Get sales summary",
    };

    // Transient failure should attempt 1 retry, fail again, then route to Structured Fallback
    const response = await resilientProvider.generateCandidatePlan(request);
    assertTest(
      response.fromFallback === true,
      "Transient failure after retry routes to Structured Fallback",
    );
    assertTest(
      response.candidatePlan.isFallback === true,
      "Candidate plan marked as fallback",
    );
    assertTest(
      response.fallbackReason !== undefined,
      "Fallback reason is captured",
    );
  }

  // 3. Non-Transient Failure Test (No Retry)
  {
    const mockAdapter = new MockAIProviderAdapter("NON_TRANSIENT_PROVIDER");
    mockAdapter.setSimulateNonTransientError(true);

    const resilientProvider = new ResilientAIProvider(mockAdapter);
    const request: AIProviderRequest = { prompt: "Invalid payload request" };

    try {
      await resilientProvider.generateCandidatePlan(request);
      assertTest(
        false,
        "Non-transient failure should throw exception immediately",
      );
    } catch (err: any) {
      assertTest(
        err instanceof AIProviderException,
        "Throws normalized AIProviderException",
      );
      assertTest(
        err.category === "REJECTED",
        "Error category classified as REJECTED",
      );
      assertTest(
        err.isTransient === false,
        "Non-transient error marked with isTransient=false",
      );
    }
  }

  // 4. Token Budget Pre-validation Test
  console.log("\n--- Test Group 3: Token Budget Enforcement ---");
  {
    const mockAdapter = new MockAIProviderAdapter("BUDGET_PROVIDER");
    const resilientProvider = new ResilientAIProvider(mockAdapter);

    const longPrompt = "A ".repeat(2000); // ~2000 characters -> ~500 tokens
    const request: AIProviderRequest = {
      prompt: longPrompt,
      tokenBudget: { maxInputTokens: 50 }, // Exceeded limit
    };

    try {
      await resilientProvider.generateCandidatePlan(request);
      assertTest(
        false,
        "Token budget violation should throw exception before API call",
      );
    } catch (err: any) {
      assertTest(
        err instanceof AIProviderException,
        "Throws AIProviderException",
      );
      assertTest(
        err.category === "TOKEN_BUDGET_EXCEEDED",
        "Category is TOKEN_BUDGET_EXCEEDED",
      );
    }
  }

  // 5. Circuit Breaker & Structured Fallback Test
  console.log("\n--- Test Group 4: Circuit Breaker & Structured Fallback ---");
  {
    const mockAdapter = new MockAIProviderAdapter("CIRCUIT_PROVIDER");
    mockAdapter.setSimulateTransientError(true);

    // Circuit breaker configured with failureThreshold: 2, resetTimeoutMs: 1000ms
    const resilientProvider = new ResilientAIProvider(mockAdapter, undefined, {
      failureThreshold: 2,
      resetTimeoutMs: 1000,
    });

    const request: AIProviderRequest = { prompt: "Test query" };

    // Request 1: Fails -> Retried -> Recorded failure
    await resilientProvider.generateCandidatePlan(request);

    // Request 2: Fails -> Retried -> Failure threshold reached -> Circuit OPENS
    await resilientProvider.generateCandidatePlan(request);

    // Request 3: Circuit is OPEN -> Bypasses external provider -> Immediate Structured Fallback
    const response3 = await resilientProvider.generateCandidatePlan(request);
    assertTest(
      response3.fromFallback === true,
      "Circuit OPEN routes directly to Structured Fallback",
    );
    assertTest(
      response3.fallbackReason?.includes("Circuit breaker is OPEN") || false,
      "Fallback reason cites Circuit Breaker",
    );

    // Wait for resetTimeoutMs to test HALF_OPEN recovery
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Turn off error simulation
    mockAdapter.setSimulateTransientError(false);

    // Request 4: HALF_OPEN probe -> Primary provider succeeds -> Circuit closes
    const response4 = await resilientProvider.generateCandidatePlan(request);
    assertTest(
      response4.fromFallback === false,
      "Circuit recovers and resumes primary provider path",
    );
  }

  // 6. Direct Structured Fallback Isolation Test
  console.log("\n--- Test Group 5: Direct Structured Fallback Execution ---");
  {
    const fallback = new StructuredFallbackProvider();
    const response = await fallback.generateCandidatePlan({
      prompt: "Show standard KPI metrics",
    });

    assertTest(
      response.candidatePlan.isFallback === true,
      "Fallback returns valid candidate plan",
    );
    assertTest(
      response.candidatePlan.candidateIntents[0].primaryEntity ===
        "analytics_summary",
      "Fallback candidate intent is certified standard report",
    );
    assertTest(
      response.narrative?.includes(
        "narrative generation is currently degraded",
      ) || false,
      "Narrative degradation is explicitly messaged without failing analytics",
    );
  }

  console.log("\n==================================================");
  console.log(
    ` RESULTS: ${passedTests}/${totalTests} Tests Passed Successfully!`,
  );
  console.log("==================================================");
}

runAIAbstractionTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
