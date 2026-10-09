import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  conversation_state,
  locale_code,
  message_kind,
  message_role,
} from "@prisma/client";
import { createCopilotService } from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";

process.env.ACCESS_TOKEN_SECRET = "test_super_secret_cursor_hmac_key_12345";

async function runPaginationPerformanceTests() {
  console.log("==================================================");
  console.log("    COPILOT PAGINATION PERFORMANCE TESTS          ");
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

  // 1. Bounded Query & No Full Conversation Scan
  await test("Performance: Database queries fetch only (limit + 1) rows, avoiding full scan", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    // Seed 1,000 messages in conversation
    const totalMessages = 1000;
    const baseTime = 1700000000000;
    for (let i = 1; i <= totalMessages; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: i % 2 === 1 ? message_role.USER : message_role.ASSISTANT,
        kind: message_kind.QUESTION,
        text: `Message content ${i} with some descriptive question text`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: randomUUID(),
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(baseTime + i * 1000),
      });
    }

    // Spy on historyPage calls
    let queriedRowCount = 0;
    const originalHistoryPage = repo.historyPage;
    repo.historyPage = async (cid, after, limit) => {
      const rows = await originalHistoryPage(cid, after, limit);
      queriedRowCount = rows.length;
      return rows;
    };

    // Request limit = 20
    const result = await service.history(1, conv.conversation_uuid, 20);

    assert.strictEqual(result.messages.length, 20);
    // Verified: fetched only 21 rows (limit + 1 for hasMore determination), NOT all 1,000 rows
    assert.strictEqual(queriedRowCount, 21);
    assert.strictEqual(result.page.has_more, true);
    assert.ok(result.page.next_cursor);
  });

  // 2. Absence of N+1 Queries
  await test("Performance: Pagination operates with exactly 1 query per page (no N+1 queries)", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    for (let i = 1; i <= 100; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Question ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    let queryCount = 0;
    const originalHistoryPage = repo.historyPage;
    repo.historyPage = async (...args) => {
      queryCount++;
      return originalHistoryPage(...args);
    };

    // Retrieve a page of 25 messages
    queryCount = 0;
    await service.history(1, conv.conversation_uuid, 25);

    // Verified: exactly 1 database query was issued to fetch the entire page
    assert.strictEqual(queryCount, 1);
  });

  // 3. Constant Memory Footprint Across Large Histories
  await test("Performance: Memory usage remains flat while paginating through large history", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    const conv = await repo.create(1, locale_code.en);
    const convModel = repo.conversations.find(
      (c) => c.conversation_uuid === conv.conversation_uuid,
    )!;

    // Seed 500 messages
    for (let i = 1; i <= 500; i++) {
      repo.messages.push({
        id: i,
        conversation_id: convModel.id,
        role: message_role.USER,
        kind: message_kind.QUESTION,
        text: `Question payload ${i}`,
        text_redacted: false,
        question_hash: null,
        locale: locale_code.en,
        request_uuid: null,
        idempotency_key: null,
        canonical_body_hash: null,
        created_at: new Date(1700000000000 + i * 1000),
      });
    }

    const pageSize = 50;
    let cursor: string | undefined = undefined;
    let pagesIterated = 0;
    const initialHeap = process.memoryUsage().heapUsed;

    while (true) {
      pagesIterated++;
      const res = await service.history(
        1,
        conv.conversation_uuid,
        pageSize,
        cursor,
      );
      assert.strictEqual(res.messages.length <= pageSize, true);
      if (!res.page.has_more) break;
      cursor = res.page.next_cursor!;
    }

    const finalHeap = process.memoryUsage().heapUsed;
    const heapDiffMb = (finalHeap - initialHeap) / (1024 * 1024);

    assert.strictEqual(pagesIterated, 10);
    // Heap should not balloon uncontrollably
    assert.ok(
      heapDiffMb < 50,
      `Memory delta too high: ${heapDiffMb.toFixed(2)} MB`,
    );
  });

  // 4. Conversation-Level Pagination Efficiency
  await test("Performance: Conversation list pagination fetches only requested page size", async () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Seed 200 conversations
    for (let i = 1; i <= 200; i++) {
      const c = await repo.create(1, locale_code.en);
      const found = repo.conversations.find(
        (conv) => conv.conversation_uuid === c.conversation_uuid,
      )!;
      found.created_at = new Date(1700000000000 + i * 1000);
      found.updated_at = new Date(1700000000000 + i * 1000);
    }

    let queriedConvRows = 0;
    const originalListConvs = repo.listUserConversations;
    repo.listUserConversations = async (uid, after, limit) => {
      const rows = await originalListConvs(uid, after, limit);
      queriedConvRows = rows.length;
      return rows;
    };

    const result = await service.listConversations(1, 15);
    assert.strictEqual(result.conversations.length, 15);
    // Verified: fetched 16 rows (15 + 1), avoiding full scan of 200 conversations
    assert.strictEqual(queriedConvRows, 16);
    assert.strictEqual(result.page.has_more, true);
  });

  console.log("==================================================");
  console.log(` PAGINATION PERFORMANCE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runPaginationPerformanceTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
