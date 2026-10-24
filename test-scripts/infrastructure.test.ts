import assert from "node:assert";
import { assertMailConfig } from "../src/infrastructure/mailer/mailer.js";
import { cronManager } from "../src/shared/cron-job/cronManager.js";

async function runInfrastructureTests() {
  console.log("==================================================");
  console.log(" FEATURE: INFRASTRUCTURE, MAILER & CRON TESTS      ");
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

  // 1. Mailer Configuration Assert
  await test("Mailer Config: Throws error when required SMTP keys are missing", () => {
    const prevHost = process.env.EMAIL_SERVICE_PROVIDER_SMTP_HOST;
    delete process.env.EMAIL_SERVICE_PROVIDER_SMTP_HOST;

    assert.throws(
      () => assertMailConfig(),
      (err: any) => {
        return err.message.includes("EMAIL_SERVICE_PROVIDER_SMTP_HOST");
      },
    );

    if (prevHost) process.env.EMAIL_SERVICE_PROVIDER_SMTP_HOST = prevHost;
  });

  await test("Mailer Config: Passes assertion when all required SMTP keys are configured", () => {
    const keys = [
      "EMAIL_SERVICE_PROVIDER_SMTP_HOST",
      "EMAIL_SERVICE_PROVIDER_SMTP_PORT",
      "EMAIL_SENDER_ID",
      "EMAIL_SENDER_PWD",
    ];
    const prevs: Record<string, string | undefined> = {};
    for (const k of keys) {
      prevs[k] = process.env[k];
      process.env[k] = "test_value";
    }

    try {
      assert.doesNotThrow(() => assertMailConfig());
    } finally {
      for (const k of keys) {
        if (prevs[k]) process.env[k] = prevs[k];
        else delete process.env[k];
      }
    }
  });

  // 2. Cron Manager Registration & Lifecycle
  await test("Cron Manager: Successfully registers and manages job lifecycle", () => {
    let executed = false;
    cronManager.register({
      name: "test-heartbeat",
      schedule: "* * * * *",
      description: "Test recurring job",
      handler: async () => { executed = true; },
    });

    const statusList = cronManager.getJobs();
    const registered = statusList.find((j) => j.name === "test-heartbeat");
    assert.ok(registered, "Job must be listed in status");
    assert.strictEqual(registered.schedule, "* * * * *");
    assert.strictEqual(registered.enabled, true);

    cronManager.stopAll();
  });

  await test("Cron Manager: Prevents duplicate job registration with warning", () => {
    cronManager.register({
      name: "test-heartbeat",
      schedule: "*/5 * * * *",
      handler: async () => {},
    });

    const statusList = cronManager.getJobs();
    const count = statusList.filter((j) => j.name === "test-heartbeat").length;
    assert.strictEqual(count, 1, "Should not duplicate job");
  });

  // 3. Health Check Logic
  await test("Health Endpoint Logic: Simulates database connectivity check", async () => {
    // Simulates the Promise.race logic used in server.ts /health endpoint
    const dbProbe = Promise.resolve([{ "1": 1 }]);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), 1000),
    );

    const result = await Promise.race([dbProbe, timeout]);
    assert.ok(Array.isArray(result));
  });

  console.log("==================================================");
  console.log(` INFRASTRUCTURE TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runInfrastructureTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
