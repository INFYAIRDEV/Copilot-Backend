import assert from "node:assert";
import { createMockConversationRepository } from "./test-utils.js";
import { CopilotStreamingService } from "../copilot-streaming.service.js";
import {
  ChatStreamEmitter,
  STREAM_SENSITIVE_PATTERNS,
} from "../streaming.types.js";
import { message_kind } from "@prisma/client";
import { IAIService } from "@/modules/ai/index.js";

async function runStreamingSecurityTests() {
  console.log("==================================================");
  console.log("        COPILOT STREAMING SECURITY TESTS          ");
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

  // 1. Cross-User Conversation Access
  await test("Security: User A cannot stream messages from User B's conversation (403)", async () => {
    const repo = createMockConversationRepository();
    const convUserB = await repo.create(200); // Owner 200

    const streamingService = new CopilotStreamingService(repo as any);
    let threw = false;

    try {
      await streamingService.streamChatResponse({
        userId: 100, // User A
        conversationUuid: convUserB.conversation_uuid,
        idempotencyKey: "cross-user-key",
        message: { kind: message_kind.QUESTION, text: "Show private data" },
        emitter: { isAborted: () => false } as any,
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must reject cross-user streaming");
  });

  // 2. Insufficient Permissions (copilot.ask required)
  await test("Security: Missing copilot.ask permission is rejected with 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const streamingService = new CopilotStreamingService(repo as any);
    let threw = false;

    try {
      await streamingService.streamChatResponse({
        userId: 1,
        userPermissions: ["copilot.read"], // Does not have copilot.ask
        conversationUuid: conv.conversation_uuid,
        idempotencyKey: "perm-check-key",
        message: { kind: message_kind.QUESTION, text: "Unauthorized question" },
        emitter: { isAborted: () => false } as any,
      });
    } catch (err: any) {
      threw = true;
      assert.strictEqual(err.statusCode, 403);
      assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
    }
    assert.ok(threw, "Must reject missing copilot.ask");
  });

  // 3. Raw Provider Payloads and Sensitive Data Not Exposed in Stream Chunks
  await test("Security: Raw SQL, database passwords, and API credentials are redacted from chunks", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const streamedChunks: string[] = [];
    const emitter: ChatStreamEmitter = {
      emitStart: () => {},
      emitChunk: (d) => streamedChunks.push(d.delta),
      emitResult: () => {},
      emitDegraded: () => {},
      emitComplete: () => {},
      emitError: () => {},
      isAborted: () => false,
      abort: () => {},
    };

    // AI returns sensitive tokens in narrative
    const mockAiService: IAIService = {
      generateCandidatePlan: async () => {
        throw new Error("Should not be called");
      },
      generateCandidatePlanStream: async (_req, onChunk) => {
        onChunk("Connecting using password = 'super_secret_db_pass' ");
        onChunk("and Bearer eyJhbGciOiJIUzI1NiIsIn... ");
        onChunk(
          "running query: SELECT id, password_hash FROM user_credentials;",
        );
        return {
          candidatePlan: {
            planId: "p-leak-test",
            candidateIntents: [],
            confidenceScore: 0.8,
            isFallback: false,
          },
          narrative: "done",
          usage: {
            provider: "MOCK",
            model: "m1",
            inputTokens: 10,
            outputTokens: 20,
            totalTokens: 30,
            latencyMs: 15,
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
      idempotencyKey: "stream-redact-key",
      message: { kind: message_kind.QUESTION, text: "Trigger leak" },
      emitter,
    });

    const fullStream = streamedChunks.join("");
    assert.ok(
      !fullStream.includes("super_secret_db_pass"),
      "Must not leak password",
    );
    assert.ok(
      !fullStream.includes("eyJhbGciOiJIUzI1NiIsIn"),
      "Must not leak JWT bearer token",
    );
    assert.ok(
      !fullStream.includes("SELECT id, password_hash"),
      "Must not leak raw SQL",
    );
    assert.ok(
      fullStream.includes("[REDACTED]"),
      "Must replace sensitive items with [REDACTED]",
    );
  });

  // 4. Role Authorization Policy: Operator Cannot Access Executive Margin
  await test("Security: Role 'operator' cannot access executive metrics in streamed results", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const emittedEvents: Array<{ event: string; data: any }> = [];
    const emitter: ChatStreamEmitter = {
      emitStart: () => {},
      emitChunk: () => {},
      emitResult: (d) => emittedEvents.push({ event: "result", data: d }),
      emitDegraded: () => {},
      emitComplete: () => {},
      emitError: () => {},
      isAborted: () => false,
      abort: () => {},
    };

    const mockAiService: IAIService = {
      generateCandidatePlan: async () => {
        throw new Error("Should not be called");
      },
      generateCandidatePlanStream: async () => ({
        candidatePlan: {
          planId: "exec-plan-leak",
          candidateIntents: [
            {
              intentType: "AGGREGATION",
              primaryEntity: "finance",
              dimensions: [],
              metrics: ["executive_cost_margin"], // Blocked for operator
            },
          ],
          confidenceScore: 0.9,
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
      }),
    };

    const streamingService = new CopilotStreamingService(
      repo as any,
      undefined,
      undefined,
      mockAiService,
    );

    await streamingService.streamChatResponse({
      userId: 1,
      userRoleId: "operator", // Operator role
      conversationUuid: conv.conversation_uuid,
      idempotencyKey: "stream-operator-blocked",
      message: { kind: message_kind.QUESTION, text: "Show margin" },
      emitter,
    });

    // Result event must NOT be emitted because policy validation failed
    assert.strictEqual(
      emittedEvents.filter((e) => e.event === "result").length,
      0,
      "Unauthorized candidate plan must not be emitted in result_available",
    );
  });

  // 5. Result Event Contains Only Sanitized Minimum Metadata (No SQL or AST)
  await test("Security: result_available event emits only approved high-level plan metadata", async () => {
    const repo = createMockConversationRepository();
    const conv = await repo.create(1);

    const emittedResults: any[] = [];
    const emitter: ChatStreamEmitter = {
      emitStart: () => {},
      emitChunk: () => {},
      emitResult: (d) => emittedResults.push(d),
      emitDegraded: () => {},
      emitComplete: () => {},
      emitError: () => {},
      isAborted: () => false,
      abort: () => {},
    };

    const mockAiService: IAIService = {
      generateCandidatePlan: async () => {
        throw new Error("Should not be called");
      },
      generateCandidatePlanStream: async () => ({
        candidatePlan: {
          planId: "plan-safe-meta",
          candidateIntents: [
            {
              intentType: "AGGREGATION",
              primaryEntity: "orders",
              dimensions: ["country"],
              metrics: ["orders_count"],
            },
          ],
          confidenceScore: 0.92,
          suggestedVisualization: "BAR_CHART",
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
      }),
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
      idempotencyKey: "stream-safe-res-key",
      message: { kind: message_kind.QUESTION, text: "Count orders" },
      emitter,
    });

    assert.strictEqual(emittedResults.length, 1);
    const result = emittedResults[0];
    assert.strictEqual(result.plan_id, "plan-safe-meta");
    assert.strictEqual(result.confidence_score, 0.92);
    assert.strictEqual(result.suggested_visualization, "BAR_CHART");
    assert.strictEqual(result.sql, undefined, "Must NOT contain SQL");
    assert.strictEqual(result.ast, undefined, "Must NOT contain internal AST");
  });

  console.log("==================================================");
  console.log(` STREAMING SECURITY TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runStreamingSecurityTests().catch((err) => {
  console.error("Streaming security tests failed:", err);
  process.exit(1);
});
