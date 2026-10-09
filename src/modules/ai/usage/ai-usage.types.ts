/**
 * Application-owned AI Model Usage Telemetry and Cost Types.
 *
 * Encapsulates token consumption, latency, pricing configurations, and
 * operational metrics mapped to the copilot.model_usage PostgreSQL table schema.
 */

export type AIUsageStatus = "SUCCESS" | "FAILED" | "DEGRADED" | "FALLBACK";

/**
 * Model pricing configuration per 1 million tokens (standard industry pricing model).
 */
export interface ModelPricingConfig {
  provider: string;
  model: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  currency: string;
}

/**
 * Normalized AI token usage and operational telemetry record.
 * Aligns directly with the analytics.model_usage database table.
 */
export interface AIUsageRecord {
  id?: number;
  requestUuid: string;
  answerId?: number | null;
  provider: string;
  model: string;
  promptVersion?: string | null;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd?: number | null;
  retryCount: number;
  status: AIUsageStatus;
  createdAt?: Date;
}

/**
 * Normalized model-related metadata prepared for inclusion in the audit_event decision path.
 */
export interface AIUsageAuditMetadata {
  requestUuid: string;
  provider: string;
  model: string;
  promptVersion?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  retryCount: number;
  status: AIUsageStatus;
}

/**
 * Aggregated model usage summary for cost reporting and operational monitoring.
 */
export interface AIUsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  fallbackRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  averageLatencyMs: number;
  costPerSuccessfulAnswerUsd: number;
}

/**
 * Filter parameters for querying usage telemetry records.
 */
export interface AIUsageQueryFilters {
  requestUuid?: string;
  provider?: string;
  model?: string;
  purpose?: string;
  status?: AIUsageStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}
