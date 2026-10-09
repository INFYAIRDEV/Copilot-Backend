import assert from "node:assert";
import {
  ResilientAIProvider,
  CircuitBreaker,
  AIErrorClassifier,
  AIResilienceMetrics,
  NarrativeFallbackHandler,
} from "../resilience/index.js";
import {
  IAIProvider,
  AIProviderMetadata,
} from "../interfaces/ai-provider.interface.js";
import {
  AIProviderRequest,
  AIProviderResponse,
  AIProviderException,
  ModelCandidatePlan,
} from "../types/ai-provider.types.js";
import { StructuredFallbackProvider } from "../fallback/structured-fallback.js";

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

// Mock Provider for testing retry and circuit breaker scenarios
class ControllableMockProvider implements IAIProvider {
  public callCount = 0;
  private failureQueue: Error[] = [];

  constructor(public providerName: string = "MOCK_PROVIDER") {}

  public getProviderMetadata(): AIProviderMetadata {
    return {
      providerName: this.providerName,
      defaultModel: "mock-model-v1",
      isAvailable: true,
    };
  }

  public queueFailure(error: Error): void {
    this.failureQueue.push(error);
  }

  public clearFailures(): void {
    this.failureQueue = [];
  }

  public async generateCandidatePlan(
    request: AIProviderRequest,
  ): Promise<AIProviderResponse> {
    this.callCount++;

    if (this.failureQueue.length > 0) {
      const err = this.failureQueue.shift()!;
      throw err;
    }

    const plan: ModelCandidatePlan = {
      planId: `test-plan-${this.callCount}`,
      candidateIntents: [
        {
          intentType: "AGGREGATION",
          primaryEntity: "sales",
          dimensions: ["month"],
          metrics: ["revenue"],
        },
      ],
      confidenceScore: 0.95,
      isFallback: false,
    };

    return {
      candidatePlan: plan,
      narrative: "Mock narrative response",
      usage: {
        providerName: this.providerName,
        modelName: "mock-model-v1",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        latencyMs: 25,
        retryCount: 0,
      },
      fromFallback: false,
    };
  }
}

