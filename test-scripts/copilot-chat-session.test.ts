import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  createCopilotService,
  CopilotError,
} from "../src/modules/copilot/copilot.service.js";
import { createMockConversationRepository } from "../src/modules/copilot/__tests__/test-utils.js";

async function runCopilotChatSessionTests() {
  console.log("==================================================");
  console.log(" FEATURE: COPILOT CHAT & SESSION MANAGEMENT TESTS  ");
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

  // 1. Session Creation
  await test("Session Creation: Successfully creates an active conversation", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    assert.ok(conv.conversation_uuid, "UUID must be generated");
    assert.strictEqual(conv.owner_user_id, 1);
    assert.strictEqual(conv.state, "ACTIVE");
  });

  // 2. Session Listing & Pagination
  await test("Session Listing: Lists active conversations for the authenticated user", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await service.createConversation(1);
    await service.createConversation(1);
    await service.createConversation(2); // different user

    const listUser1 = await service.listConversations(1, 10);
    assert.strictEqual(listUser1.conversations.length, 2);

    const listUser2 = await service.listConversations(2, 10);
    assert.strictEqual(listUser2.conversations.length, 1);
  });

  // 3. Session Rename
  await test("Session Rename: Renames title and updates analytical context", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    const updated = await service.renameConversation(1, conv.conversation_uuid, "Q3 Sales Deep Dive");
    assert.strictEqual(updated.title, "Q3 Sales Deep Dive");

    const fetched = await service.listConversations(1, 10);
    assert.strictEqual(fetched.conversations[0].title, "Q3 Sales Deep Dive");
  });

  await test("Session Rename: Rejects empty or whitespace title with 400 VALIDATION_ERROR", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    await assert.rejects(
      async () => service.renameConversation(1, conv.conversation_uuid, "   "),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "VALIDATION_ERROR");
        return true;
      },
    );
  });

  // 4. Session Soft Deletion
  await test("Session Delete: Soft deletes conversation and excludes from active list", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    const delResult = await service.deleteConversation(1, conv.conversation_uuid);
    assert.strictEqual(delResult.deleted, true);

    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations.length, 0);
  });

  // 5. Tenant Boundary & Authorization
  await test("Session Security: User A cannot rename or delete User B's conversation", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    await assert.rejects(
      async () => service.renameConversation(2, conv.conversation_uuid, "Attacker Title"),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      },
    );

    await assert.rejects(
      async () => service.deleteConversation(2, conv.conversation_uuid),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        return true;
      },
    );
  });

  console.log("==================================================");
  console.log(` COPILOT CHAT & SESSION TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================\n");
}

runCopilotChatSessionTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
