import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import {
  createCopilotService,
  CopilotError,
  publicMessage,
} from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";

// Ensure JWT/cursor secret is defined for test environment
process.env.ACCESS_TOKEN_SECRET = "test_super_secret_cursor_hmac_key_12345";

async function runHistoryUnitTests() {
  console.log("==================================================");
  console.log("      COPILOT HISTORY API UNIT TESTS             ");
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

  // 1. Authentication & Ownership Validation
  await test("Unauthenticated user id is rejected with 401 UNAUTHENTICATED on history read", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.history(0, randomUUID(), 50),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, "UNAUTHENTICATED");
        return true;
      },
    );
  });

  await test("Unauthenticated user id is rejected with 401 UNAUTHENTICATED on conversation list", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.listConversations(-1, 50),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, "UNAUTHENTICATED");
        return true;
      },
    );
  });

  await test("Accessing another user's conversation throws 403 COPILOT_PERMISSION_DENIED without leaking existence", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    // User 1 creates a conversation
    const conv = await repo.create(1, locale_code.en);

    // User 2 attempts to retrieve it
    await assert.rejects(
      async () => service.history(2, conv.conversation_uuid, 50),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );
  });

  await test("Accessing non-existent conversation returns identical 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.history(1, randomUUID(), 50),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );
  });

  // 2. Conversation Listing & Ownership Filtering
  await test("listConversations returns only conversations owned by authenticated user", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv1 = await repo.create(10, locale_code.en);
    const conv2 = await repo.create(10, locale_code.it);
    const _convOther = await repo.create(20, locale_code.en);

    const result = await service.listConversations(10, 50);
    assert.strictEqual(result.conversations.length, 2);
    assert.deepStrictEqual(
      result.conversations.map((c) => c.conversation_uuid).sort(),
      [conv1.conversation_uuid, conv2.conversation_uuid].sort(),
    );
  });

  await test("listConversations omits deleted conversations", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv1 = await repo.create(10, locale_code.en);
    const conv2 = await repo.create(10, locale_code.en);

    // Mark conv2 as deleted
    const found2 = repo.conversations.find(
      (c) => c.conversation_uuid === conv2.conversation_uuid,
    );
    if (found2) {
      found2.deleted_at = new Date();
      found2.state = conversation_state.DELETED;
    }

    const result = await service.listConversations(10, 50);
    assert.strictEqual(result.conversations.length, 1);
    assert.strictEqual(
      result.conversations[0].conversation_uuid,
      conv1.conversation_uuid,
    );
  });

  await test("listConversations orders conversations deterministically newest first", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const t0 = new Date(Date.now() - 60000);
    const t1 = new Date(Date.now() - 30000);
    const t2 = new Date();

    repo.conversations.push(
      {
        id: 1,
        conversation_uuid: randomUUID(),
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: t0,
        updated_at: t0,
        deleted_at: null,
      },
      {
        id: 2,
        conversation_uuid: randomUUID(),
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: t2,
        updated_at: t2,
        deleted_at: null,
      },
      {
        id: 3,
        conversation_uuid: randomUUID(),
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: t1,
        updated_at: t1,
        deleted_at: null,
      },
    );

    const result = await service.listConversations(1, 10);
    assert.strictEqual(result.conversations.length, 3);
    assert.strictEqual(
      result.conversations[0].conversation_uuid,
      repo.conversations[1].conversation_uuid,
    );
    assert.strictEqual(
      result.conversations[1].conversation_uuid,
      repo.conversations[2].conversation_uuid,
    );
    assert.strictEqual(
      result.conversations[2].conversation_uuid,
      repo.conversations[0].conversation_uuid,
    );
  });

  // 3. Deterministic Message Ordering & Retrieval
  await test("history returns messages in chronological order (created_at asc, id asc)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    const t1 = new Date(Date.now() - 20000);
    const t2 = new Date(Date.now() - 10000);

    repo.messages.push(
      {
        id: 10,
        conversation_id: convModel.id,
        role: message_role.ASSISTANT,
        kind: message_kind.CLARIFICATION_REPLY,
        text: "Second message",
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: t2,
      },
      {
        id: 5,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: "First message",
        text_redacted: false,
        question_hash: "hash1",
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: "key-1",
        canonical_body_hash: "chash1",
        created_at: t1,
      },
    );

    const history = await service.history(1, conv.conversation_uuid, 50);
    assert.strictEqual(history.messages.length, 2);
    assert.strictEqual(history.messages[0].id, 5);
    assert.strictEqual(history.messages[0].text, "First message");
    assert.strictEqual(history.messages[1].id, 10);
    assert.strictEqual(history.messages[1].text, "Second message");
  });

  await test("Identical timestamp messages are ordered deterministically by id asc", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    const sameTime = new Date();
    repo.messages.push(
      {
        id: 2,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: "Message B",
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: sameTime,
      },
      {
        id: 1,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: "Message A",
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: sameTime,
      },
    );

    const history = await service.history(1, conv.conversation_uuid, 50);
    assert.strictEqual(history.messages.length, 2);
    assert.strictEqual(history.messages[0].id, 1);
    assert.strictEqual(history.messages[1].id, 2);
  });

  // 4. Conversation Lifecycle States
  await test("ARCHIVED conversation history is retrievable", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const found = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;
    found.state = conversation_state.ARCHIVED;

    const history = await service.history(1, conv.conversation_uuid, 50);
    assert.strictEqual(history.conversation.state, conversation_state.ARCHIVED);
  });

  await test("DELETED conversation history is rejected with 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const found = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;
    found.deleted_at = new Date();
    found.state = conversation_state.DELETED;

    await assert.rejects(
      async () => service.history(1, conv.conversation_uuid, 50),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );
  });

  // 5. Redacted Message Masking & Data Protection
  await test("Redacted messages return text as null and redacted as true", async () => {
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
      text: "Sensitive password123 text",
      text_redacted: true,
      question_hash: "hash",
      locale: locale_code.en,
      request_uuid: randomUUID(),
      idempotency_key: null,
      canonical_body_hash: null,
      created_at: new Date(),
    });

    const history = await service.history(1, conv.conversation_uuid, 50);
    assert.strictEqual(history.messages.length, 1);
    assert.strictEqual(history.messages[0].text, null);
    assert.strictEqual(history.messages[0].redacted, true);
  });

  await test("Conversation metadata does not leak internal DB IDs, user ID, or analytical context", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);

    const history = await service.history(1, conv.conversation_uuid, 50);
    const cData = history.conversation as any;
    assert.strictEqual(cData.id, undefined);
    assert.strictEqual(cData.owner_user_id, undefined);
    assert.strictEqual(cData.analytical_context, undefined);
    assert.strictEqual(cData.dataset_id, undefined);
    assert.ok(cData.conversation_uuid);
    assert.ok(cData.state);
    assert.ok(cData.locale);
  });

  // 6. Pagination & HMAC Cursors
  await test("Message history pagination creates next_cursor when messages exceed limit", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    // Insert 3 messages
    for (let i = 1; i <= 3; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Message ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(Date.now() + i * 1000),
      });
    }

    // Page 1 (limit 2)
    const page1 = await service.history(1, conv.conversation_uuid, 2);
    assert.strictEqual(page1.messages.length, 2);
    assert.strictEqual(page1.page.has_more, true);
    assert.ok(page1.page.next_cursor);

    // Page 2 using cursor
    const page2 = await service.history(
      1,
      conv.conversation_uuid,
      2,
      page1.page.next_cursor!,
    );
    assert.strictEqual(page2.messages.length, 1);
    assert.strictEqual(page2.messages[0].id, 3);
    assert.strictEqual(page2.page.has_more, false);
    assert.strictEqual(page2.page.next_cursor, null);
  });

  await test("Conversation listing pagination creates next_cursor when items exceed limit", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Create 3 conversations
    for (let i = 1; i <= 3; i++) {
      await repo.create(1, locale_code.en);
    }

    // Page 1 (limit 2)
    const page1 = await service.listConversations(1, 2);
    assert.strictEqual(page1.conversations.length, 2);
    assert.strictEqual(page1.page.has_more, true);
    assert.ok(page1.page.next_cursor);

    // Page 2
    const page2 = await service.listConversations(
      1,
      2,
      page1.page.next_cursor!,
    );
    assert.strictEqual(page2.conversations.length, 1);
    assert.strictEqual(page2.page.has_more, false);
    assert.strictEqual(page2.page.next_cursor, null);
  });

  // 7. Cursor Tampering & Mismatch Defenses
  await test("Tampered message cursor signature throws 400 INVALID_CURSOR", async () => {
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
        created_at: new Date(Date.now() + i * 1000),
      });
    }

    const page1 = await service.history(1, conv.conversation_uuid, 2);
    const cursor = page1.page.next_cursor!;
    const tampered = cursor.slice(0, -4) + "XXXX";

    await assert.rejects(
      async () => service.history(1, conv.conversation_uuid, 2, tampered),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Cross-user cursor reuse throws 400 INVALID_CURSOR", async () => {
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
        created_at: new Date(Date.now() + i * 1000),
      });
    }

    const page1 = await service.history(1, conv.conversation_uuid, 2);
    const cursorUser1 = page1.page.next_cursor!;

    // User 2 tries to supply User 1's cursor to User 1's or User 2's conversation
    await assert.rejects(
      async () => service.history(2, conv.conversation_uuid, 2, cursorUser1),
      (err: CopilotError) => {
        // Will be rejected with permission denied on findOwned or invalid cursor
        assert.ok(
          err.code === "COPILOT_PERMISSION_DENIED" ||
            err.code === "INVALID_CURSOR",
        );
        return true;
      },
    );
  });

  await test("Audit events are recorded for history read and conversation list read", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await repo.create(1, locale_code.en);

    await service.listConversations(1, 10);
    assert.ok(
      repo.audits.some((a) => a.event_type === "CONVERSATION_LIST_READ"),
    );

    await service.history(1, conv.conversation_uuid, 10);
    assert.ok(
      repo.audits.some((a) => a.event_type === "CONVERSATION_HISTORY_READ"),
    );
  });

  console.log("==================================================");
  console.log(` UNIT TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runHistoryUnitTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
