import assert from "node:assert";
import { createMockConversationRepository } from "./test-utils.js";
import { CopilotStreamingService } from "../copilot-streaming.service.js";
import { ChatStreamEmitter } from "../streaming.types.js";
import { message_kind } from "@prisma/client";
import {
  ResilientAIProvider,
  IAIProvider,
  AIProviderException,
  AIService,
} from "@/modules/ai/index.js";

async function runStreamingResilienceTests() {
  console.log("==================================================");
  console.log("       COPILOT STREAMING RESILIENCE TESTS         ");
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

  // 1. Transient failure with successful single retry during streaming
  await test("Resilience: Transient provider failure succeeds on single permitted retry", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    let attempts = 0;
    const mockFlakyProvider: IAIProvider = {
      getProviderMetadata: () => ({
        providerName: "FLAKY_PROVIDER",
        defaultModel: "flaky-v1",
        isAvailable: true,
      }),
      generateCandidatePlan: async () => {
        throw new Error("generateCandidatePlan called");
      },
      generateCandidatePlanStream: async (_req, onChunk) => {
        attempts++;
        if (attempts === 1) {
          throw new AIProviderException(
            "TRANSIENT_FAILURE",
            "503 Service Unavailable (temporary glitch)",
            "FLAKY_PROVIDER",
          );
        }
        onChunk("Recovered successfully on retry.");
        return {
          candidatePlan: {
            planId: "p-retry-success",
            candidateIntents: [
              {
                intentType: "AGGREGATION",
                primaryEntity: "sales",
                dimensions: ["country"],
                metrics: ["sales_total"],
              },
            ],
            confidenceScore: 0.9,
            isFallback: false,
          },
          narrative: "Recovered successfully on retry.",
          usage: {
            providerName: "FLAKY_PROVIDER",
            modelName: "flaky-v1",
            inputTokens: 10,
            outputTokens: 15,
            totalTokens: 25,
            latencyMs: 30,
            retryCount: 1,
          },
          fromFallback: false,
        };
      },
    };

    const resilientProvider = new ResilientAIProvider(
      mockFlakyProvider,
      undefined,
      undefined,
      {
        retryBackoffMs: 10,
      },
    );
    const aiService = new AIService(resilientProvider);

    const emittedEvents: Array<{ event: string; data: any }> = [];
    const emitter: ChatStreamEmitter = {
      emitStart: (d) => emittedEvents.push({ event: "start", data: d }),
      emitChunk: (d) => emittedEvents.push({ event: "chunk", data: d }),
      emitResult: (d) => emittedEvents.push({ event: "result", data: d }),
      emitDegraded: (d) => emittedEvents.push({ event: "degraded", data: d }),
      emitComplete: (d) => emittedEvents.push({ event: "complete", data: d }),
      emitError: (d) => emittedEvents.push({ event: "error", data: d }),
      isAborted: () => false,
      abort: () => {},
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined,
      undefined,
      aiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-resilience-retry",
      message: { kind: message_kind.QUESTION, text: "Calculate sales" },
      emitter,
    });

    assert.strictEqual(attempts, 2, "Must retry exactly once");
    const complete = emittedEvents.find((e) => e.event === "complete");
    assert.ok(complete, "Must successfully complete stream after retry");
    assert.strictEqual(complete.data.text, "Recovered successfully on retry.");
  });

  // 2. Repeated failure routes to Structured Fallback with degraded_response event
  await test("Resilience: Repeated provider failure routes to structured fallback and emits degraded_response", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const mockAlwaysFailingProvider: IAIProvider = {
      getProviderMetadata: () => ({
        providerName: "FAILING_PROVIDER",
        defaultModel: "fail-v1",
        isAvailable: true,
      }),
      generateCandidatePlan: async () => {
        throw new AIProviderException(
          "UNAVAILABLE",
          "Continuous outage from provider",
          "FAILING_PROVIDER",
        );
      },
      generateCandidatePlanStream: async () => {
        throw new AIProviderException(
          "UNAVAILABLE",
          "Continuous outage from provider",
          "FAILING_PROVIDER",
        );
      },
    };

    const resilientProvider = new ResilientAIProvider(
      mockAlwaysFailingProvider,
      undefined,
      undefined,
      { retryBackoffMs: 5 },
    );
    const aiService = new AIService(resilientProvider);

    const emittedEvents: Array<{ event: string; data: any }> = [];
    const emitter: ChatStreamEmitter = {
      emitStart: (d) => emittedEvents.push({ event: "start", data: d }),
      emitChunk: (d) => emittedEvents.push({ event: "chunk", data: d }),
      emitResult: (d) => emittedEvents.push({ event: "result", data: d }),
      emitDegraded: (d) => emittedEvents.push({ event: "degraded", data: d }),
      emitComplete: (d) => emittedEvents.push({ event: "complete", data: d }),
      emitError: (d) => emittedEvents.push({ event: "error", data: d }),
      isAborted: () => false,
      abort: () => {},
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined,
      undefined,
      aiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-resilience-fallback",
      message: { kind: message_kind.QUESTION, text: "Query outage" },
      emitter,
    });

    const degraded = emittedEvents.find((e) => e.event === "degraded");
    assert.ok(degraded, "Must emit degraded_response on fallback");
    const complete = emittedEvents.find((e) => e.event === "complete");
    assert.ok(complete, "Must complete with fallback narrative");
  });

  // 3. Circuit Breaker is respected and trips when threshold exceeded
  await test("Resilience: Circuit Breaker trips and blocks outbound calls after failure threshold", async () => {
    let callCount = 0;
    const mockDownProvider: IAIProvider = {
      getProviderMetadata: () => ({
        providerName: "DOWN_PROVIDER",
        defaultModel: "down-v1",
        isAvailable: true,
      }),
      generateCandidatePlan: async () => {
        callCount++;
        throw new AIProviderException("UNAVAILABLE", "Outage", "DOWN_PROVIDER");
      },
    };

    const resilientProvider = new ResilientAIProvider(
      mockDownProvider,
      undefined,
      {
        failureThreshold: 1, // Trips after 1 provider execution failure (with internal retry)
        failureThresholdInWindow: 1,
        windowMs: 60000,
        resetTimeoutMs: 60000,
      },
      { retryBackoffMs: 0 },
    );

    const aiService = new AIService(resilientProvider);

    // Call 1: Fails & retries once (callCount = 2) -> circuit trips
    await aiService.generateCandidatePlan({
      prompt: "Query 1",
      context: { userId: 1, roleId: "user" },
    });

    const breaker = resilientProvider.getCircuitBreaker();
    assert.strictEqual(breaker.getState(), "OPEN");

    const callsBefore = callCount;
    // Call 2: Circuit is OPEN -> routes directly to fallback without calling provider
    const res2 = await aiService.generateCandidatePlan({
      prompt: "Query 2",
      context: { userId: 1, roleId: "user" },
    });

    assert.strictEqual(
      callCount,
      callsBefore,
      "Must NOT call downstream provider when circuit is OPEN",
    );
    assert.strictEqual(res2.fromFallback, true);
  });

  // 4. Client disconnect during generation cleans up resources and prevents saving
  await test("Resilience: Aborted client disconnect halts stream processing safely", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    let streamCompleted = false;
    let isAborted = false;

    const emitter: ChatStreamEmitter = {
      emitStart: () => {
        // Disconnect immediately after response starts
        isAborted = true;
      },
      emitChunk: () => {},
      emitResult: () => {},
      emitDegraded: () => {},
      emitComplete: () => {
        streamCompleted = true;
      },
      emitError: () => {},
      isAborted: () => isAborted,
      abort: () => {
        isAborted = true;
      },
    };

    const streamingService = new CopilotStreamingService(repo as any);

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-early-abort",
      message: { kind: message_kind.QUESTION, text: "Early abort" },
      emitter,
    });

    assert.strictEqual(
      streamCompleted,
      false,
      "Must not complete aborted stream",
    );
  });

  console.log("==================================================");
  console.log(` STREAMING RESILIENCE TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
  process.exit(0);
}

runStreamingResilienceTests().catch((err) => {
  console.error("Streaming resilience tests failed:", err);
  process.exit(1);
});
