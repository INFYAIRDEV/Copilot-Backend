import assert from "node:assert";
import { analyticsService } from "../analytics.service.js";
import { analyticsRepository } from "../analytics.repository.js";
import { GOLDEN_VALIDATION_CHECKS } from "../analytics.fixtures.js";

async function runTests() {
  console.log("==================================================");
  console.log("       TRACK A ANALYTICS & JOURNEY TESTS          ");
  console.log("==================================================");

  // 1. Golden Validation (18/18 PASS)
  console.log("\n--- TEST: Golden Validation Suite ---");
  const validationChecks = await analyticsRepository.getGoldenValidation();
  assert.strictEqual(
    validationChecks.length,
    18,
    "Expected exactly 18 golden checks",
  );
  const failed = validationChecks.filter((c: any) => c.result === "FAIL");
  assert.strictEqual(failed.length, 0, "Expected 0 failed checks");
  console.log(
    `✔ [PASS] Golden regression: ${validationChecks.length}/18 PASS, 0 FAIL`,
  );

  // 2. Journey 1: Current Sales
  console.log("\n--- TEST: Journey 1 (Current Sales) ---");
  const j1 = await analyticsService.executeJourney("current-sales", "en");
  assert.strictEqual(
    j1.blueprintResponse.metrics[0].value,
    820000,
    "Q3 sales must be €820,000",
  );
  assert.strictEqual(j1.uiAnswer.id, "current-sales");
  console.log(
    `✔ [PASS] Journey 1: €${j1.blueprintResponse.metrics[0].value.toLocaleString()} Q3-to-date`,
  );

  // 3. Journey 2: Equivalent-Period Comparison
  console.log("\n--- TEST: Journey 2 (Equivalent-Period Comparison) ---");
  const j2 = await analyticsService.executeJourney("sales-comparison", "en");
  const q2Comp = j2.blueprintResponse.comparisons.find(
    (c) => c.comparisonId === "comp-q2-equivalent",
  );
  const pyComp = j2.blueprintResponse.comparisons.find(
    (c) => c.comparisonId === "comp-py-equivalent",
  );
  assert.ok(q2Comp, "Q2 comparison must exist");
  assert.ok(pyComp, "Prior-year comparison must exist");
  assert.strictEqual(q2Comp.percentVariance, 7.9, "Q2 variance must be +7.9%");
  assert.strictEqual(
    q2Comp.baselineValue,
    760000,
    "Q2 baseline must be €760,000",
  );
  assert.strictEqual(
    pyComp.percentVariance,
    17.1,
    "Prior-year variance must be +17.1%",
  );
  assert.strictEqual(
    pyComp.baselineValue,
    700000,
    "Prior-year baseline must be €700,000",
  );
  console.log(
    `✔ [PASS] Journey 2: +${q2Comp.percentVariance}% vs Q2 (€${q2Comp.baselineValue.toLocaleString()}), +${pyComp.percentVariance}% vs PY (€${pyComp.baselineValue.toLocaleString()})`,
  );

  // 4. Journey 3: Top Customers
  console.log("\n--- TEST: Journey 3 (Top Customers) ---");
  const j3 = await analyticsService.executeJourney("top-customers", "en");
  const ranking = j3.blueprintResponse.rankings[0];
  assert.strictEqual(ranking.topNValue, 631000, "Top 5 sales must be €631,000");
  assert.strictEqual(
    ranking.topNSharePercent,
    77.0,
    "Top 5 share must be 77.0%",
  );
  assert.strictEqual(
    ranking.rows.length,
    5,
    "Must contain exactly 5 customers",
  );
  assert.strictEqual(ranking.rows[0].displayName, "OptiNord");
  assert.strictEqual(ranking.rows[0].value, 185000);
  assert.strictEqual(ranking.rows[1].displayName, "Rana");
  assert.strictEqual(ranking.rows[1].value, 148000);
  assert.strictEqual(ranking.rows[2].displayName, "MedLens");
  assert.strictEqual(ranking.rows[2].value, 112000);
  assert.strictEqual(ranking.rows[3].displayName, "EuroPhotonics");
  assert.strictEqual(ranking.rows[3].value, 96000);
  assert.strictEqual(ranking.rows[4].displayName, "NovaOptics");
  assert.strictEqual(ranking.rows[4].value, 90000);
  console.log(
    `✔ [PASS] Journey 3: Top 5 customer total €${ranking.topNValue.toLocaleString()} (${ranking.topNSharePercent}%)`,
  );

  // 5. Journey 4: Top Suppliers
  console.log("\n--- TEST: Journey 4 (Top Suppliers) ---");
  const j4 = await analyticsService.executeJourney("supplier-spend", "en");
  const suppRanking = j4.blueprintResponse.rankings[0];
  assert.strictEqual(
    suppRanking.totalValue,
    510000,
    "Total spend must be €510,000",
  );
  assert.strictEqual(
    suppRanking.topNValue,
    380000,
    "Top 5 spend must be €380,000",
  );
  assert.strictEqual(
    suppRanking.topNSharePercent,
    74.5,
    "Top 5 spend share must be 74.5%",
  );
  assert.strictEqual(suppRanking.rows.length, 5);
  assert.strictEqual(suppRanking.rows[0].displayName, "Precision Glass Italia");
  assert.strictEqual(suppRanking.rows[0].value, 112000);
  assert.strictEqual(suppRanking.rows[4].displayName, "SafeLogistics");
  assert.strictEqual(
    suppRanking.rows[4].value,
    50000,
    "SafeLogistics must be net of credit note (€50,000)",
  );
  console.log(
    `✔ [PASS] Journey 4: Top 5 supplier spend €${suppRanking.topNValue.toLocaleString()} / ${suppRanking.topNSharePercent}% of €${suppRanking.totalValue.toLocaleString()}`,
  );

  // 6. Journey 5: Delayed Orders
  console.log("\n--- TEST: Journey 5 (Delayed Orders) ---");
  const j5 = await analyticsService.executeJourney("delayed-orders", "en");
  const ordersCount = j5.blueprintResponse.metrics.find(
    (m) => m.metricId === "sales.delayed_order_count",
  );
  const linesCount = j5.blueprintResponse.metrics.find(
    (m) => m.metricId === "sales.delayed_order_line_count",
  );
  const backlogNet = j5.blueprintResponse.metrics.find(
    (m) => m.metricId === "sales.delayed_backlog_net",
  );
  assert.strictEqual(ordersCount?.value, 6, "Must be 6 delayed orders");
  assert.strictEqual(linesCount?.value, 7, "Must be 7 delayed lines");
  assert.strictEqual(
    backlogNet?.value,
    164000,
    "Delayed backlog must be €164,000",
  );
  console.log(
    `✔ [PASS] Journey 5: ${ordersCount?.value} orders, ${linesCount?.value} lines, €${backlogNet?.value.toLocaleString()} backlog`,
  );

  // 7. Journey 6: Production Linkage
  console.log("\n--- TEST: Journey 6 (Production Linkage) ---");
  const j6 = await analyticsService.executeJourney("production-linkage", "en");
  const coverageMetric = j6.blueprintResponse.metrics.find(
    (m) => m.metricId === "production.sales_linkage_coverage_pct",
  );
  const linkedBacklogMetric = j6.blueprintResponse.metrics.find(
    (m) => m.metricId === "production.exposed_backlog_net",
  );
  const delayedProdMetric = j6.blueprintResponse.metrics.find(
    (m) => m.metricId === "production.delayed_order_count",
  );
  assert.strictEqual(coverageMetric?.value, 91.0, "Coverage must be 91.0%");
  assert.strictEqual(
    linkedBacklogMetric?.value,
    149240,
    "Linked backlog must be €149,240",
  );
  assert.strictEqual(
    delayedProdMetric?.value,
    6,
    "Delayed production orders must be 6",
  );
  assert.strictEqual(
    j6.blueprintResponse.warnings.length,
    1,
    "Must contain partial linkage warning",
  );
  assert.strictEqual(
    j6.blueprintResponse.warnings[0].code,
    "PARTIAL_LINKAGE_COVERAGE",
  );
  console.log(
    `✔ [PASS] Journey 6: ${coverageMetric?.value}% coverage, €${linkedBacklogMetric?.value.toLocaleString()} linked backlog, partial linkage warning present`,
  );

  // 8. Bilingual Presentation Check
  console.log("\n--- TEST: Bilingual Presentation ---");
  const j1_it = await analyticsService.executeJourney("current-sales", "it");
  assert.strictEqual(
    j1_it.blueprintResponse.metrics[0].value,
    j1.blueprintResponse.metrics[0].value,
    "Numeric value must be identical",
  );
  assert.ok(
    j1_it.uiAnswer.meta?.howCalculated.includes("Somma degli importi"),
    "Italian explanation required",
  );
  console.log(
    "✔ [PASS] Bilingual: Identical numbers across EN and IT with localized text",
  );

  // 9. Supporting Records
  console.log("\n--- TEST: Supporting Records ---");
  const recs = await analyticsService.getSupportingRecords(
    "delayed-orders",
    3,
    0,
  );
  assert.strictEqual(recs.totalCount, 7, "Total delayed lines must be 7");
  assert.strictEqual(recs.records.length, 3, "Paginated limit 3 returned");
  assert.strictEqual(recs.hasMore, true);
  console.log(
    `✔ [PASS] Supporting records: ${recs.totalCount} total, pagination working`,
  );

  // 10. Natural Language Pipeline -> ModelCandidatePlan -> ExecutionEnvelope -> AnswerResponse
  console.log(
    "\n--- TEST: Natural Language Pipeline (ModelCandidatePlan & ExecutionEnvelope) ---",
  );
  const pipelineResult = await analyticsService.executePipeline({
    question: "Show our top customers for this quarter",
    locale: "en",
  });
  assert.ok(
    "candidatePlan" in pipelineResult,
    "Must produce ModelCandidatePlan",
  );
  assert.ok(
    "executionEnvelope" in pipelineResult,
    "Must produce ExecutionEnvelope",
  );
  assert.strictEqual(pipelineResult.candidatePlan.schemaVersion, "1.2");
  assert.strictEqual(pipelineResult.candidatePlan.intent, "RANK");
  assert.strictEqual(pipelineResult.executionEnvelope.schemaVersion, "1.2");
  assert.strictEqual(
    pipelineResult.executionEnvelope.executionPolicy.readOnly,
    true,
  );
  assert.strictEqual(
    pipelineResult.executionEnvelope.executionPolicy.statementClass,
    "CERTIFIED_ANALYTICAL_SELECT",
  );
  assert.strictEqual(
    pipelineResult.executionEnvelope.enforcedPolicy.decisionOutcome,
    "ALLOW",
  );
  assert.strictEqual(pipelineResult.uiAnswer.id, "top-customers");
  console.log(
    "✔ [PASS] Pipeline: ModelCandidatePlan (v1.2) -> ExecutionEnvelope (v1.2) -> Governed Query Executor -> UI Answer",
  );

  // 11. Ambiguity & Clarification Gate
  console.log("\n--- TEST: Ambiguity & Clarification Gate (No Guessing) ---");
  const ambigResult = await analyticsService.executePipeline({
    question: "delayed orders",
    locale: "en",
  });
  assert.strictEqual(
    ambigResult.candidatePlan.clarification.status,
    "REQUIRED",
    "Must require clarification",
  );
  assert.ok(
    ambigResult.candidatePlan.clarification.question?.includes("ambiguous"),
    "Clarification message provided",
  );
  assert.strictEqual(ambigResult.uiAnswer.id, "clarification-needed");
  console.log(
    "✔ [PASS] Ambiguity: 'delayed orders' safely returns clarification request without unauthorized guessing",
  );

  // 12. Bilingual Natural Language Pipeline
  console.log("\n--- TEST: Bilingual Pipeline (Italian) ---");
  const itPipeline = await analyticsService.executePipeline({
    question: "Mostrami le prestazioni di vendita del trimestre corrente",
    locale: "it",
  });
  assert.strictEqual(itPipeline.uiAnswer.id, "current-sales");
  assert.ok("blueprintResponse" in itPipeline);
  assert.strictEqual(
    itPipeline.blueprintResponse.metrics[0].value,
    820000,
    "Q3 sales must be €820,000 in IT pipeline",
  );
  console.log(
    "✔ [PASS] Bilingual Pipeline: Italian natural language processed through governed pipeline",
  );

  console.log("\n==================================================");
  console.log("       ALL TRACK A TESTS PASSED (12/12)           ");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
