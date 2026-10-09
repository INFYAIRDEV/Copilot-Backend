import assert from "node:assert";
import {
  AIResponseHandler,
  defaultAIResponseHandler,
  AIResponseValidator,
  AIResponseNormalizer,
  AIResponseException,
  AIResponseStatus,
  HandledAIResponse,
} from "../response/index.js";
import {
  AIProviderResponse,
  ModelCandidatePlan,
  AIProviderException,
} from "../types/ai-provider.types.js";
import { AIService } from "../services/ai.service.js";
import { IAIProvider } from "../interfaces/ai-provider.interface.js";
import {
  AIServiceRequest,
  AIServiceException,
} from "../types/ai-service.types.js";

/**
 * AI Response Handling Test Suite
 *
 * Verifies that the AI Response Handling layer correctly validates,
 * normalizes, and isolates AI responses from downstream semantic, policy,
 * and execution layers.
 */

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

// Sample valid candidate plan
const validCandidatePlan: ModelCandidatePlan = {
  planId: "plan-test-001",
  confidenceScore: 0.95,
  isFallback: false,
  reasoningSummary: "Aggregation of monthly revenue by product line",
  suggestedVisualization: "BAR_CHART",
  candidateIntents: [
    {
      intentType: "AGGREGATION",
      primaryEntity: "sales_transaction",
      dimensions: ["product_line", "transaction_month"],
      metrics: ["total_revenue", "order_count"],
      filters: [
        {
          field: "region",
          operator: "=",
          value: "NORTH_AMERICA",
        },
      ],
      timeRange: {
        granularity: "MONTH",
      },
      limit: 10,
    },
  ],
};

const validProviderResponse: AIProviderResponse = {
  candidatePlan: validCandidatePlan,
  narrative:
    "North America generated positive revenue growth over product lines.",
  usage: {
    providerName: "TEST_AI_PROVIDER",
    modelName: "test-model-v2",
    modelVersion: "2.0.0",
    inputTokens: 120,
    outputTokens: 80,
    totalTokens: 200,
    latencyMs: 45,
    retryCount: 0,
    estimatedCostUsd: 0.0003,
  },
  fromFallback: false,
};

