import assert from "node:assert";
import { createMockConversationRepository } from "./test-utils.js";
import { CopilotStreamingService } from "../copilot-streaming.service.js";
import { ChatStreamEmitter } from "../streaming.types.js";
import { message_kind, message_role } from "@prisma/client";
import { CopilotError } from "../copilot.error.js";
import { IAIService } from "@/modules/ai/index.js";

async function runStreamingIntegrationTests() {
  console.log("==================================================");
  console.log("     COPILOT STREAMING INTEGRATION TESTS          ");
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

  // 1. Authenticated Streaming Request & Message Persistence
  await test("Integration: End-to-end streaming persists user and assistant messages with audit correlation", async () => {
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
      generateCandidatePlan: async () => {
        throw new Error("Should not be called");
      },
      generateCandidatePlanStream: async (_req, onChunk) => {
        onChunk("Revenue for Q2 ");
        onChunk("was $1.2M.");
        return {
          candidatePlan: {
            planId: "plan-integ-1",
            candidateIntents: [
              {
                intentType: "AGGREGATION",
                primaryEntity: "sales",
                dimensions: ["period"],
                metrics: ["sales_total"],
              },
            ],
            confidenceScore: 0.98,
            reasoningSummary: "Revenue for Q2 was $1.2M.",
            suggestedVisualization: "KPI_CARD",
            isFallback: false,
          },
          narrative: "Revenue for Q2 was $1.2M.",
          usage: {
            provider: "MOCK",
            model: "mock-v1",
            inputTokens: 30,
            outputTokens: 40,
            totalTokens: 70,
            latencyMs: 25,
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
      undefined,
      undefined,
      mockAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      userRoleId: "analyst",
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-integ-1",
      message: {
        kind: message_kind.QUESTION,
        text: "What was the revenue for Q2?",
      },
      emitter,
    });

    // Verify messages persisted
    const storedConv = await repo.findOwned(conv.conversation_uuid, 1);
    assert.ok(storedConv);
    const messages = await repo.findMessagesByConversationId(storedConv.id);
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].role, message_role.USER);
    assert.strictEqual(messages[0].text, "What was the revenue for Q2?");
    assert.strictEqual(messages[1].role, message_role.ASSISTANT);
    assert.strictEqual(messages[1].text, "Revenue for Q2 was $1.2M.");

    // Verify audit events
    assert.ok(repo.audits.length > 0);
    assert.ok(repo.audits.some((a) => a.event_type === "MESSAGE_CREATED"));
    assert.ok(
      repo.audits.some((a) => a.event_type === "ASSISTANT_MESSAGE_CREATED"),
    );

    // Verify complete event emitted with correct tokens
    const complete = emittedEvents.find((e) => e.event === "complete");
    assert.ok(complete);
    assert.strictEqual(complete.data.usage.total_tokens, 70);
  });

  // 2. Unauthorized request rejection (unauthenticated user ID)
  await test("Integration: Unauthenticated request is rejected with 401 UNAUTHENTICATED", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const streamingService = new CopilotStreamingService(repo as any);
    let threw = false;

    try {
      await streamingService.streamChatResponse({
        userId: 0, // Invalid user id
        conversationUuid: conv.conversation_uuid,
        idempotencyKey: "unauth-key",
        message: { kind: message_kind.QUESTION, text: "Hello" },
        emitter: { isAborted: () => false } as any,
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 401);
      assert.strictEqual(err.code, "UNAUTHENTICATED");
    }
    assert.ok(threw, "Must throw 401 on unauthenticated request");
  });

  // 3. Cross-user conversation rejection
  await test("Integration: Cross-user streaming request is rejected with 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const convOwner2 = await repo.create(2); // Owned by user 2

    const streamingService = new CopilotStreamingService(repo as any);
    let threw = false;

    try {
      await streamingService.streamChatResponse({
        userId: 1, // User 1 attempting to access user 2's conversation
        conversationUuid: convOwner2.conversation_uuid,
        idempotencyKey: "cross-key",
        message: { kind: message_kind.QUESTION, text: "Spy on conversation" },
        emitter: { isAborted: () => false } as any,
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must reject cross-user streaming");
  });

  // 4. Permission check (copilot.ask required)
  await test("Integration: Request without copilot.ask permission is rejected with 403", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const streamingService = new CopilotStreamingService(repo as any);
    let threw = false;

    try {
      await streamingService.streamChatResponse({
        userId: 1,
        userPermissions: ["copilot.read"], // Missing copilot.ask
        conversationUuid: conv.conversation_uuid,
        idempotencyKey: "perm-key",
        message: { kind: message_kind.QUESTION, text: "Query" },
        emitter: { isAborted: () => false } as any,
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must enforce copilot.ask");
  });

  // 5. Answer state consistency: interrupted stream does not mark response completed
  await test("Integration: Interrupted stream does not persist incomplete assistant message as successful", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    let isAborted = false;
    const emitter: ChatStreamEmitter = {
      emitStart: () => {},
      emitChunk: () => {
        isAborted = true; // Client drops connection mid-stream
      },
      emitResult: () => {},
      emitDegraded: () => {},
      emitComplete: () => {
        assert.fail(
          "Complete event must not be emitted when stream is interrupted",
        );
      },
      emitError: () => {},
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
        onChunk("Starting response...");
        return {
          candidatePlan: {
            planId: "p-interrupted",
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
      undefined,
      undefined,
      mockAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-key-interrupt",
      message: {
        kind: message_kind.QUESTION,
        text: "Interrupt me",
      },
      emitter,
    });

    // Verify assistant message was NOT persisted
    const storedConv = await repo.findOwned(conv.conversation_uuid, 1);
    const messages = await repo.findMessagesByConversationId(storedConv!.id);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].role, message_role.USER);
  });

  console.log("==================================================");
  console.log(
    ` STREAMING INTEGRATION TESTS SUMMARY: ${passed}/${total} PASSED`,
  );
  console.log("==================================================");
}

runStreamingIntegrationTests().catch((err) => {
  console.error("Streaming integration tests failed:", err);
  process.exit(1);
});
