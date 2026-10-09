import assert from "node:assert";
import { randomUUID } from "node:crypto";
import {
  PaginationService,
  paginationService,
  computeFilterHash,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../pagination.service.js";
import { CopilotError } from "../copilot.service.js";

process.env.ACCESS_TOKEN_SECRET = "test_super_secret_cursor_hmac_key_12345";

async function runPaginationUnitTests() {
  console.log("==================================================");
  console.log("       COPILOT PAGINATION UNIT TESTS              ");
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

  // 1. Cursor Creation and Decoding
  await test("Cursor creation produces tamper-resistant HMAC signed string", () => {
    const now = new Date();
    const cursor = paginationService.encodeMessageCursor({
      userId: 42,
      conversationId: 101,
      limit: 25,
      createdAt: now,
      messageId: 500,
    });

    assert.strictEqual(typeof cursor, "string");
    const parts = cursor.split(".");
    assert.strictEqual(parts.length, 2);
    assert.ok(parts[0].length > 0);
    assert.ok(parts[1].length > 0);
  });

  await test("Cursor decoding extracts exact timestamp and message ID", () => {
    const now = new Date("2026-05-15T12:00:00.000Z");
    const cursor = paginationService.encodeMessageCursor({
      userId: 42,
      conversationId: 101,
      limit: 25,
      createdAt: now,
      messageId: 500,
    });

    const decoded = paginationService.decodeMessageCursor(cursor, {
      userId: 42,
      conversationId: 101,
      limit: 25,
    });

    assert.strictEqual(decoded.id, 500);
    assert.strictEqual(decoded.created_at.toISOString(), now.toISOString());
  });

  // 2. Cursor Integrity & Signature Validation
  await test("Modified cursor signature throws 400 INVALID_CURSOR", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 1,
      limit: 10,
      createdAt: new Date(),
      messageId: 1,
    });
    const [payload] = cursor.split(".");
    const badCursor = `${payload}.invalidsignature12345`;

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(badCursor, {
          userId: 1,
          conversationId: 1,
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 3. User Binding
  await test("Cursor is strictly bound to user identity: cross-user decode throws 400", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(cursor, {
          userId: 2, // Mismatched user
          conversationId: 10,
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 4. Conversation Binding
  await test("Cursor is strictly bound to conversation: cross-conversation decode throws 400", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(cursor, {
          userId: 1,
          conversationId: 99, // Mismatched conversation
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 5. Query Filter & Limit Binding
  await test("Cursor is bound to request limit: modifying limit throws 400", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(cursor, {
          userId: 1,
          conversationId: 10,
          limit: 20, // Different limit
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Cursor is bound to query filter hash: modifying query filter throws 400", () => {
    const filter1 = computeFilterHash({ locale: "en" });
    const filter2 = computeFilterHash({ locale: "it" });

    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
      filterHash: filter1,
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(cursor, {
          userId: 1,
          conversationId: 10,
          limit: 10,
          filterHash: filter2, // Changed filter
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 6. Expiration Validation
  await test("Expired cursor throws 400 INVALID_CURSOR", () => {
    const cursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
      ttlMs: -1000, // Expired 1 second ago
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(cursor, {
          userId: 1,
          conversationId: 10,
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 7. Resource Type Mismatch (Message Cursor vs Conversation Cursor)
  await test("Message cursor cannot be decoded as Conversation list cursor", () => {
    const msgCursor = paginationService.encodeMessageCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
      messageId: 5,
    });

    assert.throws(
      () =>
        paginationService.decodeConversationCursor(msgCursor, {
          userId: 1,
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  await test("Conversation cursor cannot be decoded as Message history cursor", () => {
    const convCursor = paginationService.encodeConversationCursor({
      userId: 1,
      conversationId: 10,
      limit: 10,
      createdAt: new Date(),
    });

    assert.throws(
      () =>
        paginationService.decodeMessageCursor(convCursor, {
          userId: 1,
          conversationId: 10,
          limit: 10,
        }),
      (err: CopilotError) => {
        assert.strictEqual(err.statusCode, 400);
        assert.strictEqual(err.code, "INVALID_CURSOR");
        return true;
      },
    );
  });

  // 8. Page Size Constants
  await test("Default and maximum page sizes conform to architecture contract", () => {
    assert.strictEqual(DEFAULT_PAGE_SIZE, 50);
    assert.strictEqual(MAX_PAGE_SIZE, 100);
  });

  console.log("==================================================");
  console.log(` PAGINATION UNIT TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runPaginationUnitTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
