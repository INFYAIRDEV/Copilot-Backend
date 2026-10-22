import "dotenv/config";
import assert from "node:assert";
import { checkAiServiceHealth, callAIService, generateQueryFromAi, interpretResultFromAi } from "../ai-client.service.js";
import { executeReadOnlyQuery, checkUserAuthorization } from "../execution.service.js";
import { processCopilotQuery } from "../copilot.service.js";
import { CopilotError } from "../copilot.error.js";
import { prisma } from "../../../shared/utils/prismaClient.js";

/**
 * ============================================================================
 * COPILOT ARCHITECTURE & FUNCTIONALITY VALIDATION SUITE
 * ============================================================================
 * This test suite validates all layers of the Sales Intelligence Copilot:
 * 1. AI Service Health & Connectivity (GET /health)
 * 2. Query Generation Contract (POST /v1/query/generate)
 * 3. PostgreSQL Read-Only Execution & Matrix Formatting
 * 4. Schema Boundary & RBAC Authorization Enforcement
 * 5. Result Interpretation Contract (POST /v1/result/interpret)
 * 6. Multi-Turn Session Continuity (via aiSessionId)
 * 7. Ambiguity & Clarification Handling (NEEDS_CLARIFICATION)
 * 8. End-to-End processCopilotQuery Pipeline (DB Persistence & Payload)
 * 9. Input Validation & Resilience (Empty question, Bad User, Limits)
 * ============================================================================
 */

