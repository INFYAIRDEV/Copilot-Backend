import assert from "node:assert";
import { randomUUID, createHmac } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { createCopilotService, CopilotError } from "../copilot.service.js";
import {
  copilotController,
  createCopilotController,
} from "../copilot.controller.js";
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

async function runHistorySecurityTests() {
  console.log("==================================================");
  console.log("     COPILOT HISTORY API SECURITY TESTS           ");
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

  // 1. Cross-User Isolation
  await test("Security: User A cannot retrieve User B's conversation history (403 COPILOT_PERMISSION_DENIED)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const convB = await repo.create(200, locale_code.en); // owned by User 200

    const reqA: any = {
      user: { user_id: 100 }, // User 100
      params: { id: convB.conversation_uuid },
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.history(reqA, res);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getJson().code, "COPILOT_PERMISSION_DENIED");
  });

  await test("Security: User A cannot list User B's conversations", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    await repo.create(100, locale_code.en); // User 100
    await repo.create(200, locale_code.en); // User 200
    await repo.create(200, locale_code.it); // User 200

    const reqA: any = {
      user: { user_id: 100 },
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.listConversations(reqA, res);
    assert.strictEqual(getStatus(), 200);
    const convs = getJson().data.conversations;
    assert.strictEqual(convs.length, 1);
    // User 200's conversations are completely absent
  });

  // 2. Cursor Tampering Protection
  await test("Security: Tampered cursor payload is rejected with 400 INVALID_CURSOR", async () => {
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

    const page1 = await service.history(1, conv.conversation_uuid, 2);
    const validCursor = page1.page.next_cursor!;
    const [payload, signature] = validCursor.split(".");

    // Tamper payload (e.g. modify user ID in payload without valid signature)
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    decoded.uid = 999;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString(
      "base64url",
    );
    const tamperedCursor = `${tamperedPayload}.${signature}`;

    await assert.rejects(
      async () => service.history(1, conv.conversation_uuid, 2, tamperedCursor),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Security: Cross-user cursor reuse is rejected", async () => {
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

    // Generate valid cursor for User 1
    const page1 = await service.history(1, conv1.conversation_uuid, 2);
    const cursorForUser1 = page1.page.next_cursor!;

    // User 2 tries to supply User 1's cursor to User 2's conversation
    await assert.rejects(
      async () =>
        service.history(2, conv2.conversation_uuid, 2, cursorForUser1),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Security: Cross-conversation cursor reuse is rejected", async () => {
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
    const cursorForConv1 = page1.page.next_cursor!;

    // Use cursor on conversation 2
    await assert.rejects(
      async () =>
        service.history(1, conv2.conversation_uuid, 2, cursorForConv1),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Security: Expired cursor is rejected with 400 INVALID_CURSOR", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);

    const secret = process.env.ACCESS_TOKEN_SECRET!;
    const expiredData = {
      v: 1,
      uid: 1,
      cid: 1,
      limit: 10,
      created_at: new Date().toISOString(),
      mid: 5,
      exp: Date.now() - 60000, // expired 1 minute ago
    };
    const payload = Buffer.from(JSON.stringify(expiredData)).toString(
      "base64url",
    );
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const expiredCursor = `${payload}.${signature}`;

    await assert.rejects(
      async () => service.history(1, conv.conversation_uuid, 10, expiredCursor),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 3. Permission & Scope Authorization Checks
  await test("Security: History endpoint enforces copilot permissions when configured on token", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);
    const conv = await repo.create(1, locale_code.en);

    // User lacking copilot.read or copilot.ask
    const reqNoScope: any = {
      user: {
        user_id: 1,
        permissions: ["billing.read", "analytics.export"],
      },
      params: { id: conv.conversation_uuid },
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.history(reqNoScope, res);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getJson().code, "COPILOT_PERMISSION_DENIED");
  });

  await test("Security: Conversation listing endpoint enforces copilot permissions when configured on token", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const controller = createCopilotController(service);

    const reqNoScope: any = {
      user: {
        user_id: 1,
        scopes: ["profile.read"], // missing copilot.read or copilot.ask
      },
      query: {},
    };
    const { res, getStatus, getJson } = createMockResponse();

    await controller.listConversations(reqNoScope, res);
    assert.strictEqual(getStatus(), 403);
    assert.strictEqual(getJson().code, "COPILOT_PERMISSION_DENIED");
  });

  // 4. Data Protection & Sensitive Field Containment
  await test("Security: Sensitive message content is never returned when text_redacted is true", async () => {
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
      text: "Sensitive master password 12345",
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
    assert.strictEqual(
      JSON.stringify(result).includes("Sensitive master password"),
      false,
    );
  });

  await test("Security: Internal fields (dataset_id, analytical_context, owner_user_id) are omitted from API response", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);

    const result = await service.history(1, conv.conversation_uuid, 10);
    const jsonStr = JSON.stringify(result);
    assert.ok(!jsonStr.includes("owner_user_id"));
    assert.ok(!jsonStr.includes("analytical_context"));
    assert.ok(!jsonStr.includes("dataset_id"));
    assert.ok(!jsonStr.includes("deleted_at"));
  });

  console.log("==================================================");
  console.log(` SECURITY TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runHistorySecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
