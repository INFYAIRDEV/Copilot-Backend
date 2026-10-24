import assert from "node:assert/strict";
import {
  classificationSchema,
  validateStructuredOutput,
  OutputSchemaRegistry,
  OutputSchemaException,
} from "../src/modules/ai/index.js";

async function runAiStructuredOutputTests() {
  console.log("==================================================");
  console.log(" FEATURE: AI STRUCTURED OUTPUT & JSON VALIDATION ");
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

  // 1. Classification Schema Structure
  await test("Schema Registry: Built-in classificationSchema contains valid JSON schema & metadata", () => {
    assert.strictEqual(classificationSchema.id, "text_classification");
    assert.strictEqual(classificationSchema.promptKey, "TEXT_CLASSIFICATION");
    assert.ok(classificationSchema.providerSchema, "Must provide provider JSON Schema");
    assert.strictEqual(classificationSchema.providerSchema.type, "object");
  });

  // 2. Validation of Conformant Payload
  await test("Structured Validator: Valid classification JSON payload parses cleanly", () => {
    const rawJson = JSON.stringify({
      category: "product",
      confidence: 0.95,
      summary: "User is asking for total sales numbers",
    });

    const result = validateStructuredOutput(rawJson, classificationSchema.schema);
    assert.strictEqual(result.success, true);
    if (result.success) {
      assert.strictEqual(result.data.category, "product");
      assert.strictEqual(result.data.confidence, 0.95);
      assert.strictEqual(result.data.summary, "User is asking for total sales numbers");
    }
  });

  // 3. Rejection of Invalid Data Types
  await test("Structured Validator: Returns failure for invalid confidence range", () => {
    const invalidConfidence = JSON.stringify({
      category: "product",
      confidence: 1.5, // max is 1.0
      summary: "Too high",
    });

    const result = validateStructuredOutput(invalidConfidence, classificationSchema.schema);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.code, "AI_OUTPUT_VALIDATION_FAILED");
    }
  });

  // 4. Rejection of Malformed JSON
  await test("Structured Validator: Returns failure for malformed JSON syntax", () => {
    const malformed = "{ category: 'sales', confidence: ";

    const result = validateStructuredOutput(malformed, classificationSchema.schema);
    assert.strictEqual(result.success, false);
    if (!result.success) {
      assert.strictEqual(result.code, "AI_OUTPUT_PARSE_FAILED");
    }
  });

  // 5. OutputSchemaRegistry assertRegistered
  await test("Schema Registry: Rejects unregistered schema lookup", () => {
    const registry = new OutputSchemaRegistry();
    const unregisteredSchema: any = {
      id: "unregistered_test",
      promptKey: "TEST",
    };

    assert.throws(
      () => registry.assertRegistered(unregisteredSchema),
      (err: any) => {
        return err instanceof OutputSchemaException;
      },
    );
  });

  console.log("==================================================");
  console.log(` AI STRUCTURED OUTPUT TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runAiStructuredOutputTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
