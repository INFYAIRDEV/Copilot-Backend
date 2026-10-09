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
  computeCanonicalBodyHash,
  sanitizeAndRedactMessageText,
  isValidUuid,
  publicMessage,
} from "../copilot.service.js";
import { createMockConversationRepository } from "./test-utils.js";

async function runUnitTests() {
  console.log("==================================================");
  console.log("    COPILOT MESSAGE PERSISTENCE UNIT TESTS        ");
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

  // 1. Canonical Body Hash Validation
  await test("Canonical body hash produces identical sha256 regardless of field insertion order", () => {
    const hash1 = computeCanonicalBodyHash({
      role: "USER",
      kind: "QUESTION",
      text: "What are sales?",
      locale: "en",
    });
    const hash2 = computeCanonicalBodyHash({
      text: "What are sales?",
      locale: "en",
      kind: "QUESTION",
      role: "USER",
    });
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(typeof hash1, "string");
    assert.strictEqual(hash1.length, 64);
  });

  await test("Canonical body hash differentiates text, role, kind, and locale", () => {
    const base = computeCanonicalBodyHash({
      role: "USER",
      kind: "QUESTION",
      text: "What are sales?",
      locale: "en",
    });
    const differentText = computeCanonicalBodyHash({
      role: "USER",
      kind: "QUESTION",
      text: "What is revenue?",
      locale: "en",
    });
    const differentRole = computeCanonicalBodyHash({
      role: "ASSISTANT",
      kind: "QUESTION",
      text: "What are sales?",
      locale: "en",
    });
    const differentKind = computeCanonicalBodyHash({
      role: "USER",
      kind: "CLARIFICATION_REPLY",
      text: "What are sales?",
      locale: "en",
    });
    const differentLocale = computeCanonicalBodyHash({
      role: "USER",
      kind: "QUESTION",
      text: "What are sales?",
      locale: "it",
    });

    assert.notStrictEqual(base, differentText);
    assert.notStrictEqual(base, differentRole);
    assert.notStrictEqual(base, differentKind);
    assert.notStrictEqual(base, differentLocale);
  });

  // 2. Redaction Behavior
  await test("Redaction: detects passwords, bearer tokens, api keys, and marks text_redacted", () => {
    const res1 = sanitizeAndRedactMessageText(
      "Here is my password = 'Secret12345!' for db",
    );
    assert.strictEqual(res1.isRedacted, true);
    assert.ok(res1.sanitizedText.includes("[REDACTED]"));
    assert.ok(!res1.sanitizedText.includes("Secret12345!"));

    const res2 = sanitizeAndRedactMessageText(
      "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doz",
    );
    assert.strictEqual(res2.isRedacted, true);
    assert.ok(res2.sanitizedText.includes("[REDACTED]"));

    const res3 = sanitizeAndRedactMessageText(
      "Use key api_key = 'abcdef12345'",
    );
    assert.strictEqual(res3.isRedacted, true);
    assert.ok(res3.sanitizedText.includes("[REDACTED]"));

    const res4 = sanitizeAndRedactMessageText(
      "Use OpenAI key sk-1234567890abcdef12345678",
    );
    assert.strictEqual(res4.isRedacted, true);
    assert.ok(res4.sanitizedText.includes("[REDACTED]"));
  });

  await test("Redaction: detects raw SQL queries and raw AI provider response payloads", () => {
    const resSql = sanitizeAndRedactMessageText(
      "SELECT * FROM users WHERE admin = 1",
    );
    assert.strictEqual(resSql.isRedacted, true);
    assert.ok(resSql.sanitizedText.includes("[REDACTED]"));

    const resPayload = sanitizeAndRedactMessageText(
      'Here is raw: {"choices": [{"message": "hello"}]}',
    );
    assert.strictEqual(resPayload.isRedacted, true);
    assert.ok(resPayload.sanitizedText.includes("[REDACTED]"));
  });

  await test("Redaction: benign text is not redacted and text_redacted is false", () => {
    const res = sanitizeAndRedactMessageText(
      "Can you show total sales by region in Q3 2025?",
    );
    assert.strictEqual(res.isRedacted, false);
    assert.strictEqual(
      res.sanitizedText,
      "Can you show total sales by region in Q3 2025?",
    );
  });

  await test("publicMessage returns text as null when text_redacted is true", () => {
    const pub = publicMessage({
      id: 1,
      role: "USER",
      kind: "QUESTION",
      text: "Contains [REDACTED]",
      text_redacted: true,
      locale: "en",
      created_at: new Date(),
    });
    assert.strictEqual(pub.text, null);
    assert.strictEqual(pub.redacted, true);
  });

  // 3. User Message Creation & Correct Role/Kind Assignment
  await test("User message creation: successfully persists user message with role USER and kind QUESTION", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 10,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const result = await service.sendMessage(1, convUuid, "idemp-key-1", {
      role: "USER",
      kind: "QUESTION",
      text: "How many users registered this month?",
      locale: "en",
    });

    assert.strictEqual(result.role, message_role.USER);
    assert.strictEqual(result.kind, message_kind.QUESTION);
    assert.strictEqual(result.text, "How many users registered this month?");
    assert.strictEqual(result.locale, "en");
    assert.strictEqual(result.redacted, false);

    const stored = repo.messages[0];
    assert.ok(stored);
    assert.strictEqual(stored.conversation_id, 10);
    assert.strictEqual(stored.role, message_role.USER);
    assert.strictEqual(stored.kind, message_kind.QUESTION);
    assert.strictEqual(stored.idempotency_key, "idemp-key-1");
    assert.ok(stored.canonical_body_hash);
    assert.ok(stored.question_hash);
    assert.ok(isValidUuid(stored.request_uuid));
  });

  // 4. Assistant Message Creation
  await test("Assistant message creation: successfully persists assistant response with role ASSISTANT", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 20,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const result = await service.storeAssistantMessage(1, convUuid, {
      kind: message_kind.CLARIFICATION_REQUEST,
      text: "Did you mean calendar month or rolling 30 days?",
      locale: "en",
    });

    assert.strictEqual(result.role, message_role.ASSISTANT);
    assert.strictEqual(result.kind, message_kind.CLARIFICATION_REQUEST);
    assert.strictEqual(
      result.text,
      "Did you mean calendar month or rolling 30 days?",
    );
    assert.strictEqual(result.redacted, false);

    const stored = repo.messages[0];
    assert.strictEqual(stored.conversation_id, 20);
    assert.strictEqual(stored.role, message_role.ASSISTANT);
    assert.strictEqual(stored.idempotency_key, null);
    assert.strictEqual(stored.canonical_body_hash, null);
    assert.strictEqual(stored.question_hash, null);
  });

  // 5. Locale Handling
  await test("Locale handling: uses request locale if valid, otherwise falls back to conversation locale", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 30,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.it,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);

    // Request with no locale inherits conversation's Italian locale
    const res1 = await service.sendMessage(1, convUuid, "key-loc-1", {
      kind: "QUESTION",
      text: "Quali sono le vendite?",
    });
    assert.strictEqual(res1.locale, "it");

    // Request with explicit supported locale
    const res2 = await service.sendMessage(1, convUuid, "key-loc-2", {
      kind: "QUESTION",
      text: "What are sales in EN?",
      locale: "en",
    });
    assert.strictEqual(res2.locale, "en");
  });

  // 6. Conversation-State Validation
  await test("Conversation-state validation: rejects message on ARCHIVED conversation with CONVERSATION_NOT_ACTIVE", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 40,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ARCHIVED,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => {
        await service.sendMessage(1, convUuid, "key-arch-1", {
          kind: "QUESTION",
          text: "Hello?",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "CONVERSATION_NOT_ACTIVE");
        return true;
      },
    );
  });

  await test("Conversation-state validation: rejects message on DELETED conversation with CONVERSATION_NOT_ACTIVE", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 41,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.DELETED,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: new Date(),
    });

    const service = createCopilotService(repo as any);
    await assert.rejects(
      async () => {
        await service.sendMessage(1, convUuid, "key-del-1", {
          kind: "QUESTION",
          text: "Hello?",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 409);
        assert.strictEqual(err.code, "CONVERSATION_NOT_ACTIVE");
        return true;
      },
    );
  });

  // 7. Idempotency Handling
  await test("Idempotency handling: replaying same key with identical body returns cached message without duplicate insertion", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 50,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const first = await service.sendMessage(1, convUuid, "idemp-test-key", {
      kind: "QUESTION",
      text: "Show top customers",
      locale: "en",
    });

    assert.strictEqual(repo.messages.length, 1);

    const second = await service.sendMessage(1, convUuid, "idemp-test-key", {
      kind: "QUESTION",
      text: "Show top customers",
      locale: "en",
    });

    assert.strictEqual(
      repo.messages.length,
      1,
      "Duplicate message must NOT be created",
    );
    assert.strictEqual(second.id, first.id);
  });

  await test("Idempotency handling: reusing same key with different body throws 409 IDEMPOTENCY_KEY_REUSED", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 51,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    await service.sendMessage(1, convUuid, "conflict-key", {
      kind: "QUESTION",
      text: "Initial body",
      locale: "en",
    });

    await assert.rejects(
      async () => {
        await service.sendMessage(1, convUuid, "conflict-key", {
          kind: "QUESTION",
          text: "Different body attempting key reuse",
          locale: "en",
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

  // 8. Request UUID Handling
  await test("Request UUID handling: preserves client-provided valid UUID and generates one when omitted", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();
    repo.conversations.push({
      id: 60,
      conversation_uuid: convUuid,
      owner_user_id: 1,
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);
    const customReqUuid = randomUUID();

    const res1 = await service.sendMessage(1, convUuid, "key-req-1", {
      kind: "QUESTION",
      text: "Test with custom request UUID",
      request_uuid: customReqUuid,
    });
    assert.strictEqual(res1.request_uuid, customReqUuid);

    const res2 = await service.sendMessage(1, convUuid, "key-req-2", {
      kind: "QUESTION",
      text: "Test without custom request UUID",
    });
    assert.ok(isValidUuid(res2.request_uuid));
  });

  console.log(`\n==================================================`);
  console.log(` UNIT TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log(`==================================================\n`);
}

runUnitTests().catch((err) => {
  console.error("Unit test execution failed:", err);
  process.exit(1);
});
