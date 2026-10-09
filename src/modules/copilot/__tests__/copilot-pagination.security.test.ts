import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { createCopilotController } from "../copilot.controller.js";
import { createCopilotService, CopilotError } from "../copilot.service.js";
import { paginationService, computeFilterHash } from "../pagination.service.js";
import { createMockConversationRepository } from "./test-utils.js";

process.env.ACCESS_TOKEN_SECRET = "test_super_secret_cursor_hmac_key_12345";

function createMockResponse() {
  let capturedStatus: number = 200;
  let capturedJson: any = null;

  const res: any = {
    status(s: number) {
      capturedStatus = s;
      return this;
    },
    json(data: any) {
      capturedJson = data;
      return this;
    },
    setHeader() {},
  };

  return {
    res,
    getStatus: () => capturedStatus,
    getJson: () => capturedJson,
  };
}

async function runPaginationSecurityTests() {
  console.log("==================================================");
  console.log("     COPILOT PAGINATION SECURITY TESTS            ");
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

  // 1. Cross-User Cursor Replay
  await test("Security: User A cannot use User B's cursor (400 INVALID_CURSOR)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv1 = await repo.create(1, locale_code.en);
    const conv2 = await repo.create(2, locale_code.en);
    const convModel1 = repo.conversations.find(
      (c) => c.conversation_uuid === conv1.conversation_uuid,
    )!;

    for (let i = 1; i <= 3; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel1.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Msg ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    const page1 = await service.history(1, conv1.conversation_uuid, 2);
    const cursorUser1 = page1.page.next_cursor!;

    // User 2 tries to use User 1's cursor on their own conversation
    await assert.rejects(
      async () => service.history(2, conv2.conversation_uuid, 2, cursorUser1),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 2. Cross-Conversation Cursor Replay
  await test("Security: Cursor cannot be used across different conversations of the same user", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv1 = await repo.create(1, locale_code.en);
    const conv2 = await repo.create(1, locale_code.en);
    const convModel1 = repo.conversations.find(
      (c) => c.conversation_uuid === conv1.conversation_uuid,
    )!;

    for (let i = 1; i <= 3; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel1.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Msg ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    const page1 = await service.history(1, conv1.conversation_uuid, 2);
    const cursorConv1 = page1.page.next_cursor!;

    // Same user uses cursor on conv2
    await assert.rejects(
      async () => service.history(1, conv2.conversation_uuid, 2, cursorConv1),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 3. Tampered Cursor Rejection
  await test("Security: Tampered payload or signature is rejected immediately without fallback to page 1", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);

    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 1,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
    });

    // Case 1: Tampered payload
    const [payload, sig] = cursor.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    decoded.mid = 999999;
    const modifiedPayload = Buffer.from(JSON.stringify(decoded)).toString(
      "base64url",
    );
    const tamperedPayloadCursor = `${modifiedPayload}.${sig}`;

    await assert.rejects(
      async () =>
        service.history(1, conv.conversation_uuid, 10, tamperedPayloadCursor),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );

    // Case 2: Tampered signature
    const tamperedSigCursor = `${payload}.${sig.slice(0, -3)}abc`;
    await assert.rejects(
      async () =>
        service.history(1, conv.conversation_uuid, 10, tamperedSigCursor),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 4. Query Filter Modification Invalidation
  await test("Security: Modifying query filters invalidates cursor (Requirement 9)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    for (let i = 1; i <= 3; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Msg ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    // Request 1 with filter X
    const page1 = await service.history(
      1,
      conv.conversation_uuid,
      2,
      undefined,
      {
        section: "finance",
      },
    );
    const cursor = page1.page.next_cursor!;

    // Request 2 with filter Y (different query filter)
    await assert.rejects(
      async () =>
        service.history(1, conv.conversation_uuid, 2, cursor, {
          section: "marketing",
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 5. Cursor Never Leaks Sensitive Data
  await test("Security: Cursors do not contain questions, answers, credentials, or SQL", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 10,
      conversationId: 20,
      limit: 50,
      createdAt: new Date(),
      messageId: 100,
    });

    const [payloadB64] = cursor.split(".");
    const decodedStr = Buffer.from(payloadB64, "base64url").toString("utf8");

    assert.ok(!decodedStr.includes("password"));
    assert.ok(!decodedStr.includes("bearer"));
    assert.ok(!decodedStr.includes("SELECT"));
    assert.ok(!decodedStr.includes("token"));
    assert.ok(!decodedStr.includes("text"));

    const parsed = JSON.parse(decodedStr);
    assert.strictEqual(parsed.uid, 10);
    assert.strictEqual(parsed.cid, 20);
    assert.strictEqual(parsed.mid, 100);
    assert.ok(parsed.exp);
  });

  console.log("==================================================");
  console.log(` PAGINATION SECURITY TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runPaginationSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
