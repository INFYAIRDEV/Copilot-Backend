import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { createCopilotService, CopilotError } from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";

async function runIntegrationTests() {
  console.log("==================================================");
  console.log("  COPILOT MESSAGE PERSISTENCE INTEGRATION TESTS   ");
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

  // 1. Messages persisted against correct conversation
  await test("Messages are persisted against the correct conversation and associated with parent conversation_id", async () => {
    const repo = createMockConversationRepository();
    const conv1Uuid = randomUUID();
    const conv2Uuid = randomUUID();

    repo.conversations.push(
      {
        id: 101,
        conversation_uuid: conv1Uuid,
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      {
        id: 102,
        conversation_uuid: conv2Uuid,
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    );

    const service = createCopilotService(repo as any);
    await service.sendMessage(1, conv1Uuid, "c1-msg1", {
      kind: "QUESTION",
      text: "Message for conversation 1",
    });
    await service.sendMessage(1, conv2Uuid, "c2-msg1", {
      kind: "QUESTION",
      text: "Message for conversation 2",
    });

    const c1Messages = await service.getConversationMessages(1, conv1Uuid);
    const c2Messages = await service.getConversationMessages(1, conv2Uuid);

    assert.strictEqual(c1Messages.length, 1);
    assert.strictEqual(c1Messages[0].text, "Message for conversation 1");

    assert.strictEqual(c2Messages.length, 1);
    assert.strictEqual(c2Messages[0].text, "Message for conversation 2");

    assert.strictEqual(repo.messages[0].conversation_id, 101);
    assert.strictEqual(repo.messages[1].conversation_id, 102);
  });

  // 2. Deterministic Message Ordering
  await test("Messages are returned in deterministic chronological order (created_at asc, id asc)", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    const convId = 201;

    repo.conversations.push({
      id: convId,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const now = Date.now();
    // Simulate messages created with sequential timestamps
    repo.messages.push(
      {
        id: 1,
        conversation_id: convId,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: "Question 1",
        text_redacted: false,
        question_hash: "hash1",
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: "k1",
        canonical_body_hash: "cb1",
        created_at: new Date(now),
      },
      {
        id: 2,
        conversation_id: convId,
        role: message_role.ASSISTANT,
        kind: message_kind.CLARIFICATION_REQUEST,
        text: "Clarification reply 1",
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(now + 1000),
      },
      {
        id: 3,
        conversation_id: convId,
        role: message_role.USER,
        kind: message_kind.CLARIFICATION_REPLY,
        text: "User clarify 2",
        text_redacted: false,
        question_hash: "hash2",
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: "k2",
        canonical_body_hash: "cb2",
        created_at: new Date(now + 2000),
      },
    );

    const service = createCopilotService(repo as any);
    const messages = await service.getConversationMessages(1, convUuid);

    assert.strictEqual(messages.length, 3);
    assert.strictEqual(messages[0].id, 1);
    assert.strictEqual(messages[1].id, 2);
    assert.strictEqual(messages[2].id, 3);
    assert.strictEqual(messages[0].role, "USER");
    assert.strictEqual(messages[1].role, "ASSISTANT");
    assert.strictEqual(messages[2].role, "USER");
  });

  // 3. User messages and Assistant messages are distinguishable
  await test("User messages and Assistant messages are clearly distinguishable by role and kind", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 301,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const userMsg = await service.sendMessage(1, convUuid, "key-dist-1", {
      kind: "QUESTION",
      text: "User query",
    });
    const asstMsg = await service.storeAssistantMessage(1, convUuid, {
      kind: message_kind.CLARIFICATION_REQUEST,
      text: "Assistant response",
    });

    assert.strictEqual(userMsg.role, message_role.USER);
    assert.strictEqual(asstMsg.role, message_role.ASSISTANT);
    assert.notStrictEqual(userMsg.role, asstMsg.role);
    assert.strictEqual(userMsg.kind, message_kind.QUESTION);
    assert.strictEqual(asstMsg.kind, message_kind.CLARIFICATION_REQUEST);
  });

  // 4. Duplicate idempotent requests do not create duplicate messages
  await test("Duplicate idempotent requests return original message without duplicate rows", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 401,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const m1 = await service.sendMessage(1, convUuid, "idem-test-99", {
      kind: "QUESTION",
      text: "Repeat test query",
      locale: "en",
    });

    const m2 = await service.sendMessage(1, convUuid, "idem-test-99", {
      kind: "QUESTION",
      text: "Repeat test query",
      locale: "en",
    });

    assert.strictEqual(repo.messages.length, 1);
    assert.strictEqual(m1.id, m2.id);
  });

  // 5. Conflicting idempotency-key reuse is rejected
  await test("Conflicting idempotency key reuse throws 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 501,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    await service.sendMessage(1, convUuid, "same-key-diff-body", {
      kind: "QUESTION",
      text: "Original message body",
    });

    await assert.rejects(
      async () => {
        await service.sendMessage(1, convUuid, "same-key-diff-body", {
          kind: "QUESTION",
          text: "Tampered or conflicting message body",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "IDEMPOTENCY_KEY_REUSED");
        return true;
      },
    );
  });

  // 6. Unauthorized users cannot create messages in another user's conversation
  await test("Unauthorized users cannot create messages in another user's conversation (403 COPILOT_PERMISSION_DENIED)", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 601,
      conversation_uuid: convUuid,
      owner_user_id: 100, // owned by user 100
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);

    // User 200 attempts to send message to user 100's conversation
    await assert.rejects(
      async () => {
        await service.sendMessage(200, convUuid, "cross-user-key", {
          kind: "QUESTION",
          text: "Attempting cross-user post",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );

    // Assistant message storage also validates ownership when userId is provided
    await assert.rejects(
      async () => {
        await service.storeAssistantMessage(200, convUuid, {
          text: "Unauthorized assistant post",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );

    assert.strictEqual(repo.messages.length, 0);
  });

  // 7. Archived and Deleted Conversation behavior
  await test("Archived or deleted conversation rejects message creation with 409 CONVERSATION_NOT_ACTIVE", async () => {
    const repo = createMockConversationRepository();
    const archivedConvUuid = randomUUID();
    const deletedConvUuid = randomUUID();

    repo.conversations.push(
      {
        id: 701,
        conversation_uuid: archivedConvUuid,
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.ARCHIVED,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      {
        id: 702,
        conversation_uuid: deletedConvUuid,
        owner_user_id: 1,
        locale: locale_code.en,
        state: conversation_state.DELETED,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: new Date(),
      },
    );

    const service = createCopilotService(repo as any);

    await assert.rejects(
      async () => {
        await service.sendMessage(1, archivedConvUuid, "arch-key", {
          kind: "QUESTION",
          text: "Post to archived",
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "CONVERSATION_NOT_ACTIVE");
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await service.sendMessage(1, deletedConvUuid, "del-key", {
          kind: "QUESTION",
          text: "Post to deleted",
        });
      },
      (err: any) => {
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "CONVERSATION_NOT_ACTIVE");
        return true;
      },
    );
  });

  // 8. Assistant messages remain associated with originating conversation
  await test("Assistant messages remain associated with originating conversation", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    const convId = 801;

    repo.conversations.push({
      id: convId,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const asstMsg = await service.storeAssistantMessage(1, convUuid, {
      kind: message_kind.CLARIFICATION_REQUEST,
      text: "Which product category?",
    });

    const storedMsg = repo.messages.find((m) => m.id === asstMsg.id);
    assert.ok(storedMsg);
    assert.strictEqual(storedMsg.conversation_id, convId);
    assert.strictEqual(storedMsg.role, message_role.ASSISTANT);
  });

  // 9. Full Flow: User Message Persistence -> AI Processing -> Assistant Message Persistence
  await test("Full interaction flow: User Message Persistence -> AI Processing -> Assistant Message Persistence", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 901,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);

    const turnResult = await service.processConversationTurn({
      userId: 1,
      conversationUuid: convUuid,
      idempotencyKey: "turn-flow-key-1",
      message: {
        kind: message_kind.QUESTION,
        text: "Show sales by region",
        locale: "en",
      },
      aiProcessor: async (userMsg) => {
        assert.strictEqual(userMsg.text, "Show sales by region");
        assert.strictEqual(userMsg.role, message_role.USER);
        return {
          kind: message_kind.CLARIFICATION_REQUEST,
          text: "Would you like to include online sales as well?",
        };
      },
    });

    assert.ok(turnResult.userMessage);
    assert.ok(turnResult.assistantMessage);
    assert.strictEqual(turnResult.userMessage.role, message_role.USER);
    assert.strictEqual(
      turnResult.assistantMessage.role,
      message_role.ASSISTANT,
    );
    assert.strictEqual(repo.messages.length, 2);
    assert.strictEqual(repo.messages[0].conversation_id, 901);
    assert.strictEqual(repo.messages[1].conversation_id, 901);
  });

  console.log(`\n==================================================`);
  console.log(` INTEGRATION TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log(`==================================================\n`);
}

runIntegrationTests().catch((err) => {
  console.error("Integration test execution failed:", err);
  process.exit(1);
});
