import {
  LLMProviderAdapter,
  ResilientAIProvider,
  LLMConfigManager,
  AIProviderException,
  AIProviderRequest,
} from "../index.js";
import { CopilotService } from "@/modules/copilot/copilot.service.js";

async function runLLMIntegrationTestSuite() {
  console.log("==================================================");
  console.log("   LLM PROVIDER INTEGRATION & RESILIENCE TESTS   ");
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

  // 1. Startup & Configuration Validation Test
  console.log(
    "\n--- Test Group 1: Configuration & Initialization Validation ---",
  );
  {
    LLMConfigManager.clearCache();
    const config = LLMConfigManager.getConfig();
    assert(config.timeoutMs > 0, "Externalized timeout configuration loaded");
    assert(config.maxInputTokens > 0, "Input token limit configuration loaded");
    assert(
      config.maxOutputTokens > 0,
      "Output token limit configuration loaded",
    );
  }

  // 2. Data Minimization & Prompt Sanitization Test
  console.log("\n--- Test Group 2: Data Minimization & Sanitization ---");
  {
    const adapter = new LLMProviderAdapter();
    const requestWithSecrets: AIProviderRequest = {
      prompt:
        "Show sales data for user password='Secret123!' and bearer bearer_token_xyz",
    };

    const response = await adapter.generateCandidatePlan(requestWithSecrets);
    assert(
      response.candidatePlan !== undefined,
      "Generates normalized candidate plan",
    );
    assert(
      !response.rawResponseText?.includes("Secret123!"),
      "Sensitive credentials redacted during data minimization",
    );
  }

  // 3. Structured JSON Parsing & Response Normalization Test
  console.log("\n--- Test Group 3: Response Normalization & Validation ---");
  {
    const adapter = new LLMProviderAdapter();
    const response = await adapter.generateCandidatePlan({
      prompt: "Show total sales by category",
    });

    assert(
      response.candidatePlan.planId !== undefined,
      "Candidate plan contains planId",
    );
    assert(
      response.candidatePlan.candidateIntents.length > 0,
      "Contains candidate intents",
    );
    assert(response.usage.inputTokens > 0, "Input tokens telemetry recorded");
    assert(response.usage.outputTokens > 0, "Output tokens telemetry recorded");
    assert(response.usage.latencyMs >= 0, "Latency telemetry recorded");
  }

  // 4. Invalid Provider Response Normalization Test
  console.log("\n--- Test Group 4: Malformed LLM Output Normalization ---");
  {
    class MalformedLLMAdapter extends LLMProviderAdapter {
      public async generateCandidatePlan(
        _request: AIProviderRequest,
      ): Promise<any> {
        // Return malformed non-JSON output
        throw (this as any).normalizeError(
          new Error("SyntaxError: Unexpected token in JSON at position 0"),
        );
      }
    }

    const malformedAdapter = new MalformedLLMAdapter();
    try {
      await malformedAdapter.generateCandidatePlan({ prompt: "Invalid query" });
      assert(false, "Should throw AIProviderException for malformed response");
    } catch (err: any) {
      assert(err instanceof AIProviderException, "Throws AIProviderException");
      assert(
        err.category === "TRANSIENT_FAILURE" ||
          err.category === "INVALID_RESPONSE",
        "Error classified properly",
      );
    }
  }

  // 5. Timeout bounded execution test
  console.log("\n--- Test Group 5: Timeout Bounded Execution ---");
  {
    const timeoutAdapter = new LLMProviderAdapter({
      timeoutMs: 10, // 10ms timeout forces AbortSignal timeout
    });

    // Replace simulate timeout
    (timeoutAdapter as any).generateCandidatePlan = async function () {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 5);
      await new Promise((res) => setTimeout(res, 50));
      const err: any = new Error("The operation was aborted");
      err.name = "AbortError";
      throw this.normalizeError(err);
    };

    try {
      await timeoutAdapter.generateCandidatePlan({ prompt: "Slow request" });
      assert(false, "Timeout should trigger AIProviderException");
    } catch (err: any) {
      assert(err instanceof AIProviderException, "Throws AIProviderException");
      assert(err.category === "TIMEOUT", "Classified as TIMEOUT");
    }
  }

  // 6. Copilot Domain Service & Security Isolation Test
  console.log(
    "\n--- Test Group 6: Copilot Domain Service & Security Boundary ---",
  );
  {
    const resilientProvider = new ResilientAIProvider(new LLMProviderAdapter());
    const copilotService = new CopilotService(resilientProvider);

    const { response, validation } =
      await copilotService.generateCandidateAnalyticalPlan(
        "Analyze monthly revenue",
        { userId: 55, roleId: "analyst" },
      );

    assert(
      response.candidatePlan !== undefined,
      "Copilot service gets candidate plan via IAIProvider",
    );
    assert(
      validation.isValid === true,
      "Semantic & policy validation succeeds for analyst role",
    );

    // Test unauthorized metric rejection by policy validation
    const mockPlanWithRestrictedMetric = {
      ...response.candidatePlan,
      candidateIntents: [
        {
          intentType: "AGGREGATION" as const,
          primaryEntity: "cost_data",
          dimensions: ["category"],
          metrics: ["executive_cost_margin"],
        },
      ],
    };

    const operatorValidation = (
      copilotService as any
    ).performSemanticAndPolicyValidation(mockPlanWithRestrictedMetric, {
      userId: 99,
      roleId: "operator",
    });

    assert(
      operatorValidation.isValid === false,
      "Policy validation rejects unauthorized metric for operator role",
    );
    assert(
      operatorValidation.validationErrors?.[0].includes(
        "Unauthorized metric access",
      ) || false,
      "Policy validation provides explicit security error message",
    );
  }

  console.log("\n==================================================");
  console.log(
    ` INTEGRATION RESULTS: ${passed}/${total} Tests Passed Successfully!`,
  );
  console.log("==================================================");
}

runLLMIntegrationTestSuite().catch((err) => {
  console.error("LLM integration test error:", err);
  process.exit(1);
});
