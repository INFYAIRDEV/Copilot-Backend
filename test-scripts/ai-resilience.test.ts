import assert from "node:assert";
import { CircuitBreaker } from "../src/modules/ai/resilience/circuit-breaker.js";
import { AIProviderException } from "../src/modules/ai/types/ai-provider.types.js";

async function runAiResilienceTests() {
  console.log("==================================================");
  console.log(" FEATURE: AI RESILIENCE & CIRCUIT BREAKER TESTS   ");
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

  // 1. Initial State
  await test("Circuit Breaker: Starts in CLOSED state", () => {
    const cb = new CircuitBreaker("TEST_PROVIDER", { failureThreshold: 3 });
    assert.strictEqual(cb.getState(), "CLOSED");
  });

  // 2. Successful Execution
  await test("Circuit Breaker: Allows operation to execute successfully in CLOSED state", async () => {
    const cb = new CircuitBreaker("TEST_PROVIDER", { failureThreshold: 3 });
    const result = await cb.execute(async () => 42);
    assert.strictEqual(result, 42);
    assert.strictEqual(cb.getState(), "CLOSED");
  });

  // 3. Trip to OPEN State on Consecutive Failures
  await test("Circuit Breaker: Trips to OPEN state after reaching failure threshold", async () => {
    const cb = new CircuitBreaker("TEST_PROVIDER", {
      failureThreshold: 2,
      failureThresholdInWindow: 2,
      resetTimeoutMs: 100, // short timeout for testing
    });

    for (let i = 0; i < 2; i++) {
      try {
        await cb.execute(async () => {
          throw new AIProviderException("TIMEOUT", "Simulated timeout", "TEST_PROVIDER");
        });
      } catch {
        // expected
      }
    }

    assert.strictEqual(cb.getState(), "OPEN");

    // Next call should be blocked immediately without executing operation
    let executed = false;
    await assert.rejects(
      async () => {
        await cb.execute(async () => {
          executed = true;
          return "should not run";
        });
      },
      (err: AIProviderException) => {
        assert.strictEqual(err.category, "UNAVAILABLE");
        assert.ok(err.message.includes("Circuit Breaker OPEN"));
        return true;
      },
    );
    assert.strictEqual(executed, false, "Operation must not have executed");
  });

  // 4. Transition to HALF_OPEN after timeout
  await test("Circuit Breaker: Transitions to HALF_OPEN after resetTimeoutMs expires", async () => {
    const cb = new CircuitBreaker("TEST_PROVIDER", {
      failureThreshold: 1,
      failureThresholdInWindow: 1,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 1,
    });

    try {
      await cb.execute(async () => {
        throw new AIProviderException("UNAVAILABLE", "Simulated outage", "TEST_PROVIDER");
      });
    } catch {
      // expected
    }

    assert.strictEqual(cb.getState(), "OPEN");

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(cb.getState(), "HALF_OPEN");

    // Successful probe closes the circuit
    const probe = await cb.execute(async () => "healthy");
    assert.strictEqual(probe, "healthy");
    assert.strictEqual(cb.getState(), "CLOSED");
  });

  console.log("==================================================");
  console.log(` AI RESILIENCE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runAiResilienceTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