async function runAllTests() {
  console.log("==================================================");
  console.log("     AI RESPONSE HANDLING TEST SUITE              ");
  console.log("==================================================");

  // -------------------------------------------------------------
  // Test Group 1: Successful Response Handling & Normalization
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 1: Successful Response Handling & Normalization ---",
  );

  await runTest(
    "Normalizes valid AI response into application-owned HandledAIResponse",
    () => {
      const handler = new AIResponseHandler();
      const result = handler.handleResponse(validProviderResponse, {
        correlationId: "corr-1001",
        purpose: "CANDIDATE_PLAN",
        startTime: Date.now() - 50,
      });

      assert.strictEqual(result.status, "SUCCESS");
      assert.strictEqual(result.isDegraded, false);
      assert.strictEqual(result.fromFallback, false);
      assert.strictEqual(result.candidatePlan.planId, "plan-test-001");
      assert.strictEqual(result.usage.providerName, "TEST_AI_PROVIDER");
      assert.strictEqual(result.usage.totalTokens, 200);
      assert.strictEqual(result.metadata.correlationId, "corr-1001");
      assert.ok(result.metadata.planHash);
      assert.ok(result.metadata.outputHash);
    },
  );

  await runTest(
    "Calculates deterministic SHA-256 hash for identical candidate plans",
    () => {
      const hash1 = AIResponseNormalizer.hashObject(validCandidatePlan);
      const clone = JSON.parse(JSON.stringify(validCandidatePlan));
      const hash2 = AIResponseNormalizer.hashObject(clone);
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64);
    },
  );

  await runTest(
    "Exposes normalized telemetry record matching copilot.model_usage",
    () => {
      const handler = new AIResponseHandler();
      const result = handler.handleResponse(validProviderResponse, {
        correlationId: "corr-1002",
        purpose: "EXECUTIVE_QUERY",
      });

      const telemetry = result.telemetryRecord;
      assert.strictEqual(telemetry.requestUuid, "corr-1002");
      assert.strictEqual(telemetry.provider, "TEST_AI_PROVIDER");
      assert.strictEqual(telemetry.model, "test-model-v2");
      assert.strictEqual(telemetry.inputTokens, 120);
      assert.strictEqual(telemetry.outputTokens, 80);
      assert.strictEqual(telemetry.totalTokens, 200);
      assert.strictEqual(telemetry.purpose, "EXECUTIVE_QUERY");
      assert.strictEqual(telemetry.status, "SUCCESS");
    },
  );

  await runTest(
    "Exposes normalized audit metadata matching copilot.audit_event",
    () => {
      const handler = new AIResponseHandler();
      const result = handler.handleResponse(validProviderResponse, {
        correlationId: "corr-1003",
      });

      const audit = result.auditMetadata;
      assert.strictEqual(audit.requestUuid, "corr-1003");
      assert.strictEqual(audit.providerName, "TEST_AI_PROVIDER");
      assert.strictEqual(audit.modelName, "test-model-v2");
      assert.strictEqual(audit.status, "SUCCESS");
      assert.ok(audit.planHash);
      assert.deepStrictEqual(audit.warningCodes, []);
    },
  );

  // -------------------------------------------------------------
  // Test Group 2: Degraded and Structured Fallback Handling
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 2: Degraded and Structured Fallback Handling ---",
  );

  await runTest(
    "Handles structured fallback response and classifies status as FALLBACK",
    () => {
      const fallbackResponse: AIProviderResponse = {
        ...validProviderResponse,
        fromFallback: true,
        fallbackReason:
          "Primary provider rate limited; certified template applied",
        candidatePlan: {
          ...validCandidatePlan,
          isFallback: true,
        },
      };

      const handler = new AIResponseHandler();
      const result = handler.handleResponse(fallbackResponse, {
        correlationId: "corr-fallback-1",
      });

      assert.strictEqual(result.status, "FALLBACK");
      assert.strictEqual(result.fromFallback, true);
      assert.strictEqual(result.isDegraded, true);
      assert.strictEqual(
        result.fallbackReason,
        "Primary provider rate limited; certified template applied",
      );
      assert.strictEqual(result.usage.requestOutcome, "FALLBACK");
      assert.ok(
        result.auditMetadata.warningCodes.includes("COPILOT_FALLBACK_APPLIED"),
      );
    },
  );

  await runTest(
    "Translates provider failure into application-level AIResponseException",
    () => {
      const handler = new AIResponseHandler();
      const providerErr = new AIProviderException(
        "UNAVAILABLE",
        "Connection to model provider failed",
        "OPENAI_PROVIDER",
      );

      assert.throws(
        () => {
          handler.handleProviderFailure(providerErr, {
            correlationId: "corr-err-1",
            providerName: "OPENAI_PROVIDER",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_MODEL_UNAVAILABLE");
          assert.strictEqual(err.statusCode, 503);
          assert.strictEqual(err.correlationId, "corr-err-1");
          // Ensure raw SDK details are sanitized
          assert.ok(!err.message.includes("OpenAI"));
          return true;
        },
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 3: Malformed, Empty, and Incomplete Response Handling
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 3: Malformed, Empty, and Incomplete Response Handling ---",
  );

  await runTest("Rejects null or empty response envelope", () => {
    const handler = new AIResponseHandler();
    assert.throws(
      () => {
        handler.handleResponse(null, { correlationId: "corr-empty-1" });
      },
      (err: any) => {
        assert.ok(err instanceof AIResponseException);
        assert.strictEqual(err.code, "COPILOT_MALFORMED_CANDIDATE");
        assert.ok(
          err.details.some((d: string) => d.includes("non-null object")),
        );
        return true;
      },
    );
  });

  await runTest("Rejects response missing candidatePlan", () => {
    const handler = new AIResponseHandler();
    const emptyPayload = { usage: { inputTokens: 10 } };
    assert.throws(
      () => {
        handler.handleResponse(emptyPayload, { correlationId: "corr-empty-2" });
      },
      (err: any) => {
        assert.ok(err instanceof AIResponseException);
        assert.strictEqual(err.code, "COPILOT_MALFORMED_CANDIDATE");
        assert.ok(
          err.details.some((d: string) =>
            d.includes("Missing 'candidatePlan'"),
          ),
        );
        return true;
      },
    );
  });

  await runTest(
    "Rejects candidate plan with missing planId or invalid confidenceScore",
    () => {
      const handler = new AIResponseHandler();
      const invalidPlan = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          planId: "", // empty
          confidenceScore: 2.5, // out of [0, 1] bounds
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(invalidPlan, {
            correlationId: "corr-bad-plan",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_MALFORMED_CANDIDATE");
          assert.ok(err.details.some((d: string) => d.includes("planId")));
          assert.ok(
            err.details.some((d: string) => d.includes("confidenceScore")),
          );
          return true;
        },
      );
    },
  );

  await runTest(
    "Rejects candidate plan with empty candidateIntents array",
    () => {
      const handler = new AIResponseHandler();
      const emptyIntents = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          candidateIntents: [],
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(emptyIntents, {
            correlationId: "corr-no-intents",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_MALFORMED_CANDIDATE");
          assert.ok(
            err.details.some((d: string) => d.includes("candidateIntents")),
          );
          return true;
        },
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 4: SQL Execution Boundary & Untrusted Output Enforcement
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 4: SQL Execution Boundary & Untrusted Output Enforcement ---",
  );

  await runTest(
    "Rejects candidate plan attempting SQL query injection in primaryEntity",
    () => {
      const handler = new AIResponseHandler();
      const sqlInjectionPayload = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          candidateIntents: [
            {
              ...validCandidatePlan.candidateIntents[0],
              primaryEntity: "sales; DROP TABLE analytics.metric; --",
            },
          ],
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(sqlInjectionPayload, {
            correlationId: "corr-sql-1",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_UNSAFE_AI_OUTPUT");
          assert.strictEqual(err.statusCode, 400);
          assert.ok(err.details.some((d: string) => d.includes("SQL syntax")));
          return true;
        },
      );
    },
  );

  await runTest(
    "Rejects candidate plan attempting SELECT FROM in dimensions or metrics",
    () => {
      const handler = new AIResponseHandler();
      const sqlInMetric = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          candidateIntents: [
            {
              ...validCandidatePlan.candidateIntents[0],
              metrics: ["SELECT password FROM users"],
            },
          ],
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(sqlInMetric, { correlationId: "corr-sql-2" });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_UNSAFE_AI_OUTPUT");
          assert.ok(
            err.details.some((d: string) =>
              d.includes("metric contains SQL syntax"),
            ),
          );
          return true;
        },
      );
    },
  );

  await runTest(
    "Rejects candidate plan attempting UNION SELECT in filters",
    () => {
      const handler = new AIResponseHandler();
      const sqlInFilter = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          candidateIntents: [
            {
              ...validCandidatePlan.candidateIntents[0],
              filters: [
                {
                  field: "region",
                  operator: "=",
                  value: "' UNION SELECT 1, 2, 3 --",
                },
              ],
            },
          ],
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(sqlInFilter, { correlationId: "corr-sql-3" });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_UNSAFE_AI_OUTPUT");
          return true;
        },
      );
    },
  );

  await runTest(
    "Rejects response when narrative contains executable SQL instructions",
    () => {
      const handler = new AIResponseHandler();
      const sqlInNarrative = {
        ...validProviderResponse,
        narrative:
          "Execute this query to get details: SELECT * FROM audit_log;",
      };

      assert.throws(
        () => {
          handler.handleResponse(sqlInNarrative, {
            correlationId: "corr-sql-4",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_UNSAFE_AI_OUTPUT");
          return true;
        },
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 5: Response Size Limits & Complexity Bounds
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 5: Response Size Limits & Complexity Bounds ---",
  );

  await runTest(
    "Rejects response exceeding maximum candidate intents limit",
    () => {
      const handler = new AIResponseHandler({ maxCandidateIntents: 2 });
      const tooManyIntents = {
        ...validProviderResponse,
        candidatePlan: {
          ...validCandidatePlan,
          candidateIntents: [
            validCandidatePlan.candidateIntents[0],
            validCandidatePlan.candidateIntents[0],
            validCandidatePlan.candidateIntents[0], // 3 intents > limit 2
          ],
        },
      };

      assert.throws(
        () => {
          handler.handleResponse(tooManyIntents, {
            correlationId: "corr-too-many",
          });
        },
        (err: any) => {
          assert.ok(err instanceof AIResponseException);
          assert.strictEqual(err.code, "COPILOT_MALFORMED_CANDIDATE");
          assert.ok(
            err.details.some((d: string) => d.includes("exceeds limit")),
          );
          return true;
        },
      );
    },
  );

  await runTest("Rejects response exceeding maximum narrative length", () => {
    const handler = new AIResponseHandler({ maxNarrativeLength: 50 });
    const longNarrative = {
      ...validProviderResponse,
      narrative:
        "This narrative is intentionally constructed to exceed the strict 50 character limit for testing.",
    };

    assert.throws(
      () => {
        handler.handleResponse(longNarrative, {
          correlationId: "corr-long-narrative",
        });
      },
      (err: any) => {
        assert.ok(err instanceof AIResponseException);
        assert.strictEqual(err.code, "COPILOT_RESPONSE_TOO_LARGE");
        assert.strictEqual(err.statusCode, 422);
        return true;
      },
    );
  });

  // -------------------------------------------------------------
  // Test Group 6: Narrative Response & Decoupling from Calculation
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 6: Narrative Response & Decoupling from Calculation ---",
  );

  await runTest("Validates and normalizes clean narrative response", () => {
    const handler = new AIResponseHandler();
    const narrativeResult = handler.handleNarrativeResponse(
      "Revenue for Q3 grew by 14% compared to previous quarter.",
      { correlationId: "corr-narrative-1" },
    );

    assert.strictEqual(narrativeResult.isValidated, true);
    assert.strictEqual(narrativeResult.isFallbackNarrative, false);
    assert.ok(narrativeResult.narrative.includes("Revenue for Q3"));
  });

  await runTest("Rejects standalone narrative containing SQL injection", () => {
    const handler = new AIResponseHandler();
    assert.throws(
      () => {
        handler.handleNarrativeResponse(
          "Here is the result: DROP TABLE analytics.metric;",
          { correlationId: "corr-narrative-sql" },
        );
      },
      (err: any) => {
        assert.ok(err instanceof AIResponseException);
        assert.strictEqual(err.code, "COPILOT_UNSAFE_AI_OUTPUT");
        return true;
      },
    );
  });

  await runTest(
    "Narrative validation failure returns fallback text without crashing authoritative result",
    () => {
      const handler = new AIResponseHandler();
      // Empty narrative fails validation
      const narrativeResult = handler.handleNarrativeResponse("", {
        correlationId: "corr-empty-narrative",
      });

      assert.strictEqual(narrativeResult.isValidated, false);
      assert.strictEqual(narrativeResult.isFallbackNarrative, true);
      assert.strictEqual(
        narrativeResult.warningCode,
        "COPILOT_NARRATIVE_VALIDATION_FAILED",
      );
      assert.strictEqual(
        narrativeResult.narrative,
        "Standard analytical calculation results generated.",
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 7: AIService Integration with Injected AIResponseHandler
  // -------------------------------------------------------------
  console.log(
    "\n--- Test Group 7: AIService Integration with Injected AIResponseHandler ---",
  );

  await runTest(
    "AIService uses injected AIResponseHandler and returns normalized result",
    async () => {
      const mockProvider: IAIProvider = {
        generateCandidatePlan: async () => validProviderResponse,
        getProviderMetadata: () => ({
          providerName: "TEST_AI_PROVIDER",
          defaultModel: "test-model-v2",
          isAvailable: true,
        }),
      };

      const aiService = new AIService(mockProvider);
      const request: AIServiceRequest = {
        prompt: "Show revenue by product line for North America",
        context: {
          userId: 101,
          roleId: "executive",
        },
      };

      const result = await aiService.generateCandidatePlan(request);
      assert.strictEqual(result.candidatePlan.planId, "plan-test-001");
      assert.strictEqual(result.usage.providerName, "TEST_AI_PROVIDER");
      assert.strictEqual(result.usage.requestOutcome, "SUCCESS");
    },
  );

  await runTest(
    "AIService rejects model response with unsafe SQL instructions",
    async () => {
      const maliciousProvider: IAIProvider = {
        generateCandidatePlan: async () => ({
          ...validProviderResponse,
          candidatePlan: {
            ...validCandidatePlan,
            candidateIntents: [
              {
                ...validCandidatePlan.candidateIntents[0],
                primaryEntity: "sales; TRUNCATE TABLE users; --",
              },
            ],
          },
        }),
        getProviderMetadata: () => ({
          providerName: "MALICIOUS_PROVIDER",
          defaultModel: "evil-model",
          isAvailable: true,
        }),
      };

      const aiService = new AIService(maliciousProvider);
      const request: AIServiceRequest = {
        prompt: "Show sales data",
        context: { userId: 102, roleId: "analyst" },
      };

      await assert.rejects(
        async () => {
          await aiService.generateCandidatePlan(request);
        },
        (err: any) => {
          assert.ok(err instanceof AIServiceException);
          assert.strictEqual(err.code, "COPILOT_INVALID_RESPONSE");
          assert.strictEqual(err.statusCode, 400);
          return true;
        },
      );
    },
  );

  // -------------------------------------------------------------
  // Test Group 8: Architectural Boundaries (Zero Leaks)
  // -------------------------------------------------------------
  console.log("\n--- Test Group 8: Architectural Boundaries (Zero Leaks) ---");

  await runTest(
    "AIResponseHandler has no provider client or database dependencies",
    () => {
      const handler = new AIResponseHandler();
      assert.strictEqual((handler as any).prisma, undefined);
      assert.strictEqual((handler as any).db, undefined);
      assert.strictEqual((handler as any).openai, undefined);
      assert.strictEqual((handler as any).anthropic, undefined);
    },
  );

  await runTest(
    "AIResponseException safe client serialization strips internal details",
    () => {
      const ex = new AIResponseException(
        "COPILOT_INVALID_RESPONSE",
        "Candidate plan failed validation",
        {
          correlationId: "corr-client-test",
          details: ["Missing field X"],
          providerName: "INTERNAL_SECRET_PROVIDER",
        },
      );

      const clientJson = ex.toClientResponse();
      assert.strictEqual(clientJson.error.code, "COPILOT_INVALID_RESPONSE");
      assert.strictEqual(clientJson.error.correlationId, "corr-client-test");
      assert.deepStrictEqual(clientJson.error.details, ["Missing field X"]);
      // Confirm provider internals are not serialized in the client response
      assert.strictEqual((clientJson.error as any).providerName, undefined);
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
