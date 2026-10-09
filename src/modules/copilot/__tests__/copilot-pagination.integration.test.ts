import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { createCopilotController } from "../copilot.controller.js";
import { createCopilotService } from "../copilot.service.js";
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

async function runPaginationIntegrationTests() {
  console.log("==================================================");
  console.log("   COPILOT PAGINATION INTEGRATION TESTS           ");
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

  // 1. First Page Retrieval
  await test("Integration: First page returns exactly requested limit and next cursor", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    for (let i = 1; i <= 5; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Question ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    const req: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "2" },
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.history(req, res);
    assert.strictEqual(getStatus(), 200);
    const body = getJson();
    assert.strictEqual(body.data.messages.length, 2);
    assert.strictEqual(body.data.page.limit, 2);
    assert.strictEqual(body.data.page.has_more, true);
    assert.ok(body.data.page.next_cursor);
  });

  // 2. Next Page Continuity
  await test("Integration: Next page starts immediately after previous page without skipping or duplicating", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    const total = 7;
    for (let i = 1; i <= total; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Question ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    // Page 1
    const req1: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "3" },
    };
    const res1 = createMockResponse();
    await controller.history(req1, res1.res);
    const page1Data = res1.getJson().data;
    assert.strictEqual(page1Data.messages.length, 3);
    assert.deepStrictEqual(
      page1Data.messages.map((m: any) => m.id),
      [1, 2, 3],
    );

    // Page 2 using cursor
    const req2: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "3", cursor: page1Data.page.next_cursor },
    };
    const res2 = createMockResponse();
    await controller.history(req2, res2.res);
    const page2Data = res2.getJson().data;
    assert.strictEqual(page2Data.messages.length, 3);
    assert.deepStrictEqual(
      page2Data.messages.map((m: any) => m.id),
      [4, 5, 6],
    );

    // Page 3 using cursor
    const req3: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "3", cursor: page2Data.page.next_cursor },
    };
    const res3 = createMockResponse();
    await controller.history(req3, res3.res);
    const page3Data = res3.getJson().data;
    assert.strictEqual(page3Data.messages.length, 1);
    assert.deepStrictEqual(
      page3Data.messages.map((m: any) => m.id),
      [7],
    );
    assert.strictEqual(page3Data.page.has_more, false);
    assert.strictEqual(page3Data.page.next_cursor, null);
  });

  // 3. Identical Timestamps Stable Tie-Breaking
  await test("Integration: Multiple messages with identical timestamps are ordered deterministically by ID", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    const identicalTime = new Date(1700000000000);
    // 4 messages at the exact same millisecond
    for (let i = 1; i <= 4; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Tie Message ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: identicalTime,
      });
    }

    // Page 1 (limit 2)
    const req1: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "2" },
    };
    const res1 = createMockResponse();
    await controller.history(req1, res1.res);
    const p1 = res1.getJson().data;
    assert.deepStrictEqual(
      p1.messages.map((m: any) => m.id),
      [1, 2],
    );

    // Page 2 (limit 2)
    const req2: any = {
      user: { user_id: 1 },
      params: { id: conv.conversation_uuid },
      query: { limit: "2", cursor: p1.page.next_cursor },
    };
    const res2 = createMockResponse();
    await controller.history(req2, res2.res);
    const p2 = res2.getJson().data;
    assert.deepStrictEqual(
      p2.messages.map((m: any) => m.id),
      [3, 4],
    );
  });

  // 4. Conversation Ownership Enforced on Every Page
  await test("Integration: Valid cursor cannot bypass ownership on paginated requests", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const conv1 = await repo.create(1, locale_code.en);
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

    // User 1 gets valid cursor
    const req1: any = {
      user: { user_id: 1 },
      params: { id: conv1.conversation_uuid },
      query: { limit: "2" },
    };
    const res1 = createMockResponse();
    await controller.history(req1, res1.res);
    const cursor = res1.getJson().data.page.next_cursor;

    // User 2 attempts to use valid cursor for User 1's conversation
    const req2: any = {
      user: { user_id: 2 },
      params: { id: conv1.conversation_uuid },
      query: { limit: "2", cursor },
    };
    const res2 = createMockResponse();
    await controller.history(req2, res2.res);
    assert.strictEqual(res2.getStatus(), 403);
    assert.strictEqual(res2.getJson().code, "COPILOT_PERMISSION_DENIED");
  });

  console.log("==================================================");
  console.log(` PAGINATION INTEGRATION TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runPaginationIntegrationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
