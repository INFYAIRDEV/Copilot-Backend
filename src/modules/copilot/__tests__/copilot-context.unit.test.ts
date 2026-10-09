import assert from "node:assert";
import {
  ContextService,
  contextService,
  resolveCanonicalTerm,
  CERTIFIED_METRICS,
  CERTIFIED_DIMENSIONS,
} from "../context.service.js";
import {
  normalizedAnalyticalContextSchema,
  createDefaultAnalyticalContext,
  NormalizedAnalyticalContext,
  CandidateContextUpdate,
} from "../context.types.js";
import { createMockConversationRepository } from "./test-utils.js";
import { message_kind } from "@prisma/client";

async function runContextUnitTests() {
  console.log("==================================================");
  console.log("         COPILOT CONTEXT UNIT TESTS               ");
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

  // 1. Context Schema Validation
  await test("Default analytical context conforms to strict schema", () => {
    const defaultCtx = createDefaultAnalyticalContext();
    const parsed = normalizedAnalyticalContextSchema.safeParse(defaultCtx);
    assert.strictEqual(parsed.success, true);
    if (parsed.success) {
      assert.deepStrictEqual(parsed.data.metricRefs, []);
      assert.deepStrictEqual(parsed.data.dimensionRefs, []);
      assert.deepStrictEqual(parsed.data.filters, []);
      assert.strictEqual(parsed.data.timezone, "UTC");
      assert.strictEqual(parsed.data.mode, "DEFAULT");
      assert.strictEqual(parsed.data.version, 1);
    }
  });

  await test("Schema rejects arbitrary unknown or forbidden keys (strict mode)", () => {
    const invalidCtx = {
      ...createDefaultAnalyticalContext(),
      unknownField: "malicious_payload",
    };
    const parsed = normalizedAnalyticalContextSchema.safeParse(invalidCtx);
    assert.strictEqual(parsed.success, false);
  });

  // 2. Context Normalization & Canonical Resolution
  await test("Business terminology resolves to canonical IDs (English & Italian)", () => {
    assert.strictEqual(resolveCanonicalTerm("sales"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("vendite"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("fatturato"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("revenue"), "sales_total");
    assert.strictEqual(resolveCanonicalTerm("orders"), "orders_count");
    assert.strictEqual(resolveCanonicalTerm("ordini"), "orders_count");
    assert.strictEqual(
      resolveCanonicalTerm("delayed orders"),
      "delayed_orders",
    );
    assert.strictEqual(
      resolveCanonicalTerm("ordini in ritardo"),
      "delayed_orders",
    );
    assert.strictEqual(resolveCanonicalTerm("cliente"), "customer");
    assert.strictEqual(resolveCanonicalTerm("clienti"), "customer");
    assert.strictEqual(resolveCanonicalTerm("paese"), "country");
    assert.strictEqual(resolveCanonicalTerm("italy"), "IT");
    assert.strictEqual(resolveCanonicalTerm("italia"), "IT");
    assert.strictEqual(resolveCanonicalTerm("q1"), "Q1");
    assert.strictEqual(resolveCanonicalTerm("q2"), "Q2");
  });

  // 3. Context Inheritance
  await test("Inheritance: Turn 2 inherits metrics, dimensions, filters, and periods", () => {
    const service = new ContextService();
    const initial: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      dimensionRefs: ["country"],
      filters: [{ field: "country", operator: "=", value: "IT" }],
      period: { type: "QUARTER", value: "Q2" },
    };

    const update: CandidateContextUpdate = {
      comparison: { type: "EXPLICIT", value: "Q1" },
    };

    const merged = service.mergeContext(initial, update);
    assert.deepStrictEqual(merged.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(merged.dimensionRefs, ["country"]);
    assert.deepStrictEqual(merged.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.deepStrictEqual(merged.period, { type: "QUARTER", value: "Q2" });
    assert.deepStrictEqual(merged.comparison, {
      type: "EXPLICIT",
      value: "Q1",
    });
  });

  // 4. Context Override
  await test("Override: explicit period override replaces period while preserving unaffected filters", () => {
    const service = new ContextService();
    const initial: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      dimensionRefs: ["country"],
      filters: [{ field: "country", operator: "=", value: "IT" }],
      period: { type: "QUARTER", value: "Q2" },
    };

    const update: CandidateContextUpdate = {
      period: { type: "QUARTER", value: "Q3" },
    };

    const merged = service.mergeContext(initial, update);
    assert.deepStrictEqual(merged.metricRefs, ["sales_total"]);
    assert.deepStrictEqual(merged.filters, [
      { field: "country", operator: "=", value: "IT" },
    ]);
    assert.strictEqual(merged.period?.value, "Q3");
    assert.strictEqual(merged.period?.type, "QUARTER");
  });

  await test("Override: field-level filter override updates matching field and preserves other fields", () => {
    const service = new ContextService();
    const initial: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      dimensionRefs: ["country", "category"],
      filters: [
        { field: "country", operator: "=", value: "FR" },
        { field: "category", operator: "=", value: "ELECTRONICS" },
      ],
    };

    const update: CandidateContextUpdate = {
      filters: [{ field: "paese", operator: "=", value: "italia" }],
    };

    const merged = service.mergeContext(initial, update);
    assert.strictEqual(merged.filters.length, 2);
    const countryFilter = merged.filters.find((f) => f.field === "country");
    const catFilter = merged.filters.find((f) => f.field === "category");
    assert.ok(countryFilter);
    assert.strictEqual(countryFilter?.value, "IT");
    assert.ok(catFilter);
    assert.strictEqual(catFilter?.value, "ELECTRONICS");
  });

  // 5. Context Clarification Handling
  await test("Clarification: handleClarification keeps existing context completely unchanged", () => {
    const service = new ContextService();
    const existing: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      filters: [{ field: "country", operator: "=", value: "IT" }],
      period: { type: "QUARTER", value: "Q2" },
    };

    const preserved = service.handleClarification(
      existing,
      message_kind.CLARIFICATION_REQUEST,
    );
    assert.deepStrictEqual(preserved, existing);
  });

  // 6. Context Reset Behavior
  await test("Reset: isReset=true resets historical context to default baseline with only new properties", () => {
    const service = new ContextService();
    const existing: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      dimensionRefs: ["country"],
      filters: [{ field: "country", operator: "=", value: "IT" }],
      groupBy: ["country"],
      period: { type: "QUARTER", value: "Q2" },
    };

    const resetUpdate: CandidateContextUpdate = {
      isReset: true,
      metrics: ["orders_count"],
      dimensions: ["customer"],
    };

    const result = service.mergeContext(existing, resetUpdate);
    assert.deepStrictEqual(result.metricRefs, ["orders_count"]);
    assert.deepStrictEqual(result.dimensionRefs, ["customer"]);
    assert.deepStrictEqual(result.filters, []);
    assert.deepStrictEqual(result.groupBy, []);
    assert.strictEqual(result.period, null);
  });

  // 7. Locale-Independent Canonical Resolution
  await test("Locale independence: English and Italian queries resolve to identical canonical analytical context", () => {
    const service = new ContextService();
    const initial = createDefaultAnalyticalContext();

    const enUpdate: CandidateContextUpdate = {
      metrics: ["sales"],
      dimensions: ["country"],
      filters: [{ field: "country", operator: "=", value: "italy" }],
      period: { type: "QUARTER", value: "q2" },
    };

    const itUpdate: CandidateContextUpdate = {
      metrics: ["vendite"],
      dimensions: ["paese"],
      filters: [{ field: "paese", operator: "=", value: "italia" }],
      period: { type: "QUARTER", value: "q2" },
    };

    const enContext = service.mergeContext(initial, enUpdate);
    const itContext = service.mergeContext(initial, itUpdate);

    assert.deepStrictEqual(enContext.metricRefs, itContext.metricRefs);
    assert.deepStrictEqual(enContext.dimensionRefs, itContext.dimensionRefs);
    assert.deepStrictEqual(enContext.filters, itContext.filters);
    assert.deepStrictEqual(enContext.period, itContext.period);
  });

  // 8. Invalid Metric References
  await test("Validation: uncertified or unknown metric reference is rejected", () => {
    const service = new ContextService();
    const invalid: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["unknown_fraudulent_metric"],
    };

    const res = service.validateContext(invalid, { userId: 1, roleId: "user" });
    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) => e.includes("Invalid metric reference")),
      "Should contain metric validation error",
    );
  });

  // 9. Invalid Dimension References
  await test("Validation: uncertified or unknown dimension reference is rejected", () => {
    const service = new ContextService();
    const invalid: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      dimensionRefs: ["internal_system_secrets"],
    };

    const res = service.validateContext(invalid, { userId: 1, roleId: "user" });
    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) => e.includes("Invalid dimension reference")),
      "Should contain dimension validation error",
    );
  });

  // 10. Invalid Filter Combinations
  await test("Validation: BETWEEN operator without 2-element array is rejected", () => {
    const service = new ContextService();
    const invalid: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      filters: [
        {
          field: "date",
          operator: "BETWEEN",
          value: "2026-01-01", // Scalar instead of [start, end]
        },
      ],
    };

    const res = service.validateContext(invalid, { userId: 1, roleId: "user" });
    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) =>
        e.includes(
          "operator 'BETWEEN' on 'date' requires an array of 2 values",
        ),
      ),
    );
  });

  await test("Validation: IN operator with empty array is rejected", () => {
    const service = new ContextService();
    const invalid: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      filters: [
        {
          field: "country",
          operator: "IN",
          value: [],
        },
      ],
    };

    const res = service.validateContext(invalid, { userId: 1, roleId: "user" });
    assert.strictEqual(res.isValid, false);
    assert.ok(
      res.errors?.some((e) =>
        e.includes("operator 'IN' on 'country' requires a non-empty array"),
      ),
    );
  });

  await test("Validation: scalar operator '=' cannot have an array value", () => {
    const service = new ContextService();
    const invalid: NormalizedAnalyticalContext = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      filters: [
        {
          field: "country",
          operator: "=",
          value: ["IT", "FR"] as any,
        },
      ],
    };

    const res = service.validateContext(invalid, { userId: 1, roleId: "user" });
    assert.strictEqual(res.isValid, false);
    assert.ok(res.errors?.some((e) => e.includes("scalar operator '='")));
  });

  // 11. Context Version Handling
  await test("Version Handling: persistContext increments version from expected version", async () => {
    const repo = createMockConversationRepository();
    const createdConv = await repo.create(1);
    const service = new ContextService(repo as any);

    const { conversationId, version } = await service.retrieveContext(
      createdConv.conversation_uuid,
      1,
    );

    const contextToSave = {
      ...createDefaultAnalyticalContext(),
      metricRefs: ["sales_total"],
      filters: [{ field: "country", operator: "=", value: "IT" } as any],
    };

    const saved = await service.persistContext(
      conversationId,
      version,
      contextToSave,
    );
    assert.strictEqual(saved.version, 2);

    const stored = await repo.findById(conversationId);
    assert.strictEqual(stored?.version, 2);
    assert.deepStrictEqual(stored?.analytical_context.metricRefs, [
      "sales_total",
    ]);
  });

  console.log("==================================================");
  console.log(` CONTEXT UNIT TESTS SUMMARY: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runContextUnitTests().catch((err) => {
  console.error("Context unit tests failed:", err);
  process.exit(1);
});
