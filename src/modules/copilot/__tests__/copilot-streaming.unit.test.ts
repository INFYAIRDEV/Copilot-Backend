import assert from "node:assert";
import {
  formatSseEvent,
  sanitizeStreamChunk,
  STREAM_EVENT_TYPES,
  ChatStreamEmitter,
} from "../streaming.types.js";
import {
  CopilotStreamingService,
  StreamChatRequest,
} from "../copilot-streaming.service.js";
import { createMockConversationRepository } from "./test-utils.js";
import { message_kind, message_role } from "@prisma/client";
import { CopilotError } from "../copilot.error.js";
import { IAIService } from "@/modules/ai/index.js";

async function runStreamingUnitTests() {
  console.log("==================================================");
  console.log("        COPILOT STREAMING UNIT TESTS              ");
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

  // 1. SSE Wire Format Transformation
  await test("formatSseEvent formats standard SSE wire messages", () => {
    const raw = formatSseEvent(STREAM_EVENT_TYPES.RESPONSE_STARTED, {
      conversation_uuid: "123e4567-e89b-12d3-a456-426614174000",
      request_uuid: "req-001",
      created_at: "2026-10-09T00:00:00Z",
    });

    assert.ok(raw.startsWith("event: response_started\n"));
    assert.ok(raw.includes('data: {"conversation_uuid":'));
    assert.ok(raw.endsWith("\n\n"));
  });

  // 2. Sensitive Data Chunk Sanitization
  await test("sanitizeStreamChunk redacts passwords, bearer tokens, API keys, and SQL", () => {
    assert.strictEqual(
      sanitizeStreamChunk("password = 'super_secret'"),
      "[REDACTED]",
    );
    assert.strictEqual(
      sanitizeStreamChunk("Authorization: Bearer my-secret-jwt-token-1234"),
      "Authorization: [REDACTED]",
    );
    assert.strictEqual(
      sanitizeStreamChunk("api_key = 'abcdef123456'"),
      "[REDACTED]",
    );
    assert.strictEqual(
      sanitizeStreamChunk("SELECT * FROM sensitive_users WHERE id = 1"),
      "[REDACTED]",
    );
    assert.strictEqual(
      sanitizeStreamChunk("Safe narrative chunk showing revenue metrics."),
      "Safe narrative chunk showing revenue metrics.",
    );
  });

  // 3. Successful Streaming Flow with Mock AI Service
  await test("streamChatResponse emits start, chunks, result, and complete events", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

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

    const mockAiService: IAIService = {
      generateCandidatePlan: async () => ({
        candidatePlan: {
          planId: "plan-unit-1",
          candidateIntents: [
            {
              intentType: "AGGREGATION",
              primaryEntity: "sales",
              dimensions: ["country"],
              metrics: ["sales_total"],
            },
          ],
          confidenceScore: 0.95,
          reasoningSummary: "Here are the sales by country.",
          suggestedVisualization: "BAR_CHART",
          isFallback: false,
        },
        narrative: "Here are the sales by country.",
        usage: {
          provider: "MOCK",
          model: "mock-v1",
          inputTokens: 50,
          outputTokens: 75,
          totalTokens: 125,
          latencyMs: 40,
          retryCount: 0,
          requestOutcome: "SUCCESS",
        },
        fromFallback: false,
        isDegraded: false,
      }),
      generateCandidatePlanStream: async (_req, onChunk) => {
        onChunk("Here are ");
        onChunk("the sales ");
        onChunk("by country.");
        return {
          candidatePlan: {
            planId: "plan-unit-1",
            candidateIntents: [
              {
                intentType: "AGGREGATION",
                primaryEntity: "sales",
                dimensions: ["country"],
                metrics: ["sales_total"],
              },
            ],
            confidenceScore: 0.95,
            reasoningSummary: "Here are the sales by country.",
            suggestedVisualization: "BAR_CHART",
            isFallback: false,
          },
          narrative: "Here are the sales by country.",
          usage: {
            provider: "MOCK",
            model: "mock-v1",
            inputTokens: 50,
            outputTokens: 75,
            totalTokens: 125,
            latencyMs: 40,
            retryCount: 0,
            requestOutcome: "SUCCESS",
          },
          fromFallback: false,
          isDegraded: false,
        };
      },
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined as any,
      undefined as any,
      mockAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-key-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales by country",
      },
      emitter,
    });

    const types = emittedEvents.map((e) => e.event);
    assert.ok(types.includes("start"), "Must emit start");
    assert.ok(types.includes("chunk"), "Must emit chunk");
    assert.ok(types.includes("result"), "Must emit result");
    assert.ok(types.includes("complete"), "Must emit complete");
    assert.ok(!types.includes("error"), "Must not emit error on success");

    const completeEvent = emittedEvents.find((e) => e.event === "complete");
    assert.ok(
      completeEvent?.data.message_id,
      "Complete event must have message_id",
    );
    assert.strictEqual(completeEvent?.data.role, "ASSISTANT");
    assert.strictEqual(completeEvent?.data.usage.total_tokens, 125);
  });

  // 4. Client Disconnect Handling
  await test("Client cancellation stops streaming and does not mark response completed", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const emittedEvents: Array<{ event: string; data: any }> = [];
    let isAborted = false;

    const emitter: ChatStreamEmitter = {
      emitStart: (d) => emittedEvents.push({ event: "start", data: d }),
      emitChunk: (d) => {
        emittedEvents.push({ event: "chunk", data: d });
        // Simulate client disconnect after first chunk
        isAborted = true;
      },
      emitResult: (d) => emittedEvents.push({ event: "result", data: d }),
      emitDegraded: (d) => emittedEvents.push({ event: "degraded", data: d }),
      emitComplete: (d) => emittedEvents.push({ event: "complete", data: d }),
      emitError: (d) => emittedEvents.push({ event: "error", data: d }),
      isAborted: () => isAborted,
      abort: () => {
        isAborted = true;
      },
    };

    const mockAiService: IAIService = {
      generateCandidatePlan: async () => {
        throw new Error("Should not be called");
      },
      generateCandidatePlanStream: async (_req, onChunk) => {
        onChunk("First chunk");
        onChunk("Second chunk");
        return {
          candidatePlan: {
            planId: "p1",
            candidateIntents: [],
            confidenceScore: 0.5,
            isFallback: false,
          },
          usage: {
            provider: "MOCK",
            model: "m1",
            inputTokens: 10,
            outputTokens: 10,
            totalTokens: 20,
            latencyMs: 10,
            retryCount: 0,
            requestOutcome: "SUCCESS",
          },
          fromFallback: false,
          isDegraded: false,
        };
      },
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined as any,
      undefined as any,
      mockAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-key-abort",
      message: {
        kind: message_kind.QUESTION,
        text: "Abort this query",
      },
      emitter,
    });

    const types = emittedEvents.map((e) => e.event);
    assert.ok(types.includes("start"));
    assert.ok(types.includes("chunk"));
    assert.ok(
      !types.includes("complete"),
      "Must NOT emit complete when aborted",
    );
  });

  // 5. Degraded Response Event on Fallback
  await test("Degraded mode emits degraded_response event", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

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

    const fallbackAiService: IAIService = {
      generateCandidatePlan: async () => ({
        candidatePlan: {
          planId: "fallback-plan",
          candidateIntents: [],
          confidenceScore: 0.2,
          isFallback: true,
        },
        narrative: "Operating in degraded mode due to upstream outage.",
        usage: {
          provider: "FALLBACK",
          model: "deterministic-fallback",
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          latencyMs: 5,
          retryCount: 1,
          requestOutcome: "FALLBACK",
        },
        fromFallback: true,
        fallbackReason: "Provider connection failed",
        isDegraded: true,
      }),
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined as any,
      undefined as any,
      fallbackAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-key-degraded",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales",
      },
      emitter,
    });

    const degraded = emittedEvents.find((e) => e.event === "degraded");
    assert.ok(degraded, "Must emit degraded event");
    assert.strictEqual(degraded.data.reason, "Provider connection failed");
  });

  console.log("==================================================");
  console.log(` STREAMING UNIT TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runStreamingUnitTests().catch((err) => {
  console.error("Streaming unit tests failed:", err);
  process.exit(1);
});
