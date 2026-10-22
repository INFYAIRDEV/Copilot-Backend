import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { conversation_state } from "@prisma/client";
import {
  createCopilotService,
  CopilotError,
} from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";

async function runRenameDeleteUnitTests() {
  console.log("==================================================");
  console.log("   COPILOT RENAME & DELETE API UNIT TESTS         ");
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

  // 1. Rename Tests
  await test("Rename rejects unauthenticated user with 401 UNAUTHENTICATED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.renameConversation(0, randomUUID(), "New Title"),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, "UNAUTHENTICATED");
        return true;
      },
    );
  });

  await test("Rename rejects empty title with 400 VALIDATION_ERROR", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.renameConversation(1, randomUUID(), "   "),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "VALIDATION_ERROR");
        return true;
      },
    );
  });

  await test("Rename returns 404 CONVERSATION_NOT_FOUND when conversation does not exist", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.renameConversation(1, randomUUID(), "New Title"),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  await test("Rename returns 404 CONVERSATION_NOT_FOUND when conversation is owned by someone else", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    await assert.rejects(
      async () => service.renameConversation(2, conv.conversation_uuid, "Hacked Title"),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  await test("Rename successfully updates conversation title and saves in analytical_context", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    const result = await service.renameConversation(1, conv.conversation_uuid, "My Q3 Sales Analysis");
    assert.strictEqual(result.conversation_uuid, conv.conversation_uuid);
    assert.strictEqual(result.title, "My Q3 Sales Analysis");

    // Verify listConversations returns the renamed title
    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations.length, 1);
    assert.strictEqual(list.conversations[0].title, "My Q3 Sales Analysis");

    // Verify audit event recorded
    const audit = repo.audits.find((a) => a.event_type === "CONVERSATION_RENAMED");
    assert.ok(audit);
    assert.strictEqual(audit.payload.title, "My Q3 Sales Analysis");
  });

  // 2. Delete Tests
  await test("Delete rejects unauthenticated user with 401 UNAUTHENTICATED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.deleteConversation(0, randomUUID()),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, "UNAUTHENTICATED");
        return true;
      },
    );
  });

  await test("Delete returns 404 CONVERSATION_NOT_FOUND when conversation does not exist", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.deleteConversation(1, randomUUID()),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  await test("Delete returns 404 CONVERSATION_NOT_FOUND when conversation is owned by someone else", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    await assert.rejects(
      async () => service.deleteConversation(2, conv.conversation_uuid),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  await test("Delete soft-deletes conversation and removes it from list and history", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    const result = await service.deleteConversation(1, conv.conversation_uuid);
    assert.strictEqual(result.conversation_uuid, conv.conversation_uuid);
    assert.strictEqual(result.deleted, true);

    // Verify conversation is now omitted from listConversations
    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations.length, 0);

    // Verify subsequent delete returns 404
    await assert.rejects(
      async () => service.deleteConversation(1, conv.conversation_uuid),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      },
    );

    // Verify subsequent rename returns 404
    await assert.rejects(
      async () => service.renameConversation(1, conv.conversation_uuid, "Can't Rename"),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      },
    );

    // Verify audit event recorded
    const audit = repo.audits.find((a) => a.event_type === "CONVERSATION_DELETED");
    assert.ok(audit);
    assert.strictEqual(audit.payload.conversation_uuid, conv.conversation_uuid);
  });

  console.log(`\n==================================================`);
  console.log(`RENAME & DELETE UNIT TESTS COMPLETED: ${passed}/${total} PASSED`);
  console.log(`==================================================\n`);
}

runRenameDeleteUnitTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
