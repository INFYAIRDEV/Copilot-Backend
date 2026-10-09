import {
  AIProviderResponse,
  AIProviderException,
} from "../types/ai-provider.types.js";
import { PromptMetadata } from "../prompts/prompt.types.js";
import {
  HandledAIResponse,
  HandledNarrativeResponse,
  AIResponseHandlerOptions,
  AIResponseStatus,
} from "./ai-response.types.js";
import { AIResponseValidator } from "./ai-response.validator.js";
import { AIResponseNormalizer } from "./ai-response.normalizer.js";
import { AIResponseException } from "./ai-response.errors.js";
import { logger } from "../../../shared/utils/logger.js";

/**
 * Interface contract for AI Response Handling component.
 */
export interface IAIResponseHandler {
  /**
   * Processes, validates, and normalizes candidate plan responses from AI providers.
   */
  handleResponse(
    rawResponse: unknown,
    context: {
      correlationId: string;
      promptMetadata?: PromptMetadata;
      purpose?: string;
      startTime?: number;
    },
    options?: AIResponseHandlerOptions,
  ): HandledAIResponse;

  /**
   * Processes, validates, and normalizes AI narrative interpretations of deterministic results.
   */
  handleNarrativeResponse(
    rawResponse: unknown,
    context: {
      correlationId: string;
      promptMetadata?: PromptMetadata;
      authoritativeData?: Record<string, unknown>;
    },
    options?: AIResponseHandlerOptions,
  ): HandledNarrativeResponse;

  /**
   * Normalizes provider exceptions into application-level AIResponseExceptions.
   */
  handleProviderFailure(
    error: unknown,
    context: {
      correlationId: string;
      providerName?: string;
      modelName?: string;
    },
  ): never;
}

/**
 * AIResponseHandler
 *
 * Implements the centralized AI Response Handling layer for the Copilot Backend.
 *
 * Sits in the flow:
 * AI Service → AI Provider Abstraction → [AI Response Handler] → Candidate Typed Analytical Plan
 *   ↓
 * Semantic Validation → Policy Validation → Application-Owned AST → Parameterized SQL
 *
 * Guarantees:
 * 1. AI output is untrusted and strictly validated.
 * 2. Directly executable SQL is detected and rejected with COPILOT_UNSAFE_AI_OUTPUT.
 * 3. Provider SDK objects/errors are stripped and normalized into application-owned types.
 * 4. Preserves degraded and fallback response states without silently assuming HTTP 200 success.
 * 5. Provides cryptographic verification hashes and normalized model_usage telemetry.
 * 6. Decouples AI narrative interpretations from authoritative deterministic calculation results.
 */
export class AIResponseHandler implements IAIResponseHandler {
  constructor(private readonly defaultOptions: AIResponseHandlerOptions = {}) {}

  /**
   * Processes and normalizes an AI provider response into a HandledAIResponse.
   */
  public handleResponse(
    rawResponse: unknown,
    context: {
      correlationId: string;
      promptMetadata?: PromptMetadata;
      purpose?: string;
      startTime?: number;
    },
    options: AIResponseHandlerOptions = {},
  ): HandledAIResponse {
    const correlationId = context.correlationId;
    const effectiveOptions = { ...this.defaultOptions, ...options };
    const durationMs = context.startTime ? Date.now() - context.startTime : 0;

    // 1. Structural and Safety Validation
    const validationResult = AIResponseValidator.validateCandidateResponse(
      rawResponse,
      effectiveOptions,
      correlationId,
    );

    if (!validationResult.isValid) {
      logger.warn(
        `[AIResponseHandler] Candidate response validation failed [correlationId: ${correlationId}]: ${validationResult.errors.join("; ")}`,
      );
      throw new AIResponseException(
        "COPILOT_MALFORMED_CANDIDATE",
        "Candidate response failed structural validation",
        {
          correlationId,
          details: validationResult.errors,
        },
      );
    }

    const providerResponse = rawResponse as AIProviderResponse;

    // 2. Classify Response Status
    let status: AIResponseStatus = "SUCCESS";
    let isDegraded = false;
    let fromFallback = false;

    if (providerResponse.fromFallback) {
      status = "FALLBACK";
      fromFallback = true;
      isDegraded = true;
    }

    // 3. Normalize Usage Telemetry
    const normalizedUsage = AIResponseNormalizer.normalizeUsage(
      providerResponse.usage,
      status,
      durationMs,
    );

    // 4. Generate Cryptographic Plan and Output Hashes
    const planHash = AIResponseNormalizer.hashObject(
      providerResponse.candidatePlan,
    );
    const outputHash = AIResponseNormalizer.hashObject({
      candidatePlan: providerResponse.candidatePlan,
      narrative: providerResponse.narrative,
    });

    // 5. Generate Response Metadata
    const metadata = AIResponseNormalizer.createResponseMetadata(
      correlationId,
      {
        promptMetadata: context.promptMetadata,
        planHash,
        outputHash,
      },
    );

    // 6. Generate Telemetry Record for copilot.model_usage
    const telemetryRecord = AIResponseNormalizer.createTelemetryRecord(
      normalizedUsage,
      {
        correlationId,
        promptVersion: context.promptMetadata?.version,
        purpose: context.purpose || "CANDIDATE_PLAN",
        status,
      },
    );

    // 7. Generate Audit Event Metadata for copilot.audit_event
    const auditMetadata = AIResponseNormalizer.createAuditMetadata({
      correlationId,
      providerName: normalizedUsage.providerName,
      modelName: normalizedUsage.modelName,
      status,
      planHash,
      outputHash,
      warningCodes: fromFallback ? ["COPILOT_FALLBACK_APPLIED"] : [],
    });

    logger.info(
      `[AIResponseHandler] Handled AI response successfully [correlationId: ${correlationId}, status: ${status}, planHash: ${planHash.substring(0, 8)}, tokens: ${normalizedUsage.totalTokens}]`,
    );

    // 8. Return Handled Application-Owned Response
    return {
      status,
      candidatePlan: providerResponse.candidatePlan,
      narrative: providerResponse.narrative,
      isDegraded,
      fromFallback,
      fallbackReason: providerResponse.fallbackReason,
      usage: normalizedUsage,
      metadata,
      auditMetadata,
      telemetryRecord,
      promptMetadata: context.promptMetadata,
    };
  }

