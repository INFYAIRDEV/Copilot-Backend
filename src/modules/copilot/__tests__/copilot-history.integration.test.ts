import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import {
  copilotController,
  createCopilotController,
} from "../copilot.controller.js";
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

async function runHistoryIntegrationTests() {
  console.log("==================================================");
  console.log("   COPILOT HISTORY API INTEGRATION TESTS          ");
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

  // 1. Controller: Conversation Listing
  await test("GET /copilot/conversations: retrieves owned conversations with 200 OK", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Create 3 conversations for user 5
    const c1 = await repo.create(5, locale_code.en);
    const c2 = await repo.create(5, locale_code.it);
    await repo.create(99, locale_code.en); // other user

    const req: any = {
      user: { user_id: 5 },
      query: { limit: "10" },
    };
    const { res, getStatus, getJson } = createMockResponse();

    const controller = createCopilotController(service);
    await controller.listConversations(req, res);
    assert.strictEqual(getStatus(), 200);
    const body = getJson();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.conversations.length, 2);
    assert.strictEqual(body.data.page.limit, 10);
    assert.strictEqual(body.data.page.has_more, false);
    assert.strictEqual(body.data.page.next_cursor, null);
  });

  await test("GET /copilot/conversations: validates invalid limit parameter with 400 VALIDATION_ERROR", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const req: any = {
      user: { user_id: 5 },
      query: { limit: "0" }, // Min is 1
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.listConversations(req, res);
    assert.strictEqual(getStatus(), 400);
    const body = getJson();
    assert.strictEqual(body.code, "VALIDATION_ERROR");
  });

  await test("GET /copilot/conversations: rejects unauthenticated requests with 401 UNAUTHENTICATED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const req: any = {
      user: undefined,
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.listConversations(req, res);
    assert.strictEqual(getStatus(), 401);
    assert.strictEqual(getJson().code, "UNAUTHENTICATED");
  });

  // 2. Controller: Conversation History
  await test("GET /copilot/conversations/:id/messages: retrieves owned messages with 200 OK", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);
    const conv = await repo.create(5, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    repo.messages.push({
      id: 1,
      conversation_id: convModel.id,
      role: message_role.USER,
      kind: message_kind.QUESTION,
      text: "What is net revenue?",
      text_redacted: false,
      question_hash: "hash",
      locale: locale_code.en,
      request_uuid: randomUUID(),
      idempotency_key: "k1",
      canonical_body_hash: "b1",
      created_at: new Date(),
    });

    const req: any = {
      user: { user_id: 5 },
      params: { id: conv.conversation_uuid },
      query: { limit: "10" },
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.history(req, res);
    assert.strictEqual(getStatus(), 200);
    const body = getJson();
    assert.strictEqual(body.success, true);
    assert.strictEqual(
      body.data.conversation.conversation_uuid,
      conv.conversation_uuid,
    );
    assert.strictEqual(body.data.messages.length, 1);
    assert.strictEqual(body.data.messages[0].text, "What is net revenue?");
    assert.strictEqual(body.data.messages[0].redacted, false);
  });

  await test("GET /copilot/conversations/:id/messages: rejects cross-user access with 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);
    const convUser1 = await repo.create(1, locale_code.en);

    const req: any = {
      user: { user_id: 2 }, // User 2 trying to read User 1's conversation
      params: { id: convUser1.conversation_uuid },
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.history(req, res);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getJson().code, "COPILOT_PERMISSION_DENIED");
  });

  // 3. Multi-page pagination workflow
  await test("Multi-page message pagination: retrieves large conversation without gaps or duplicates", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    // Seed 25 messages
    const totalMsgs = 25;
    for (let i = 1; i <= totalMsgs; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: i % 2 === 1 ? message_role.USER : message_role.ASSISTANT,
        kind:
          i % 2 === 1
            ? message_kind.QUESTION
            : message_kind.CLARIFICATION_REPLY,
        text: `Message ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    const pageSize = 10;
    const collected: any[] = [];
    let currentCursor: string | undefined = undefined;
    let pageCount = 0;

    while (true) {
      pageCount++;
      const result = await service.history(
        1,
        conv.conversation_uuid,
        pageSize,
        currentCursor,
      );
      collected.push(...result.messages);
      if (!result.page.has_more) {
        assert.strictEqual(result.page.next_cursor, null);
        break;
      }
      assert.ok(result.page.next_cursor);
      currentCursor = result.page.next_cursor;
    }

    assert.strictEqual(pageCount, 3); // 10, 10, 5
    assert.strictEqual(collected.length, 25);
    // Verify strict ascending order and complete continuity
    for (let i = 0; i < collected.length; i++) {
      assert.strictEqual(collected[i].id, i + 1);
      assert.strictEqual(collected[i].text, `Message ${i + 1}`);
    }
  });

  await test("Multi-page conversation listing: retrieves all conversations across multiple pages", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Seed 15 conversations
    for (let i = 1; i <= 15; i++) {
      const conv = await repo.create(1, locale_code.en);
      const found = repo.conversations.find(
        (c) => c.conversation_uuid === conv.conversation_uuid,
      )!;
      found.created_at = new Date(1700000000000 + i * 1000);
      found.updated_at = new Date(1700000000000 + i * 1000);
    }

    const pageSize = 5;
    const collected: any[] = [];
    let currentCursor: string | undefined = undefined;
    let pageCount = 0;

    while (true) {
      pageCount++;
      const result = await service.listConversations(
        1,
        pageSize,
        currentCursor,
      );
      collected.push(...result.conversations);
      if (!result.page.has_more) {
        assert.strictEqual(result.page.next_cursor, null);
        break;
      }
      assert.ok(result.page.next_cursor);
      currentCursor = result.page.next_cursor;
    }

    assert.strictEqual(pageCount, 3); // 5, 5, 5
    assert.strictEqual(collected.length, 15);
    // Verify strictly descending order
    for (let i = 0; i < collected.length - 1; i++) {
      assert.ok(
        collected[i].created_at.getTime() >=
          collected[i + 1].created_at.getTime(),
      );
    }
  });

  await test("Redacted messages remain masked in history responses (text: null)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    repo.messages.push({
      id: 1,
      conversation_id: convModel.id,
      role: message_role.USER,
      kind: message_kind.QUESTION,
      text: "Sensitive secret token value",
      text_redacted: true,
      question_hash: "hash",
      locale: locale_code.en,
      request_uuid: randomUUID(),
      idempotency_key: null,
      canonical_body_hash: null,
      created_at: new Date(),
    });

    const result = await service.history(1, conv.conversation_uuid, 10);
    assert.strictEqual(result.messages[0].text, null);
    assert.strictEqual(result.messages[0].redacted, true);
  });

  console.log("==================================================");
  console.log(` INTEGRATION TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runHistoryIntegrationTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
