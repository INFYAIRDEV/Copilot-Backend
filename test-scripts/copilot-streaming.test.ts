import assert from "node:assert";
import {
  STREAM_EVENT_TYPES,
  formatSseEvent,
  sanitizeStreamChunk,
  ChatStreamEmitter,
} from "../src/modules/copilot/streaming.types.js";

async function runCopilotStreamingTests() {
  console.log("==================================================");
  console.log(" FEATURE: COPILOT SSE STREAMING & WEBSOCKET TESTS  ");
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

  // 1. SSE Event Formatting
  await test("SSE Formatting: Generates standard event/data SSE payloads", () => {
    const raw = formatSseEvent(STREAM_EVENT_TYPES.CONTENT_CHUNK, {
      delta: "Hello world",
      index: 0,
    });
    assert.ok(raw.startsWith("event: content_chunk\n"), "Must have event header");
    assert.ok(raw.includes('"delta":"Hello world"'), "Must include JSON serialized payload");
    assert.ok(raw.endsWith("\n\n"), "Must terminate with double newline");
  });

  // 2. Stream Chunk Sanitization
  await test("Stream Sanitization: Redacts credentials, tokens and sensitive SQL", () => {
    const sensitive = "Here is the key: api_key='secret123' and password='mypassword' for sk-12345678901234567890";
    const sanitized = sanitizeStreamChunk(sensitive);
    assert.ok(!sanitized.includes("secret123"), "API key value must be redacted");
    assert.ok(!sanitized.includes("mypassword"), "Password value must be redacted");
    assert.ok(sanitized.includes("[REDACTED]"), "Must insert [REDACTED]");
  });

  await test("Stream Sanitization: Redacts database connection strings and raw DDL/DML", () => {
    const rawConn = "Connecting to postgres://user:pass@localhost:5432/db";
    const sanitizedConn = sanitizeStreamChunk(rawConn);
    assert.ok(!sanitizedConn.includes("postgres://"), "Postgres URI must be redacted");

    const rawSql = "Executed SELECT * FROM users WHERE id = 1;";
    const sanitizedSql = sanitizeStreamChunk(rawSql);
    assert.ok(sanitizedSql.includes("[REDACTED]"), "Raw SQL query must be redacted");
  });

  // 3. Mock Stream Emitter Lifecycle
  await test("Stream Emitter: Follows complete lifecycle from start to complete", () => {
    const emittedEvents: Array<{ event: string; data: any }> = [];
    let aborted = false;

    const emitter: ChatStreamEmitter = {
      emitStart(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.RESPONSE_STARTED, data });
      },
      emitChunk(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.CONTENT_CHUNK, data });
      },
      emitResult(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.RESULT_AVAILABLE, data });
      },
      emitDegraded(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.DEGRADED_RESPONSE, data });
      },
      emitComplete(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.RESPONSE_COMPLETED, data });
      },
      emitError(data) {
        emittedEvents.push({ event: STREAM_EVENT_TYPES.ERROR, data });
      },
      isAborted: () => aborted,
      abort: () => { aborted = true; },
    };

    emitter.emitStart({
      conversation_uuid: "uuid-1",
      request_uuid: "req-1",
      created_at: new Date().toISOString(),
    });

    emitter.emitChunk({ delta: "Analytical ", index: 0 });
    emitter.emitChunk({ delta: "insights ", index: 1 });
    emitter.emitChunk({ delta: "generated.", index: 2 });

    emitter.emitComplete({
      message_id: 101,
      role: "ASSISTANT",
      kind: "ANSWER",
      text: "Analytical insights generated.",
      conversation_uuid: "uuid-1",
      created_at: new Date().toISOString(),
      usage: {
        input_tokens: 50,
        output_tokens: 20,
        total_tokens: 70,
        latency_ms: 120,
      },
    });

    assert.strictEqual(emittedEvents.length, 5);
    assert.strictEqual(emittedEvents[0].event, STREAM_EVENT_TYPES.RESPONSE_STARTED);
    assert.strictEqual(emittedEvents[1].event, STREAM_EVENT_TYPES.CONTENT_CHUNK);
    assert.strictEqual(emittedEvents[4].event, STREAM_EVENT_TYPES.RESPONSE_COMPLETED);
    assert.strictEqual(emitter.isAborted(), false);

    emitter.abort();
    assert.strictEqual(emitter.isAborted(), true);
  });

  console.log("==================================================");
  console.log(` COPILOT STREAMING TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runCopilotStreamingTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
