import { ModelCandidatePlan } from "./ai-provider.types.js";

/**
 * Normalized Analytical Context provided by the Copilot orchestration layer.
 * Strictly adheres to data minimization: only fields required for analytical
 * intent parsing are included. No unrestricted records, table dumps, or secrets.
 */
export interface NormalizedAnalyticalContext {
  userId: number;
  roleId: string;
  locale?: string;
  conversationId?: string;
  allowedEntities?: string[];
  datasetContext?: {
    datasetId?: string;
    availableMetrics?: string[];
    availableDimensions?: string[];
  };
}

import { PromptMetadata } from "../prompts/prompt.types.js";

/**
 * Application-owned request context passed into the AI Service.
 * Isolates the application workflow from provider-specific parameters.
 */
export interface AIServiceRequest {
  prompt: string;
  context: NormalizedAnalyticalContext;
  promptKey?: string;
  promptVersion?: string;
  tokenBudget?: {
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxConversationTokens?: number;
  };
  correlationId?: string;
}

/**
 * Normalized telemetry collected by the AI Service for operational
 * observability and integration with the model_usage operational schema.
 */
export interface AIServiceUsageTelemetry {
  provider: string;
  providerName?: string;
  model: string;
  modelName?: string;
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
 * Application-owned candidate result returned by the AI Service.
 * Does NOT expose raw provider responses, SDK exceptions, or internal endpoints.
 */
export interface AIServiceResult {
  candidatePlan: ModelCandidatePlan;
  narrative?: string;
  usage: AIServiceUsageTelemetry;
  fromFallback: boolean;
  fallbackReason?: string;
  isDegraded: boolean;
  promptMetadata?: PromptMetadata;
  correlationId?: string;
}

/**
 * Standardized application error codes for Copilot AI operations.
 */
export type AIServiceErrorCode =
  | "COPILOT_MODEL_UNAVAILABLE"
  | "COPILOT_MODEL_DEGRADED"
  | "COPILOT_MODEL_TIMEOUT"
  | "COPILOT_INVALID_RESPONSE"
  | "COPILOT_TOKEN_BUDGET_EXCEEDED"
  | "COPILOT_CONFIG_ERROR"
  | "COPILOT_PROMPT_ERROR"
  | "COPILOT_SERVICE_ERROR";

/**
 * Application-level exception thrown by the AI Service.
 * Encapsulates failure details in a normalized taxonomy without leaking SDK details.
 */
export class AIServiceException extends Error {
  public readonly code: AIServiceErrorCode;
  public readonly statusCode: number;
  public readonly isTransient: boolean;
  public readonly correlationId?: string;
  public readonly details?: string[];

  constructor(
    code: AIServiceErrorCode,
    message: string,
    options: {
      statusCode?: number;
      isTransient?: boolean;
      correlationId?: string;
      details?: string[];
    } = {},
  ) {
    super(message);
    this.name = "AIServiceException";
    this.code = code;
    this.statusCode = options.statusCode ?? (
      code === "COPILOT_TOKEN_BUDGET_EXCEEDED" || code === "COPILOT_INVALID_RESPONSE"
        ? 422
        : 503
    );
    this.isTransient = options.isTransient ?? (
      code === "COPILOT_MODEL_TIMEOUT" || code === "COPILOT_MODEL_UNAVAILABLE"
    );
    this.correlationId = options.correlationId;
    this.details = options.details;

    Object.setPrototypeOf(this, AIServiceException.prototype);
  }
}
