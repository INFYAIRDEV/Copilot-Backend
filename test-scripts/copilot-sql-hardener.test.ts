import assert from "node:assert";
import {
  validateAndHardenSql,
  ensureQueryLimit,
} from "../src/modules/copilot/sql-hardener.js";

async function runSqlHardenerTests() {
  console.log("==================================================");
  console.log(" FEATURE: COPILOT SQL HARDENER & QUERY GOVERNANCE ");
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

  // 1. Valid Analytical Queries
  await test("SQL Hardener: Valid SELECT on reporting view passes", () => {
    const sql = "SELECT customer_name, sales_amount FROM reporting.v_sales ORDER BY sales_amount DESC LIMIT 10;";
    const result = validateAndHardenSql(sql);
    assert.strictEqual(result.passed, true);
    assert.ok(result.referencedTables.includes("reporting.v_sales"));
  });

  await test("SQL Hardener: Valid JOIN on reporting views passes", () => {
    const sql = `
      SELECT s.customer_name, p.product_name, s.sales_amount
      FROM reporting.v_sales s
      JOIN reporting.v_product p ON s.product_id = p.product_id
      LIMIT 10;
    `;
    const result = validateAndHardenSql(sql);
    assert.strictEqual(result.passed, true);
    assert.ok(result.referencedTables.includes("reporting.v_sales"));
    assert.ok(result.referencedTables.includes("reporting.v_product"));
  });

  // 2. Reject Empty or Multi-statement
  await test("SQL Hardener: Rejects empty or whitespace-only SQL", () => {
    const result = validateAndHardenSql("   ");
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.code, "EMPTY_SQL");
  });

  await test("SQL Hardener: Rejects multi-statement SQL attacks", () => {
    const sql = "SELECT * FROM reporting.v_customer_sales; DROP TABLE users;";
    const result = validateAndHardenSql(sql);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.code, "MULTI_STATEMENT_REJECTED");
  });

  // 3. Forbid Destructive Keywords
  await test("SQL Hardener: Rejects forbidden DDL/DML keywords (DROP, DELETE, UPDATE, INSERT, TRUNCATE)", () => {
    const forbiddenSqls = [
      "DROP TABLE reporting.v_customer_sales;",
      "DELETE FROM reporting.v_customer_sales WHERE id = 1;",
      "UPDATE reporting.v_customer_sales SET total_amount = 0;",
      "INSERT INTO reporting.v_customer_sales (customer_name) VALUES ('Hacker');",
      "TRUNCATE TABLE reporting.v_customer_sales;",
      "ALTER TABLE reporting.v_customer_sales ADD COLUMN hacker text;",
    ];

    for (const sql of forbiddenSqls) {
      const result = validateAndHardenSql(sql);
      assert.strictEqual(result.passed, false);
    }
  });

  // 4. Forbid System Catalog Access
  await test("SQL Hardener: Rejects pg_catalog and information_schema accesses", () => {
    const pgCatalogSql = "SELECT * FROM pg_catalog.pg_tables;";
    const infoSchemaSql = "SELECT * FROM information_schema.tables;";

    const res1 = validateAndHardenSql(pgCatalogSql);
    assert.strictEqual(res1.passed, false);

    const res2 = validateAndHardenSql(infoSchemaSql);
    assert.strictEqual(res2.passed, false);
  });

  // 5. Unapproved Tables
  await test("SQL Hardener: Rejects tables outside approved reporting catalog", () => {
    const sql = "SELECT * FROM public.users;";
    const result = validateAndHardenSql(sql);
    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.code, "UNAPPROVED_TABLES");
  });

  // 6. Safety Limit Injection
  await test("Safety Limit: Injects LIMIT 1000 if no LIMIT is present", () => {
    const sql = "SELECT * FROM reporting.v_customer_sales";
    const hardened = ensureQueryLimit(sql, 1000);
    assert.strictEqual(hardened, "SELECT * FROM reporting.v_customer_sales LIMIT 1000");
  });

  await test("Safety Limit: Caps existing LIMIT if it exceeds maximum allowed", () => {
    const sql = "SELECT * FROM reporting.v_customer_sales LIMIT 5000";
    const hardened = ensureQueryLimit(sql, 1000);
    assert.strictEqual(hardened, "SELECT * FROM reporting.v_customer_sales LIMIT 1000");
  });

  await test("Safety Limit: Preserves legitimate LIMIT if within bounds", () => {
    const sql = "SELECT * FROM reporting.v_customer_sales LIMIT 25";
    const hardened = ensureQueryLimit(sql, 1000);
    assert.strictEqual(hardened, "SELECT * FROM reporting.v_customer_sales LIMIT 25");
  });

  console.log("==================================================");
  console.log(` COPILOT SQL HARDENER TESTS: ${passed}/${total} PASSED`);
  console.log("==================================================");
}

runSqlHardenerTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
