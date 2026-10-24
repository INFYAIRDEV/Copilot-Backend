import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { message_role, message_kind, locale_code } from "@prisma/client";
import {
  createCopilotService,
} from "../src/modules/copilot/copilot.service.js";
import { createMockConversationRepository } from "../src/modules/copilot/__tests__/test-utils.js";

async function runCopilotMessagePersistenceTests() {
  console.log("==================================================");
  console.log(" FEATURE: COPILOT MESSAGE PERSISTENCE & PAGINATION");
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

  // 1. Message Persistence
  await test("Message Persistence: Stores user and assistant messages with sequence integrity", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);
    const convModel = repo.conversations.find((c) => c.conversation_uuid === conv.conversation_uuid)!;

    const userMsg = await repo.createMessage({
      conversation_id: convModel.id,
      role: message_role.USER,
      kind: message_kind.CHAT,
      text: "Show sales by country",
      text_redacted: false,
      question_hash: "hash_sales_country",
      locale: locale_code.en,
      request_uuid: randomUUID(),
      idempotency_key: "idem_1",
      canonical_body_hash: "canon_1",
    });

    const assistantMsg = await repo.createAssistantMessage({
      conversation_id: convModel.id,
      role: message_role.ASSISTANT,
      kind: message_kind.ANSWER,
      text: "Here are the sales figures...",
      text_redacted: false,
      locale: locale_code.en,
      request_uuid: randomUUID(),
      token_usage: {
        prompt_tokens: 120,
        completion_tokens: 65,
        total_tokens: 185,
        model: "gemini-1.5-flash",
      },
    });

    assert.ok(userMsg.id > 0);
    assert.strictEqual(userMsg.role, message_role.USER);
    assert.strictEqual(userMsg.text, "Show sales by country");

    assert.ok(assistantMsg.id > userMsg.id);
    assert.strictEqual(assistantMsg.role, message_role.ASSISTANT);
    assert.strictEqual(assistantMsg.text, "Here are the sales figures...");
  });

  // 2. Pagination Controls
  await test("Message Pagination: Page size limits and pagination offsets work properly", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);
    const convModel = repo.conversations.find((c) => c.conversation_uuid === conv.conversation_uuid)!;

    for (let i = 1; i <= 15; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: i % 2 === 1 ? message_role.USER : message_role.ASSISTANT,
        kind: message_kind.QUESTION,
        text: `Message ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: `idem_${i}`,
        canonical_body_hash: null,
        created_at: new Date(Date.now() + i * 1000),
      });
    }

    const page1 = await service.history(1, conv.conversation_uuid, 5);
    assert.strictEqual(page1.messages.length, 5);

    const page2 = await service.history(1, conv.conversation_uuid, 10);
    assert.strictEqual(page2.messages.length, 10);
  });

  // 3. Message Role & Audit Trail
  await test("Audit Trail: Appending messages triggers audit logs", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);
    const convModel = repo.conversations.find((c) => c.conversation_uuid === conv.conversation_uuid)!;

    await repo.createMessage({
      conversation_id: convModel.id,
      role: message_role.USER,
      kind: message_kind.CHAT,
      text: "Audited question",
      text_redacted: false,
      question_hash: null,
      locale: locale_code.en,
      request_uuid: randomUUID(),
      idempotency_key: "idem_audit",
      canonical_body_hash: null,
    });

    const audits = repo.audits.filter((a) => a.conversation_id === convModel.id);
    assert.ok(audits.length >= 1, "Must have recorded audit event");
  });

  console.log("==================================================");
  console.log(` MESSAGE PERSISTENCE & PAGINATION TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runCopilotMessagePersistenceTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