  /**
   * Processes and normalizes an AI narrative interpretation of authoritative calculation results.
   */
  public handleNarrativeResponse(
    rawResponse: unknown,
    context: {
      correlationId: string;
      promptMetadata?: PromptMetadata;
      authoritativeData?: Record<string, unknown>;
    },
    options: AIResponseHandlerOptions = {},
  ): HandledNarrativeResponse {
    const correlationId = context.correlationId;
    const effectiveOptions = { ...this.defaultOptions, ...options };

    // Extract narrative text from object or direct string
    let narrativeText = "";
    if (typeof rawResponse === "string") {
      narrativeText = rawResponse;
    } else if (
      rawResponse &&
      typeof rawResponse === "object" &&
      "narrative" in rawResponse &&
      typeof (rawResponse as any).narrative === "string"
    ) {
      narrativeText = (rawResponse as any).narrative;
    } else {
      narrativeText = "";
    }

    const validationResult = AIResponseValidator.validateNarrativeResponse(
      narrativeText,
      effectiveOptions,
      context.authoritativeData,
      correlationId,
    );

    if (!validationResult.isValid) {
      logger.warn(
        `[AIResponseHandler] Narrative validation failed [correlationId: ${correlationId}]: ${validationResult.errors.join("; ")}`,
      );

      // Return handled narrative with validation failure flag rather than crashing
      // authoritative analytical calculation results!
      return {
        narrative: "Standard analytical calculation results generated.",
        isValidated: false,
        isFallbackNarrative: true,
        warningCode:
          validationResult.warningCode || "COPILOT_NARRATIVE_VALIDATION_FAILED",
      };
    }

    return {
      narrative: narrativeText,
      isValidated: true,
      isFallbackNarrative: false,
    };
  }

  /**
   * Normalizes provider-level errors into application-owned AIResponseExceptions.
   */
  public handleProviderFailure(
    error: unknown,
    context: {
      correlationId: string;
      providerName?: string;
      modelName?: string;
    },
  ): never {
    const correlationId = context.correlationId;

    if (error instanceof AIProviderException) {
      logger.warn(
        `[AIResponseHandler] Provider failure [correlationId: ${correlationId}, category: ${error.category}]: ${error.message}`,
      );

      let code: any = "COPILOT_MODEL_UNAVAILABLE";
      let statusCode = 503;

      switch (error.category) {
        case "UNAVAILABLE":
        case "TRANSIENT_FAILURE":
        case "RATE_LIMITED":
          code = "COPILOT_MODEL_UNAVAILABLE";
          statusCode = 503;
          break;
        case "TIMEOUT":
          code = "COPILOT_MODEL_UNAVAILABLE";
          statusCode = 504;
          break;
        case "INVALID_RESPONSE":
          code = "COPILOT_INVALID_RESPONSE";
          statusCode = 422;
          break;
        default:
          code = "COPILOT_MODEL_UNAVAILABLE";
          statusCode = 503;
      }

      throw new AIResponseException(
        code,
        "AI provider is currently unavailable or returned an invalid response",
        {
          statusCode,
          correlationId,
          providerName: context.providerName || error.providerName,
          modelName: context.modelName,
          isTransient: error.isTransient,
        },
      );
    }

    if (error instanceof AIResponseException) {
      throw error;
    }

    // Generic error
    const msg =
      error instanceof Error ? error.message : "Internal AI response failure";
    logger.error(
      `[AIResponseHandler] Unexpected response handling error [correlationId: ${correlationId}]: ${msg}`,
    );

    throw new AIResponseException(
      "COPILOT_SERVICE_ERROR",
      "An unexpected error occurred during AI response processing",
      {
        statusCode: 500,
        correlationId,
      },
    );
  }
}

/**
 * Default singleton instance of AIResponseHandler.
 */
export const defaultAIResponseHandler = new AIResponseHandler();
