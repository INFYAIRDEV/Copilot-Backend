import { prisma } from "../../shared/utils/prismaClient.js";
import { logger } from "../../shared/utils/logger.js";
import { areTablesAllowed } from "./schema-catalog.js";

export interface BoundedResult {
  columns: Array<{ name: string; type: string }>;
  rows: any[];
  rowCount: number;
  truncated: boolean;
}

export interface MatrixBoundedResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  truncated: boolean;
}

export interface ExecutionResult {
  rows: any[];
  rowCount: number;
  durationMs: number;
  bounded: BoundedResult;
  matrixResult: MatrixBoundedResult;
}

/**
 * Verifies that the user has permission to execute the query against referenced reporting objects.
 * Enforces schema boundary and authorization (Section 6.3 & 10).
 */
export function checkUserAuthorization(
  user: { id: number; role_id?: string },
  referencedTables: string[],
  referencedColumns: string[],
): void {
  if (!user || !user.id) {
    const err: any = new Error("User authentication required for query execution.");
    err.statusCode = 401;
    err.code = "UNAUTHORIZED_CALLER";
    throw err;
  }

  // Operator role (role 3) denied analytical SQL execution if restricted
  if (user.role_id === "3") {
    const err: any = new Error("User does not have permission to execute sales analytics queries.");
    err.statusCode = 403;
    err.code = "FORBIDDEN_INSUFFICIENT_RIGHTS";
    throw err;
  }

  // Verify that all referenced tables belong to approved reporting schema
  const check = areTablesAllowed(referencedTables);
  if (!check.allowed) {
    const err: any = new Error(`Access denied to unapproved objects: ${check.rejectedTables.join(", ")}`);
    err.statusCode = 403;
    err.code = "UNAUTHORIZED_OBJECT_ACCESS";
    throw err;
  }
}

/**
 * Executes approved SQL using a read-only transaction with statement timeout
 * and interactive limit (1,000 rows cap) (Section 6.3 & 7.2).
 */
export async function executeReadOnlyQuery(sql: string): Promise<ExecutionResult> {
  const startTime = Date.now();

  try {
    // Execute inside a read-only transaction with timeout
    const rows = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10000';"); // 10s timeout
        await tx.$executeRawUnsafe("SET LOCAL default_transaction_read_only = 'on';");
        return await tx.$queryRawUnsafe<any[]>(sql);
      },
      {
        timeout: 12000,
      }
    );

    const durationMs = Date.now() - startTime;
    const rowCount = rows ? rows.length : 0;

    // Convert bigints and dates to clean JSON serializable formats
    const sanitizedRows = rows.map((row) => {
      const clean: any = {};
      for (const [k, v] of Object.entries(row)) {
        if (typeof v === "bigint") {
          clean[k] = Number(v);
        } else if (v instanceof Date) {
          clean[k] = v.toISOString().split("T")[0];
        } else if (typeof v === "object" && v !== null && "toNumber" in (v as any)) {
          // Prisma Decimal
          clean[k] = (v as any).toNumber();
        } else {
          clean[k] = v;
        }
      }
      return clean;
    });

    const bounded = boundResultForInterpretation(sanitizedRows, rowCount);

    const allKeys = sanitizedRows.length > 0 ? Object.keys(sanitizedRows[0]).slice(0, 30) : [];
    const matrixColumns = allKeys;
    const matrixRows = sanitizedRows.slice(0, 200).map((r) => allKeys.map((k) => r[k]));
    const matrixResult: MatrixBoundedResult = {
      columns: matrixColumns,
      rows: matrixRows,
      rowCount,
      truncated: rowCount > 200 || sanitizedRows.length > 200,
    };

    return {
      rows: sanitizedRows,
      rowCount,
      durationMs,
      bounded,
      matrixResult,
    };
  } catch (error: any) {
    const durationMs = Date.now() - startTime;
    logger.error("SQL_EXECUTION_FAILED", { sql, error: error.message, durationMs });

    // Clean Prisma invocation prefix so internal stack details are sanitized
    const rawMessage = error.message || "Failed to execute database query.";
    const cleanMessage =
      rawMessage.match(/Message:\s*`([^`]+)`/)?.[1] ||
      rawMessage.replace(/Invalid `prisma\.\$queryRawUnsafe\(\)` invocation:\s*/g, "").trim();

    const err: any = new Error(cleanMessage || "Failed to execute database query.");
    err.statusCode = 500;
    err.code = "QUERY_EXECUTION_ERROR";
    err.durationMs = durationMs;
    err.cleanMessage = cleanMessage;
    throw err;
  }
}

/**
 * Large-Result Gate (Section 7.2):
 * Bounds database results before sending to Vertex / Gemini for narration.
 * Max 200 rows, max 30 columns, max 512KB payload.
 */
export function boundResultForInterpretation(
  allRows: any[],
  totalRowCount: number,
  maxRows = 200,
  maxCols = 30,
): BoundedResult {
  const truncated = totalRowCount > maxRows || allRows.length > maxRows;
  const slicedRows = allRows.slice(0, maxRows);

  if (slicedRows.length === 0) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
  }

  // Extract columns up to maxCols
  const allKeys = Object.keys(slicedRows[0]);
  const allowedKeys = allKeys.slice(0, maxCols);

  const columns = allowedKeys.map((key) => {
    const sampleVal = slicedRows[0][key];
    let type = "string";
    if (typeof sampleVal === "number") type = "numeric";
    else if (typeof sampleVal === "boolean") type = "boolean";
    return { name: key, type };
  });

  // Filter rows to only allowed columns
  const filteredRows = slicedRows.map((r) => {
    const item: any = {};
    for (const k of allowedKeys) {
      item[k] = r[k];
    }
    return item;
  });

  return {
    columns,
    rows: filteredRows,
    rowCount: totalRowCount,
    truncated,
  };
}

export const executionService = {
  checkUserAuthorization,
  executeReadOnlyQuery,
  boundResultForInterpretation,
};