async function runAllTests() {
  console.log("==================================================");
  console.log("     AI ERROR AND RETRY HANDLING TEST SUITE       ");
  console.log("==================================================");

  // -------------------------------------------------------------
  // Test Group 1: Error Classification & Sanitization
  // -------------------------------------------------------------
  console.log("\n--- Test Group 1: Error Classification & Sanitization ---");

  await runTest("Classifies transient provider errors as retryable", () => {
    const timeoutErr = new AIProviderException("TIMEOUT", "Request timed out");
    const rateLimitErr = new AIProviderException(
      "RATE_LIMITED",
      "Too many requests",
    );
    const transientErr = new AIProviderException(
      "TRANSIENT_FAILURE",
      "Socket reset",
    );

    assert.strictEqual(AIErrorClassifier.isRetryable(timeoutErr), true);
    assert.strictEqual(AIErrorClassifier.isRetryable(rateLimitErr), true);
    assert.strictEqual(AIErrorClassifier.isRetryable(transientErr), true);
  });

  await runTest("Classifies non-transient errors as non-retryable", () => {
    const budgetErr = new AIProviderException(
      "TOKEN_BUDGET_EXCEEDED",
      "Too large",
    );
    const configErr = new AIProviderException("CONFIG_ERROR", "Invalid key");
    const rejectErr = new AIProviderException("REJECTED", "Bad payload");
    const responseErr = new AIProviderException("INVALID_RESPONSE", "Bad json");

    assert.strictEqual(AIErrorClassifier.isRetryable(budgetErr), false);
    assert.strictEqual(AIErrorClassifier.isRetryable(configErr), false);
    assert.strictEqual(AIErrorClassifier.isRetryable(rejectErr), false);
    assert.strictEqual(AIErrorClassifier.isRetryable(responseErr), false);
  });

  await runTest(
    "Classifies validation and security errors as non-retryable",
    () => {
      const validationErr = new Error(
        "Zod validation failed: invalid prompt field",
      );
      const securityErr = new Error(
        "Unauthorized role attempted metric access",
      );

      const classifiedValidation = AIErrorClassifier.classify(validationErr);
      assert.strictEqual(classifiedValidation.isRetryable, false);
      assert.strictEqual(
        classifiedValidation.classification,
        "APPLICATION_VALIDATION_FAILURE",
      );

      const classifiedSecurity = AIErrorClassifier.classify(securityErr);
      assert.strictEqual(classifiedSecurity.isRetryable, false);
      assert.strictEqual(
        classifiedSecurity.classification,
        "SECURITY_POLICY_VIOLATION",
      );
    },
  );

  await runTest(
    "Sanitizes sensitive bearer tokens and passwords in error messages",
    () => {
      const rawMsg =
        "Provider failed with Bearer secret-token-xyz123 and password='supersecret'";
      const sanitized = AIErrorClassifier.sanitizeErrorMessage(rawMsg);
      assert.ok(!sanitized.includes("secret-token-xyz123"));
      assert.ok(!sanitized.includes("supersecret"));
      assert.ok(sanitized.includes("[REDACTED]"));
    },
  );

  // -------------------------------------------------------------
  // Test Group 2: Single Retry Policy (Strict Bounds)
  // -------------------------------------------------------------
  console.log("\n--- Test Group 2: Single Retry Policy (Strict Bounds) ---");

  await runTest(
    "Performs EXACTLY ONE retry on transient failure and succeeds",
    async () => {
      const mock = new ControllableMockProvider("RETRY_MOCK");
      // Fail once with transient timeout, then succeed
      mock.queueFailure(
        new AIProviderException("TIMEOUT", "Simulated transient timeout"),
      );

      const metrics = new AIResilienceMetrics();
      const resilientProvider = new ResilientAIProvider(
        mock,
        undefined,
        undefined,
        {
          retryBackoffMs: 10,
          metrics,
        },
      );

      const response = await resilientProvider.generateCandidatePlan({
        prompt: "Test prompt",
      });

      // Initial call (fail) + 1 retry (success) = exactly 2 calls
      assert.strictEqual(mock.callCount, 2);
      assert.strictEqual(response.usage.retryCount, 1);
      assert.strictEqual(response.fromFallback, false);

      const snapshot = metrics.getSnapshot();
      assert.strictEqual(snapshot.retriesAttempted, 1);
      assert.strictEqual(snapshot.retriesSucceeded, 1);
    },
  );

  await runTest(
    "Performs AT MOST ONE retry when retry also fails, then routes to fallback",
    async () => {
      const mock = new ControllableMockProvider("DOUBLE_FAIL_MOCK");
      // Fail twice with transient errors
      mock.queueFailure(new AIProviderException("TIMEOUT", "Timeout 1"));
      mock.queueFailure(new AIProviderException("TIMEOUT", "Timeout 2"));

      const metrics = new AIResilienceMetrics();
      const resilientProvider = new ResilientAIProvider(
        mock,
        undefined,
        undefined,
        {
          retryBackoffMs: 10,
          metrics,
        },
      );

      const response = await resilientProvider.generateCandidatePlan({
        prompt: "Test prompt",
      });

      // Call 1 (fail) + Retry 1 (fail) = exactly 2 calls (NO third attempt!)
      assert.strictEqual(mock.callCount, 2);
      assert.strictEqual(response.fromFallback, true);
      assert.ok(response.fallbackReason?.includes("Timeout 2") || false);

      const snapshot = metrics.getSnapshot();
      assert.strictEqual(snapshot.retriesAttempted, 1);
      assert.strictEqual(snapshot.retriesFailed, 1);
      assert.strictEqual(snapshot.fallbackCount, 1);
    },
  );

  await runTest(
    "NEVER retries non-transient errors (Token Budget, Config, Rejected)",
    async () => {
      const mock = new ControllableMockProvider("NON_TRANSIENT_MOCK");
      mock.queueFailure(
        new AIProviderException("REJECTED", "400 Bad Request: Invalid schema"),
      );

      const resilientProvider = new ResilientAIProvider(
        mock,
        undefined,
        undefined,
        {
          retryBackoffMs: 10,
        },
      );

      await assert.rejects(
        async () => {
          await resilientProvider.generateCandidatePlan({
            prompt: "Test prompt",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIProviderException);
          assert.strictEqual(err.category, "REJECTED");
          return true;
        },
      );

      // EXACTLY 1 attempt: no retry attempted for non-transient errors!
      assert.strictEqual(mock.callCount, 1);
    },
  );

  // -------------------------------------------------------------
  // Test Group 3: Circuit Breaker Blueprint Thresholds
  // -------------------------------------------------------------
  console.log("\n--- Test Group 3: Circuit Breaker Blueprint Thresholds ---");

  await runTest(
    "Circuit trips OPEN on >= 5 failures in 60-second window",
    async () => {
      let circuitOpened = false;
      let openReason = "";

      const breaker = new CircuitBreaker("WINDOW_PROVIDER", {
        failureThresholdInWindow: 5,
        windowMs: 60_000,
        onCircuitOpen: (provider, reason) => {
          circuitOpened = true;
          openReason = reason;
        },
      });

      assert.strictEqual(breaker.getState(), "CLOSED");

      // Record 4 transient failures (below threshold 5)
      for (let i = 0; i < 4; i++) {
        breaker.onFailure(
          new AIProviderException("TIMEOUT", "Simulated timeout"),
        );
      }
      assert.strictEqual(breaker.getState(), "CLOSED");

      // 5th failure trips the circuit
      breaker.onFailure(
        new AIProviderException("TIMEOUT", "Simulated timeout 5"),
      );
      assert.strictEqual(breaker.getState(), "OPEN");
      assert.strictEqual(circuitOpened, true);
      assert.ok(openReason.includes("5 failures in 60000ms"));
    },
  );

  await runTest(
    "Circuit trips OPEN on >= 50% failures across latest 20 calls",
    async () => {
      const breaker = new CircuitBreaker("SLIDING_PROVIDER", {
        slidingWindowSize: 20,
        slidingWindowFailureRate: 0.5,
        failureThresholdInWindow: 15, // set high so ratio trigger hits
      });

      // 10 successes
      for (let i = 0; i < 10; i++) {
        breaker.onSuccess();
      }
      assert.strictEqual(breaker.getState(), "CLOSED");

      // 9 failures (9 out of 19 calls < 50%) -> remains CLOSED
      for (let i = 0; i < 9; i++) {
        breaker.onFailure(
          new AIProviderException("TIMEOUT", "Simulated timeout"),
        );
      }
      assert.strictEqual(breaker.getState(), "CLOSED");

      // 10th failure -> 10/20 calls failed (50%) -> trips OPEN!
      breaker.onFailure(
        new AIProviderException("TIMEOUT", "Simulated timeout 10"),
      );
      assert.strictEqual(breaker.getState(), "OPEN");
    },
  );

  await runTest(
    "Circuit blocks calls when OPEN without calling downstream provider",
    async () => {
      const mock = new ControllableMockProvider("BLOCKED_PROVIDER");
      const breaker = new CircuitBreaker("BLOCKED_PROVIDER", {
        failureThreshold: 1,
      });

      breaker.onFailure(
        new AIProviderException("UNAVAILABLE", "Provider down"),
      );
      assert.strictEqual(breaker.getState(), "OPEN");

      await assert.rejects(
        async () => {
          await breaker.execute(async () =>
            mock.generateCandidatePlan({ prompt: "hi" }),
          );
        },
        (err: any) => {
          assert.strictEqual(err.category, "UNAVAILABLE");
          assert.ok(err.message.includes("Circuit Breaker OPEN"));
          return true;
        },
      );

      // Downstream provider was NOT called
      assert.strictEqual(mock.callCount, 0);
    },
  );

  await runTest(
    "Circuit enters HALF_OPEN after cooldown and recovers on successful probes",
    async () => {
      const breaker = new CircuitBreaker("RECOVERY_PROVIDER", {
        failureThreshold: 1,
        resetTimeoutMs: 50, // Short cooldown for testing
        halfOpenSuccessThreshold: 2,
      });

      breaker.onFailure(new AIProviderException("TIMEOUT", "Error"));
      assert.strictEqual(breaker.getState(), "OPEN");

      // Wait for resetTimeoutMs
      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(breaker.getState(), "HALF_OPEN");

      // Probe 1 success
      breaker.onSuccess();
      assert.strictEqual(breaker.getState(), "HALF_OPEN");

      // Probe 2 success -> Closes circuit
      breaker.onSuccess();
      assert.strictEqual(breaker.getState(), "CLOSED");
    },
  );

  await runTest(
    "Circuit re-trips OPEN immediately if probe fails in HALF_OPEN",
    async () => {
      const breaker = new CircuitBreaker("RETRIP_PROVIDER", {
        failureThreshold: 1,
        resetTimeoutMs: 50,
        halfOpenSuccessThreshold: 2,
      });

      breaker.onFailure(new AIProviderException("TIMEOUT", "Error"));
      assert.strictEqual(breaker.getState(), "OPEN");

      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(breaker.getState(), "HALF_OPEN");

      // Probe fails in HALF_OPEN -> immediately re-trips OPEN
      breaker.onFailure(new AIProviderException("TIMEOUT", "Probe failed"));
      assert.strictEqual(breaker.getState(), "OPEN");
    },
  );

  // -------------------------------------------------------------
  // Test Group 4: Structured Fallback & Degraded Narrative
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 4: Structured Fallback & Degraded Narrative ---",
  );

  await runTest(
    "Structured fallback returns certified template with zero fabricated numbers",
    async () => {
      const fallback = new StructuredFallbackProvider();
      const result = await fallback.generateCandidatePlan({
        prompt: "Executive KPI query",
      });

      assert.strictEqual(result.fromFallback, true);
      assert.strictEqual(result.candidatePlan.isFallback, true);
      assert.strictEqual(result.candidatePlan.confidenceScore, 1.0);
      assert.strictEqual(
        result.candidatePlan.candidateIntents[0].primaryEntity,
        "analytics_summary",
      );
      assert.ok(result.narrative?.includes("degraded"));
    },
  );

  await runTest(
    "Narrative provider failure activates immediate degraded mode with HTTP 200",
    () => {
      const handler = new NarrativeFallbackHandler();
      const degradedResult = handler.handleProviderDegraded(
        "Narrative model timeout",
      );

      assert.strictEqual(degradedResult.isDegraded, true);
      assert.strictEqual(degradedResult.status, "COPILOT_MODEL_DEGRADED");
      assert.strictEqual(degradedResult.httpStatusCode, 200);
      assert.ok(degradedResult.narrative.includes("degraded"));
    },
  );

  await runTest(
    "Narrative validation failure returns certified server narrative with HTTP 200",
    () => {
      const handler = new NarrativeFallbackHandler();
      const result = handler.handleValidationFailure(
        "Hallucinated metric claim detected",
      );

      assert.strictEqual(result.isDegraded, true);
      assert.strictEqual(result.status, "COPILOT_NARRATIVE_VALIDATION_FAILED");
      assert.strictEqual(result.httpStatusCode, 200);
      assert.ok(
        result.narrative.includes("Standard certified analytical calculation"),
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 5: Observability & Resilience Metrics Tracking
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 5: Observability & Resilience Metrics Tracking ---",
  );

  await runTest(
    "Metrics collector accurately records operations, retries, and circuit events",
    () => {
      const metrics = new AIResilienceMetrics();

      metrics.recordRequest();
      metrics.recordSuccess(40);
      metrics.recordRequest();
      metrics.recordFailure(true);
      metrics.recordRetry(true);
      metrics.recordCircuitOpen();
      metrics.recordFallback();
      metrics.recordDegraded();

      const snapshot = metrics.getSnapshot();
      assert.strictEqual(snapshot.totalRequests, 2);
      assert.strictEqual(snapshot.successRequests, 1);
      assert.strictEqual(snapshot.failedRequests, 1);
      assert.strictEqual(snapshot.transientFailures, 1);
      assert.strictEqual(snapshot.retriesAttempted, 1);
      assert.strictEqual(snapshot.retriesSucceeded, 1);
      assert.strictEqual(snapshot.circuitOpenEvents, 1);
      assert.strictEqual(snapshot.fallbackCount, 1);
      assert.strictEqual(snapshot.degradedResponses, 1);
      assert.strictEqual(snapshot.averageLatencyMs, 40);
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