async function runArchitectureValidationTests() {
  console.log("\n====================================================================");
  console.log("     SALES INTELLIGENCE COPILOT - ARCHITECTURE VALIDATION SUITE     ");
  console.log("====================================================================\n");

  let passed = 0;
  let failed = 0;
  let sharedAiSessionId: string | null = null;
  let generatedSql: string = "";

  async function test(name: string, fn: () => Promise<void> | void) {
    const start = Date.now();
    try {
      await fn();
      const duration = Date.now() - start;
      passed++;
      console.log(`  ✔ [PASS] ${name} (${duration}ms)`);
    } catch (err: any) {
      const duration = Date.now() - start;
      failed++;
      console.error(`  ✘ [FAIL] ${name} (${duration}ms)`);
      console.error(`     Error: ${err.message || err}`);
      if (err.stack) {
        console.error(`     Stack: ${err.stack.split("\n").slice(1, 4).join("\n")}`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: AI Query Agent Connectivity & Health
  // --------------------------------------------------------------------------
  await test("Layer 1: AI Agent Connectivity & Health (GET /health)", async () => {
    const health = await checkAiServiceHealth();
    assert.strictEqual(health.ok, true, `AI service health check failed: ${health.error}`);
    console.log(`     -> Remote service status: ${health.status}`);
  });

  // --------------------------------------------------------------------------
  // TEST 2: Query Generation Contract (POST /v1/query/generate)
  // --------------------------------------------------------------------------
  await test("Layer 2: SQL Query Generation (POST /v1/query/generate)", async () => {
    const response = await generateQueryFromAi({
      requestId: "test-arch-req-1",
      conversationId: "test-arch-conv-1",
      userId: "3",
      aiSessionId: null,
      question: "Show total sales by year.",
      locale: "en",
    });

    assert.ok(response, "Expected response from AI query generator");
    assert.strictEqual(response.status, "READY", `Expected READY status but got: ${response.status}`);
    
    const ready = response as any;
    assert.ok(ready.sql, "Expected non-empty SQL string in response");
    assert.match(ready.sql, /SELECT/i, "Expected SQL to contain SELECT statement");
    assert.ok(ready.aiSessionId, "Expected aiSessionId returned by AI agent for session memory");
    
    sharedAiSessionId = ready.aiSessionId;
    generatedSql = ready.sql;
    console.log(`     -> Generated aiSessionId: ${sharedAiSessionId}`);
    console.log(`     -> Generated SQL: ${generatedSql.replace(/\s+/g, " ").trim().slice(0, 80)}...`);
  });

  // --------------------------------------------------------------------------
  // TEST 3: Cloud SQL Read-Only Execution & Matrix Transformation
  // --------------------------------------------------------------------------
  await test("Layer 3: Read-Only Cloud SQL Execution & Matrix Formatting", async () => {
    assert.ok(generatedSql, "Prerequisite generatedSql must be available from Layer 2");

    const execResult = await executeReadOnlyQuery(generatedSql);
    assert.ok(execResult, "Execution result should not be null");
    assert.ok(Array.isArray(execResult.rows), "Expected rows array");
    assert.ok(execResult.rowCount >= 0, "Row count should be non-negative");
    assert.ok(execResult.durationMs >= 0, "Execution duration should be tracked");

    // Matrix Result format check
    const matrix = execResult.matrixResult;
    assert.ok(matrix, "matrixResult must be present");
    assert.ok(Array.isArray(matrix.columns), "matrix.columns must be array of strings");
    assert.ok(Array.isArray(matrix.rows), "matrix.rows must be array of row arrays");
    assert.strictEqual(typeof matrix.truncated, "boolean", "matrix.truncated must be boolean");

    console.log(`     -> DB Query executed in ${execResult.durationMs}ms, returned ${execResult.rowCount} rows`);
    console.log(`     -> Matrix columns: [${matrix.columns.join(", ")}]`);
  });

  // --------------------------------------------------------------------------
  // TEST 4: RBAC & Schema Authorization Boundary Enforcement
  // --------------------------------------------------------------------------
  await test("Layer 4: RBAC & Schema Boundary Enforcement", async () => {
    // 4a: Approved reporting view should pass
    assert.doesNotThrow(() => {
      checkUserAuthorization({ id: 3, role_id: "user" }, ["reporting.v_sales"], ["order_year", "total_sales"]);
    }, "Approved reporting views must be allowed");

    // 4b: Unauthorized internal table access must be rejected
    assert.throws(
      () => {
        checkUserAuthorization({ id: 3, role_id: "user" }, ["users", "conversation"], ["id", "password_hash"]);
      },
      /Access denied to unapproved objects|UNAUTHORIZED_OBJECT_ACCESS/i,
      "Access to internal user tables must be rejected"
    );

    // 4c: Denied role (role 3 - Operator) must be forbidden
    assert.throws(
      () => {
        checkUserAuthorization({ id: 3, role_id: "3" }, ["reporting.v_sales"], ["order_year"]);
      },
      /permission to execute sales analytics queries|FORBIDDEN_INSUFFICIENT_RIGHTS/i,
      "Operator role must be forbidden"
    );
  });

  // --------------------------------------------------------------------------
  // TEST 5: Result Interpretation Contract (POST /v1/result/interpret)
  // --------------------------------------------------------------------------
  await test("Layer 5: AI Result Interpretation (POST /v1/result/interpret)", async () => {
    const mockMatrix = {
      columns: ["order_year", "total_sales"],
      rows: [
        [2021, 1500000],
        [2022, 2300000],
        [2023, 3100000],
      ],
      rowCount: 3,
      truncated: false,
    };

    const interpretation = await interpretResultFromAi({
      requestId: "test-arch-req-interpret",
      conversationId: "test-arch-conv-1",
      userId: "3",
      aiSessionId: sharedAiSessionId,
      question: "Show total sales by year.",
      result: mockMatrix,
      executionMetadata: {
        durationMs: 45,
      },
    });

    assert.ok(interpretation, "Expected interpretation response");
    const answerText = interpretation.answer || interpretation.summary;
    assert.ok(answerText && answerText.length > 0, "Expected non-empty natural language answer/summary");

    console.log(`     -> Interpreted Answer: ${answerText.slice(0, 100)}...`);
    if (interpretation.chart) {
      console.log(`     -> Recommended Chart Type: ${(interpretation.chart as any).type || (interpretation.chart as any).chartType || "chart"}`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 6: Multi-Turn Conversation Continuity via aiSessionId
  // --------------------------------------------------------------------------
  await test("Layer 6: Multi-Turn Context Continuity (aiSessionId)", async () => {
    assert.ok(sharedAiSessionId, "Prerequisite sharedAiSessionId must be set");

    // Follow-up question relying on previous turn context without re-sending history
    const followUp = await generateQueryFromAi({
      requestId: "test-arch-req-followup",
      conversationId: "test-arch-conv-1",
      userId: "3",
      aiSessionId: sharedAiSessionId,
      question: "Now only for Europe.",
      locale: "en",
    });

    assert.ok(followUp, "Expected response for follow-up query");
    assert.strictEqual(followUp.status, "READY", `Expected READY for contextual follow-up, got: ${followUp.status}`);
    
    const readyFollowUp = followUp as any;
    assert.ok(readyFollowUp.sql, "Follow-up query must produce SQL");
    console.log(`     -> Follow-up SQL with session context: ${readyFollowUp.sql.replace(/\s+/g, " ").trim().slice(0, 90)}...`);
  });

  // --------------------------------------------------------------------------
  // TEST 7: Ambiguity & Clarification Flow (NEEDS_CLARIFICATION)
  // --------------------------------------------------------------------------
  await test("Layer 7: Ambiguity & Clarification Handling (NEEDS_CLARIFICATION)", async () => {
    const ambiguousResponse = await generateQueryFromAi({
      requestId: "test-arch-req-ambiguous",
      conversationId: "test-arch-conv-clarify",
      userId: "3",
      aiSessionId: null,
      question: "Rank them for me.", // Ambiguous: rank what? customers, products, territories?
      locale: "en",
    });

    assert.ok(ambiguousResponse, "Expected response for ambiguous request");
    // Should be NEEDS_CLARIFICATION or handled gracefully
    if (ambiguousResponse.status === "NEEDS_CLARIFICATION") {
      const clarify = ambiguousResponse as any;
      const q = clarify.clarificationQuestion || clarify.question;
      assert.ok(q && q.length > 0, "Expected clarificationQuestion when status is NEEDS_CLARIFICATION");
      console.log(`     -> Handled ambiguity with clarification: "${q}"`);
    } else {
      console.log(`     -> AI Agent resolved question with status: ${ambiguousResponse.status}`);
    }
  });

  // --------------------------------------------------------------------------
  // TEST 8: End-to-End processCopilotQuery Pipeline (Service Layer)
  // --------------------------------------------------------------------------
  await test("Layer 8: End-to-End processCopilotQuery Pipeline", async () => {
    const result = await processCopilotQuery({
      userId: 3,
      question: "Show total sales by year.",
      locale: "en",
    });

    assert.ok(result, "Expected result from processCopilotQuery");
    assert.strictEqual(result.status, "SUCCESS", `Expected SUCCESS status, got: ${result.status}`);
    assert.ok(result.answer, "Expected answer text in unified payload");
    assert.ok(result.conversationId, "Expected conversationId returned");
    assert.ok(result.sql, "Expected executed SQL in payload");
    assert.ok(result.table, "Expected table data in payload");
    assert.ok(Array.isArray(result.table.columns), "Table columns must be array");
    assert.ok(Array.isArray(result.table.rows), "Table rows must be array");

    // Verify conversation was persisted with aiSessionId in database
    const conv = await prisma.conversation.findUnique({
      where: { conversation_uuid: result.conversationId },
    });
    assert.ok(conv, "Conversation should exist in PostgreSQL");
    const analyticalContext = conv.analytical_context as any;
    assert.ok(analyticalContext?.aiSessionId, "aiSessionId should be saved in conversation.analytical_context");

    // Verify messages were persisted
    const msgCount = await prisma.conversation_message.count({
      where: { conversation_id: conv.id },
    });
    assert.ok(msgCount >= 2, `Expected at least 2 messages (user + assistant), found: ${msgCount}`);

    console.log(`     -> Verified complete pipeline: Conv UUID = ${result.conversationId}`);
    console.log(`     -> Answer preview: "${result.answer.slice(0, 80)}..."`);
  });

  // --------------------------------------------------------------------------
  // TEST 9: Input Validation & Defensive Resilience
  // --------------------------------------------------------------------------
  await test("Layer 9: Input Validation & Defensive Checks", async () => {
    // 9a: Empty question rejected with 400
    await assert.rejects(
      async () => {
        await processCopilotQuery({ userId: 3, question: "" });
      },
      (err: any) => err instanceof CopilotError && err.statusCode === 400,
      "Empty question must be rejected with HTTP 400"
    );

    // 9b: Invalid user ID rejected with 401
    await assert.rejects(
      async () => {
        await processCopilotQuery({ userId: -1, question: "Valid question" });
      },
      (err: any) => err instanceof CopilotError && err.statusCode === 401,
      "Invalid user ID must be rejected with HTTP 401"
    );

    // 9c: Huge payload rejected with 413
    await assert.rejects(
      async () => {
        await processCopilotQuery({ userId: 3, question: "A".repeat(4001) });
      },
      (err: any) => err instanceof CopilotError && err.statusCode === 413,
      "Oversized question (>4000 chars) must be rejected with HTTP 413"
    );
  });

  // --------------------------------------------------------------------------
  // Summary
  // --------------------------------------------------------------------------
  console.log("\n====================================================================");
  console.log(`   VALIDATION SUMMARY: ${passed} PASSED / ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("====================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

// Run if invoked directly
runArchitectureValidationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  });
