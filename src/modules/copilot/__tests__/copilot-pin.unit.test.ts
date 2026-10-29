import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  createCopilotService,
  CopilotError,
} from "../copilot.service.js";
import { pinConversationSchema } from "../conversation.validation.js";
import { createMockConversationRepository } from "./test-utils.js";

async function runPinUnitTests() {
  console.log("==================================================");
  console.log("   COPILOT PIN & UNPIN API UNIT TESTS             ");
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

  // 1. Zod Validation Tests
  await test("Validation: accepts valid boolean is_pinned with valid uuid", () => {
    const validUuid = randomUUID();
    const result = pinConversationSchema.safeParse({
      params: { id: validUuid },
      body: { is_pinned: true },
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.body.is_pinned, true);
    }
  });

  await test("Validation: accepts is_pinned: false", () => {
    const validUuid = randomUUID();
    const result = pinConversationSchema.safeParse({
      params: { id: validUuid },
      body: { is_pinned: false },
    });
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.body.is_pinned, false);
    }
  });

  await test("Validation: rejects non-boolean is_pinned (string 'true')", () => {
    const validUuid = randomUUID();
    const result = pinConversationSchema.safeParse({
      params: { id: validUuid },
      body: { is_pinned: "true" },
    });
    assert.strictEqual(result.success, false);
  });

  await test("Validation: rejects missing is_pinned field", () => {
    const validUuid = randomUUID();
    const result = pinConversationSchema.safeParse({
      params: { id: validUuid },
      body: {},
    });
    assert.strictEqual(result.success, false);
  });

  await test("Validation: rejects invalid UUID in params", () => {
    const result = pinConversationSchema.safeParse({
      params: { id: "not-a-valid-uuid" },
      body: { is_pinned: true },
    });
    assert.strictEqual(result.success, false);
  });

  // 2. Authentication & Authorization Tests
  await test("Pin: rejects unauthenticated user with 401 UNAUTHENTICATED", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.pinConversation(0, randomUUID(), true),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 401);
        assert.strictEqual(err.code, "UNAUTHENTICATED");
        return true;
      },
    );
  });

  await test("Pin: rejects invalid is_pinned type at service level with 400 VALIDATION_ERROR", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.pinConversation(1, randomUUID(), "yes" as any),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "VALIDATION_ERROR");
        return true;
      },
    );
  });

  await test("Pin: returns 404 CONVERSATION_NOT_FOUND when conversation does not exist", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => service.pinConversation(1, randomUUID(), true),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  await test("Pin: returns 404 CONVERSATION_NOT_FOUND when conversation belongs to someone else", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1); // owned by user 1

    await assert.rejects(
      async () => service.pinConversation(2, conv.conversation_uuid, true), // user 2 tries to pin
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 404);
        assert.strictEqual(err.code, "CONVERSATION_NOT_FOUND");
        return true;
      },
    );
  });

  // 3. Functional Pin & Unpin Tests
  await test("Pin: successfully pins a conversation (is_pinned: true) and records audit log", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    const result = await service.pinConversation(1, conv.conversation_uuid, true);
    assert.strictEqual(result.conversation_uuid, conv.conversation_uuid);
    assert.strictEqual(result.is_pinned, true);

    // Verify listConversations includes is_pinned: true
    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations.length, 1);
    assert.strictEqual(list.conversations[0].is_pinned, true);

    // Verify audit event
    const audit = repo.audits.find((a) => a.event_type === "CONVERSATION_PINNED");
    assert.ok(audit, "CONVERSATION_PINNED audit event must be logged");
    assert.strictEqual(audit.payload.is_pinned, true);
  });

  await test("Unpin: successfully unpins a previously pinned conversation (is_pinned: false)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);
    const conv = await service.createConversation(1);

    // Pin first
    await service.pinConversation(1, conv.conversation_uuid, true);
    // Now Unpin
    const result = await service.pinConversation(1, conv.conversation_uuid, false);
    assert.strictEqual(result.conversation_uuid, conv.conversation_uuid);
    assert.strictEqual(result.is_pinned, false);

    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations[0].is_pinned, false);

    // Verify unpin audit event
    const audit = repo.audits.find((a) => a.event_type === "CONVERSATION_UNPINNED");
    assert.ok(audit, "CONVERSATION_UNPINNED audit event must be logged");
    assert.strictEqual(audit.payload.is_pinned, false);
  });

  // 4. Ordering Tests: Pinned conversations must appear before unpinned conversations
  await test("Ordering: Pinned conversations appear first while preserving existing order within groups", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Create 3 conversations: C1 (oldest), C2 (middle), C3 (newest)
    const c1 = await service.createConversation(1);
    await new Promise((r) => setTimeout(r, 10));
    const c2 = await service.createConversation(1);
    await new Promise((r) => setTimeout(r, 10));
    const c3 = await service.createConversation(1);

    // Initial order should be: C3, C2, C1 (newest first)
    const initialList = await service.listConversations(1, 10);
    assert.deepStrictEqual(
      initialList.conversations.map((c: any) => c.conversation_uuid),
      [c3.conversation_uuid, c2.conversation_uuid, c1.conversation_uuid],
    );

    // Pin the oldest conversation (C1)
    await service.pinConversation(1, c1.conversation_uuid, true);

    // After pinning C1: C1 must appear first, followed by C3, C2
    const afterPinList = await service.listConversations(1, 10);
    assert.deepStrictEqual(
      afterPinList.conversations.map((c: any) => c.conversation_uuid),
      [c1.conversation_uuid, c3.conversation_uuid, c2.conversation_uuid],
    );
    assert.strictEqual(afterPinList.conversations[0].is_pinned, true);
    assert.strictEqual(afterPinList.conversations[1].is_pinned, false);
    assert.strictEqual(afterPinList.conversations[2].is_pinned, false);

    // Pin C2 as well: both C1 and C2 are pinned, C3 is unpinned
    await service.pinConversation(1, c2.conversation_uuid, true);
    const bothPinnedList = await service.listConversations(1, 10);
    assert.strictEqual(bothPinnedList.conversations[0].is_pinned, true);
    assert.strictEqual(bothPinnedList.conversations[1].is_pinned, true);
    assert.strictEqual(bothPinnedList.conversations[2].is_pinned, false);
    assert.strictEqual(bothPinnedList.conversations[2].conversation_uuid, c3.conversation_uuid);
  });

  // 5. Existing features regression tests
  await test("Regression: Create, Rename, and Delete work seamlessly alongside Pin", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv = await service.createConversation(1);
    await service.renameConversation(1, conv.conversation_uuid, "Pinned Chat Title");
    await service.pinConversation(1, conv.conversation_uuid, true);

    const list = await service.listConversations(1, 10);
    assert.strictEqual(list.conversations[0].title, "Pinned Chat Title");
    assert.strictEqual(list.conversations[0].is_pinned, true);

    await service.deleteConversation(1, conv.conversation_uuid);
    const afterDelete = await service.listConversations(1, 10);
    assert.strictEqual(afterDelete.conversations.length, 0);
  });

  console.log("==================================================");
  console.log(`PIN & UNPIN UNIT TESTS COMPLETED: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runPinUnitTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
