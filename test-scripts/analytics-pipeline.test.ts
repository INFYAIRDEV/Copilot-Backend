import "../src/shared/translation/i18n.js";
import assert from "node:assert";
import { analyticsService } from "../src/modules/analytics/analytics.service.js";
import { analyticsRepository } from "../src/modules/analytics/analytics.repository.js";

async function runAnalyticsPipelineTests() {
  console.log("==================================================");
  console.log(" FEATURE: ANALYTICS & GOVERNED PIPELINE TESTS     ");
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

  // 1. Golden Validation (18/18 checks)
  await test("Golden Regression Suite: 18/18 certified checks pass", async () => {
    const checks = await analyticsRepository.getGoldenValidation();
    assert.strictEqual(checks.length, 18, "Expected 18 checks");
    const failed = checks.filter((c: any) => c.result === "FAIL");
    assert.strictEqual(failed.length, 0, "Expected 0 failures");
  });

  // 2. Journey 1: Current Sales
  await test("Journey 1 (Current Sales): Accurately aggregates Q3 sales metric", async () => {
    const res = await analyticsService.executeJourney("current-sales", "en");
    assert.strictEqual(res.uiAnswer.id, "current-sales");
    assert.strictEqual(res.blueprintResponse.metrics[0].value, 820000);
  });

  // 3. Journey 3: Top Customers
  await test("Journey 3 (Top Customers): Produces ranked customer list with percentage share", async () => {
    const res = await analyticsService.executeJourney("top-customers", "en");
    const ranking = res.blueprintResponse.rankings[0];
    assert.strictEqual(ranking.rows.length, 5);
    assert.strictEqual(ranking.topNValue, 631000);
    assert.strictEqual(ranking.topNSharePercent, 77.0);
    assert.strictEqual(ranking.rows[0].displayName, "OptiNord");
  });

  // 4. Natural Language Governed Pipeline
  await test("Natural Language Pipeline: Produces candidate plan & execution envelope", async () => {
    const pipelineResult = await analyticsService.executePipeline({
      question: "Show our top customers for this quarter",
      locale: "en",
    });
    assert.ok("candidatePlan" in pipelineResult);
    assert.ok("executionEnvelope" in pipelineResult);
    assert.strictEqual(pipelineResult.candidatePlan.schemaVersion, "1.2");
    assert.strictEqual(pipelineResult.candidatePlan.intent, "RANK");
    assert.strictEqual(pipelineResult.executionEnvelope.executionPolicy.readOnly, true);
    assert.strictEqual(pipelineResult.executionEnvelope.enforcedPolicy.decisionOutcome, "ALLOW");
    assert.strictEqual(pipelineResult.uiAnswer.id, "top-customers");
  });

  // 5. Ambiguity & Clarification Gate
  await test("Clarification Gate: Ambiguous query requires clarification without guessing", async () => {
    const ambig = await analyticsService.executePipeline({
      question: "delayed orders",
      locale: "en",
    });
    assert.strictEqual(ambig.candidatePlan.clarification.status, "REQUIRED");
    assert.strictEqual(ambig.uiAnswer.id, "clarification-needed");
  });

  // 6. Bilingual Pipeline (Italian)
  await test("Bilingual Support: Executes query in Italian and returns localized response", async () => {
    const itResult = await analyticsService.executePipeline({
      question: "Mostrami le prestazioni di vendita del trimestre corrente",
      locale: "it",
    });
    assert.strictEqual(itResult.uiAnswer.id, "current-sales");
    assert.strictEqual(itResult.blueprintResponse.metrics[0].value, 820000);
  });

  console.log("==================================================");
  console.log(` ANALYTICS PIPELINE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runAnalyticsPipelineTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
