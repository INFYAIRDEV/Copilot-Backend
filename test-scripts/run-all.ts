import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve, join } from "node:path";

interface SuiteResult {
  file: string;
  durationMs: number;
  success: boolean;
  error?: string;
}

async function runTestFile(filePath: string): Promise<SuiteResult> {
  const start = Date.now();
  return new Promise((res) => {
    // Run with tsx (or node if dist)
    const proc = spawn("npx", ["tsx", filePath], {
      stdio: "inherit",
      shell: true,
      cwd: resolve("."),
    });

    proc.on("close", (code) => {
      const durationMs = Date.now() - start;
      res({
        file: filePath,
        durationMs,
        success: code === 0,
      });
    });

    proc.on("error", (err) => {
      res({
        file: filePath,
        durationMs: Date.now() - start,
        success: false,
        error: err.message,
      });
    });
  });
}

async function main() {
  const testScriptsDir = resolve("test-scripts");
  const files = readdirSync(testScriptsDir)
    .filter((f) => f.endsWith(".test.ts"))
    .sort();

  console.log("================================================================================");
  console.log(` 🚀 RUNNING ALL FEATURE TEST SCRIPTS (${files.length} SUITES FOUND)`);
  console.log("================================================================================\n");

  const results: SuiteResult[] = [];
  const overallStart = Date.now();

  for (const file of files) {
    const fullPath = join("test-scripts", file);
    console.log(`\n▶ Running suite: ${file}...`);
    const result = await runTestFile(fullPath);
    results.push(result);
  }

  const overallDuration = ((Date.now() - overallStart) / 1000).toFixed(2);
  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log("\n================================================================================");
  console.log("                           TEST EXECUTION SUMMARY                               ");
  console.log("================================================================================");
  console.log(
    `Total Suites: ${results.length} | Passed: ${passed} | Failed: ${failed} | Duration: ${overallDuration}s\n`,
  );

  for (const r of results) {
    const icon = r.success ? "✔ [PASS]" : "✘ [FAIL]";
    const duration = `${r.durationMs}ms`.padStart(8, " ");
    console.log(` ${icon}  ${duration}  ${r.file}`);
  }
  console.log("================================================================================\n");

  if (failed > 0) {
    console.error(`💥 ${failed} test suite(s) failed.`);
    process.exit(1);
  } else {
    console.log("🎉 All feature test suites passed successfully!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
