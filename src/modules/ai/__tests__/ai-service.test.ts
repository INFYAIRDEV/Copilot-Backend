import {
  AIService,
  AIServiceRequest,
  AIServiceException,
  CandidatePlanValidator,
  MockAIProviderAdapter,
  ResilientAIProvider,
  StructuredFallbackProvider,
  AIProviderException,
  AIProviderRequest,
  AIProviderResponse,
  IAIProvider,
} from "../index.js";

async function runAIServiceTestSuite() {
  console.log("==================================================");
  console.log("       AI SERVICE LAYER COMPREHENSIVE TESTS       ");
  console.log("==================================================");

  let passed = 0;
  let total = 0;

  function assert(condition: boolean, description: string) {
    total++;
    if (condition) {
      passed++;
      console.log(`✔ [PASS] ${description}`);
    } else {
      console.error(`❌ [FAIL] ${description}`);
      throw new Error(`Test failed: ${description}`);
    }
  }

  // ----------------------------------------------------
  // TEST GROUP 1: Unit Tests & Provider Invocations
  // ----------------------------------------------------
  console.log("\n--- Test Group 1: Unit Tests - Request Handling & Normalization ---");
  {
    const mockAdapter = new MockAIProviderAdapter("UNIT_TEST_PROVIDER");
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
      correlationId: "corr-unit-test-1",
    };

    const result = await aiService.generateCandidatePlan(request);

    assert(result.candidatePlan !== undefined, "Returns candidate typed analytical plan");
    assert(result.candidatePlan.planId.startsWith("plan-"), "Candidate plan contains valid planId");
    assert(result.candidatePlan.candidateIntents.length > 0, "Candidate plan has non-empty intents");
    assert(result.usage.provider === "UNIT_TEST_PROVIDER", "Normalized usage records provider name");
    assert(result.usage.inputTokens > 0, "Usage captures input tokens");
    assert(result.usage.outputTokens > 0, "Usage captures output tokens");
    assert(result.usage.requestOutcome === "SUCCESS", "Request outcome is SUCCESS");
    assert(result.correlationId === "corr-unit-test-1", "Preserves correlation ID");
    assert(result.isDegraded === false, "Success plan is not degraded");
    assert(result.fromFallback === false, "Success plan is not from fallback");
  }

  // ----------------------------------------------------
  // TEST GROUP 2: Candidate Plan Structural Validation
  // ----------------------------------------------------
  console.log("\n--- Test Group 2: Structural Validation of Candidate Plans ---");
  {
    // 2a. Valid candidate plan passes validation
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
    const validResult = CandidatePlanValidator.validate(validPlan);
    assert(validResult.isValid === true, "Valid candidate plan passes structural validation");
    assert(validResult.errors.length === 0, "Valid candidate plan has zero validation errors");

    // 2b. Missing planId fails
    const missingPlanId = { ...validPlan, planId: "" };
    const missingPlanIdResult = CandidatePlanValidator.validate(missingPlanId);
    assert(missingPlanIdResult.isValid === false, "Rejects empty planId");
    assert(
      missingPlanIdResult.errors.some((e) => e.includes("planId")),
      "Reports error for missing planId",
    );

    // 2c. Invalid confidenceScore fails
    const invalidConfidence = { ...validPlan, confidenceScore: 1.5 };
    const invalidConfidenceResult = CandidatePlanValidator.validate(invalidConfidence);
    assert(invalidConfidenceResult.isValid === false, "Rejects confidenceScore > 1.0");

    // 2d. Empty candidateIntents array fails
    const emptyIntents = { ...validPlan, candidateIntents: [] };
    const emptyIntentsResult = CandidatePlanValidator.validate(emptyIntents);
    assert(emptyIntentsResult.isValid === false, "Rejects empty candidateIntents array");

    // 2e. Invalid intentType fails
    const invalidIntentType = {
      ...validPlan,
      candidateIntents: [
        {
          intentType: "ARBITRARY_SQL_EXECUTION",
          primaryEntity: "users",
          dimensions: [],
          metrics: [],
        },
      ],
    };
    const invalidIntentResult = CandidatePlanValidator.validate(invalidIntentType);
    assert(invalidIntentResult.isValid === false, "Rejects unsupported intentType");

    // 2f. AI Service rejects structurally invalid model response
    class MalformedProvider implements IAIProvider {
      public async generateCandidatePlan(_req: AIProviderRequest): Promise<AIProviderResponse> {
        return {
          candidatePlan: {
            planId: "", // invalid empty planId
            candidateIntents: [], // invalid empty intents
            confidenceScore: -5, // invalid negative confidence
            isFallback: false,
          },
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
            latencyMs: 15,
            providerName: "MALFORMED_PROVIDER",
            modelName: "test-model",
            retryCount: 0,
          },
          fromFallback: false,
        };
      }
      public getProviderMetadata() {
        return {
          providerName: "MALFORMED_PROVIDER",
          defaultModel: "test-model",
          isAvailable: true,
        };
      }
    }

    const aiServiceMalformed = new AIService(new MalformedProvider());
    try {
      await aiServiceMalformed.generateCandidatePlan({
        prompt: "Show metrics",
        context: { userId: 1, roleId: "admin" },
      });
      assert(false, "Should throw AIServiceException for malformed plan");
    } catch (err: any) {
      assert(err instanceof AIServiceException, "Throws AIServiceException for malformed plan");
      assert(err.code === "COPILOT_INVALID_RESPONSE", "Error code is COPILOT_INVALID_RESPONSE");
      assert(err.statusCode === 422, "Status code is 422 Unprocessable Entity");
      assert(err.details && err.details.length > 0, "Details contain specific structural errors");
    }
  }

  // ----------------------------------------------------
  // TEST GROUP 3: Security & Authorization Boundaries
  // ----------------------------------------------------
  console.log("\n--- Test Group 3: Security & Authorization Boundaries ---");
  {
    let capturedProviderRequest: AIProviderRequest | null = null;
    class CapturingProvider implements IAIProvider {
      public async generateCandidatePlan(req: AIProviderRequest): Promise<AIProviderResponse> {
        capturedProviderRequest = req;
        return {
          candidatePlan: {
            planId: "plan-captured",
            candidateIntents: [
              {
                intentType: "AGGREGATION",
                primaryEntity: "sales",
                dimensions: ["month"],
                metrics: ["amount"],
              },
            ],
            confidenceScore: 0.9,
            isFallback: false,
          },
          usage: {
            inputTokens: 20,
            outputTokens: 30,
            totalTokens: 50,
            latencyMs: 25,
            providerName: "CAPTURING_PROVIDER",
            modelName: "test-model",
            retryCount: 0,
          },
          fromFallback: false,
        };
      }
      public getProviderMetadata() {
        return {
          providerName: "CAPTURING_PROVIDER",
          defaultModel: "test-model",
          isAvailable: true,
        };
      }
    }

    const capturingService = new AIService(new CapturingProvider());

    // 3a. Input minimization & credential redaction
    await capturingService.generateCandidatePlan({
      prompt: "Show sales with password='SuperSecretPassword!' and bearer token_abc123 and postgres://user:pass@db:5432/db",
      context: { userId: 42, roleId: "operator" },
    });

    assert(capturedProviderRequest !== null, "Captured provider request");
    const capturedReq = capturedProviderRequest as unknown as AIProviderRequest;
    assert(
      !capturedReq.prompt.includes("SuperSecretPassword!"),
      "Sensitive password redacted from model input",
    );
    assert(
      !capturedReq.prompt.includes("token_abc123"),
      "Bearer token redacted from model input",
    );
    assert(
      !capturedReq.prompt.includes("postgres://user:pass"),
      "Database connection string redacted from model input",
    );

    // 3b. Authorization scope is strictly preserved without escalation
    assert(
      capturedReq.context?.userId === 42,
      "Preserves authorized userId exactly as provided",
    );
    assert(
      capturedReq.context?.roleId === "operator",
      "Preserves authorized roleId without privilege escalation",
    );

    // 3c. Empty prompt / invalid context rejected before calling provider
    try {
      await capturingService.generateCandidatePlan({
        prompt: "",
        context: { userId: 42, roleId: "operator" },
      });
      assert(false, "Should reject empty prompt");
    } catch (err: any) {
      assert(err instanceof AIServiceException, "Rejects empty prompt with AIServiceException");
      assert(err.statusCode === 400, "Returns 400 Bad Request for empty prompt");
    }
  }

  // ----------------------------------------------------
  // TEST GROUP 4: Resilience, Errors & Structured Fallback
  // ----------------------------------------------------
  console.log("\n--- Test Group 4: Resilience, Error Normalization & Structured Fallback ---");
  {
    // 4a. Timeout error normalization
    class TimeoutProvider implements IAIProvider {
      public async generateCandidatePlan(_req: AIProviderRequest): Promise<AIProviderResponse> {
        throw new AIProviderException("TIMEOUT", "Read timeout after 15000ms", "TIMEOUT_PROVIDER");
      }
      public getProviderMetadata() {
        return {
          providerName: "TIMEOUT_PROVIDER",
          defaultModel: "test",
          isAvailable: false,
        };
      }
    }

    const timeoutService = new AIService(new TimeoutProvider());
    try {
      await timeoutService.generateCandidatePlan({
        prompt: "Show data",
        context: { userId: 1, roleId: "analyst" },
      });
      assert(false, "Should throw on timeout");
    } catch (err: any) {
      assert(err instanceof AIServiceException, "Translates to AIServiceException");
      assert(err.code === "COPILOT_MODEL_TIMEOUT", "Maps to COPILOT_MODEL_TIMEOUT");
      assert(err.statusCode === 503, "Status code is 503 Service Unavailable");
      assert(err.isTransient === true, "Marked as transient error");
      assert(!err.message.includes("Read timeout after 15000ms"), "Masks internal timeout exception details");
    }

    // 4b. Provider unavailable error normalization
    class UnavailableProvider implements IAIProvider {
      public async generateCandidatePlan(_req: AIProviderRequest): Promise<AIProviderResponse> {
        throw new AIProviderException("UNAVAILABLE", "503 Service Unavailable from upstream", "UNAVAILABLE_PROVIDER");
      }
      public getProviderMetadata() {
        return {
          providerName: "UNAVAILABLE_PROVIDER",
          defaultModel: "test",
          isAvailable: false,
        };
      }
    }

    const unavailableService = new AIService(new UnavailableProvider());
    try {
      await unavailableService.generateCandidatePlan({
        prompt: "Show data",
        context: { userId: 1, roleId: "analyst" },
      });
      assert(false, "Should throw on unavailable");
    } catch (err: any) {
      assert(err instanceof AIServiceException, "Translates to AIServiceException");
      assert(err.code === "COPILOT_MODEL_UNAVAILABLE", "Maps to COPILOT_MODEL_UNAVAILABLE");
      assert(err.statusCode === 503, "Status code is 503");
      assert(err.isTransient === false, "UNAVAILABLE outage marked as non-transient to prevent immediate retry loop");
    }

    // 4c. Token budget exceeded error normalization
    class TokenExceededProvider implements IAIProvider {
      public async generateCandidatePlan(_req: AIProviderRequest): Promise<AIProviderResponse> {
        throw new AIProviderException("TOKEN_BUDGET_EXCEEDED", "Input exceeds 2048 tokens", "BUDGET_PROVIDER");
      }
      public getProviderMetadata() {
        return {
          providerName: "BUDGET_PROVIDER",
          defaultModel: "test",
          isAvailable: true,
        };
      }
    }

    const budgetService = new AIService(new TokenExceededProvider());
    try {
      await budgetService.generateCandidatePlan({
        prompt: "Show massive data",
        context: { userId: 1, roleId: "analyst" },
      });
      assert(false, "Should throw on budget exceeded");
    } catch (err: any) {
      assert(err instanceof AIServiceException, "Translates to AIServiceException");
      assert(err.code === "COPILOT_TOKEN_BUDGET_EXCEEDED", "Maps to COPILOT_TOKEN_BUDGET_EXCEEDED");
      assert(err.statusCode === 422, "Status code is 422 Unprocessable Entity");
      assert(err.isTransient === false, "Budget exceeded is non-transient");
    }

    // 4d. Structured Fallback consumption through Resilient Provider
    const failingAdapter = new MockAIProviderAdapter("FAILING_PRIMARY");
    failingAdapter.setSimulateTransientError(true);
    const resilientProvider = new ResilientAIProvider(failingAdapter);
    const fallbackService = new AIService(resilientProvider);

    const fallbackResult = await fallbackService.generateCandidatePlan({
      prompt: "Show revenue report",
      context: { userId: 10, roleId: "manager" },
    });

    assert(fallbackResult.fromFallback === true, "AIService consumes structured fallback");
    assert(fallbackResult.isDegraded === true, "Marks result as degraded state");
    assert(fallbackResult.usage.requestOutcome === "FALLBACK", "Usage telemetry records FALLBACK outcome");
    assert(fallbackResult.candidatePlan.isFallback === true, "Candidate plan isFallback flag set");
    assert(fallbackResult.fallbackReason !== undefined, "Captures structured fallback reason");
  }

  // ----------------------------------------------------
  // TEST GROUP 5: Boundary & Architectural Separation Tests
  // ----------------------------------------------------
  console.log("\n--- Test Group 5: Architectural Boundaries & Dependency Isolation ---");
  {
    const mockAdapter = new MockAIProviderAdapter("BOUNDARY_PROVIDER");
    const aiService = new AIService(mockAdapter);

    // 5a. Service stops strictly at candidate plan stage
    const result = await aiService.generateCandidatePlan({
      prompt: "Show margin for electronics",
      context: { userId: 77, roleId: "analyst" },
    });

    assert(
      (result as any).sql === undefined,
      "AIService does NOT generate or return executable SQL",
    );
    assert(
      (result as any).parameterizedSql === undefined,
      "AIService does NOT return parameterized SQL",
    );
    assert(
      (result as any).executionEnvelope === undefined,
      "AIService does NOT construct ExecutionEnvelope (server-owned downstream responsibility)",
    );
    assert(
      (result as any).ast === undefined,
      "AIService does NOT construct server AST (Application-Owned AST is downstream)",
    );
    assert(
      (result as any).authoritativeMetrics === undefined,
      "AIService does NOT calculate authoritative business numbers (deterministic calculations are application-owned)",
    );

    // 5b. Result candidate plan remains an untrusted candidate requiring validation
    assert(
      result.candidatePlan.confidenceScore <= 1.0,
      "Candidate plan includes model confidence rating",
    );
    assert(
      Array.isArray(result.candidatePlan.candidateIntents),
      "Candidate intents are structured for downstream semantic & policy validators",
    );
  }

  console.log("\n==================================================");
  console.log(` RESULTS: ${passed}/${total} AI Service Tests Passed!`);
  console.log("==================================================");
}

runAIServiceTestSuite().catch((err) => {
  console.error("AI Service test suite failed:", err);
  process.exit(1);
});
