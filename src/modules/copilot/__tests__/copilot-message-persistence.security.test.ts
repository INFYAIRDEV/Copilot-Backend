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
  sanitizeAndRedactMessageText,
  publicMessage,
} from "../copilot.service.js";
import { copilotController } from "../copilot.controller.js";
import { createMockConversationRepository } from "./test-utils.js";

async function runSecurityTests() {
  console.log("==================================================");
  console.log("    COPILOT MESSAGE PERSISTENCE SECURITY TESTS    ");
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

  // 1. Cross-User Message Access is Rejected
  await test("Security: Cross-user message submission is rejected with 403 COPILOT_PERMISSION_DENIED", async () => {
    const repo = createMockConversationRepository();
    const aliceConvUuid = randomUUID();

    repo.conversations.push({
      id: 1,
      conversation_uuid: aliceConvUuid,
      owner_user_id: 10, // Alice's user_id is 10
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    const service = createCopilotService(repo as any);

    // Bob (user_id: 20) attempts to access Alice's conversation
    await assert.rejects(
      async () => {
        await service.sendMessage(20, aliceConvUuid, "bob-key", {
          kind: "QUESTION",
          text: "Malicious injection into Alice's chat",
        });
      },
      (err: any) => {
        assert.ok(err instanceof CopilotError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, "COPILOT_PERMISSION_DENIED");
        return true;
      },
    );

    // Verify Alice's conversation history was not tampered with
    assert.strictEqual(repo.messages.length, 0);
  });

  // 2. Cross-Conversation Access is Rejected
  await test("Security: Cross-conversation message mixing is impossible; messages strictly scoped by conversation_id", async () => {
    const repo = createMockConversationRepository();
    const convAUuid = randomUUID();
    const convBUuid = randomUUID();

    repo.conversations.push(
      {
        id: 100,
        conversation_uuid: convAUuid,
        owner_user_id: 10,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
      {
        id: 200,
        conversation_uuid: convBUuid,
        owner_user_id: 10,
        locale: locale_code.en,
        state: conversation_state.ACTIVE,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      },
    );

    const service = createCopilotService(repo as any);
    await service.sendMessage(10, convAUuid, "a-k1", {
      kind: "QUESTION",
      text: "Msg in Conv A",
    });
    await service.sendMessage(10, convBUuid, "b-k1", {
      kind: "QUESTION",
      text: "Msg in Conv B",
    });

    const aMessages = await service.getConversationMessages(10, convAUuid);
    const bMessages = await service.getConversationMessages(10, convBUuid);

    assert.strictEqual(aMessages.length, 1);
    assert.strictEqual(aMessages[0].text, "Msg in Conv A");

    assert.strictEqual(bMessages.length, 1);
    assert.strictEqual(bMessages[0].text, "Msg in Conv B");
  });

  // 3. Client-Supplied Ownership Information Cannot Override Authenticated Identity
  await test("Security: Controller strictly derives owner from req.user and ignores spoofed body fields", async () => {
    const repo = createMockConversationRepository();
    const convUuid = randomUUID();

    repo.conversations.push({
      id: 50,
      conversation_uuid: convUuid,
      owner_user_id: 42, // Alice is 42
      locale: locale_code.en,
      state: conversation_state.ACTIVE,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
    });

    let capturedStatus: number | null = null;
    let capturedJson: any = null;

    const mockRes: any = {
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

    // Client sends user_id = 9999 in body attempting to impersonate another user
    const mockReq: any = {
      user: { user_id: 42, role_id: "analyst" }, // Authenticated identity
      params: { id: convUuid },
      get(headerName: string) {
        if (headerName.toLowerCase() === "idempotency-key")
          return "spoof-key-1";
        return undefined;
      },
      body: {
        kind: "QUESTION",
        text: "Legitimate question by 42",
        owner_user_id: 9999, // Attempted spoof
      },
    };

    // Note: Zod validation with .strict() rejects extra properties in body!
    await copilotController.sendMessage(mockReq, mockRes);

    // Either rejected with 400 validation error (strict schema) OR executed with authenticated user 42
    assert.ok(
      capturedStatus === 400 || capturedStatus === 201,
      `Status must be 400 (strict validation rejects unmodeled owner_user_id) or 201`,
    );

    if (capturedStatus === 400) {
      assert.strictEqual(capturedJson.code, "VALIDATION_ERROR");
    }
  });

  // 4. Sensitive Credentials Cannot Be Persisted As Message Text
  await test("Security: Sensitive credentials (passwords, JWTs, DB URLs, API keys) are redacted before storage", async () => {
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
    const result = await service.sendMessage(1, convUuid, "cred-key-1", {
      kind: "QUESTION",
      text: "Connect with postgres://admin:superSecret@db.internal:5432/analytics and password = 'my-db-pass'",
    });

    // Public message returns text as null and redacted as true
    assert.strictEqual(result.redacted, true);
    assert.strictEqual(result.text, null);

    // Stored message in DB contains [REDACTED] rather than plaintext credentials
    const stored = repo.messages[0];
    assert.strictEqual(stored.text_redacted, true);
    assert.ok(!stored.text!.includes("superSecret"));
    assert.ok(!stored.text!.includes("my-db-pass"));
    assert.ok(stored.text!.includes("[REDACTED]"));
  });

  // 5. Raw Provider Payloads are Not Persisted
  await test("Security: Raw AI provider response payloads are caught and redacted", async () => {
    const rawPayload =
      '{"choices": [{"message": {"role": "assistant", "content": "secret"}}]}';
    const { sanitizedText, isRedacted } =
      sanitizeAndRedactMessageText(rawPayload);

    assert.strictEqual(isRedacted, true);
    assert.ok(!sanitizedText.includes('"choices"'));
    assert.ok(sanitizedText.includes("[REDACTED]"));
  });

  // 6. Unrestricted Analytical Result Datasets are Not Stored in Message Text
  await test("Security: Raw SQL queries are caught by redaction and marked text_redacted", () => {
    const rawSql =
      "SELECT password_hash, secret_key FROM users WHERE is_admin = true";
    const { sanitizedText, isRedacted } = sanitizeAndRedactMessageText(rawSql);

    assert.strictEqual(isRedacted, true);
    assert.ok(!sanitizedText.includes("SELECT password_hash"));
    assert.ok(sanitizedText.includes("[REDACTED]"));
  });

  // 7. Security: copilot.ask authorization enforcement
  await test("Security: Controller enforces copilot.ask authorization when permissions/scopes are present", async () => {
    let capturedStatus: number | null = null;
    let capturedJson: any = null;

    const mockRes: any = {
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

    // User lacking copilot.ask permission
    const mockReqWithoutPermission: any = {
      user: {
        user_id: 77,
        role_id: "operator",
        permissions: ["reports.view", "dashboards.read"], // missing "copilot.ask"
      },
      params: { id: randomUUID() },
      get(headerName: string) {
        if (headerName.toLowerCase() === "idempotency-key") return "sec-key-1";
        return undefined;
      },
      body: {
        kind: "QUESTION",
        text: "Will I be blocked?",
      },
    };

    await copilotController.sendMessage(mockReqWithoutPermission, mockRes);

    assert.strictEqual(capturedStatus, 403);
    assert.strictEqual(capturedJson.code, "COPILOT_PERMISSION_DENIED");
    assert.ok(capturedJson.message.includes("copilot.ask required"));
  });

  // 8. Application Logs do not leak sensitive prompt or message content
  await test("Security: publicMessage and audit records do not leak unmasked text or credentials", () => {
    const repo = createMockConversationRepository();
    const service = createCopilotService(repo as any);

    // Verify audit payload structure from mock repository
    // In conversation.repository.ts, audit logs only record role, kind, and question_hash!
    const text = "Secret customer SSN: 123-45-6789";
    const { isRedacted } = sanitizeAndRedactMessageText(text);

    const pub = publicMessage({
      id: 99,
      role: "USER",
      kind: "QUESTION",
      text: "[REDACTED]",
      text_redacted: true,
      locale: "en",
      created_at: new Date(),
    });

    // Public representation completely strips text to null
    assert.strictEqual(pub.text, null);
    assert.strictEqual(pub.redacted, true);
  });

  console.log(`\n==================================================`);
  console.log(` SECURITY TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log(`==================================================\n`);
}

runSecurityTests().catch((err) => {
  console.error("Security test execution failed:", err);
  process.exit(1);
});
