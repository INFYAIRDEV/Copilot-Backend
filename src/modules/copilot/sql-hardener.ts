import { areTablesAllowed, SCHEMA_CATALOG } from "./schema-catalog.js";

export interface SqlValidationResult {
  passed: boolean;
  code?: string;
  reason?: string;
  referencedTables: string[];
  referencedColumns: string[];
}

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "MERGE",
  "CREATE",
  "ALTER",
  "DROP",
  "TRUNCATE",
  "GRANT",
  "REVOKE",
  "COPY",
  "CALL",
  "DO",
  "EXECUTE",
  "PREPARE",
  "DEALLOCATE",
  "VACUUM",
  "REINDEX",
  "REFRESH",
  "INTO", // SELECT INTO
];

const FORBIDDEN_SYSTEM_OBJECTS = [
  "pg_catalog",
  "information_schema",
  "pg_",
  "current_user",
  "session_user",
  "dblink",
  "pg_sleep",
];

/**
 * Deterministically hardens and validates PostgreSQL SQL syntax and structure
 * as defined in Section 5.4 of the MVP Architecture Guide.
 */
export function validateAndHardenSql(sql: string): SqlValidationResult {
  if (!sql || typeof sql !== "string" || sql.trim().length === 0) {
    return {
      passed: false,
      code: "EMPTY_SQL",
      reason: "Generated SQL is empty.",
      referencedTables: [],
      referencedColumns: [],
    };
  }

  const cleanSql = sql.trim().replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // 1. Statement count check: Exactly one statement (allow single trailing semicolon)
  const statements = cleanSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  if (statements.length > 1) {
    return {
      passed: false,
      code: "MULTI_STATEMENT_REJECTED",
      reason: "Multiple SQL statements are not permitted.",
      referencedTables: [],
      referencedColumns: [],
    };
  }

  const singleStatement = statements[0];

  // 2. Statement type check: SELECT or WITH ... SELECT only
  const trimmedUpper = singleStatement.toUpperCase();
  const isSelect = trimmedUpper.startsWith("SELECT");
  const isWith = trimmedUpper.startsWith("WITH");

  if (!isSelect && !isWith) {
    return {
      passed: false,
      code: "INVALID_STATEMENT_TYPE",
      reason: "Query must be a SELECT or WITH ... SELECT statement.",
      referencedTables: [],
      referencedColumns: [],
    };
  }

  // 3. Forbid DML / DDL / Administrative commands
  for (const kw of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${kw}\\b`, "i");
    if (regex.test(singleStatement)) {
      // Special case for 'INTO' check: ensure it's 'SELECT ... INTO'
      if (kw === "INTO" && !/\bSELECT\b[\s\S]+?\bINTO\b/i.test(singleStatement)) {
        continue;
      }
      return {
        passed: false,
        code: "UNSAFE_KEYWORD_DETECTED",
        reason: `Forbidden keyword '${kw}' detected in query.`,
        referencedTables: [],
        referencedColumns: [],
      };
    }
  }

  // 4. System access check: Reject pg_catalog, information_schema, etc.
  for (const sys of FORBIDDEN_SYSTEM_OBJECTS) {
    const regex = new RegExp(`\\b${sys}`, "i");
    if (regex.test(singleStatement)) {
      return {
        passed: false,
        code: "SYSTEM_ACCESS_REJECTED",
        reason: `System catalog access '${sys}' is prohibited.`,
        referencedTables: [],
        referencedColumns: [],
      };
    }
  }

  // 5. Extract referenced tables and verify against approved schema catalog
  const referencedTables = extractReferencedTables(singleStatement);
  if (referencedTables.length === 0) {
    return {
      passed: false,
      code: "NO_TABLE_FOUND",
      reason: "No reporting view found in query.",
      referencedTables: [],
      referencedColumns: [],
    };
  }

  const tableCheck = areTablesAllowed(referencedTables);
  if (!tableCheck.allowed) {
    return {
      passed: false,
      code: "UNAPPROVED_TABLES",
      reason: `Query references unapproved tables: ${tableCheck.rejectedTables.join(", ")}. Only reporting.* views are allowed.`,
      referencedTables,
      referencedColumns: [],
    };
  }

  // 6. Extract referenced columns
  const referencedColumns = extractReferencedColumns(singleStatement, referencedTables);

  return {
    passed: true,
    referencedTables,
    referencedColumns,
  };
}

/**
 * Extracts table names from FROM and JOIN clauses.
 */
function extractReferencedTables(sql: string): string[] {
  const tables = new Set<string>();
  // Mask out function calls like EXTRACT(... FROM ...), TRIM(... FROM ...), SUBSTRING(... FROM ...)
  const sanitizedForTableSearch = sql
    .replace(/\bEXTRACT\s*\([^)]+?\)/gi, "")
    .replace(/\bTRIM\s*\([^)]+?\)/gi, "")
    .replace(/\bSUBSTRING\s*\([^)]+?\)/gi, "");

  const tableRegex = /\b(?:FROM|JOIN)\s+([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)?)/gi;

  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(sanitizedForTableSearch)) !== null) {
    const rawName = match[1].trim();
    if (rawName && !["SELECT", "LATERAL", "UNNEST"].includes(rawName.toUpperCase())) {
      const normalized = rawName.toLowerCase().startsWith("reporting.")
        ? rawName.toLowerCase()
        : `reporting.${rawName.toLowerCase()}`;
      tables.add(normalized);
    }
  }

  return Array.from(tables);
}

/**
 * Extracts column names present in the query that match catalog columns.
 */
function extractReferencedColumns(sql: string, tables: string[]): string[] {
  const columns = new Set<string>();
  const upperSql = sql.toUpperCase();

  for (const tbl of tables) {
    const viewDef = SCHEMA_CATALOG[tbl];
    if (viewDef) {
      for (const colName of Object.keys(viewDef.columns)) {
        const regex = new RegExp(`\\b${colName}\\b`, "i");
        if (regex.test(sql)) {
          columns.add(colName);
        }
      }
    }
  }

  return Array.from(columns);
}

/**
 * Ensures a safety LIMIT clause is present (max 1000 rows as per Section 7.2).
 */
export function ensureQueryLimit(sql: string, maxLimit = 1000): string {
  const trimmed = sql.trim().replace(/;$/, "");
  const limitMatch = trimmed.match(/\bLIMIT\s+(\d+)\b/i);

  if (limitMatch) {
    const currentLimit = parseInt(limitMatch[1], 10);
    if (currentLimit > maxLimit) {
      return trimmed.replace(/\bLIMIT\s+\d+\b/i, `LIMIT ${maxLimit}`);
    }
    return trimmed;
  }

  return `${trimmed} LIMIT ${maxLimit}`;
}
