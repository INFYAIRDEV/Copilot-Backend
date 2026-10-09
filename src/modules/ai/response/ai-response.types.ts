import {
  ModelCandidatePlan,
  AIUsageTelemetry,
} from "../types/ai-provider.types.js";
import { PromptMetadata } from "../prompts/prompt.types.js";

/**
 * Standard AI response states recognized by the Copilot architecture.
 */
export type AIResponseStatus = "SUCCESS" | "DEGRADED" | "FALLBACK" | "ERROR";

/**
 * Metadata captured from AI response for audit events and operational tracing.
 */
export interface AIResponseAuditMetadata {
  requestUuid: string;
  planHash?: string;
  outputHash?: string;
  providerName: string;
  modelName: string;
  status: AIResponseStatus;
  warningCodes: string[];
}

/**
 * Telemetry record normalized for integration with the copilot.model_usage operational schema.
 */
export interface AIResponseTelemetryRecord {
  requestUuid: string;
  provider: string;
  model: string;
  promptVersion?: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  estimatedCostUsd?: number;
  retryCount: number;
  status: AIResponseStatus;
}

/**
 * Traceable metadata associated with the processed AI response.
 */
export interface AIResponseMetadata {
  correlationId: string;
  timestamp: string;
  promptKey?: string;
  promptVersion?: string;
  outputHash?: string;
  planHash?: string;
}

/**
 * Normalized usage telemetry matching application-level contracts.
 */
export interface NormalizedUsageTelemetry {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
  modelVersion?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  latencyMs: number;
  retryCount: number;
  requestOutcome: "SUCCESS" | "FALLBACK" | "DEGRADED" | "FAILED";
  estimatedCostUsd?: number;
}

/**
 * Complete application-owned handled AI response representation.
 * Disconnects the application from provider-specific formats and prepares
 * candidate plans for downstream semantic and policy validation.
 */
export interface HandledAIResponse {
  readonly status: AIResponseStatus;
  readonly candidatePlan: ModelCandidatePlan;
  readonly narrative?: string;
  readonly isDegraded: boolean;
  readonly fromFallback: boolean;
  readonly fallbackReason?: string;
  readonly usage: NormalizedUsageTelemetry;
  readonly metadata: AIResponseMetadata;
  readonly auditMetadata: AIResponseAuditMetadata;
  readonly telemetryRecord: AIResponseTelemetryRecord;
  readonly promptMetadata?: PromptMetadata;
}

/**
 * Handled narrative interpretation response.
 */
export interface HandledNarrativeResponse {
  readonly narrative: string;
  readonly isValidated: boolean;
  readonly isFallbackNarrative: boolean;
  readonly claimRefs?: string[];
  readonly warningCode?: string;
}

/**
 * Configuration options for the AI Response Handler.
 */
export interface AIResponseHandlerOptions {
  maxNarrativeLength?: number;
  maxCandidateIntents?: number;
  disallowExecutableSql?: boolean;
}

/**
 * Result of AI response validation checks.
 */
export interface AIResponseValidationResult {
  isValid: boolean;
  status: AIResponseStatus;
  errors: string[];
}
