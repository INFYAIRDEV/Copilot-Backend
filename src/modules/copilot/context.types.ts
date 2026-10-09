import { z } from "zod";

export interface AnalyticalFilter {
  field: string;
  operator: "=" | "!=" | ">" | "<" | ">=" | "<=" | "IN" | "LIKE" | "BETWEEN";
  value: string | number | boolean | Array<string | number>;
}

export interface AnalyticalSort {
  field: string;
  direction: "ASC" | "DESC";
}

export interface AnalyticalPeriod {
  type?: "ABSOLUTE" | "RELATIVE" | "QUARTER" | "MONTH" | "YEAR";
  value?: string;
  startDate?: string;
  endDate?: string;
  granularity?: "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";
}

export interface AnalyticalComparison {
  type?:
    "PERIOD_OVER_PERIOD" | "PREVIOUS_PERIOD" | "PREVIOUS_YEAR" | "EXPLICIT";
  value?: string;
  startDate?: string;
  endDate?: string;
}

export interface DrillDownContext {
  activeDimension?: string;
  path?: string[];
}

export interface NormalizedAnalyticalContext {
  metricRefs: string[];
  dimensionRefs: string[];
  filters: AnalyticalFilter[];
  groupBy: string[];
  sort: AnalyticalSort[];
  period?: AnalyticalPeriod | null;
  comparison?: AnalyticalComparison | null;
  currency?: { code?: string; symbol?: string } | null;
  timezone?: string | null;
  mode?: "POINT_IN_TIME" | "CURRENT" | "DEFAULT";
  drillDown?: DrillDownContext | null;
  datasetId?: string | null;
  datasetVersion?: string | null;
  semanticVersion?: string | null;
  version: number;
}

export interface CandidateContextUpdate {
  intentType?: string;
  metrics?: string[];
  dimensions?: string[];
  filters?: AnalyticalFilter[];
  groupBy?: string[];
  sort?: AnalyticalSort[];
  period?: AnalyticalPeriod | null;
  comparison?: AnalyticalComparison | null;
  currency?: { code?: string; symbol?: string } | null;
  timezone?: string | null;
  mode?: "POINT_IN_TIME" | "CURRENT" | "DEFAULT";
  drillDown?: DrillDownContext | null;
  isReset?: boolean;
}

export const FORBIDDEN_CONTEXT_KEYS = [
  "sql",
  "raw_sql",
  "query",
  "password",
  "credentials",
  "secret",
  "token",
  "user_id",
  "role_id",
  "permissions",
  "scopes",
  "record_scope",
  "tenant_id",
];

const analyticalFilterSchema = z.object({
  field: z.string().min(1).max(128),
  operator: z.enum(["=", "!=", ">", "<", ">=", "<=", "IN", "LIKE", "BETWEEN"]),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.union([z.string(), z.number()])),
  ]),
});

const analyticalSortSchema = z.object({
  field: z.string().min(1).max(128),
  direction: z.enum(["ASC", "DESC"]),
});

const analyticalPeriodSchema = z
  .object({
    type: z
      .enum(["ABSOLUTE", "RELATIVE", "QUARTER", "MONTH", "YEAR"])
      .optional(),
    value: z.string().max(64).optional(),
    startDate: z.string().max(64).optional(),
    endDate: z.string().max(64).optional(),
    granularity: z.enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"]).optional(),
  })
  .nullable()
  .optional();

const analyticalComparisonSchema = z
  .object({
    type: z
      .enum([
        "PERIOD_OVER_PERIOD",
        "PREVIOUS_PERIOD",
        "PREVIOUS_YEAR",
        "EXPLICIT",
      ])
      .optional(),
    value: z.string().max(64).optional(),
    startDate: z.string().max(64).optional(),
    endDate: z.string().max(64).optional(),
  })
  .nullable()
  .optional();

const drillDownSchema = z
  .object({
    activeDimension: z.string().max(128).optional(),
    path: z.array(z.string().max(128)).optional(),
  })
  .nullable()
  .optional();

export const normalizedAnalyticalContextSchema = z
  .object({
    metricRefs: z.array(z.string().min(1).max(128)).default([]),
    dimensionRefs: z.array(z.string().min(1).max(128)).default([]),
    filters: z.array(analyticalFilterSchema).default([]),
    groupBy: z.array(z.string().min(1).max(128)).default([]),
    sort: z.array(analyticalSortSchema).default([]),
    period: analyticalPeriodSchema,
    comparison: analyticalComparisonSchema,
    currency: z
      .object({
        code: z.string().max(8).optional(),
        symbol: z.string().max(8).optional(),
      })
      .nullable()
      .optional(),
    timezone: z.string().max(64).nullable().optional(),
    mode: z
      .enum(["POINT_IN_TIME", "CURRENT", "DEFAULT"])
      .optional()
      .default("DEFAULT"),
    drillDown: drillDownSchema,
    datasetId: z.string().max(128).nullable().optional(),
    datasetVersion: z.string().max(64).nullable().optional(),
    semanticVersion: z.string().max(64).nullable().optional(),
    version: z.number().int().min(1).default(1),
  })
  .strict();

export function createDefaultAnalyticalContext(): NormalizedAnalyticalContext {
  return {
    metricRefs: [],
    dimensionRefs: [],
    filters: [],
    groupBy: [],
    sort: [],
    period: null,
    comparison: null,
    currency: null,
    timezone: "UTC",
    mode: "DEFAULT",
    drillDown: null,
    datasetId: null,
    datasetVersion: null,
    semanticVersion: "1.0.0",
    version: 1,
  };
}
